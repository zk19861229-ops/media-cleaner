import { Store, MemoryStore } from './storage.mjs';
import { Analyzer } from './worker-client.mjs';
import { BrowserFiles, scanScope, resolveFile, requestAccess } from './files.mjs';
import { defaultPolicy, EXACT, compilePlan, exactGroups, similarGroups, localRecommendation, selectAction,
  keepGroup, chooseKeeper, protectInPlan, planDigest, approvalFor, approvalMatches, selectedActions, selectedBytes, executeAction } from './ontology.mjs';
import { endpoint, interpretPolicy, recommend } from './gateway.mjs';
import { renderApp, progress, escape, icon, size } from './view.mjs';
import { demoFiles } from './demo.mjs';

const state = {
  page: ['overview', 'plan', 'history', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview',
  scope: null, assets: [], plan: null, history: [], results: {}, busy: false, progress: null,
  policy: { ...defaultPolicy }, intent: '', config: { url: '', token: '', enabled: false },
  directorySupported: typeof window.showDirectoryPicker === 'function' && isSecureContext,
  locksSupported: Boolean(navigator.locks), storeDurable: false, expanded: new Set(), filter: 'all', groupLimit: 30,
};
let store, controller, observer, toastTimer, confirmation;
let operationPending = false;
const sessions = new Map(), previewURLs = new Map();
const app = document.querySelector('#app');

function notify(message) {
  const toast = document.querySelector('#toast'); toast.textContent = message; toast.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 7000);
}
function render() {
  const y = window.scrollY;
  observer?.disconnect(); app.innerHTML = renderApp(state); window.scrollTo(0, y); loadThumbnails();
}
function navigate(page) { state.page = page; location.hash = page; render(); window.scrollTo(0, 0); }
let lastProgress = 0;
function updateProgress(value) {
  state.progress = value;
  if (performance.now() - lastProgress < 100 && value.done !== value.total) return;
  lastProgress = performance.now();
  const panel = document.querySelector('.progress-panel'); if (panel) panel.outerHTML = progress(state);
}
function clearPreviews() {
  for (const url of previewURLs.values()) URL.revokeObjectURL(url);
  previewURLs.clear();
}
function findAsset(id) {
  return state.plan?.groups.flatMap(group => group.members).find(asset => asset.id === id) ?? state.assets.find(asset => asset.id === id);
}
async function fileFor(asset, ask = false) {
  const session = sessions.get(asset.scopeId);
  if (session) {
    const file = session.get(JSON.stringify(asset.path)); if (!file) throw new Error('请重新选择原媒体文件'); return file;
  }
  const scope = state.scope?.id === asset.scopeId ? state.scope : await store.get('scopes', asset.scopeId);
  if (!scope?.handle) throw new Error('目录未连接，请重新选择原文件夹');
  if (await scope.handle.queryPermission({ mode: 'read' }) !== 'granted') {
    if (!ask || !await requestAccess(scope.handle, 'read')) throw new Error('请授权读取目录后再预览');
  }
  return (await resolveFile(scope.handle, asset.path)).file;
}
function loadThumbnails() {
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target);
      const asset = findAsset(entry.target.dataset.previewId);
      if (!asset?.mime.startsWith('image/')) continue;
      const element = entry.target;
      (async () => {
        const key = `${asset.id}:${asset.modified}`;
        let url = previewURLs.get(key);
        if (!url) { url = URL.createObjectURL(await fileFor(asset)); previewURLs.set(key, url); }
        if (element.isConnected) { element.src = url; element.onload = () => element.classList.add('loaded'); }
      })().catch(() => {});
    }
  }, { rootMargin: '200px' });
  document.querySelectorAll('[data-preview-id]').forEach(element => observer.observe(element));
}
async function openPreview(id) {
  const asset = findAsset(id); if (!asset) return;
  const file = await fileFor(asset, true), url = URL.createObjectURL(file), dialog = document.querySelector('#preview-dialog');
  dialog.innerHTML = `<div class="preview-heading"><div><strong>${escape(asset.name)}</strong><small>${escape(asset.path.join('/'))} · ${size(file.size)}</small></div><button class="icon-button" data-close-preview aria-label="关闭预览">${icon('close')}</button></div>
    <div class="preview-body">${asset.mime.startsWith('video/') ? `<video controls playsinline src="${url}"></video>` : `<img src="${url}" alt="${escape(asset.name)}">`}</div>`;
  dialog.showModal(); dialog.querySelector('[data-close-preview]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { dialog.querySelector('video')?.pause(); dialog.innerHTML = ''; URL.revokeObjectURL(url); }, { once: true });
}
async function refreshHistory() { state.history = (await store.all('plans')).toSorted((a, b) => b.createdAt - a.createdAt); }
async function showPlan(plan) {
  state.plan = plan; state.expanded.clear(); state.groupLimit = 30;
  state.results = Object.fromEntries((await Promise.all(plan.actions.map(a => store.get('journal', a.id)))).filter(Boolean).map(result => [result.actionId, result]));
  navigate('plan');
}
async function chooseFolder() {
  if (!state.directorySupported) { document.querySelector('#folder-input').click(); return; }
  const handle = await window.showDirectoryPicker({ id: 'spacekeeper-media', mode: 'readwrite' });
  if (!await requestAccess(handle)) throw new Error('未获得目录写入授权，原文件保持不变');
  let saved;
  for (const known of await store.all('scopes')) {
    try { if (known.handle && await handle.isSameEntry(known.handle)) { saved = known; break; } } catch { /* unavailable older grant */ }
  }
  const scope = { id: saved?.id ?? crypto.randomUUID(), name: handle.name, mode: state.storeDurable && state.locksSupported ? 'readwrite' : 'readonly', handle };
  await store.put('scopes', scope.id, scope); await store.put('settings', 'activeScope', scope.id);
  state.scope = scope;
  const inventory = new Set(await store.get('settings', `inventory:${scope.id}`) ?? []);
  state.assets = (await store.all('assets')).filter(a => a.scopeId === scope.id && inventory.has(a.id));
  state.plan = state.history.find(plan => plan.scopeId === scope.id) ?? null; state.results = {};
  clearPreviews(); render(); notify('文件夹已连接。点击“分析并生成计划”，清理前会让你确认。');
}
async function readOnlyFiles(files, demo = false) {
  if (!files.length) return;
  const scope = { id: crypto.randomUUID(), name: demo ? '拾光 · 演示样本' : files[0].webkitRelativePath?.split('/')[0] || '已选择的媒体文件', mode: demo ? 'demo' : 'readonly' };
  const mapping = new Map();
  for (const [index, file] of [...files].entries()) {
    const path = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1) : [String(index + 1).padStart(3, '0'), file.name];
    mapping.set(JSON.stringify(path), file);
  }
  sessions.set(scope.id, mapping); state.scope = scope; state.assets = []; state.plan = null; state.results = {};
  await store.put('scopes', scope.id, scope); await store.put('settings', 'activeScope', scope.id);
  clearPreviews(); navigate('overview');
  if (demo) await startScan(); else notify('媒体已选择。此入口只提供本地分析和计划导出，不会删除原文件。');
}
async function startScan() {
  if (!state.scope) return chooseFolder();
  const scope = state.scope;
  const pending = (await store.all('plans')).find(plan => plan.scopeId === scope.id && ['APPROVED', 'RUNNING'].includes(plan.status));
  if (pending) { await showPlan(pending); notify('请先继续完成这份已确认的计划。'); return; }
  if (scope.handle) { if (!await requestAccess(scope.handle, scope.mode === 'readwrite' ? 'readwrite' : 'read')) throw new Error('需要重新授权后才能扫描'); }
  else if (!sessions.has(scope.id)) throw new Error('只读选择在页面关闭后失效，请重新选择文件');
  state.busy = 'scan'; controller = new AbortController(); state.progress = { phase: '准备分析', done: 0, total: 0 }; render();
  let analyzer;
  const policy = { ...state.policy }, config = { ...state.config };
  try {
    analyzer = new Analyzer();
    const { assets, skipped } = await scanScope(scope, sessions.get(scope.id), store, analyzer, { signal: controller.signal, onProgress: updateProgress });
    const exactIds = new Set(exactGroups(assets).flatMap(group => group.members.map(asset => asset.id)));
    const similar = policy.includeSimilar ? similarGroups(assets.filter(a => !exactIds.has(a.id))) : [];
    const recommendations = new Map(); let failures = 0, consecutiveFailures = 0;
    for (const [index, group] of similar.entries()) {
      controller.signal.throwIfAborted();
      updateProgress({ phase: config.enabled ? '正在获取 Jev 网关建议' : '正在整理相似照片', done: index, total: similar.length, skipped });
      if (!config.enabled) recommendations.set(group.id, localRecommendation(group));
      else if (consecutiveFailures >= 3) { failures++; recommendations.set(group.id, { decision: 'REQUEST_REVIEW', source: 'manual-review' }); }
      else try { recommendations.set(group.id, await recommend(config, group, controller.signal)); consecutiveFailures = 0; }
      catch (error) {
        if (controller.signal.aborted) throw error;
        failures++; consecutiveFailures++; recommendations.set(group.id, { decision: 'REQUEST_REVIEW', source: 'manual-review' });
      }
    }
    controller.signal.throwIfAborted();
    const plan = compilePlan(scope, assets, policy, recommendations, { skipped });
    await store.savePlan(plan); await store.put('settings', `inventory:${scope.id}`, assets.map(asset => asset.id));
    state.assets = assets; state.plan = plan; state.results = {}; state.expanded.clear(); state.groupLimit = 30;
    await refreshHistory(); state.page = 'plan'; location.hash = 'plan';
    notify(failures ? `${failures} 组模型建议不可用，已转入人工复核。` : '计划已生成。相似照片未默认勾选，请先查看差异。');
  } catch (error) {
    if (controller.signal.aborted) notify('分析已暂停。再次开始会重新遍历，并复用有效缓存。');
    else throw error;
  } finally { analyzer?.close(); state.busy = false; controller = null; render(); }
}
async function editPlan(transform) {
  const old = state.plan; if (!old || old.status !== 'REVIEW') return;
  state.busy = 'save';
  try {
    const changed = transform(old); await store.savePlan(changed, old.version); state.plan = changed; await refreshHistory();
  } catch (error) { state.plan = await store.get('plans', old.id) ?? old; throw error; }
  finally { state.busy = false; render(); }
}
async function protect(id) {
  const asset = findAsset(id); if (!asset) return;
  const enabled = !(await store.get('protections', id))?.enabled;
  await store.put('protections', id, { assetId: id, enabled });
  state.assets = state.assets.map(a => a.id === id ? { ...a, protected: enabled } : a);
  if (state.plan?.status === 'REVIEW') await editPlan(plan => protectInPlan(plan, id, enabled)); else render();
}
function confirmPlan() {
  const plan = state.plan;
  if (!plan || plan.mode !== 'readwrite' || !selectedActions(plan).length || !state.storeDurable || !state.locksSupported) throw new Error('当前模式不支持执行删除');
  confirmation = { planId: plan.id, digest: planDigest(plan) };
  const dialog = document.querySelector('#confirm-dialog'), similarCount = selectedActions(plan).filter(a => a.relation !== EXACT).length;
  dialog.innerHTML = `<div class="confirm-icon">${icon('trash')}</div><h2 id="confirm-title">确认永久删除？</h2><p>将按此计划处理 <strong>${selectedActions(plan).length}</strong> 个文件，预计释放 <strong>${size(selectedBytes(plan))}</strong>。</p>
    ${similarCount ? `<p class="warning-text">其中 ${similarCount} 项是相似照片，并非完全重复。请确认已经查看差异。</p>` : ''}<p>本应用没有回收站。删除后无法通过本应用恢复。执行前会再次核验文件与保留副本。</p>
    <div class="dialog-actions"><button class="button secondary" id="cancel-confirm">返回检查</button><button class="button danger" id="execute-confirm">确认永久删除 ${selectedActions(plan).length} 项</button></div>`;
  dialog.showModal(); dialog.querySelector('#cancel-confirm').onclick = () => dialog.close();
  dialog.querySelector('#execute-confirm').onclick = () => run(async () => {
    dialog.close(); await executePlan(confirmation);
  });
}
async function executePlan(confirmed) {
  const before = state.plan;
  if (!before || confirmed.planId !== before.id || confirmed.digest !== planDigest(before)) throw new Error('计划已变化，请重新确认');
  const scope = await store.get('scopes', before.scopeId);
  if (!scope?.handle || !await requestAccess(scope.handle)) throw new Error('需要重新选择目录并授予写入权限');
  state.busy = 'execute'; state.progress = { phase: '准备执行已确认计划', done: 0, total: selectedActions(before).length }; render();
  let analyzer;
  try {
    analyzer = new Analyzer();
    await navigator.locks.request('spacekeeper-cleanup-execution', { ifAvailable: true }, async lock => {
      if (!lock) throw new Error('另一个页面正在执行清理，请等待完成');
      let plan = await store.get('plans', before.id);
      if (!plan || planDigest(plan) !== confirmed.digest || !['REVIEW', 'APPROVED', 'RUNNING'].includes(plan.status)) throw new Error('计划状态已变化，请重新查看');
      let approval = await store.get('approvals', plan.id);
      if (plan.status === 'REVIEW') { approval = approvalFor(plan); await store.approve(plan, approval); plan = { ...plan, status: 'APPROVED' }; }
      if (!approvalMatches(plan, approval)) throw new Error('缺少有效确认记录');
      await store.setStatus(plan.id, 'RUNNING'); plan = { ...plan, status: 'RUNNING' }; state.plan = plan;
      const files = new BrowserFiles(scope, store, analyzer);
      const ledger = { get: id => store.get('journal', id), put: result => store.put('journal', result.actionId, result) };
      const actions = selectedActions(plan); state.results = {};
      for (const [index, action] of actions.entries()) {
        updateProgress({ phase: '重新校验并清理文件', done: index, total: actions.length });
        const result = await executeAction(plan, approval, action, files, ledger); state.results[action.id] = result;
        if (result.status === 'SUCCEEDED') { await store.remove('assets', action.target.assetId); state.assets = state.assets.filter(a => a.id !== action.target.assetId); }
      }
      const complete = Object.values(state.results).every(result => result.status === 'SUCCEEDED');
      await store.setStatus(plan.id, complete ? 'COMPLETED' : 'PARTIAL');
      state.plan = await store.get('plans', plan.id); await refreshHistory(); clearPreviews();
      notify(`处理结束，成功删除 ${Object.values(state.results).filter(result => result.status === 'SUCCEEDED').length} 项。跳过和不确定结果见详情。`);
    });
  } finally {
    analyzer?.close(); state.busy = false;
    state.plan = await store.get('plans', before.id) ?? state.plan; await refreshHistory(); render();
  }
}
function exportPlan() {
  if (!state.plan) return;
  const data = { schema: 'spacekeeper-web-plan-v1', exportedAt: new Date().toISOString(), plan: state.plan, results: state.results,
    notice: '这是一份清理计划与记录，不包含媒体文件；导出不代表已执行删除。' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `spacekeeper-plan-${state.plan.id.slice(0, 8)}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function interpret() {
  if (!state.config.enabled) { notify('请先在设置中连接 LLM 网关；也可直接使用页面上的整理选项。'); return; }
  state.busy = 'model'; controller = new AbortController(); state.progress = { phase: 'LLM 正在解析整理偏好', done: 0, total: 0 }; render();
  try {
    state.policy = await interpretPolicy(state.config, state.intent, state.policy, controller.signal);
    await store.put('settings', 'policy', state.policy); notify('偏好已解析，请核对下方开关。新策略将在下一次分析生效。');
  } finally { state.busy = false; controller = null; render(); }
}
async function dispatch(element) {
  const action = element.dataset.action;
  if (action === 'navigate') return navigate(element.dataset.page);
  if (action === 'go-overview') return navigate('overview');
  if (action === 'cancel') { controller?.abort(); return; }
  if (action === 'preview') return openPreview(element.dataset.id);
  if (state.busy) return;
  switch (action) {
    case 'choose': return chooseFolder();
    case 'choose-files': document.querySelector('#files-input').click(); break;
    case 'demo': return readOnlyFiles(await demoFiles(), true);
    case 'scan': return startScan();
    case 'interpret': return interpret();
    case 'filter': state.filter = element.dataset.filter; state.groupLimit = 30; render(); break;
    case 'expand': state.expanded.has(element.dataset.group) ? state.expanded.delete(element.dataset.group) : state.expanded.add(element.dataset.group); render(); break;
    case 'more-groups': state.groupLimit += 30; render(); break;
    case 'keep-group': return editPlan(plan => keepGroup(plan, element.dataset.group));
    case 'keeper': await editPlan(plan => chooseKeeper(plan, element.dataset.group, element.dataset.id)); notify('保留项已更新，请重新勾选这一组中需要删除的内容。'); break;
    case 'protect': return protect(element.dataset.id);
    case 'confirm': return confirmPlan();
    case 'export': return exportPlan();
    case 'history': { const plan = await store.get('plans', element.dataset.id); if (plan) await showPlan(plan); break; }
    case 'forget': if (state.scope) {
      await store.remove('scopes', state.scope.id); await store.remove('settings', 'activeScope'); sessions.delete(state.scope.id);
      state.scope = null; state.assets = []; state.plan = null; clearPreviews(); render(); notify('已忘记当前目录。系统权限可以在浏览器的网站设置中撤销。');
    } break;
  }
}
async function run(operation, exclusive = true) {
  if (exclusive && operationPending) return;
  if (exclusive) operationPending = true;
  try { await operation(); }
  catch (error) { if (error.name !== 'AbortError') notify(error.message || '操作未完成，请重试'); }
  finally { if (exclusive) operationPending = false; }
}
app.addEventListener('click', event => {
  const element = event.target.closest('[data-action]'); if (!element) return;
  event.preventDefault();
  // Keep navigation and cancellation responsive while serializing async mutations,
  // including the permission prompt before a scan or deletion starts.
  run(() => dispatch(element), !['navigate', 'go-overview', 'cancel', 'preview'].includes(element.dataset.action));
});
app.addEventListener('input', event => { if (event.target.id === 'intent') state.intent = event.target.value; });
app.addEventListener('change', event => run(async () => {
  if (state.busy) return;
  if (event.target.dataset.select) await editPlan(plan => selectAction(plan, event.target.dataset.select, event.target.checked));
  if (event.target.dataset.setting) {
    state.policy = { ...state.policy, [event.target.dataset.setting]: event.target.checked };
    await store.put('settings', 'policy', state.policy);
  }
}));
app.addEventListener('submit', event => {
  event.preventDefault(); if (event.target.id !== 'gateway-form' || state.busy) return;
  run(async () => {
    const data = new FormData(event.target), url = String(data.get('url')).trim(), enabled = data.get('enabled') === 'on';
    if (enabled || url) endpoint(url);
    state.config = { url, enabled, token: String(data.get('token')).trim() };
    // Keys and the enabled flag never enter persistent storage.
    await store.put('settings', 'gatewayUrl', url); render(); notify('模型设置已保存。密钥只在当前页面内存中保留。');
  });
});
for (const id of ['folder-input', 'files-input']) document.querySelector(`#${id}`).addEventListener('change', event => {
  const files = [...event.target.files]; event.target.value = ''; if (!state.busy) run(() => readOnlyFiles(files));
});
window.addEventListener('beforeunload', event => {
  if (state.busy === 'execute') { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('hashchange', () => {
  const page = location.hash.slice(1); if (['overview', 'plan', 'history', 'settings'].includes(page) && page !== state.page) { state.page = page; render(); }
});

async function initialize() {
  try { store = await Store.open(); } catch { store = new MemoryStore(); notify('浏览器本地记录不可用，已禁用删除。仍可分析和导出计划。'); }
  state.storeDurable = store.durable;
  const policy = await store.get('settings', 'policy');
  if (policy && typeof policy.includeSimilar === 'boolean' && typeof policy.protectScreenshots === 'boolean') state.policy = policy;
  state.config.url = await store.get('settings', 'gatewayUrl') ?? '';
  const scopeId = await store.get('settings', 'activeScope'); state.scope = scopeId ? await store.get('scopes', scopeId) : null;
  if (state.scope) {
    const inventory = new Set(await store.get('settings', `inventory:${state.scope.id}`) ?? []);
    state.assets = (await store.all('assets')).filter(asset => asset.scopeId === state.scope.id && inventory.has(asset.id));
  }
  await refreshHistory(); state.plan = state.history.find(plan => plan.scopeId === state.scope?.id) ?? null;
  if (state.plan) state.results = Object.fromEntries((await Promise.all(state.plan.actions.map(action => store.get('journal', action.id)))).filter(Boolean).map(result => [result.actionId, result]));
  render();
  if (state.plan && ['APPROVED', 'RUNNING'].includes(state.plan.status)) notify('发现尚未完成的已确认计划，可在清理计划页继续执行。');
}
run(initialize);
