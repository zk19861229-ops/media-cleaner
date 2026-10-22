package cn.spacekeeper.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.DocumentsContract
import cn.spacekeeper.core.*
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.security.MessageDigest

data class ScanProgress(val phase: String = "", val done: Int = 0, val total: Int = 0, val skipped: Int = 0)

class MediaAccess(private val context: Context, private val db: AppDatabase) : FileGateway {
    private val resolver = context.contentResolver
    private val columns = arrayOf(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    )
    override fun hasGrant(scopeId: String): Boolean = resolver.persistedUriPermissions.any {
        it.uri.toString() == scopeId && it.isReadPermission && it.isWritePermission
    }

    private fun children(scope: Uri, parentId: String): List<Asset> {
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(scope, parentId)
        val cursor = resolver.query(uri, columns, null, null, null) ?: error("无法读取目录")
        return cursor.use { c -> buildList {
            while (c.moveToNext()) {
                val id = c.getString(0)
                val documentUri = DocumentsContract.buildDocumentUriUsingTree(scope, id).toString()
                add(Asset(
                    id = sha256(documentUri.toByteArray()).take(32), scopeId = scope.toString(), uri = documentUri,
                    name = c.getString(1) ?: "未命名", mime = c.getString(2) ?: "application/octet-stream",
                    size = if (c.isNull(3)) -1 else c.getLong(3), modified = if (c.isNull(4)) 0 else c.getLong(4),
                    parentId = parentId,
                ))
            }
        } }
    }

    suspend fun scan(scopeId: String, progress: (ScanProgress) -> Unit): List<Asset> {
        require(hasGrant(scopeId)) { "请重新选择目录并授予读写权限" }
        val scope = Uri.parse(scopeId)
        require(scope.authority == "com.android.externalstorage.documents") { "首版仅支持设备本地存储目录，请勿选择云盘或第三方文件提供方" }
        val queue = ArrayDeque<String>()
        val visited = mutableSetOf<String>()
        val found = mutableListOf<Asset>()
        val ignored = db.list("ignored", scopeId).map { codec.decodeFromString<String>(it) }.toSet()
        var skipped = 0
        queue.add(DocumentsContract.getTreeDocumentId(scope))
        while (queue.isNotEmpty()) {
            currentCoroutineContext().ensureActive()
            val parent = queue.removeFirst()
            if (!visited.add(parent) || parent in ignored) continue
            val entries = try { children(scope, parent) } catch (_: Exception) { skipped++; continue }
            entries.forEach {
                if (it.mime == DocumentsContract.Document.MIME_TYPE_DIR) queue.add(DocumentsContract.getDocumentId(Uri.parse(it.uri)))
                else if ((it.isImage || it.isVideo) && it.size > 0) found += it.copy(protected = db.isProtected(it.id))
            }
            progress(ScanProgress("正在浏览目录", found.size, skipped = skipped))
        }
        val sizeCounts = found.groupingBy { it.size }.eachCount()
        val cache = db.assets(scopeId).associateBy { it.id }
        val result = mutableListOf<Asset>()
        for ((index, asset) in found.withIndex()) {
            currentCoroutineContext().ensureActive()
            progress(ScanProgress("分析图片与视频", index, found.size, skipped))
            try {
                val old = cache[asset.id]
                val canReuse = asset.modified > 0 && old?.size == asset.size && old.modified == asset.modified && !old.hash.isNullOrBlank()
                val analyzed = if (canReuse) old!!.copy(protected = asset.protected, parentId = asset.parentId) else {
                    // Hash every image eligible for similarity; single-size videos need no content read.
                    val coroutine = currentCoroutineContext()
                    val hash = if (asset.isImage || (sizeCounts[asset.size] ?: 0) > 1) hash(Uri.parse(asset.uri)) { coroutine.ensureActive() } else null
                    val metrics = if (asset.isImage) imageMetrics(Uri.parse(asset.uri)) else null
                    asset.copy(hash = hash, perceptualHash = metrics?.hash, width = metrics?.width ?: 0,
                        height = metrics?.height ?: 0, sharpness = metrics?.sharpness ?: 0.0)
                }
                // Reject files that changed while reading; a later scan can retry them.
                val fresh = metadata(asset.snapshot())
                if (fresh == null || fresh.size != asset.size || fresh.modified != asset.modified) { skipped++; continue }
                db.saveAsset(analyzed)
                result += analyzed
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: Exception) { skipped++ }
        }
        progress(ScanProgress("分析完成", found.size, found.size, skipped))
        return result
    }

    private fun hash(uri: Uri, checkCancellation: () -> Unit = {}): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val stream = resolver.openInputStream(uri) ?: error("无法读取文件")
        stream.use {
            val buffer = ByteArray(256 * 1024)
            while (true) {
                checkCancellation()
                if (Thread.currentThread().isInterrupted) throw InterruptedException()
                val count = it.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun metadata(snapshot: Snapshot): Asset? {
        val uri = Uri.parse(snapshot.uri)
        return resolver.query(uri, columns, null, null, null)?.use { c ->
            if (!c.moveToFirst()) null else Asset(snapshot.assetId, snapshot.scopeId, snapshot.uri,
                c.getString(1) ?: "", c.getString(2) ?: "", if (c.isNull(3)) -1 else c.getLong(3),
                if (c.isNull(4)) 0 else c.getLong(4), parentId = snapshot.parentId)
        }
    }

    override fun inspect(snapshot: Snapshot): FileState = try {
        if (!hasGrant(snapshot.scopeId)) FileState.Unavailable("目录授权已失效") else {
            val scope = Uri.parse(snapshot.scopeId)
            val root = DocumentsContract.buildDocumentUriUsingTree(scope, DocumentsContract.getTreeDocumentId(scope))
            val uri = Uri.parse(snapshot.uri)
            if (scope.authority != "com.android.externalstorage.documents" || uri.authority != scope.authority) {
                FileState.Unavailable("目录提供方不受支持")
            } else {
                // Query the actual parent to distinguish missing files from failed provider access.
                val siblings = children(scope, snapshot.parentId)
                val current = siblings.find { it.id == snapshot.assetId }
                if (current == null) FileState.Missing
                else if (!DocumentsContract.isChildDocument(resolver, root, uri)) FileState.Unavailable("文件已移出授权目录")
                else {
                    val hash = hash(uri)
                    val after = metadata(snapshot)
                    if (after == null || after.size != current.size || after.modified != current.modified)
                        FileState.Unavailable("文件在校验期间发生变化")
                    else FileState.Present(current.copy(hash = hash, protected = db.isProtected(snapshot.assetId)))
                }
            }
        }
    } catch (_: Exception) { FileState.Unavailable("无法访问文件或确认其所属目录") }

    override fun isProtected(assetId: String) = db.isProtected(assetId)
    override fun delete(snapshot: Snapshot): Boolean {
        val current = metadata(snapshot) ?: return false
        if (current.size != snapshot.size || current.modified != snapshot.modified || !hasGrant(snapshot.scopeId) || isProtected(snapshot.assetId)) return false
        return DocumentsContract.deleteDocument(resolver, Uri.parse(snapshot.uri))
    }

    private data class Metrics(val hash: Long, val width: Int, val height: Int, val sharpness: Double)
    private fun imageMetrics(uri: Uri): Metrics? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth < 64 || bounds.outHeight < 64) return null
        val options = BitmapFactory.Options().apply {
            inSampleSize = Integer.highestOneBit((maxOf(bounds.outWidth, bounds.outHeight) / 256).coerceAtLeast(1))
        }
        val bitmap = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null
        try {
            val tiny = Bitmap.createScaledBitmap(bitmap, 9, 8, true)
            var hash = 0L
            fun gray(color: Int) = ((color shr 16 and 255) * 299 + (color shr 8 and 255) * 587 + (color and 255) * 114) / 1000
            for (y in 0..7) for (x in 0..7) {
                hash = (hash shl 1) or if (gray(tiny.getPixel(x, y)) > gray(tiny.getPixel(x + 1, y))) 1L else 0L
            }
            if (tiny !== bitmap) tiny.recycle()
            var sum = 0.0
            var count = 0
            for (y in 1 until bitmap.height - 1 step 2) for (x in 1 until bitmap.width - 1 step 2) {
                val laplacian = 4 * gray(bitmap.getPixel(x, y)) - gray(bitmap.getPixel(x - 1, y)) - gray(bitmap.getPixel(x + 1, y)) - gray(bitmap.getPixel(x, y - 1)) - gray(bitmap.getPixel(x, y + 1))
                sum += laplacian.toDouble() * laplacian; count++
            }
            return Metrics(hash, bounds.outWidth, bounds.outHeight, if (count == 0) 0.0 else sum / count)
        } finally { bitmap.recycle() }
    }
}
