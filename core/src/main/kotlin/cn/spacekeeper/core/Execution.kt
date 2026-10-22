package cn.spacekeeper.core

object ManifestRules {
    fun validate(plan: Plan): List<String> = buildList {
        val actions = plan.selectedActions
        val targets = actions.map { it.target.assetId }
        if (targets.distinct().size != targets.size) add("同一文件存在重复动作")
        if (plan.actions.map { it.id }.distinct().size != plan.actions.size) add("动作 ID 重复")
        for (action in actions) {
            val group = plan.groups.find { it.id == action.groupId }
            val target = group?.members?.find { it.id == action.target.assetId }
            val keeper = group?.members?.find { it.id == action.keeper.assetId }
            if (target == null || keeper == null || group.evidence.id != action.evidenceId || group.relation != action.relation) {
                add("缺少有效的文件或证据关系"); continue
            }
            if (target.snapshot() != action.target || keeper.snapshot() != action.keeper) add("文件快照与证据不一致")
            if (target.isProtected(plan.policy)) add("目标文件受到保护")
            if (action.target.assetId == action.keeper.assetId || action.target.uri == action.keeper.uri || action.keeper.assetId in targets) add("保留副本不能被删除")
            if (listOf(action.target, action.keeper).any { it.scopeId != plan.scopeId || !it.hash.matches(Regex("[a-f0-9]{64}")) }) add("授权范围或指纹无效")
            if (action.relation == Relation.EXACT_DUPLICATE && (action.target.hash != action.keeper.hash || action.target.size != action.keeper.size)) add("内容并非完全重复")
        }
    }
}

/** Implementations must distinguish missing files from unavailable/revoked providers. */
sealed interface FileState {
    data class Present(val asset: Asset) : FileState
    data object Missing : FileState
    data class Unavailable(val reason: String) : FileState
}

interface FileGateway {
    fun hasGrant(scopeId: String): Boolean
    /** Fresh full hash, metadata and parent-membership verification. Never a cached analysis. */
    fun inspect(snapshot: Snapshot): FileState
    fun isProtected(assetId: String): Boolean
    fun delete(snapshot: Snapshot): Boolean
}

interface ExecutionLedger {
    fun get(actionId: String): ActionResult?
    /** Must commit before a destructive operation. */
    fun put(result: ActionResult)
}

class CleanupExecutor(private val files: FileGateway, private val ledger: ExecutionLedger) {
    fun execute(plan: Plan, approval: Approval, action: PlannedAction): ActionResult {
        require(approval.matches(plan)) { "清理计划已变化，需要重新确认" }
        require(plan.status == PlanStatus.APPROVED || plan.status == PlanStatus.RUNNING) { "计划尚未批准" }
        require(plan.selectedActions.any { it == action }) { "动作未被用户确认" }
        require(ManifestRules.validate(plan).isEmpty()) { "计划不满足保护约束" }
        val previous = ledger.get(action.id)
        if (previous?.status in setOf(ActionStatus.SUCCEEDED, ActionStatus.SKIPPED, ActionStatus.UNKNOWN)) return previous!!
        fun finish(status: ActionStatus, reason: String, bytes: Long = 0) = ActionResult(action.id, status, reason, bytes).also(ledger::put)
        if (!files.hasGrant(plan.scopeId)) return finish(ActionStatus.SKIPPED, "目录授权已失效")
        if (files.isProtected(action.target.assetId)) return finish(ActionStatus.SKIPPED, "文件已被保护")
        ledger.put(ActionResult(action.id, ActionStatus.VALIDATING, "正在验证文件与保留副本"))
        return try {
            when (val target = files.inspect(action.target)) {
                FileState.Missing -> return finish(
                    if (previous?.status == ActionStatus.EXECUTING) ActionStatus.UNKNOWN else ActionStatus.SKIPPED,
                    if (previous?.status == ActionStatus.EXECUTING) "中断后文件已不存在，无法确认删除归属，不计入释放容量" else "执行前文件已不存在",
                )
                is FileState.Unavailable -> return finish(ActionStatus.SKIPPED, target.reason)
                is FileState.Present -> if (target.asset.snapshot() != action.target) return finish(ActionStatus.SKIPPED, "目标文件已发生变化")
            }
            when (val keeper = files.inspect(action.keeper)) {
                FileState.Missing -> return finish(ActionStatus.SKIPPED, "保留副本已不存在")
                is FileState.Unavailable -> return finish(ActionStatus.SKIPPED, keeper.reason)
                is FileState.Present -> if (keeper.asset.snapshot() != action.keeper) return finish(ActionStatus.SKIPPED, "保留副本已发生变化")
            }
            if (!files.hasGrant(plan.scopeId) || files.isProtected(action.target.assetId)) return finish(ActionStatus.SKIPPED, "执行条件已变化")
            // Keeper verification can take time for large videos. Recheck the target afterwards.
            val finalTarget = files.inspect(action.target)
            if (finalTarget !is FileState.Present || finalTarget.asset.snapshot() != action.target)
                return finish(ActionStatus.SKIPPED, "目标文件在最终校验时发生变化或不可访问")
            ledger.put(ActionResult(action.id, ActionStatus.EXECUTING, "正在删除"))
            val deleted = files.delete(action.target)
            when (files.inspect(action.target)) {
                FileState.Missing -> if (deleted) finish(ActionStatus.SUCCEEDED, "已永久删除", action.target.size)
                    else finish(ActionStatus.UNKNOWN, "文件已不存在，但删除接口未确认成功")
                is FileState.Unavailable -> finish(ActionStatus.UNKNOWN, "删除后无法访问目录，结果待核实")
                is FileState.Present -> finish(ActionStatus.FAILED, "文件仍存在，未完成删除")
            }
        } catch (exception: Exception) {
            finish(if (ledger.get(action.id)?.status == ActionStatus.EXECUTING) ActionStatus.UNKNOWN else ActionStatus.FAILED,
                "操作中断：${exception.javaClass.simpleName}")
        }
    }
}
