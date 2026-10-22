package cn.spacekeeper.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import cn.spacekeeper.core.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.security.KeyStore
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class ModelSettings(val enabled: Boolean = false, val baseUrl: String = "", val token: String = "")

class SettingsStore(context: Context) {
    private val prefs = context.getSharedPreferences("models", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("model-token", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("model-token", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun load(): ModelSettings {
        val encrypted = prefs.getString("token", "").orEmpty()
        val token = if (encrypted.isBlank()) "" else runCatching {
            val parts = encrypted.split(":")
            Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
            }.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)).toString(Charsets.UTF_8)
        }.getOrDefault("")
        return ModelSettings(prefs.getBoolean("enabled", false), prefs.getString("url", "").orEmpty(), token)
    }
    fun save(settings: ModelSettings) {
        if (settings.enabled || settings.baseUrl.isNotBlank()) validateEndpoint(settings.baseUrl)
        val encrypted = if (settings.token.isEmpty()) "" else {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            val bytes = cipher.doFinal(settings.token.toByteArray())
            Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(bytes, Base64.NO_WRAP)
        }
        check(prefs.edit().putBoolean("enabled", settings.enabled).putString("url", settings.baseUrl.trim())
            .putString("token", encrypted).commit()) { "设置保存失败" }
    }
}

fun validateEndpoint(value: String) {
    val url = value.trim().toHttpUrl()
    require(url.isHttps && url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null) {
        "网关需要 HTTPS 地址，且不能在 URL 中包含密钥、查询参数或片段"
    }
}

@Serializable private data class PolicyReply(val includeSimilar: Boolean, val protectScreenshots: Boolean)
@Serializable private data class DecisionReply(val decision: DecisionType, val keeperId: String? = null, val confidence: Double)

/** This is our gateway contract, NOT an asserted official Jev API. */
class ModelGateway(private val settings: ModelSettings) {
    private val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS)
        .callTimeout(25, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
    private fun post(path: String, body: JsonObject): String {
        require(settings.enabled) { "远程模型未启用" }
        validateEndpoint(settings.baseUrl)
        val url = settings.baseUrl.trim().trimEnd('/').toHttpUrl().newBuilder().addPathSegments(path).build()
        val request = Request.Builder().url(url)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .apply { if (settings.token.isNotBlank()) header("Authorization", "Bearer ${settings.token}") }.build()
        return client.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "模型网关返回 HTTP ${response.code}" }
            val source = response.body?.source() ?: error("模型返回空内容")
            source.request(65537)
            require(source.buffer.size <= 65536) { "模型响应过大" }
            source.readUtf8()
        }
    }
    fun interpret(intent: String, current: Policy): Policy {
        require(intent.length in 1..2000) { "请将偏好控制在 2000 字以内" }
        val response = codec.decodeFromString<PolicyReply>(post("v1/policy", buildJsonObject {
            put("intent", intent)
            put("current", buildJsonObject {
                put("includeSimilar", current.includeSimilar); put("protectScreenshots", current.protectScreenshots)
            })
        }))
        return current.copy(includeSimilar = response.includeSimilar, protectScreenshots = response.protectScreenshots,
            userIntent = intent, source = "llm-gateway")
    }
    fun recommend(group: MediaGroup): Recommendation {
        val aliases = group.members.mapIndexed { index, asset -> "m$index" to asset }.toMap()
        val response = codec.decodeFromString<DecisionReply>(post("v1/decision", buildJsonObject {
            put("task", "recommend_photo_keeper")
            put("relation", group.relation.name)
            put("members", buildJsonArray {
                aliases.forEach { (alias, asset) -> add(buildJsonObject {
                    put("id", alias); put("width", asset.width); put("height", asset.height)
                    put("sharpness", asset.sharpness); put("protected", asset.protected)
                }) }
            })
        }))
        require(response.confidence.isFinite() && response.confidence in 0.0..1.0) { "置信度无效" }
        require(if (response.decision == DecisionType.RECOMMEND_KEEPER) response.keeperId in aliases else response.keeperId == null) { "模型返回的保留项无效" }
        return Recommendation(response.decision, aliases[response.keeperId]?.id, response.confidence,
            source = "jev-gateway")
    }
}
