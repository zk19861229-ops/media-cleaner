import { canonical, textHash } from './hashing.mjs';

export const EXACT = 'EXACT_DUPLICATE';
export const SIMILAR = 'VISUALLY_SIMILAR';
export const defaultPolicy = Object.freeze({ includeSimilar: true, protectScreenshots: true });
const HASH = /^[0-9a-f]{64}$/;
export const selectedActions = plan => plan.actions.filter(action => action.selected);
export const selectedBytes = plan => selectedActions(plan).reduce((total, action) => total + action.target.size, 0);
export const protectedAsset = (asset, policy) => asset.protected || (policy.protectScreenshots && /screenshot|screen_shot|截图|截屏/i.test(asset.name));
export const idForPath = (scopeId, path) => textHash(canonical([scopeId, path]));
export function validPath(path) {
  return Array.isArray(path) && path.length > 0 && path.every(part => typeof part === 'string' && part !== '' && part !== '.' && part !== '..' && !/[\/\\\0]/.test(part));
}
export function snapshot(asset) {
  return { assetId: asset.id, scopeId: asset.scopeId, path: [...asset.path], size: asset.size, modified: asset.modified, hash: asset.hash };
}
export const sameSnapshot = (a, b) => canonical(a) === canonical(b);
export const planDigest = plan => textHash(canonical({ ...plan, status: 'REVIEW' }));

function mediaGroup(relation, members) {
  const id = textHash(canonical([relation, members.map(asset => asset.id).sort()]));
  return { id, relation, members, evidence: {
    id: `e_${id}`, relation, memberIds: members.map(asset => asset.id),
    algorithm: relation === EXACT ? 'sha256-full-v1' : 'dhash64-anchor-hamming6-v1',
    description: relation === EXACT ? '文件大小与完整 SHA-256 一致' : '画面相似，可能包含不同动作、文字或细节',
  } };
}
export function exactGroups(assets) {
  const buckets = new Map();
  for (const asset of assets) {
    if (!HASH.test(asset.hash ?? '') || asset.size <= 0) continue;
    const key = `${asset.size}:${asset.hash}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(asset);
  }
  return [...buckets.values()].filter(members => members.length > 1)
    .map(members => mediaGroup(EXACT, members.toSorted((a, b) => a.id.localeCompare(b.id))));
}
export function hamming(a, b) {
  let value = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), count = 0;
  while (value) { value &= value - 1n; count++; }
  return count;
}
class HashTree {
  root = null;
  add(hash, index) {
    if (!this.root) { this.root = { hash, indices: [index], children: new Map() }; return; }
    let node = this.root;
    while (true) {
      const distance = hamming(hash, node.hash);
      if (distance === 0) { node.indices.push(index); return; }
      if (!node.children.has(distance)) { node.children.set(distance, { hash, indices: [index], children: new Map() }); return; }
      node = node.children.get(distance);
    }
  }
  near(hash, radius) {
    const pending = this.root ? [this.root] : [], result = [];
    while (pending.length) {
      const node = pending.pop(), distance = hamming(hash, node.hash);
      if (distance <= radius) result.push(...node.indices);
      for (const [edge, child] of node.children) if (Math.abs(edge - distance) <= radius) pending.push(child);
    }
    return result;
  }
}
export function similarGroups(assets) {
  const candidates = assets.filter(a => a.mime.startsWith('image/') && HASH.test(a.hash ?? '') &&
    /^[0-9a-f]{16}$/.test(a.perceptualHash ?? '') && a.width >= 64 && a.height >= 64)
    .toSorted((a, b) => b.sharpness - a.sharpness || a.id.localeCompare(b.id));
  const tree = new HashTree(), anchors = [];
  for (const asset of candidates) {
    const matches = tree.near(asset.perceptualHash, 6).map(index => anchors[index]).filter(members =>
      members[0].hash !== asset.hash && Math.abs(members[0].width / members[0].height - asset.width / asset.height) < 0.04);
    matches.sort((a, b) => hamming(a[0].perceptualHash, asset.perceptualHash) - hamming(b[0].perceptualHash, asset.perceptualHash));
    if (matches[0]) matches[0].push(asset);
    else { tree.add(asset.perceptualHash, anchors.length); anchors.push([asset]); }
  }
  return anchors.filter(members => members.length > 1).map(members => mediaGroup(SIMILAR, members));
}
export function localRecommendation(group) {
  return { decision: 'RECOMMEND_KEEPER', keeperAssetId: group.members[0].id, confidence: null, source: 'local-rules' };
}
export function validRecommendation(group, response) {
  if (!response || !['RECOMMEND_KEEPER', 'KEEP_ALL', 'REQUEST_REVIEW'].includes(response.decision)) return false;
  if (response.confidence != null && (!Number.isFinite(response.confidence) || response.confidence < 0 || response.confidence > 1)) return false;
  return response.decision === 'RECOMMEND_KEEPER' ? group.members.some(a => a.id === response.keeperAssetId) : response.keeperAssetId == null;
}
function actionFor(planId, group, target, keeper, selected, response = {}) {
  return { id: `${planId}_${group.id}_${target.id}`, groupId: group.id, relation: group.relation,
    target: snapshot(target), keeper: snapshot(keeper), evidenceId: group.evidence.id, selected,
    confidence: response.confidence ?? null, decisionSource: response.source ?? 'sha256' };
}
export function compilePlan(scope, assets, policy, recommendations = new Map(), options = {}) {
  if (assets.some(a => a.scopeId !== scope.id || !validPath(a.path) || a.id !== idForPath(scope.id, a.path))) throw new Error('文件超出授权范围或标识无效');
  if (new Set(assets.map(a => a.id)).size !== assets.length) throw new Error('文件标识重复');
  const exact = exactGroups(assets), exactIds = new Set(exact.flatMap(g => g.members.map(a => a.id)));
  const similar = policy.includeSimilar ? similarGroups(assets.filter(a => !exactIds.has(a.id))) : [];
  const plan = { id: crypto.randomUUID(), version: 1, scopeId: scope.id, scopeName: scope.name, mode: scope.mode,
    createdAt: Date.now(), status: 'REVIEW', policy: { ...policy }, groups: [...exact, ...similar],
    skippedAnalysisItems: options.skipped ?? 0, assetsCount: assets.length, totalBytes: assets.reduce((sum, a) => sum + a.size, 0), actions: [] };
  for (const group of plan.groups) {
    const candidate = recommendations.get(group.id);
    const response = validRecommendation(group, candidate) ? candidate : { decision: 'REQUEST_REVIEW', source: 'manual-review' };
    group.recommendation = group.relation === EXACT ? null : response;
    if (group.relation === SIMILAR && response.decision === 'KEEP_ALL') { group.keeperId = null; continue; }
    const keeper = group.relation === EXACT ? group.members.toSorted((a, b) => Number(protectedAsset(b, policy)) - Number(protectedAsset(a, policy)) || a.id.localeCompare(b.id))[0]
      : group.members.find(a => a.id === response.keeperAssetId) ?? group.members[0];
    group.keeperId = keeper.id;
    for (const target of group.members) if (target.id !== keeper.id && !protectedAsset(target, policy)) {
      plan.actions.push(actionFor(plan.id, group, target, keeper, group.relation === EXACT, group.relation === EXACT ? {} : response));
    }
  }
  assertManifest(plan);
  return plan;
}
function editable(plan) { if (plan.status !== 'REVIEW') throw new Error('已确认的计划不能修改'); }
export function selectAction(plan, id, selected) {
  editable(plan);
  if (!plan.actions.some(a => a.id === id)) throw new Error('动作不存在');
  const result = { ...plan, version: plan.version + 1, actions: plan.actions.map(a => a.id === id ? { ...a, selected } : a) };
  assertManifest(result); return result;
}
export function keepGroup(plan, groupId) {
  editable(plan);
  return { ...plan, version: plan.version + 1, actions: plan.actions.map(a => a.groupId === groupId ? { ...a, selected: false } : a) };
}
export function chooseKeeper(plan, groupId, assetId) {
  editable(plan);
  const group = plan.groups.find(g => g.id === groupId), keeper = group?.members.find(a => a.id === assetId);
  if (!keeper) throw new Error('保留项不在当前组内');
  return { ...plan, version: plan.version + 1,
    groups: plan.groups.map(g => g.id === groupId ? { ...g, keeperId: assetId } : g),
    actions: [...plan.actions.filter(a => a.groupId !== groupId), ...group.members.filter(a => a.id !== assetId && !protectedAsset(a, plan.policy))
      .map(target => actionFor(plan.id, group, target, keeper, false, { source: 'user' }))] };
}
export function protectInPlan(plan, assetId, enabled) {
  editable(plan);
  return { ...plan, version: plan.version + 1,
    groups: plan.groups.map(g => ({ ...g, members: g.members.map(a => a.id === assetId ? { ...a, protected: enabled } : a) })),
    actions: plan.actions.map(a => a.target.assetId === assetId && enabled ? { ...a, selected: false } : a) };
}
export function assertManifest(plan) {
  const actions = selectedActions(plan), targets = new Set(actions.map(a => a.target.assetId));
  if (targets.size !== actions.length || new Set(plan.actions.map(a => a.id)).size !== plan.actions.length) throw new Error('清理动作重复');
  for (const action of actions) {
    const group = plan.groups.find(g => g.id === action.groupId);
    const target = group?.members.find(a => a.id === action.target.assetId), keeper = group?.members.find(a => a.id === action.keeper.assetId);
    if (!target || !keeper || group.evidence.id !== action.evidenceId || group.relation !== action.relation) throw new Error('缺少有效证据');
    if (!sameSnapshot(snapshot(target), action.target) || !sameSnapshot(snapshot(keeper), action.keeper)) throw new Error('快照与证据不一致');
    if (protectedAsset(target, plan.policy)) throw new Error('文件受到保护');
    if (targets.has(keeper.id) || target.id === keeper.id) throw new Error('保留副本不能被删除');
    for (const asset of [target, keeper]) if (asset.scopeId !== plan.scopeId || !validPath(asset.path) || asset.id !== idForPath(plan.scopeId, asset.path) || !HASH.test(asset.hash ?? '') || !Number.isSafeInteger(asset.size) || asset.size < 1) throw new Error('文件范围或指纹无效');
    if (action.relation === EXACT && (target.hash !== keeper.hash || target.size !== keeper.size)) throw new Error('内容并非完全重复');
  }
}
export function approvalFor(plan) {
  editable(plan); assertManifest(plan);
  if (plan.mode !== 'readwrite' || !selectedActions(plan).length) throw new Error('没有可执行的已选择动作');
  return { planId: plan.id, version: plan.version, digest: planDigest(plan), approvedAt: Date.now() };
}
export function approvalMatches(plan, approval) {
  return approval?.planId === plan.id && approval.version === plan.version && approval.digest === planDigest(plan);
}

/** Dependencies are injected so the same contract is exercised with real browser handles in E2E tests. */
export async function executeAction(plan, approval, action, files, ledger) {
  if (plan.mode !== 'readwrite') throw new Error('只读计划不能执行删除');
  if (!approvalMatches(plan, approval) || !['APPROVED', 'RUNNING'].includes(plan.status)) throw new Error('缺少有效的计划确认');
  if (!selectedActions(plan).some(a => canonical(a) === canonical(action))) throw new Error('动作未获批准');
  assertManifest(plan);
  const previous = await ledger.get(action.id);
  if (previous && ['SUCCEEDED', 'SKIPPED', 'UNKNOWN'].includes(previous.status)) return previous;
  const finish = async (status, reason, reclaimedBytes = 0) => {
    const result = { actionId: action.id, status, reason, reclaimedBytes, updatedAt: Date.now() };
    await ledger.put(result); return result;
  };
  if (!await files.hasGrant(plan.scopeId)) return finish('SKIPPED', '目录写入授权已失效');
  if (await files.isProtected(action.target.assetId)) return finish('SKIPPED', '文件已被保护');
  await finish('VALIDATING', '正在校验文件与保留副本');
  let deletionStarted = false;
  try {
    const target = await files.inspect(action.target);
    if (target.state === 'missing') return finish(previous?.status === 'EXECUTING' ? 'UNKNOWN' : 'SKIPPED',
      previous?.status === 'EXECUTING' ? '中断后文件已不存在，无法确认删除归属' : '执行前文件已不存在');
    if (target.state !== 'present') return finish('SKIPPED', target.reason ?? '目标文件无法访问');
    if (!sameSnapshot(target.snapshot, action.target)) return finish('SKIPPED', '目标文件已变化');
    const keeper = await files.inspect(action.keeper);
    if (keeper.state !== 'present' || !sameSnapshot(keeper.snapshot, action.keeper)) return finish('SKIPPED', '保留副本已变化或无法访问');
    const finalTarget = await files.inspect(action.target);
    if (finalTarget.state !== 'present' || !sameSnapshot(finalTarget.snapshot, action.target)) return finish('SKIPPED', '目标文件在校验期间发生变化');
    if (!await files.hasGrant(plan.scopeId) || await files.isProtected(action.target.assetId)) return finish('SKIPPED', '执行条件已变化');
    await finish('EXECUTING', '正在删除');
    deletionStarted = true;
    await files.delete(action.target);
    const after = await files.inspect(action.target);
    if (after.state === 'missing') return finish('SUCCEEDED', '已永久删除', action.target.size);
    return finish(after.state === 'present' ? 'FAILED' : 'UNKNOWN', after.state === 'present' ? '文件仍然存在' : '删除后无法核实文件状态');
  } catch (error) {
    return finish(deletionStarted ? 'UNKNOWN' : 'FAILED', deletionStarted ? '删除结果待核实，不计入释放容量' : `校验未完成：${error.name ?? 'Error'}`);
  }
}
