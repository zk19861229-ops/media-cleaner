export function endpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('请输入不包含密钥或查询参数的 HTTPS 网关地址');
  return url.href.replace(/\/$/, '');
}
async function post(config, path, data, signal) {
  if (!config.enabled) throw new Error('模型网关尚未启用');
  signal?.throwIfAborted();
  const controller = new AbortController(), cancel = () => controller.abort(signal.reason);
  const timer = setTimeout(() => controller.abort(new DOMException('模型请求超时', 'TimeoutError')), 25000);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(`${endpoint(config.url)}/${path}`, { method: 'POST', credentials: 'omit', redirect: 'error',
      signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) }, body: JSON.stringify(data) });
    if (!response.ok) throw new Error(`模型网关返回 HTTP ${response.status}`);
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 65536) throw new Error('模型响应过大');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
function exactKeys(object, keys) {
  if (!object || Array.isArray(object) || typeof object !== 'object' || Object.keys(object).some(key => !keys.includes(key))) throw new Error('模型响应字段无效');
}
export async function interpretPolicy(config, intent, policy, signal) {
  if (!intent.trim() || intent.length > 2000) throw new Error('请输入 1～2000 字的整理偏好');
  const response = await post(config, 'v1/policy', { intent, current: { includeSimilar: policy.includeSimilar, protectScreenshots: policy.protectScreenshots } }, signal);
  exactKeys(response, ['includeSimilar', 'protectScreenshots']);
  if (typeof response.includeSimilar !== 'boolean' || typeof response.protectScreenshots !== 'boolean') throw new Error('模型策略类型无效');
  return response;
}
export async function recommend(config, group, signal) {
  const aliases = new Map(group.members.map((asset, index) => [`m${index}`, asset.id]));
  const response = await post(config, 'v1/decision', { task: 'recommend_photo_keeper', relation: group.relation,
    members: group.members.map((asset, index) => ({ id: `m${index}`, width: asset.width, height: asset.height,
      sharpness: asset.sharpness, protected: asset.protected })) }, signal);
  exactKeys(response, ['decision', 'keeperId', 'confidence']);
  if (!['RECOMMEND_KEEPER', 'KEEP_ALL', 'REQUEST_REVIEW'].includes(response.decision) || !Number.isFinite(response.confidence) || response.confidence < 0 || response.confidence > 1) throw new Error('模型决策类型或置信度无效');
  if (response.decision === 'RECOMMEND_KEEPER' ? !aliases.has(response.keeperId) : response.keeperId != null) throw new Error('模型保留项不属于当前组');
  return { decision: response.decision, keeperAssetId: aliases.get(response.keeperId) ?? null, confidence: response.confidence, source: 'jev-gateway' };
}
