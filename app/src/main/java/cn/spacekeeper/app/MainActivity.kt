package cn.spacekeeper.app

import android.content.Intent
import android.os.Bundle
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import cn.spacekeeper.core.*
import coil.compose.AsyncImage
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val Ink = Color(0xFF23243B)
private val Violet = Color(0xFF6556DB)
private val Green = Color(0xFF197A63)
private val Muted = Color(0xFF74778A)
private val Page = Color(0xFFF7F8FC)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { SpaceKeeperTheme { App() } }
    }
}

@Composable fun SpaceKeeperTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = lightColorScheme(primary = Violet, secondary = Green,
        background = Page, surface = Color.White, onSurface = Ink, onBackground = Ink), content = content)
}

@Composable private fun App(vm: AppViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) result.data?.let { data -> data.data?.let { vm.chooseScope(it, data.flags) } }
    }
    LaunchedEffect(state.notice) { state.notice?.let { snackbar.showSnackbar(it); vm.dismissNotice() } }
    Scaffold(containerColor = Page, snackbarHost = { SnackbarHost(snackbar) }, bottomBar = {
        NavigationBar(containerColor = Color.White, tonalElevation = 0.dp) {
            listOf("空间" to AppIcons.PieChart, "清理计划" to AppIcons.Checklist,
                "记录" to AppIcons.History, "设置" to AppIcons.Tune).forEachIndexed { index, item ->
                NavigationBarItem(selected = state.tab == index, onClick = { vm.tab(index) },
                    icon = { Icon(item.second, contentDescription = item.first) }, label = { Text(item.first) })
            }
        }
    }) { padding ->
        if (!state.initialized) Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        else Box(Modifier.padding(padding)) {
            when (state.tab) {
                0 -> Home(state, vm) {
                    picker.launch(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION))
                }
                1 -> PlanScreen(state, vm)
                2 -> HistoryScreen(state, vm)
                else -> SettingsScreen(state, vm)
            }
        }
    }
}

@Composable private fun PageTitle(kicker: String, title: String, subtitle: String) {
    Column(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 8.dp)) {
        Text(kicker, color = Violet, style = MaterialTheme.typography.labelMedium, letterSpacing = 2.sp)
        Spacer(Modifier.height(8.dp))
        Text(title, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(7.dp))
        Text(subtitle, color = Muted, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable private fun Home(state: AppState, vm: AppViewModel, chooseFolder: () -> Unit) {
    var intent by remember(state.policy.userIntent) { mutableStateOf(state.policy.userIntent) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(22.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item { PageTitle("SPACE KEEPER  /  拾光", "给回忆，留点空间", "整理重复内容，把值得留下的留好。") }
        item {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp))
                .background(Brush.linearGradient(listOf(Color(0xFF7162E6), Color(0xFF5145B5)))).padding(24.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(AppIcons.AutoAwesome, null, tint = Color.White)
                    Spacer(Modifier.width(8.dp)); Text("当前目录 · 媒体占用", color = Color.White.copy(alpha = .85f))
                }
                Spacer(Modifier.height(24.dp))
                Text(if (state.assets.isEmpty()) "等待分析" else bytes(state.assets.sumOf { it.size }), color = Color.White,
                    style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(12.dp))
                Text("${state.assets.count { it.isImage }} 张图片   ·   ${state.assets.count { it.isVideo }} 个视频", color = Color.White.copy(alpha = .82f))
                Spacer(Modifier.height(24.dp))
                Button(onClick = { if (state.scope == null) chooseFolder() else vm.scan() }, enabled = !state.busy,
                    colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Violet),
                    modifier = Modifier.fillMaxWidth().height(52.dp)) {
                    Icon(if (state.scope == null) AppIcons.FolderOpen else AppIcons.Search, null)
                    Spacer(Modifier.width(8.dp)); Text(if (state.scope == null) "选择清理目录" else "分析并生成清理计划")
                }
            }
        }
        if (state.busy) item { ProgressCard(state, vm::pause) }
        item {
            Panel {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(AppIcons.FolderOpen, null, tint = Violet)
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(state.scopeName.ifBlank { "存储目录" }, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text("仅扫描授权范围 · 包含子目录", color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                    TextButton(onClick = chooseFolder, enabled = !state.busy) { Text("更换") }
                }
            }
        }
        item {
            Panel {
                Text("这次想怎么整理？", fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = intent, onValueChange = { if (it.length <= 2000) intent = it },
                    placeholder = { Text("例如：仅清理重复内容，保留所有截图") },
                    modifier = Modifier.fillMaxWidth(), minLines = 2, enabled = !state.busy,
                    shape = RoundedCornerShape(14.dp))
                TextButton(onClick = { vm.interpretIntent(intent) }, enabled = !state.busy) {
                    Icon(AppIcons.AutoAwesome, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
                    Text(if (state.settings.enabled) "用 LLM 解析偏好" else "LLM 尚未连接 · 使用下方设置")
                }
                ToggleRow("分析相似照片", "推荐保留项，删除由你逐项选择", state.policy.includeSimilar, !state.busy) {
                    vm.updatePolicy(state.policy.copy(includeSimilar = it, source = "local-settings"))
                }
                ToggleRow("保护截图", "按文件名识别截图；其他重要文件可手动保护", state.policy.protectScreenshots, !state.busy) {
                    vm.updatePolicy(state.policy.copy(protectScreenshots = it, source = "local-settings"))
                }
            }
        }
        item { InfoRow(AppIcons.Shield, "先看计划，再清理", "完整哈希验证重复内容。所有删除都需要你确认；原始媒体默认不上传。") }
        val large = state.assets.filter { it.isVideo }.sortedByDescending { it.size }.take(6)
        if (large.isNotEmpty()) {
            item { Text("较大的视频", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium) }
            items(large, key = { it.id }) { asset ->
                Panel { AssetRow(asset, "${bytes(asset.size)} · 具体操作以清理计划为准", null, false, {}, vm) }
            }
        }
        item { Text("${if (state.settings.enabled) "远程模型网关已启用" else "本地规则模式 · 未调用 LLM / Jev"}  ·  v0.1", color = Muted, style = MaterialTheme.typography.labelSmall) }
    }
}

@Composable private fun PlanScreen(state: AppState, vm: AppViewModel) {
    val plan = state.plan
    var confirmation by remember { mutableStateOf<Plan?>(null) }
    var category by remember { mutableIntStateOf(0) }
    if (plan == null) {
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(AppIcons.Checklist, null, tint = Violet, modifier = Modifier.size(60.dp))
            Spacer(Modifier.height(18.dp)); Text("先生成一份清理计划", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(10.dp)); Text("授权目录后，应用会自动分析图片和视频。", color = Muted)
            Spacer(Modifier.height(20.dp)); Button(onClick = { vm.tab(0) }) { Text("前往空间页") }
        }; return
    }
    val editable = plan.status == PlanStatus.REVIEW && !state.busy
    val finished = plan.status in setOf(PlanStatus.COMPLETED, PlanStatus.PARTIAL)
    val groups = plan.groups.filter { category == 0 || (category == 1 && it.relation == Relation.EXACT_DUPLICATE) || (category == 2 && it.relation == Relation.VISUALLY_SIMILAR) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(22.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { PageTitle("REVIEW  /  ${statusLabel(plan.status)}", "你的清理计划", "${date(plan.createdAt)} · 版本 ${plan.version} · 可查看每一份保留内容")
            Text(Uri.decode(plan.scopeId.substringAfterLast('/')), color = Muted, style = MaterialTheme.typography.bodySmall) }
        item {
            Panel(color = Color(0xFFEAF5EF)) {
                Text(if (finished) "成功删除文件大小" else "预计释放空间", color = Green)
                Spacer(Modifier.height(8.dp))
                Text(bytes(if (finished) state.results.values.sumOf { it.reclaimedBytes } else plan.selectedBytes),
                    fontWeight = FontWeight.Bold, style = MaterialTheme.typography.displaySmall, color = Green)
                Text(if (finished) "以执行记录为准；设备可用空间变化可能不同" else "已选择 ${plan.selectedActions.size} 个文件 · 按文件逻辑大小计算", color = Green, style = MaterialTheme.typography.bodySmall)
                if (!finished) {
                    Spacer(Modifier.height(16.dp))
                    Button(onClick = { confirmation = plan }, enabled = plan.selectedActions.isNotEmpty() && !state.busy,
                        modifier = Modifier.fillMaxWidth().height(50.dp), colors = ButtonDefaults.buttonColors(containerColor = Green)) {
                        Text(if (plan.status == PlanStatus.REVIEW) "查看并确认清理" else "继续已确认的计划")
                    }
                }
            }
        }
        if (state.busy) item { ProgressCard(state, vm::pause) }
        item { InfoRow(AppIcons.VerifiedUser, "删除后无法通过本应用恢复", "完全重复项已推荐选择；相似照片可能记录不同瞬间，请放大查看后再选。压缩功能不在此版本中。") }
        if (plan.skippedAnalysisItems > 0) item {
            InfoRow(AppIcons.Info, "有 ${plan.skippedAnalysisItems} 项未完成分析", "部分文件或子目录无法访问、读取失败或在分析时发生变化。本计划仅包含已完成分析的内容。")
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("全部", "完全重复", "相似照片").forEachIndexed { index, label -> FilterChip(selected = category == index, onClick = { category = index }, label = { Text(label) }) }
            }
        }
        if (groups.isEmpty()) item { Panel { Text("这个分类没有需要处理的内容。", color = Muted) } }
        items(groups, key = { it.id }) { group ->
            GroupCard(group, plan, state.results, editable, vm)
        }
    }
    confirmation?.let { confirmedPlan ->
        AlertDialog(onDismissRequest = { confirmation = null }, icon = { Icon(AppIcons.DeleteOutline, null) },
            title = { Text(if (confirmedPlan.status == PlanStatus.REVIEW) "确认永久删除？" else "继续清理？") },
            text = { Column {
                Text("计划包含 ${confirmedPlan.selectedActions.size} 个文件，预计释放 ${bytes(confirmedPlan.selectedBytes)}。")
                Spacer(Modifier.height(12.dp))
                if (confirmedPlan.selectedActions.any { it.relation == Relation.VISUALLY_SIMILAR }) Text("你选择了相似照片，它们并非完全重复，请确认已经查看差异。", color = MaterialTheme.colorScheme.error)
                Spacer(Modifier.height(8.dp)); Text("本应用没有回收站，删除不可撤销。执行前会再次验证文件和保留副本，变化项目自动跳过。")
            } }, confirmButton = {
                TextButton(onClick = { confirmation = null; vm.execute(confirmedPlan.digest()) }) { Text("确认并执行", color = MaterialTheme.colorScheme.error) }
            }, dismissButton = { TextButton(onClick = { confirmation = null }) { Text("返回检查") } })
    }
}

@Composable private fun GroupCard(group: MediaGroup, plan: Plan, results: Map<String, ActionResult>, editable: Boolean, vm: AppViewModel) {
    val actions = plan.actions.filter { it.groupId == group.id }
    val keeperId = actions.firstOrNull()?.keeper?.assetId
    var expanded by remember(group.id) { mutableStateOf(false) }
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(if (group.relation == Relation.EXACT_DUPLICATE) AppIcons.ContentCopy else AppIcons.BurstMode, null, tint = Violet)
            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                Text(if (group.relation == Relation.EXACT_DUPLICATE) "完全重复 · ${group.members.size} 项" else "相似照片 · ${group.members.size} 项", fontWeight = FontWeight.SemiBold)
                Text(if (group.relation == Relation.EXACT_DUPLICATE) "完整 SHA-256 已比对" else "建议来源：${sourceLabel(actions.firstOrNull()?.decisionSource)}", style = MaterialTheme.typography.labelSmall, color = Muted)
            }
            if (editable) TextButton(onClick = { vm.keepAll(group.id) }) { Text("全部保留") }
        }
        Spacer(Modifier.height(10.dp)); Text(group.evidence.description, color = Muted, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(12.dp))
        val sorted = group.members.sortedBy { it.id != keeperId }
        val visible = if (expanded) sorted else sorted.take(3)
        visible.forEach { asset ->
            val action = actions.find { it.target.assetId == asset.id }
            val result = action?.let { results[it.id] }
            val label = when {
                result != null -> result.reason
                asset.isProtected(plan.policy) -> "已保护 · 保留"
                asset.id == keeperId -> "保留副本"
                action == null -> "保留"
                else -> "${bytes(asset.size)} · ${if (action.selected) "计划删除" else "尚未选择删除"}"
            }
            AssetRow(asset, label, action?.selected, editable && action != null && !asset.isProtected(plan.policy),
                { selected -> action?.let { vm.select(it.id, selected) } }, vm, allowProtect = editable)
            if (editable && asset.id != keeperId) {
                TextButton(onClick = { vm.chooseKeeper(group.id, asset.id) }, modifier = Modifier.align(Alignment.End)) { Text("改为保留这一份") }
            }
            Spacer(Modifier.height(8.dp))
        }
        if (sorted.size > 3) TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "收起" else "展开其余 ${sorted.size - 3} 项") }
    }
}

@Composable private fun AssetRow(asset: Asset, detail: String, selected: Boolean?, selectable: Boolean,
    onSelected: (Boolean) -> Unit, vm: AppViewModel, allowProtect: Boolean = false) {
    val context = LocalContext.current
    fun preview() {
        runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(asset.uri), asset.mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }.onFailure { vm.notice("无法打开预览，请安装支持该媒体格式的查看应用。") }
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        AsyncImage(model = asset.uri, contentDescription = "预览 ${asset.name}", contentScale = ContentScale.Crop,
            modifier = Modifier.size(66.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xFFEDECF5)).clickable { preview() })
        Column(Modifier.weight(1f).padding(horizontal = 10.dp).clickable { preview() }) {
            Text(asset.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
            Text(asset.parentId.substringAfter(':'), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall, color = Muted)
            Text(detail, color = if (detail.contains("保留") || detail.contains("保护")) Green else Muted, style = MaterialTheme.typography.bodySmall, maxLines = 3)
            if (allowProtect) TextButton(onClick = { vm.protect(asset.id, !asset.protected) }, contentPadding = PaddingValues(0.dp), modifier = Modifier.height(32.dp)) {
                Text(if (asset.protected) "取消文件保护" else "保护此文件", style = MaterialTheme.typography.labelSmall)
            }
        }
        if (selected != null) Checkbox(checked = selected, onCheckedChange = onSelected, enabled = selectable)
        else Icon(AppIcons.CheckCircle, null, tint = Green, modifier = Modifier.size(22.dp))
    }
}

@Composable private fun HistoryScreen(state: AppState, vm: AppViewModel) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(22.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { PageTitle("JOURNAL  /  操作记录", "每一步，都有记录", "计划、用户确认与执行结果保存在设备本地。") }
        if (state.history.isEmpty()) item { Panel { Text("还没有清理记录。先从一个目录开始。", color = Muted) } }
        items(state.history, key = { it.id }) { plan ->
            Panel {
                Text(date(plan.createdAt), fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                Text("${statusLabel(plan.status)} · 计划选择 ${plan.selectedActions.size} 项", color = Muted)
                Text("计划容量 ${bytes(plan.selectedBytes)}", color = Muted)
                TextButton(onClick = { vm.viewPlan(plan) }, enabled = !state.busy) { Text("查看计划与结果") }
            }
        }
    }
}

@Composable private fun SettingsScreen(state: AppState, vm: AppViewModel) {
    var enabled by remember(state.settings) { mutableStateOf(state.settings.enabled) }
    var url by remember(state.settings) { mutableStateOf(state.settings.baseUrl) }
    var token by remember(state.settings) { mutableStateOf(state.settings.token) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(22.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        PageTitle("PREFERENCES  /  设置", "由你掌握边界", "本地分析随时可用，远程模型按需开启。")
        Panel {
            Text("LLM + Jev 网关", fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Text("未连接时使用本地规则，不代表 Jev 推理。网关须按项目中的接口文档部署，并实际接入对应模型。", color = Muted, style = MaterialTheme.typography.bodySmall)
            ToggleRow("允许远程模型调用", "发送你输入的偏好与相似组尺寸、清晰度、保护状态；不发送原始媒体、文件名或路径。可能产生网关费用。", enabled, !state.busy) { enabled = it }
            OutlinedTextField(url, { url = it }, label = { Text("HTTPS 网关地址") }, placeholder = { Text("https://gateway.example.com") },
                modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !state.busy)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(token, { token = it }, label = { Text("访问密钥（保存在系统密钥库保护的存储中）") },
                visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !state.busy)
            Spacer(Modifier.height(16.dp))
            Button(onClick = { vm.saveSettings(ModelSettings(enabled, url, token)) }, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) { Text("保存模型设置") }
        }
        Panel {
            Text("目录授权", fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp)); Text(state.scopeName, color = Muted)
            TextButton(onClick = vm::revokeScope, enabled = state.scope != null && !state.busy) { Text("撤销当前目录授权") }
        }
        InfoRow(AppIcons.Info, "当前版本的能力", "支持完全重复图片与视频清理、相似照片人工筛选、文件保护和操作记录。分析期间请保持应用打开；暂停后可复用缓存继续。暂不支持压缩、云盘、自动后台扫描和回收站。")
    }
}

@Composable private fun Panel(color: Color = Color.White, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(color).padding(18.dp), content = content)
}
@Composable private fun ToggleRow(title: String, description: String, checked: Boolean, enabled: Boolean, changed: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(description, style = MaterialTheme.typography.bodySmall, color = Muted)
        }
        Switch(checked, changed, enabled = enabled)
    }
}
@Composable private fun InfoRow(icon: ImageVector, title: String, text: String) {
    Row(Modifier.fillMaxWidth()) {
        Icon(icon, null, tint = Green, modifier = Modifier.size(22.dp))
        Column(Modifier.padding(start = 10.dp)) {
            Text(title, fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(4.dp)); Text(text, color = Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}
@Composable private fun ProgressCard(state: AppState, pause: () -> Unit) {
    Panel {
        Text(state.progress.phase, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(12.dp))
        if (state.progress.total > 0) LinearProgressIndicator(progress = { state.progress.done.toFloat() / state.progress.total }, modifier = Modifier.fillMaxWidth())
        else LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        Text("已处理 ${state.progress.done}${if (state.progress.total > 0) " / ${state.progress.total}" else ""} · 跳过 ${state.progress.skipped}", color = Muted, style = MaterialTheme.typography.bodySmall)
        if (!state.executing) TextButton(onClick = pause) { Text("暂停分析") }
        else Text("请保持应用打开，执行记录会持续保存。", color = Muted, style = MaterialTheme.typography.bodySmall)
    }
}
fun bytes(value: Long): String = when {
    value >= (1L shl 30) -> String.format(Locale.ROOT, "%.2f GiB", value / (1L shl 30).toDouble())
    value >= (1L shl 20) -> String.format(Locale.ROOT, "%.1f MiB", value / (1L shl 20).toDouble())
    value >= 1024 -> String.format(Locale.ROOT, "%.1f KiB", value / 1024.0)
    else -> "$value B"
}
private fun date(value: Long) = SimpleDateFormat("MM 月 dd 日 HH:mm", Locale.CHINA).format(Date(value))
private fun sourceLabel(source: String?) = when (source) {
    "jev-gateway" -> "Jev 网关"
    "local-rules" -> "本地清晰度规则"
    "user" -> "你的选择"
    else -> "待人工复核"
}
private fun statusLabel(status: PlanStatus) = when (status) {
    PlanStatus.REVIEW -> "待确认"
    PlanStatus.APPROVED -> "已确认"
    PlanStatus.RUNNING -> "执行中 / 可恢复"
    PlanStatus.COMPLETED -> "已完成"
    PlanStatus.PARTIAL -> "部分完成"
}
