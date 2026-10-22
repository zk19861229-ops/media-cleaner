package cn.spacekeeper.core

import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path
import java.util.Base64
import kotlin.test.*

/** Real filesystem exercise using only newly generated 1x1 PNGs, never personal files. */
class FileIntegrationTest {
    private val png = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOt0AAAAASUVORK5CYII=")

    private fun withFiles(block: (Path, List<Asset>, DiskGateway) -> Unit) {
        val directory = Files.createTempDirectory("spacekeeper-integration-")
        try {
            val paths = listOf("a.png", "b.png", "c.png").map { directory.resolve(it).also { p -> Files.write(p, png) } }
            val assets = paths.map { diskAsset(directory, it) }
            block(directory, assets, DiskGateway(directory))
        } finally {
            Files.walk(directory).use { stream -> stream.sorted(Comparator.reverseOrder()).forEach(Files::deleteIfExists) }
        }
    }
    private fun diskAsset(root: Path, file: Path) = Asset(
        file.fileName.toString(), root.toString(), file.toUri().toString(), file.fileName.toString(), "image/png",
        Files.size(file), Files.getLastModifiedTime(file).toMillis(), sha256(Files.readAllBytes(file)), parentId = root.toString(),
    )
    private inner class DiskGateway(private val directory: Path) : FileGateway {
        override fun hasGrant(scopeId: String) = scopeId == directory.toString()
        override fun inspect(snapshot: Snapshot): FileState {
            val path = Path.of(java.net.URI(snapshot.uri))
            if (path.parent != directory) return FileState.Unavailable("outside directory")
            return if (Files.exists(path)) FileState.Present(diskAsset(directory, path)) else FileState.Missing
        }
        override fun isProtected(assetId: String) = false
        override fun delete(snapshot: Snapshot) = Files.deleteIfExists(Path.of(java.net.URI(snapshot.uri)))
    }
    private class Ledger : ExecutionLedger {
        val rows = mutableMapOf<String, ActionResult>()
        override fun get(actionId: String) = rows[actionId]
        override fun put(result: ActionResult) { rows[result.actionId] = result }
    }

    @Test fun `only approved selected copy is deleted from actual directory`() = withFiles { root, assets, files ->
        val draft = PlanCompiler.compile(root.toString(), assets, Policy())
        // User chooses to preserve one of the otherwise duplicate copies.
        val edited = draft.select(draft.actions.last().id, false)
        assertTrue(assets.all { Files.exists(Path.of(java.net.URI(it.uri))) })
        val approved = edited.copy(status = PlanStatus.APPROVED)
        val approval = Approval(approved.id, approved.version, approved.digest(), 1)
        val result = CleanupExecutor(files, Ledger()).execute(approved, approval, approved.selectedActions.single())
        assertEquals(ActionStatus.SUCCEEDED, result.status)
        assertEquals(png.size.toLong(), result.reclaimedBytes)
        Files.list(root).use { assertEquals(2L, it.count()) }
        assertContentEquals(png, Files.readAllBytes(root.resolve("a.png")))
    }
    @Test fun `same length real file modification is not deleted`() = withFiles { root, assets, files ->
        val plan = PlanCompiler.compile(root.toString(), assets, Policy()).copy(status = PlanStatus.APPROVED)
        val target = plan.selectedActions.first()
        val changed = png.copyOf().apply { this[lastIndex] = (this[lastIndex].toInt() xor 1).toByte() }
        Files.write(Path.of(java.net.URI(target.target.uri)), changed)
        val result = CleanupExecutor(files, Ledger()).execute(plan, Approval(plan.id, plan.version, plan.digest(), 1), target)
        assertEquals(ActionStatus.SKIPPED, result.status)
        Files.list(root).use { assertEquals(3L, it.count()) }
    }
    @Test fun `different plans cannot reuse an earlier approval on real files`() = withFiles { root, assets, files ->
        val first = PlanCompiler.compile(root.toString(), assets, Policy())
        val second = PlanCompiler.compile(root.toString(), assets, Policy()).copy(status = PlanStatus.APPROVED)
        val approval = Approval(first.id, first.version, first.digest(), 1)
        assertFailsWith<IllegalArgumentException> { CleanupExecutor(files, Ledger()).execute(second, approval, second.selectedActions.first()) }
        Files.list(root).use { assertEquals(3L, it.count()) }
    }
}
