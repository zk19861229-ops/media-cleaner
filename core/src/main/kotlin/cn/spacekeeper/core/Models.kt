package cn.spacekeeper.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest

val codec = Json { encodeDefaults = true; ignoreUnknownKeys = false }
fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes).joinToString("") { "%02x".format(it) }

@Serializable
data class Asset(
    val id: String,
    val scopeId: String,
    val uri: String,
    val name: String,
    val mime: String,
    val size: Long,
    val modified: Long,
    val hash: String? = null,
    val perceptualHash: Long? = null,
    val width: Int = 0,
    val height: Int = 0,
    val sharpness: Double = 0.0,
    val protected: Boolean = false,
    val parentId: String = "",
) {
    val isImage: Boolean get() = mime.startsWith("image/")
    val isVideo: Boolean get() = mime.startsWith("video/")
    fun snapshot() = Snapshot(id, scopeId, uri, size, modified, hash ?: "", parentId)
}

@Serializable
data class Snapshot(
    val assetId: String, val scopeId: String, val uri: String,
    val size: Long, val modified: Long, val hash: String, val parentId: String,
)

@Serializable enum class Relation { EXACT_DUPLICATE, VISUALLY_SIMILAR }
@Serializable enum class DecisionType { RECOMMEND_KEEPER, KEEP_ALL, REQUEST_REVIEW }
@Serializable enum class ReasonCode { IDENTICAL_BYTES, SHARPER_IMAGE, REVIEW_REQUIRED }
@Serializable
data class Evidence(
    val id: String, val relation: Relation, val memberIds: List<String>,
    val algorithm: String, val description: String,
)
@Serializable
data class MediaGroup(val id: String, val relation: Relation, val members: List<Asset>, val evidence: Evidence)
@Serializable
data class Recommendation(
    val decision: DecisionType, val keeperAssetId: String? = null,
    val confidence: Double? = null, val reason: ReasonCode = ReasonCode.REVIEW_REQUIRED,
    val source: String = "local-rules",
)
@Serializable
data class Policy(
    val includeSimilar: Boolean = true,
    val protectScreenshots: Boolean = true,
    val userIntent: String = "优先清理完全重复内容，相似照片逐组确认",
    val source: String = "local-settings",
)
@Serializable
data class PlannedAction(
    val id: String, val groupId: String, val relation: Relation,
    val target: Snapshot, val keeper: Snapshot, val evidenceId: String,
    val selected: Boolean, val confidence: Double? = null,
    val decisionSource: String = "deterministic",
)
@Serializable enum class PlanStatus { REVIEW, APPROVED, RUNNING, COMPLETED, PARTIAL }
@Serializable
data class Plan(
    val id: String, val version: Int = 1, val scopeId: String, val createdAt: Long,
    val actions: List<PlannedAction>, val groups: List<MediaGroup>, val policy: Policy,
    val status: PlanStatus = PlanStatus.REVIEW,
    val skippedAnalysisItems: Int = 0,
) {
    val selectedActions: List<PlannedAction> get() = actions.filter { it.selected }
    val selectedBytes: Long get() = selectedActions.sumOf { it.target.size }
    // Status is operational metadata, not a change to the approved manifest.
    fun digest(): String = sha256(codec.encodeToString(copy(status = PlanStatus.REVIEW)).toByteArray())
    fun select(actionId: String, selected: Boolean): Plan {
        require(status == PlanStatus.REVIEW) { "已确认的计划不可修改" }
        require(actions.any { it.id == actionId }) { "动作不存在" }
        return copy(version = version + 1, actions = actions.map {
            if (it.id == actionId) it.copy(selected = selected) else it
        })
    }
    fun chooseKeeper(groupId: String, assetId: String): Plan {
        require(status == PlanStatus.REVIEW) { "已确认的计划不可修改" }
        val group = groups.single { it.id == groupId }
        val keeper = group.members.single { it.id == assetId }
        val updated = group.members.filter { it.id != assetId && !it.isProtected(policy) }.map { target ->
            PlannedAction("${id}_${group.id}_${target.id}", group.id, group.relation, target.snapshot(), keeper.snapshot(),
                group.evidence.id, selected = false, decisionSource = "user")
        }
        return copy(version = version + 1, actions = actions.filter { it.groupId != groupId } + updated)
    }
}
@Serializable
data class Approval(val planId: String, val version: Int, val digest: String, val approvedAt: Long) {
    fun matches(plan: Plan) = planId == plan.id && version == plan.version && digest == plan.digest()
}
@Serializable enum class ActionStatus { PENDING, VALIDATING, EXECUTING, SUCCEEDED, SKIPPED, FAILED, UNKNOWN }
@Serializable
data class ActionResult(val actionId: String, val status: ActionStatus, val reason: String, val reclaimedBytes: Long = 0)

fun isScreenshot(asset: Asset): Boolean = listOf("screenshot", "screen_shot", "截图", "截屏")
    .any { asset.name.contains(it, ignoreCase = true) }

fun Asset.isProtected(policy: Policy) = protected || (policy.protectScreenshots && isScreenshot(this))
