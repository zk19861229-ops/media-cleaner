package cn.spacekeeper.core

import org.junit.Test
import kotlin.test.*

class SafetyTest {
    private val hash = "a".repeat(64)
    private fun asset(id: String, hash: String = this.hash, protected: Boolean = false, perceptual: Long? = null) = Asset(
        id, "scope", "content://test/$id", "$id.jpg", "image/jpeg", 1024, 100, hash,
        perceptualHash = perceptual, width = 100, height = 100, protected = protected, parentId = "root",
    )
    private fun plan(vararg assets: Asset) = PlanCompiler.compile("scope", assets.toList(), Policy(protectScreenshots = false))
    private fun approved(plan: Plan) = plan.copy(status = PlanStatus.APPROVED)
    private fun approval(plan: Plan) = Approval(plan.id, plan.version, plan.digest(), 1)

    @Test fun `exact duplicates retain one and count only copies`() {
        val plan = plan(asset("a"), asset("b"), asset("c"))
        assertEquals(2, plan.selectedActions.size)
        assertEquals(2048, plan.selectedBytes)
        assertTrue(plan.selectedActions.all { it.keeper.assetId == "a" })
    }
    @Test fun `equal sizes do not establish duplicate content`() {
        assertTrue(plan(asset("a"), asset("b", "b".repeat(64))).actions.isEmpty())
    }
    @Test fun `missing and malformed hashes are never evidence`() {
        val assets = listOf(asset("a").copy(hash = null), asset("b").copy(hash = null), asset("c", "short"), asset("d", "short"))
        assertTrue(PlanCompiler.compile("scope", assets, Policy()).actions.isEmpty())
    }
    @Test fun `protected file is retained and never targeted`() {
        val plan = plan(asset("a"), asset("b", protected = true), asset("c", protected = true))
        assertEquals(listOf("a"), plan.selectedActions.map { it.target.assetId })
        assertEquals("b", plan.selectedActions.single().keeper.assetId)
    }
    @Test fun `screenshot protection is applied at compilation`() {
        val plan = PlanCompiler.compile("scope", listOf(asset("a").copy(name = "Screenshot_1.png"), asset("b")), Policy())
        assertEquals("a", plan.actions.single().keeper.assetId)
        assertEquals("b", plan.actions.single().target.assetId)
    }
    @Test fun `similar content defaults to unselected`() {
        val plan = plan(asset("a", perceptual = 0), asset("b", "b".repeat(64), perceptual = 1))
        assertEquals(Relation.VISUALLY_SIMILAR, plan.actions.single().relation)
        assertFalse(plan.actions.single().selected)
        assertEquals(0, plan.selectedBytes)
    }
    @Test fun `similarity is not made transitive`() {
        val a = asset("a", perceptual = 0).copy(sharpness = 3.0)
        val b = asset("b", "b".repeat(64), perceptual = 63).copy(sharpness = 2.0)
        val c = asset("c", "c".repeat(64), perceptual = 4095).copy(sharpness = 1.0)
        val groups = Grouping.similar(listOf(a, b, c), emptyList())
        assertEquals(setOf("a", "b"), groups.single().members.map { it.id }.toSet())
    }
    @Test fun `duplicate and similarity groups cannot create keeper chains`() {
        val plan = plan(asset("a", perceptual = 0), asset("b", perceptual = 0), asset("c", "b".repeat(64), perceptual = 1))
        assertEquals(1, plan.actions.size)
        assertTrue(ManifestRules.validate(plan).isEmpty())
    }
    @Test fun `wrong scope input is rejected`() {
        assertFailsWith<IllegalArgumentException> { plan(asset("a"), asset("b").copy(scopeId = "other")) }
    }
    @Test fun `model cannot reference files outside group or claim invalid confidence`() {
        val group = Grouping.exact(listOf(asset("a"), asset("b"))).single()
        assertFalse(PlanCompiler.validRecommendation(group, Recommendation(DecisionType.RECOMMEND_KEEPER, "outside", .99)))
        assertFalse(PlanCompiler.validRecommendation(group, Recommendation(DecisionType.RECOMMEND_KEEPER, "a", Double.NaN)))
        assertFalse(PlanCompiler.validRecommendation(group, Recommendation(DecisionType.RECOMMEND_KEEPER, "a", 1.1)))
        assertFalse(PlanCompiler.validRecommendation(group, Recommendation(DecisionType.KEEP_ALL, "a", .99)))
    }
    @Test fun `approval binds selection snapshots and plan version`() {
        val plan = plan(asset("a"), asset("b"))
        val approval = approval(plan)
        assertTrue(approval.matches(approved(plan)))
        assertFalse(approval.matches(plan.select(plan.actions.single().id, false)))
        val tampered = plan.copy(actions = plan.actions.map { it.copy(target = it.target.copy(uri = "content://other")) })
        assertFalse(approval.matches(tampered))
    }
    @Test fun `approved plans cannot change selection`() {
        val plan = approved(plan(asset("a"), asset("b")))
        assertFailsWith<IllegalArgumentException> { plan.select(plan.actions.single().id, false) }
    }
    @Test fun `ledger action IDs are unique across plans`() {
        assertNotEquals(plan(asset("a"), asset("b")).actions.single().id, plan(asset("a"), asset("b")).actions.single().id)
    }
    @Test fun `user can choose a different keeper and must reselect deletion candidates`() {
        val plan = plan(asset("a"), asset("b"), asset("c"))
        val updated = plan.chooseKeeper(plan.groups.single().id, "b")
        assertEquals(2, updated.version)
        assertTrue(updated.actions.all { it.keeper.assetId == "b" && !it.selected })
        assertEquals(setOf("a", "c"), updated.actions.map { it.target.assetId }.toSet())
        assertFalse(approval(plan).matches(updated))
    }
    @Test fun `choosing a keeper cannot expose protected files to deletion`() {
        val plan = plan(asset("a", protected = true), asset("b"), asset("c"))
        val updated = plan.chooseKeeper(plan.groups.single().id, "b")
        assertEquals(listOf("c"), updated.actions.map { it.target.assetId })
        assertFailsWith<NoSuchElementException> { plan.chooseKeeper(plan.groups.single().id, "outside") }
    }
    @Test fun `manifest rejects keeper scheduled for deletion`() {
        val plan = plan(asset("a"), asset("b"))
        val action = plan.actions.single()
        val bad = plan.copy(actions = listOf(action, action.copy(id = "evil", target = action.keeper, keeper = action.target)))
        assertTrue(ManifestRules.validate(bad).any { it.contains("保留副本") })
    }
    @Test fun `manifest rejects fabricated evidence`() {
        val plan = plan(asset("a"), asset("b"))
        assertTrue(ManifestRules.validate(plan.copy(actions = plan.actions.map { it.copy(evidenceId = "fake") })).isNotEmpty())
    }

    private class MemoryLedger : ExecutionLedger {
        val rows = mutableMapOf<String, ActionResult>()
        override fun get(actionId: String) = rows[actionId]
        override fun put(result: ActionResult) { rows[result.actionId] = result }
    }
    private class Files(assets: List<Asset>) : FileGateway {
        val files = assets.associateBy { it.id }.toMutableMap()
        var granted = true
        var unavailable = false
        var deleteCalls = 0
        var deleteSuccess = true
        var deleteThrows = false
        val protections = mutableSetOf<String>()
        override fun hasGrant(scopeId: String) = granted
        override fun inspect(snapshot: Snapshot) = if (unavailable) FileState.Unavailable("provider unavailable") else files[snapshot.assetId]?.let(FileState::Present) ?: FileState.Missing
        override fun isProtected(assetId: String) = assetId in protections
        override fun delete(snapshot: Snapshot): Boolean {
            deleteCalls++
            if (deleteThrows) error("connection lost")
            if (deleteSuccess) files.remove(snapshot.assetId)
            return deleteSuccess
        }
    }
    private fun execution(change: (Files, MemoryLedger, Plan) -> Unit = { _, _, _ -> }): Triple<ActionResult, Files, MemoryLedger> {
        val assets = listOf(asset("a"), asset("b"))
        val plan = approved(plan(*assets.toTypedArray()))
        val files = Files(assets)
        val ledger = MemoryLedger()
        change(files, ledger, plan)
        return Triple(CleanupExecutor(files, ledger).execute(plan, approval(plan), plan.actions.single()), files, ledger)
    }
    @Test fun `successful delete reclaims only target and retains keeper`() {
        val (result, files) = execution()
        assertEquals(ActionStatus.SUCCEEDED, result.status)
        assertEquals(1024, result.reclaimedBytes)
        assertEquals(setOf("a"), files.files.keys)
    }
    @Test fun `changed target hash with unchanged size and time is skipped`() {
        val (result, files) = execution { files, _, _ -> files.files["b"] = files.files.getValue("b").copy(hash = "c".repeat(64)) }
        assertEquals(ActionStatus.SKIPPED, result.status); assertEquals(0, files.deleteCalls)
    }
    @Test fun `changed target timestamp is skipped`() {
        val (result, files) = execution { files, _, _ -> files.files["b"] = files.files.getValue("b").copy(modified = 101) }
        assertEquals(ActionStatus.SKIPPED, result.status); assertEquals(0, files.deleteCalls)
    }
    @Test fun `missing keeper is skipped`() {
        val (result, files) = execution { files, _, _ -> files.files.remove("a") }
        assertEquals(ActionStatus.SKIPPED, result.status); assertEquals(0, files.deleteCalls)
    }
    @Test fun `changed keeper is skipped`() {
        val (result, files) = execution { files, _, _ -> files.files["a"] = files.files.getValue("a").copy(hash = "c".repeat(64)) }
        assertEquals(ActionStatus.SKIPPED, result.status); assertEquals(0, files.deleteCalls)
    }
    @Test fun `revoked grant prevents deleting`() {
        val (result, files) = execution { files, _, _ -> files.granted = false }
        assertEquals(ActionStatus.SKIPPED, result.status); assertEquals(0, files.deleteCalls)
    }
    @Test fun `protection added after approval prevents deleting`() {
        val (result, files) = execution { files, _, _ -> files.protections.add("b") }
        assertEquals(ActionStatus.SKIPPED, result.status); assertEquals(0, files.deleteCalls)
    }
    @Test fun `provider failure is not counted as missing or reclaimed`() {
        val (result, files) = execution { files, _, _ -> files.unavailable = true }
        assertEquals(ActionStatus.SKIPPED, result.status); assertEquals(0, result.reclaimedBytes); assertEquals(0, files.deleteCalls)
    }
    @Test fun `already missing file does not count as our deletion`() {
        val (result, _) = execution { files, _, _ -> files.files.remove("b") }
        assertEquals(ActionStatus.SKIPPED, result.status); assertEquals(0, result.reclaimedBytes)
    }
    @Test fun `interrupted deletion with missing file remains uncertain`() {
        val (result, files) = execution { files, ledger, plan ->
            files.files.remove("b"); ledger.put(ActionResult(plan.actions.single().id, ActionStatus.EXECUTING, "in flight"))
        }
        assertEquals(ActionStatus.UNKNOWN, result.status); assertEquals(0, result.reclaimedBytes); assertEquals(0, files.deleteCalls)
    }
    @Test fun `successful operation is idempotent`() {
        val (result, files) = execution { _, ledger, plan -> ledger.put(ActionResult(plan.actions.single().id, ActionStatus.SUCCEEDED, "done", 1024)) }
        assertEquals(ActionStatus.SUCCEEDED, result.status); assertEquals(0, files.deleteCalls)
    }
    @Test fun `failed deletion keeps file and does not claim space`() {
        val (result, files) = execution { files, _, _ -> files.deleteSuccess = false }
        assertEquals(ActionStatus.FAILED, result.status); assertEquals(0, result.reclaimedBytes); assertEquals(2, files.files.size)
    }
    @Test fun `throw during deletion is uncertain and not automatically repeated`() {
        val (result, _) = execution { files, _, _ -> files.deleteThrows = true }
        assertEquals(ActionStatus.UNKNOWN, result.status)
    }
    @Test fun `unapproved and injected actions are rejected before filesystem access`() {
        val plan = plan(asset("a"), asset("b"))
        val files = Files(listOf(asset("a"), asset("b")))
        val executor = CleanupExecutor(files, MemoryLedger())
        assertFailsWith<IllegalArgumentException> { executor.execute(plan, approval(plan), plan.actions.single()) }
        assertFailsWith<IllegalArgumentException> { executor.execute(approved(plan), approval(plan), plan.actions.single().copy(id = "injected")) }
        assertEquals(0, files.deleteCalls)
    }
    @Test fun `serialized plan retains its approval digest`() {
        val plan = plan(asset("a"), asset("b"))
        val decoded = codec.decodeFromString<Plan>(codec.encodeToString(Plan.serializer(), plan))
        assertEquals(plan.digest(), decoded.digest())
    }
}
