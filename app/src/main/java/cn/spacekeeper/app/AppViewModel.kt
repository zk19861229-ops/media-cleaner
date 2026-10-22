package cn.spacekeeper.app

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import cn.spacekeeper.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.encodeToString
import java.util.concurrent.Executors

data class AppState(
    val scope: String? = null, val scopeName: String = "尚未选择目录",
    val assets: List<Asset> = emptyList(), val plan: Plan? = null, val history: List<Plan> = emptyList(),
    val results: Map<String, ActionResult> = emptyMap(), val busy: Boolean = false,
    val executing: Boolean = false, val progress: ScanProgress = ScanProgress(),
    val policy: Policy = Policy(), val settings: ModelSettings = ModelSettings(),
    val notice: String? = null, val tab: Int = 0, val initialized: Boolean = false,
)

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val db = AppDatabase(application)
    private val files = MediaAccess(application, db)
    private val settingsStore = SettingsStore(application)
    private val mutableState = MutableStateFlow(AppState())
    val state = mutableState.asStateFlow()
    private var task: Job? = null
    // All stateful operations share one queue: review edits cannot overwrite an approval.
    private val operations = Executors.newSingleThreadExecutor().asCoroutineDispatcher()

    init {
        viewModelScope.launch(operations) {
            try {
                val scope = db.read("setting", "scope")
                val history = db.plans()
                val plan = history.firstOrNull { it.scopeId == scope }
                val policy = db.read("setting", "policy")?.let { codec.decodeFromString<Policy>(it) } ?: Policy()
                mutableState.update { it.copy(scope = scope, scopeName = scope?.let(::scopeLabel) ?: "尚未选择目录",
                    assets = scope?.let(db::visibleAssets).orEmpty(), plan = plan, history = history,
                    settings = settingsStore.load(), policy = policy, initialized = true,
                    results = plan?.actions?.mapNotNull { a -> db.get(a.id)?.let { a.id to it } }?.toMap().orEmpty(),
                    notice = if (plan?.status in setOf(PlanStatus.APPROVED, PlanStatus.RUNNING)) "发现未完成的已确认计划，可在计划页继续；继续时会重新验证文件。" else null)
                }
            } catch (_: Exception) { mutableState.update { it.copy(initialized = true, notice = "无法加载本地数据，请检查设备空间后重试") } }
        }
    }
    private fun scopeLabel(scope: String) = runCatching { android.provider.DocumentsContract.getTreeDocumentId(Uri.parse(scope)).substringAfter(':') }.getOrDefault("授权目录")
    fun tab(index: Int) { mutableState.update { it.copy(tab = index) } }
    fun dismissNotice() { mutableState.update { it.copy(notice = null) } }
    fun notice(message: String) { mutableState.update { it.copy(notice = message) } }
    fun chooseScope(uri: Uri, flags: Int) {
        if (state.value.busy) return
        task = viewModelScope.launch(operations) {
            try {
                require(uri.authority == "com.android.externalstorage.documents") { "请选择设备本地存储中的文件夹；首版暂不支持云盘" }
                val required = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                require(flags and required == required) { "需要目录读取与写入授权" }
                getApplication<Application>().contentResolver.takePersistableUriPermission(uri, flags and required)
                db.save("setting", "scope", uri.toString())
                val plans = db.plans()
                mutableState.update { it.copy(scope = uri.toString(), scopeName = scopeLabel(uri.toString()),
                    assets = db.visibleAssets(uri.toString()), plan = plans.firstOrNull { p -> p.scopeId == uri.toString() }, results = emptyMap(),
                    notice = "目录已授权，点击开始分析。文件仅在确认计划后删除。") }
            } catch (e: Exception) { notice(e.message ?: "目录授权失败") }
        }
    }
    fun revokeScope() {
        if (state.value.busy) return
        task = viewModelScope.launch(operations) {
            state.value.scope?.let { scope ->
                runCatching { getApplication<Application>().contentResolver.releasePersistableUriPermission(Uri.parse(scope), Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
                db.remove("setting", "scope")
            }
            mutableState.update { it.copy(scope = null, scopeName = "尚未选择目录", assets = emptyList(), plan = null, results = emptyMap()) }
        }
    }
    fun updatePolicy(policy: Policy) {
        if (state.value.busy) return
        // An existing plan stays bound to its original policy; changes apply on the next scan.
        mutableState.update { it.copy(policy = policy) }
        viewModelScope.launch(operations) { db.save("setting", "policy", codec.encodeToString(policy)) }
    }
    fun interpretIntent(intent: String) {
        if (state.value.busy) return
        if (!state.value.settings.enabled) { notice("当前为本地规则模式。请使用下方开关设置策略，或在设置中连接 LLM 网关。"); return }
        mutableState.update { it.copy(busy = true, progress = ScanProgress("LLM 正在解析偏好")) }
        task = viewModelScope.launch(operations) {
            try {
                val policy = ModelGateway(state.value.settings).interpret(intent, state.value.policy)
                db.save("setting", "policy", codec.encodeToString(policy))
                mutableState.update { it.copy(policy = policy, notice = "已解析偏好，请核对相似照片与截图保护开关。新策略在下一次分析生效。") }
            } catch (e: Exception) { notice("偏好解析未完成，原策略保持不变：${e.message}") }
            finally { mutableState.update { it.copy(busy = false) } }
        }
    }
    fun scan() {
        val scope = state.value.scope ?: return
        if (state.value.busy) return
        if (state.value.plan?.status in setOf(PlanStatus.APPROVED, PlanStatus.RUNNING)) {
            notice("请先继续完成已确认计划，再生成新计划。"); tab(1); return
        }
        val policy = state.value.policy
        val settings = state.value.settings
        mutableState.update { it.copy(busy = true, executing = false, progress = ScanProgress("准备扫描"), notice = null) }
        task = viewModelScope.launch(operations) {
            try {
                val assets = files.scan(scope) { progress -> mutableState.update { it.copy(progress = progress) } }
                val exactIds = Grouping.exact(assets).flatMap { it.members }.map { it.id }.toSet()
                val similar = if (policy.includeSimilar) Grouping.similar(assets.filter { it.id !in exactIds }, emptyList()) else emptyList()
                val recommendations = mutableMapOf<String, Recommendation>()
                val gateway = if (settings.enabled) ModelGateway(settings) else null
                var failures = 0
                for ((index, group) in similar.withIndex()) {
                    ensureActive()
                    mutableState.update { it.copy(progress = ScanProgress(if (gateway == null) "整理相似组（本地规则）" else "Jev 网关正在评估", index, similar.size, it.progress.skipped)) }
                    recommendations[group.id] = if (gateway == null) LocalDecisionProvider.recommend(group) else try {
                        gateway.recommend(group)
                    } catch (_: Exception) { failures++; Recommendation(DecisionType.REQUEST_REVIEW, source = "gateway-unavailable") }
                }
                ensureActive()
                val plan = PlanCompiler.compile(scope, assets, policy, recommendations).copy(skippedAnalysisItems = state.value.progress.skipped)
                db.savePlan(plan)
                db.save("inventory", scope, codec.encodeToString(assets.map { it.id }))
                mutableState.update { it.copy(assets = assets, plan = plan, history = db.plans(), results = emptyMap(), tab = 1,
                    notice = if (failures > 0) "$failures 组模型建议不可用，已转为人工复核；完全重复结果仍可使用。" else "清理计划已生成。相似照片未默认勾选，请先查看差异。") }
            } catch (_: CancellationException) { notice("分析已暂停，已完成的文件分析会保留。再次开始将重新遍历并复用有效缓存。") }
            catch (e: Exception) { notice("分析未完成：${e.message}") }
            finally { mutableState.update { it.copy(busy = false, executing = false) } }
        }
    }
    fun pause() { if (!state.value.executing) task?.cancel() }
    fun select(actionId: String, selected: Boolean) {
        if (state.value.busy) return
        val plan = state.value.plan ?: return
        if (plan.status != PlanStatus.REVIEW) return
        val changed = plan.select(actionId, selected)
        mutableState.update { it.copy(plan = changed, history = it.history.map { p -> if (p.id == changed.id) changed else p }) }
        viewModelScope.launch(operations) { db.savePlan(changed) }
    }
    fun keepAll(groupId: String) {
        val plan = state.value.plan ?: return
        if (state.value.busy || plan.status != PlanStatus.REVIEW) return
        val changed = plan.copy(version = plan.version + 1, actions = plan.actions.map { if (it.groupId == groupId) it.copy(selected = false) else it })
        mutableState.update { it.copy(plan = changed, history = it.history.map { p -> if (p.id == changed.id) changed else p }) }
        viewModelScope.launch(operations) { db.savePlan(changed) }
    }
    fun chooseKeeper(groupId: String, assetId: String) {
        val plan = state.value.plan ?: return
        if (state.value.busy || plan.status != PlanStatus.REVIEW) return
        val changed = plan.chooseKeeper(groupId, assetId)
        mutableState.update { it.copy(plan = changed, history = it.history.map { p -> if (p.id == changed.id) changed else p },
            notice = "已更新保留项，请重新勾选这一组中需要删除的文件。") }
        viewModelScope.launch(operations) { db.savePlan(changed) }
    }
    fun protect(assetId: String, enabled: Boolean) {
        if (state.value.busy) return
        task = viewModelScope.launch(operations) {
            db.protect(assetId, enabled)
            val old = state.value.plan
            val changed = if (old?.status == PlanStatus.REVIEW) old.copy(version = old.version + 1,
                groups = old.groups.map { it.copy(members = it.members.map { a -> if (a.id == assetId) a.copy(protected = enabled) else a }) },
                actions = old.actions.map { if (it.target.assetId == assetId && enabled) it.copy(selected = false) else it }) else old
            changed?.let(db::savePlan)
            mutableState.update { it.copy(plan = changed, history = db.plans(), assets = it.assets.map { a -> if (a.id == assetId) a.copy(protected = enabled) else a }) }
        }
    }
    fun execute(expectedDigest: String) {
        val plan = state.value.plan ?: return
        if (state.value.busy) return
        if (plan.digest() != expectedDigest) { notice("计划已变化，请重新查看并确认"); return }
        if (plan.selectedActions.isEmpty()) return
        mutableState.update { it.copy(busy = true, executing = true, progress = ScanProgress("正在验证清理计划")) }
        task = viewModelScope.launch(operations) {
            try {
                require(ManifestRules.validate(plan).isEmpty()) { "计划不满足保护规则，请重新分析" }
                val stored = db.plan(plan.id) ?: error("计划不存在")
                require(stored.digest() == plan.digest()) { "计划已更新，请重新查看并确认" }
                require(stored.status !in setOf(PlanStatus.COMPLETED, PlanStatus.PARTIAL)) { "该计划已结束，请重新分析" }
                val approval = if (plan.status == PlanStatus.REVIEW) Approval(plan.id, plan.version, plan.digest(), System.currentTimeMillis()).also {
                    db.approve(plan, it)
                } else db.approval(plan.id) ?: error("缺少有效确认记录")
                val running = plan.copy(status = PlanStatus.RUNNING)
                db.savePlan(running)
                mutableState.update { it.copy(plan = running) }
                val executor = CleanupExecutor(files, db)
                val results = mutableMapOf<String, ActionResult>()
                running.selectedActions.forEachIndexed { index, action ->
                    ensureActive()
                    mutableState.update { it.copy(progress = ScanProgress("验证并清理文件", index, running.selectedActions.size)) }
                    val result = executor.execute(running, approval, action)
                    results[action.id] = result
                    if (result.status == ActionStatus.SUCCEEDED) db.remove("asset", action.target.assetId)
                    mutableState.update { it.copy(results = results.toMap()) }
                }
                val done = running.copy(status = if (results.values.all { it.status == ActionStatus.SUCCEEDED }) PlanStatus.COMPLETED else PlanStatus.PARTIAL)
                db.savePlan(done)
                mutableState.update { it.copy(plan = done, history = db.plans(), assets = state.value.scope?.let(db::visibleAssets).orEmpty(),
                    notice = "处理结束。成功删除文件 ${results.values.count { r -> r.status == ActionStatus.SUCCEEDED }} 个；跳过与失败项目见计划详情。") }
            } catch (e: Exception) { notice("执行中断，已保存操作记录：${e.message}") }
            finally { mutableState.update { it.copy(busy = false, executing = false) } }
        }
    }
    fun viewPlan(plan: Plan) {
        if (state.value.busy) return
        viewModelScope.launch(operations) {
            val latest = db.plan(plan.id) ?: return@launch
            mutableState.update { it.copy(plan = latest, tab = 1, results = latest.actions.mapNotNull { a -> db.get(a.id)?.let { a.id to it } }.toMap()) }
        }
    }
    fun saveSettings(settings: ModelSettings) {
        if (state.value.busy) return
        viewModelScope.launch(operations) {
            try { settingsStore.save(settings); mutableState.update { it.copy(settings = settings, notice = "模型设置已保存") } }
            catch (e: Exception) { notice(e.message ?: "设置保存失败") }
        }
    }
    override fun onCleared() { super.onCleared(); operations.close() }
}
