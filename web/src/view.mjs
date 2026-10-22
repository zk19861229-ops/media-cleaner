import { EXACT, SIMILAR, selectedActions, selectedBytes, protectedAsset } from './ontology.mjs';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function size(bytes) {
  if (bytes >= 2 ** 30) return `${(bytes / 2 ** 30).toFixed(2)} GiB`;
  if (bytes >= 2 ** 20) return `${(bytes / 2 ** 20).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes ?? 0} B`;
}
export const date = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  plan: '<path d="M9 6h12M9 12h12M9 18h12M3 5l1 1 2-3M3 11l1 1 2-3M3 17l1 1 2-3"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>',
  settings: '<path d="M3 6h4m4 0h10M3 12h10m4 0h4M3 18h2m4 0h12M7 3h4v6H7zM13 9h4v6h-4zM5 15h4v6H5z"/>',
  folder: '<path d="M3 7V5h6l2 2h10v3M3 7v13h16l3-10H7L3 20"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4m-2-2h4"/>',
  shield: '<path d="m12 3-8 3v6c0 5 4 8 8 10 4-2 8-5 8-10V6zM8 12l3 3 5-6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m4 17 5-6 5 5 3-4 4 5"/><circle cx="16" cy="8" r="1.5"/>',
  video: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4z"/>',
  copy: '<path d="M8 8h13v13H8zM16 4V2H2v14h2"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  down: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
};
export const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.image}</svg>`;
const button = (label, action, cls = 'button', extra = '') => `<button class="${cls}" data-action="${action}" ${extra}>${label}</button>`;
const disabled = state => state.busy ? 'disabled' : '';
const statusName = status => ({ REVIEW: '待确认', APPROVED: '已确认', RUNNING: '执行中 · 可继续', COMPLETED: '已完成', PARTIAL: '部分完成' })[status] ?? status;
export const sourceName = source => ({ 'sha256': '完整哈希比对', 'local-rules': '本地清晰度规则', 'jev-gateway': 'Jev 网关建议', user: '你的选择' })[source] ?? '待人工复核';
function title(eyebrow, heading, description, aside = '') {
  return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${heading}</h1><p class="subtitle">${description}</p></div>${aside}</div>`;
}
function modeLabel(state) {
  if (state.scope?.mode === 'demo') return '演示样本 · 只读';
  if (state.scope?.mode === 'readonly') return '只读分析模式';
  if (!state.directorySupported) return '当前浏览器支持只读分析';
  return '文件在本地处理';
}
export function progress(state) {
  if (!state.busy || !state.progress) return '';
  const p = state.progress, amount = p.total ? Math.round(p.done / p.total * 100) : 0;
  return `<section class="progress-panel" aria-live="polite"><div class="progress-heading"><div><strong>${escape(p.phase)}</strong><span>${escape(p.filename ?? '')}</span></div>
    ${state.busy === 'scan' ? button(`${icon('pause')}暂停`, 'cancel', 'button ghost small') : '<span class="spinner"></span>'}</div>
    <progress ${p.total ? `value="${p.done}" max="${p.total}"` : ''} aria-label="处理进度"></progress>
    <div class="progress-meta"><span>已处理 ${p.done ?? 0}${p.total ? ` / ${p.total}` : ''} 项${p.skipped ? ` · 跳过 ${p.skipped}` : ''}</span><span>${p.bytes ? `${size(p.bytes.done)} / ${size(p.bytes.total)}` : p.total ? `${amount}%` : '请保持页面打开'}</span></div></section>`;
}
function overview(state) {
  const total = state.assets.reduce((sum, a) => sum + a.size, 0);
  const images = state.assets.filter(a => a.mime.startsWith('image/'));
  const videos = state.assets.filter(a => a.mime.startsWith('video/'));
  const plan = state.plan?.scopeId === state.scope?.id ? state.plan : null;
  const folder = state.scope ? escape(state.scope.name) : '还没有选择文件夹';
  const recent = videos.toSorted((a, b) => b.size - a.size).slice(0, 6);
  return `${title('YOUR SPACE, REIMAGINED', '给回忆，留点空间。', '重复的可以清理，值得的好好留下。', '<span class="privacy-tag">'+icon('shield')+' 原始媒体不上传</span>')}
    <div class="dashboard-grid"><section class="hero"><div class="hero-copy"><span class="hero-label">${icon('spark')} 你的媒体空间</span>
      <h2>${state.assets.length ? size(total) : '从一个文件夹开始'}</h2><p>${state.assets.length ? `${state.assets.length.toLocaleString()} 个媒体文件，整理后让空间更轻盈。` : '我们帮你找出重复与相似内容。<br>先看清理计划，再决定留下什么。'}</p>
      <div class="hero-actions">${button(`${icon(state.scope ? 'spark' : 'folder')}${state.scope ? '分析并生成计划' : '选择文件夹'}${icon('arrow')}`, state.scope ? 'scan' : 'choose', 'button light', disabled(state))}
      ${button('体验演示', 'demo', 'hero-link', disabled(state))}</div><div class="hero-foot">${icon('shield')} 仅访问你选择的范围 · 清理前需要确认</div></div>
      <div class="hero-art" aria-hidden="true"><div class="art-orbit"></div><div class="photo-card photo-back"><span></span></div><div class="photo-card photo-front"><div class="sun"></div><div class="mountain mountain-one"></div><div class="mountain mountain-two"></div></div><span class="art-check">${icon('check')}</span><span class="art-spark">✦</span></div></section>
      <section class="panel scope-panel"><div class="panel-label">${icon('folder')} 清理范围</div><div class="scope-symbol">${icon('folder')}</div><h3>${folder}</h3><p>${state.scope ? '包含所选文件夹中的子目录' : '选择后，应用会在本地浏览和分析媒体。'}</p>
      <span class="mode-badge">${escape(modeLabel(state))}</span><div class="scope-actions">${button(state.scope ? '更换文件夹' : '选择文件夹', 'choose', 'button secondary', disabled(state))}${button('选择媒体文件', 'choose-files', 'text-button', disabled(state))}</div></section></div>
    ${progress(state)}
    <div class="stats-grid"><section class="stat-card"><span class="stat-icon violet">${icon('image')}</span><div><span>图片</span><strong>${images.length.toLocaleString()} <small>张</small></strong><p>${size(images.reduce((sum, a) => sum + a.size, 0))}</p></div></section>
      <section class="stat-card"><span class="stat-icon blue">${icon('video')}</span><div><span>视频</span><strong>${videos.length.toLocaleString()} <small>个</small></strong><p>${size(videos.reduce((sum, a) => sum + a.size, 0))}</p></div></section>
      <section class="stat-card"><span class="stat-icon green">${icon('copy')}</span><div><span>计划选择的文件</span><strong>${plan ? selectedActions(plan).length : '—'} <small>项</small></strong><p>${plan ? `预计释放 ${size(selectedBytes(plan))}` : '分析后查看清理建议'}</p></div></section></div>
    <div class="lower-grid"><section class="panel policy-panel"><div class="section-heading"><div><p class="eyebrow">MAKE IT YOURS</p><h2>这次，想怎么整理？</h2></div><span class="pill">${state.config.enabled ? 'LLM 网关已启用' : '本地规则模式'}</span></div>
      <label class="sr-only" for="intent">整理偏好</label><textarea id="intent" maxlength="2000" placeholder="例如：仅清理重复内容，保留所有截图" ${disabled(state)}>${escape(state.intent)}</textarea>
      <div class="intent-foot"><span>自然语言解析需要连接 LLM 网关</span>${button(`${icon('spark')}解析偏好`, 'interpret', 'text-button', disabled(state))}</div>
      ${toggle('includeSimilar', '分析相似照片', '推荐保留项，由你逐项确认删除', state.policy.includeSimilar, state)}
      ${toggle('protectScreenshots', '保护截图', '按文件名识别；重要文件也可手动保护', state.policy.protectScreenshots, state)}</section>
      <section class="panel steps-panel"><p class="eyebrow">A LITTLE MORE PEACE OF MIND</p><h2>每一步，都由你掌握</h2><ol><li><span>01</span><div><strong>选择清理范围</strong><p>只读取你授权的文件夹或文件。</p></div></li><li><span>02</span><div><strong>看清每一个建议</strong><p>比较重复与相似内容，选好保留项。</p></div></li><li><span>03</span><div><strong>确认后才执行</strong><p>再次校验文件，变化项目自动跳过。</p></div></li></ol></section></div>
    ${recent.length ? `<section class="panel"><div class="section-heading"><h2>较大的视频</h2><span class="muted">具体操作以清理计划为准</span></div><div class="large-grid">${recent.map(asset => `<button class="large-file" data-action="preview" data-id="${asset.id}"><span class="stat-icon blue">${icon('video')}</span><span><strong>${escape(asset.name)}</strong><small>${size(asset.size)}</small></span>${icon('arrow')}</button>`).join('')}</div></section>` : ''}`;
}
function toggle(key, label, description, checked, state) {
  return `<label class="toggle-row"><span><strong>${label}</strong><small>${description}</small></span><input type="checkbox" class="switch" data-setting="${key}" ${checked ? 'checked' : ''} ${disabled(state)} aria-label="${label}"></label>`;
}
function assetRow(asset, group, plan, state) {
  const action = plan.actions.find(a => a.target.assetId === asset.id && a.groupId === group.id);
  const result = action && state.results[action.id];
  const isProtected = protectedAsset(asset, plan.policy), keeper = group.keeperId === asset.id;
  const editable = plan.status === 'REVIEW' && !state.busy;
  const detail = result?.reason ?? (isProtected ? '已保护 · 保留' : keeper ? '保留这一份' : action?.selected ? '已选择删除' : '未选择删除');
  return `<div class="asset-row ${keeper ? 'keeper' : ''}" data-asset-row="${asset.id}"><button class="asset-thumb" data-action="preview" data-id="${asset.id}" aria-label="预览 ${escape(asset.name)}"><span>${icon(asset.mime.startsWith('video/') ? 'video' : 'image')}</span><img data-preview-id="${asset.id}" alt="" loading="lazy"></button>
    <div class="asset-info"><button class="file-name" data-action="preview" data-id="${asset.id}">${escape(asset.name)}</button><p class="file-path" title="${escape(asset.path.join('/'))}">${escape(asset.path.slice(0, -1).join('/') || '根目录')} · ${size(asset.size)}</p>
      <span class="file-state ${keeper || isProtected ? 'retained' : result?.status === 'FAILED' || result?.status === 'UNKNOWN' ? 'caution' : ''}">${keeper || isProtected ? icon('shield') : ''}${escape(detail)}</span></div>
    <div class="asset-controls">${editable ? `${button(asset.protected ? '取消保护' : '保护', 'protect', 'text-button small', `data-id="${asset.id}"`)}${!keeper ? button('保留这份', 'keeper', 'text-button small', `data-id="${asset.id}" data-group="${group.id}"`) : ''}` : ''}
      ${action ? `<label class="select-label"><input type="checkbox" data-select="${action.id}" ${action.selected ? 'checked' : ''} ${!editable || isProtected ? 'disabled' : ''} aria-label="删除 ${escape(asset.name)}"><span class="sr-only">选择删除</span></label>` : `<span class="keep-check" title="保留">${icon('check')}</span>`}</div></div>`;
}
function groupCard(group, plan, state, index) {
  const expanded = state.expanded.has(group.id), sorted = group.members.toSorted((a, b) => Number(b.id === group.keeperId) - Number(a.id === group.keeperId));
  const visible = expanded ? sorted : sorted.slice(0, 3);
  return `<section class="panel group-card"><div class="group-heading"><span class="stat-icon ${group.relation === EXACT ? 'violet' : 'peach'}">${icon(group.relation === EXACT ? 'copy' : 'image')}</span>
    <div><h3>${group.relation === EXACT ? '完全重复' : '相似照片'} <span>${group.members.length} 项</span></h3><p>${group.relation === EXACT ? '完整 SHA-256 已比对' : escape(sourceName(group.recommendation?.source))}</p></div>
    ${plan.status === 'REVIEW' ? button('整组保留', 'keep-group', 'text-button', `data-group="${group.id}" ${disabled(state)}`) : ''}</div>
    <p class="evidence">${icon('info')}${escape(group.evidence.description)}</p>
    ${visible.map(asset => assetRow(asset, group, plan, state)).join('')}
    ${sorted.length > 3 ? button(expanded ? '收起' : `展开其余 ${sorted.length - 3} 项`, 'expand', 'text-button expand', `data-group="${group.id}"`) : ''}</section>`;
}
function planPage(state) {
  const plan = state.plan;
  if (!plan) return `${title('REVIEW BEFORE YOU REMOVE', '你的清理计划', '每一个建议，都有可以查看的依据。')}<section class="empty-state">${icon('plan')}<h2>先生成一份清理计划</h2><p>选择一个文件夹，我们帮你找出重复与相似内容。</p>${button('前往选择文件夹', 'go-overview', 'button primary')}</section>`;
  const finished = ['COMPLETED', 'PARTIAL'].includes(plan.status), readonly = plan.mode !== 'readwrite';
  const groups = plan.groups.filter(g => state.filter === 'all' || g.relation === state.filter);
  const selected = selectedActions(plan), reclaimed = Object.values(state.results).reduce((sum, r) => sum + r.reclaimedBytes, 0);
  return `${title('REVIEW BEFORE YOU REMOVE', '把选择，留给自己。', `${escape(plan.scopeName)} · ${date(plan.createdAt)} · 计划 v${plan.version}`, `<span class="pill">${statusName(plan.status)}</span>`)}
    <section class="plan-summary"><div><span>${finished ? '成功删除文件的逻辑大小' : '预计释放空间'}</span><strong>${size(finished ? reclaimed : selectedBytes(plan))}</strong><p>${finished ? '设备可用空间净变化可能不同' : `已选择 ${selected.length} 个文件 · 数值按文件逻辑大小计算`}</p></div>
      <div class="plan-summary-actions">${readonly ? `<span class="mode-badge">${plan.mode === 'demo' ? '演示样本' : '当前目录'}仅供分析，不可删除</span>${button(`${icon('down')}导出清理计划`, 'export', 'button primary', disabled(state))}` : finished ? button(`${icon('down')}导出结果记录`, 'export', 'button secondary', disabled(state)) : `${button(`${icon('trash')}${plan.status === 'REVIEW' ? '查看并确认清理' : '继续已确认计划'}`, 'confirm', 'button primary', `${disabled(state)} ${selected.length ? '' : 'disabled'}`)}${button('导出计划', 'export', 'text-button', disabled(state))}`}</div></section>
    ${progress(state)}
    <div class="notice ${readonly ? 'notice-info' : ''}">${icon(readonly ? 'info' : 'shield')}<p>${readonly ? '浏览器尚未获得原文件写入权限。可以预览、调整和导出计划；这些操作不会删除原文件。' : '<strong>删除后无法通过本应用恢复。</strong> 相似照片默认不勾选，请查看差异后选择。确认后会重新校验文件与保留副本。'}</p></div>
    ${plan.skippedAnalysisItems ? `<div class="notice notice-info">${icon('info')}<p>${plan.skippedAnalysisItems} 项未完成分析：可能无法读取或在扫描时发生变化，未纳入本次完整结果。</p></div>` : ''}
    <div class="filter-bar"><div class="segmented">${[['all', '全部'], [EXACT, '完全重复'], [SIMILAR, '相似照片']].map(([key, label]) => button(`${label}<span>${plan.groups.filter(g => key === 'all' || g.relation === key).length}</span>`, 'filter', state.filter === key ? 'active' : '', `data-filter="${key}" aria-pressed="${state.filter === key}"`)).join('')}</div><span class="muted">${groups.length} 组内容</span></div>
    <div class="groups-grid">${groups.slice(0, state.groupLimit).map((group, index) => groupCard(group, plan, state, index)).join('')}</div>
    ${!groups.length ? `<section class="empty-state compact">${icon('check')}<h2>这个分类没有清理建议</h2><p>唯一内容会保留。你可以更换文件夹，或调整相似照片分析设置。</p></section>` : ''}
    ${groups.length > state.groupLimit ? button('继续显示更多组', 'more-groups', 'button secondary load-more') : ''}`;
}
function historyPage(state) {
  return `${title('YOUR LOCAL JOURNAL', '每一步，都有记录。', '清理计划与执行结果保存在这个浏览器中。')}
    ${state.history.length ? `<div class="history-list">${state.history.map(plan => `<button class="panel history-item" data-action="history" data-id="${plan.id}"><span class="stat-icon ${plan.status === 'COMPLETED' ? 'green' : 'violet'}">${icon('history')}</span><span class="history-description"><strong>${escape(plan.scopeName)}</strong><span>${date(plan.createdAt)} · ${plan.mode === 'readwrite' ? '授权目录' : '只读分析'} · 版本 ${plan.version}</span></span><span class="history-numbers"><strong>${size(selectedBytes(plan))}</strong><span>计划选择 ${selectedActions(plan).length} 项</span></span><span class="pill">${statusName(plan.status)}</span>${icon('arrow')}</button>`).join('')}</div>` : `<section class="empty-state">${icon('history')}<h2>还没有清理记录</h2><p>从一个文件夹开始，生成第一份计划。</p>${button('开始整理', 'go-overview', 'button primary')}</section>`}`;
}
function settingsPage(state) {
  return `${title('YOUR DATA, YOUR BOUNDARIES', '边界，始终由你决定。', '本地分析随时可用，模型服务按需连接。')}
    <div class="settings-grid"><section class="panel settings-panel"><div class="section-heading"><h2>LLM + Jev 网关</h2><span class="pill">${state.config.enabled ? '已启用' : '未连接'}</span></div>
      <p class="muted">LLM 解析整理偏好，Jev 对相似组提出结构化建议。未连接时使用本地规则，不代表真实模型推理。</p>
      <form id="gateway-form"><label class="field-label" for="gateway-url">HTTPS 网关地址</label><input id="gateway-url" name="url" type="url" placeholder="https://gateway.example.com" value="${escape(state.config.url)}" ${disabled(state)}>
      <label class="field-label" for="gateway-token">访问密钥 <span>仅在当前页面内存中保存</span></label><input id="gateway-token" name="token" type="password" autocomplete="off" placeholder="按网关要求填写" value="${escape(state.config.token)}" ${disabled(state)}>
      <label class="consent"><input name="enabled" type="checkbox" ${state.config.enabled ? 'checked' : ''} ${disabled(state)}><span><strong>允许调用远程模型</strong><small>发送你输入的偏好，以及匿名的尺寸、清晰度和保护状态。不发送原始媒体、文件名或路径。调用可能产生网关费用。</small></span></label>
      <button class="button primary" type="submit" ${disabled(state)}>保存模型设置</button></form>
      <p class="footnote">这是本项目的网关契约，需要服务端实际接入 LLM / Jev，并允许当前网站的跨域请求。页面刷新后远程调用恢复为关闭。</p></section>
      <div class="settings-aside"><section class="panel"><h2>浏览器能力</h2><ul class="capability-list"><li><span>本地文件分析</span><strong>支持</strong></li><li><span>目录读写授权</span><strong>${state.directorySupported ? '浏览器支持' : '当前浏览器不支持'}</strong></li><li><span>本地持久记录</span><strong>${state.storeDurable ? '可用' : '不可用 · 禁止删除'}</strong></li><li><span>跨页面执行互斥</span><strong>${state.locksSupported ? '支持' : '不支持 · 禁止删除'}</strong></li></ul><p class="footnote">完整清理建议使用桌面版 Chrome 或 Edge，通过 HTTPS / localhost 访问。手机浏览器以实际支持的能力为准。</p></section>
      <section class="panel"><h2>当前清理范围</h2><p class="scope-name">${escape(state.scope?.name ?? '尚未选择')}</p>${button('忘记当前目录', 'forget', 'button secondary', `${disabled(state)} ${state.scope ? '' : 'disabled'}`)}<p class="footnote">会移除本应用保存的目录句柄。浏览器层面的授权可在网站设置中撤销，已有清理记录仍保留。</p></section>
      <section class="notice notice-info">${icon('info')}<p>当前版本支持清理与人工筛选，暂不支持压缩、云盘同步、后台定时扫描或回收站。</p></section></div></div>`;
}
export function renderApp(state) {
  const nav = [['overview', 'grid', '我的空间'], ['plan', 'plan', '清理计划'], ['history', 'history', '操作记录'], ['settings', 'settings', '设置']];
  return `<aside class="sidebar"><a class="brand" href="#overview" data-action="go-overview"><img src="./icon.svg" alt=""><span>拾光清理<small>SPACE KEEPER</small></span></a>
    <div class="nav-label">工作区</div><nav aria-label="主导航">${nav.map(([key, glyph, label]) => `<button data-action="navigate" data-page="${key}" class="nav-item ${state.page === key ? 'active' : ''}" ${state.page === key ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>${key === 'plan' && state.plan ? '<i></i>' : ''}</button>`).join('')}</nav>
    <div class="sidebar-bottom"><div class="local-note">${icon('shield')}<strong>安心整理，轻装出发</strong><p>你的回忆，留在你的设备。</p></div><span class="version">WEB PREVIEW · v0.1</span></div></aside>
    <div class="workspace"><header class="topbar"><span>${nav.find(([key]) => key === state.page)?.[2]}</span><div><span class="status-dot"></span>${escape(modeLabel(state))}<span class="avatar">拾</span></div></header>
    <main id="main" tabindex="-1">${state.page === 'overview' ? overview(state) : state.page === 'plan' ? planPage(state) : state.page === 'history' ? historyPage(state) : settingsPage(state)}<footer>拾光清理 <span>·</span> 让空间更轻盈，让回忆更清晰。</footer></main></div>`;
}
