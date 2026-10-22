import { idForPath, validPath } from './ontology.mjs';

const extensions = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', mpeg: 'video/mpeg', mpg: 'video/mpeg', '3gp': 'video/3gpp' };
export const mediaType = file => extensions[file.name.split('.').at(-1)?.toLowerCase()] ??
  (/^(image|video)\//.test(file.type) && file.type !== 'image/svg+xml' ? file.type : null);
export function metadata(scopeId, path, file) {
  return { id: idForPath(scopeId, path), scopeId, path, name: path.at(-1), mime: mediaType(file), size: file.size,
    modified: file.lastModified, hash: null, width: 0, height: 0, sharpness: 0, perceptualHash: null, protected: false, analysisVersion: 1 };
}
export async function requestAccess(handle, mode = 'readwrite') {
  const descriptor = { mode };
  if (await handle.queryPermission(descriptor) === 'granted') return true;
  return await handle.requestPermission(descriptor) === 'granted';
}
export async function resolveFile(root, path) {
  if (!validPath(path)) throw new Error('非法文件路径');
  let parent = root;
  for (const segment of path.slice(0, -1)) parent = await parent.getDirectoryHandle(segment);
  const handle = await parent.getFileHandle(path.at(-1));
  const resolved = await root.resolve(handle);
  if (!resolved || JSON.stringify(resolved) !== JSON.stringify(path)) throw new Error('文件不在授权目录中');
  return { parent, handle, file: await handle.getFile() };
}
export async function scanScope(scope, sessionFiles, store, analyzer, { signal, onProgress }) {
  const entries = [], cached = new Map((await store.all('assets')).filter(a => a.scopeId === scope.id).map(a => [a.id, a]));
  const protectedIds = new Set((await store.all('protections')).filter(p => p.enabled).map(p => p.assetId));
  let skipped = 0;
  if (scope.handle) {
    const queue = [{ handle: scope.handle, path: [] }];
    while (queue.length) {
      signal.throwIfAborted();
      const current = queue.shift();
      try {
        for await (const [name, handle] of current.handle.entries()) {
          signal.throwIfAborted();
          const path = [...current.path, name];
          if (handle.kind === 'directory') queue.push({ handle, path });
          else try {
            const file = await handle.getFile();
            if (mediaType(file) && file.size > 0) entries.push({ asset: metadata(scope.id, path, file), file, handle });
          } catch { skipped++; }
        }
      } catch (error) { if (signal.aborted) throw error; skipped++; }
      onProgress({ phase: '正在浏览文件夹', done: entries.length, total: 0, skipped });
    }
  } else {
    for (const [key, file] of sessionFiles) {
      const path = JSON.parse(key);
      if (mediaType(file) && file.size > 0) entries.push({ asset: metadata(scope.id, path, file), file });
    }
  }
  const counts = new Map();
  entries.forEach(({ asset }) => counts.set(asset.size, (counts.get(asset.size) ?? 0) + 1));
  const assets = [];
  for (const [index, entry] of entries.entries()) {
    signal.throwIfAborted();
    const { asset, file, handle } = entry;
    const progress = { phase: '正在分析媒体', done: index, total: entries.length, filename: asset.name, skipped };
    onProgress(progress);
    try {
      const old = cached.get(asset.id);
      const reusable = old?.analysisVersion === 1 && old.hash && asset.modified > 0 && old.modified === asset.modified && old.size === asset.size;
      const result = reusable ? old : { ...asset, ...await analyzer.analyze(file, {
        hash: asset.mime.startsWith('image/') || counts.get(asset.size) > 1,
        metrics: asset.mime.startsWith('image/'), signal,
        onProgress: bytes => onProgress({ ...progress, bytes }),
      }) };
      if (handle) {
        const current = await handle.getFile();
        if (current.size !== asset.size || current.lastModified !== asset.modified) { skipped++; continue; }
      }
      const analyzed = { ...result, protected: protectedIds.has(asset.id) };
      await store.put('assets', asset.id, analyzed); assets.push(analyzed);
    } catch (error) { if (signal.aborted) throw error; skipped++; }
  }
  onProgress({ phase: '分析完成', done: entries.length, total: entries.length, skipped });
  return { assets, skipped };
}

export class BrowserFiles {
  constructor(scope, store, analyzer) { this.scope = scope; this.store = store; this.analyzer = analyzer; }
  async hasGrant(scopeId) {
    try { return scopeId === this.scope.id && this.scope.mode === 'readwrite' && await this.scope.handle.queryPermission({ mode: 'readwrite' }) === 'granted'; }
    catch { return false; }
  }
  async isProtected(id) { return Boolean((await this.store.get('protections', id))?.enabled); }
  async inspect(snapshot) {
    if (!await this.hasGrant(snapshot.scopeId)) return { state: 'unavailable', reason: '目录写入授权已失效' };
    try {
      const { file, handle } = await resolveFile(this.scope.handle, snapshot.path);
      const { hash } = await this.analyzer.analyze(file, { hash: true, metrics: false });
      const after = await handle.getFile();
      if (file.size !== after.size || file.lastModified !== after.lastModified) return { state: 'unavailable', reason: '文件在校验时发生变化' };
      return { state: 'present', snapshot: { assetId: idForPath(this.scope.id, snapshot.path), scopeId: this.scope.id,
        path: [...snapshot.path], size: file.size, modified: file.lastModified, hash } };
    } catch (error) { return error.name === 'NotFoundError' ? { state: 'missing' } : { state: 'unavailable', reason: '无法读取文件或确认其目录归属' }; }
  }
  async delete(snapshot) {
    if (!await this.hasGrant(snapshot.scopeId) || await this.isProtected(snapshot.assetId)) throw new Error('执行条件已变化');
    const { parent, file } = await resolveFile(this.scope.handle, snapshot.path);
    if (file.size !== snapshot.size || file.lastModified !== snapshot.modified) throw new Error('文件已变化');
    await parent.removeEntry(snapshot.path.at(-1), { recursive: false });
  }
}
