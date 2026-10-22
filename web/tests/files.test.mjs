import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserFiles, metadata, scanScope, resolveFile, mediaType } from '../src/files.mjs';
import { hashBlob } from '../src/hashing.mjs';
import { MemoryStore } from '../src/storage.mjs';
import { snapshot } from '../src/ontology.mjs';

const file = (name, text, type = 'image/jpeg', modified = 100) => new File([text], name, { type, lastModified: modified });
const notFound = () => new DOMException('missing', 'NotFoundError');
class FileHandle {
  kind = 'file';
  constructor(value) { this.value = value; this.name = value.name; }
  async getFile() { return this.value; }
}
class Directory {
  kind = 'directory';
  granted = true;
  constructor(name, children = []) { this.name = name; this.children = new Map(children.map(child => [child.name, child])); }
  async *entries() { yield* this.children.entries(); }
  async queryPermission() { return this.granted ? 'granted' : 'denied'; }
  async requestPermission() { return this.queryPermission(); }
  async getFileHandle(name) { const entry = this.children.get(name); if (!entry) throw notFound(); if (entry.kind !== 'file') throw new DOMException('wrong kind', 'TypeMismatchError'); return entry; }
  async getDirectoryHandle(name) { const entry = this.children.get(name); if (!entry) throw notFound(); if (entry.kind !== 'directory') throw new DOMException('wrong kind', 'TypeMismatchError'); return entry; }
  async removeEntry(name, options) { assert.equal(options.recursive, false); if (!this.children.has(name)) throw notFound(); this.children.delete(name); }
  async resolve(handle) {
    for (const [name, child] of this.children) {
      if (child === handle) return [name];
      if (child.kind === 'directory') { const path = await child.resolve(handle); if (path) return [name, ...path]; }
    }
    return null;
  }
}
const analyzer = { async analyze(file, options) { return { hash: options.hash ? await hashBlob(file, options) : null, width: 0, height: 0, perceptualHash: null, sharpness: 0 }; } };
const scopeFor = root => ({ id: 'scope', name: root.name, mode: 'readwrite', handle: root });

test('recursive scan indexes media and excludes text and SVG documents', async () => {
  const root = new Directory('root', [new FileHandle(file('a.jpg', 'photo')), new FileHandle(file('notes.txt', 'notes', 'text/plain')),
    new FileHandle(file('active.svg', '<svg/>', 'image/svg+xml')), new Directory('nested', [new FileHandle(file('copy.jpg', 'photo'))])]);
  const result = await scanScope(scopeFor(root), null, new MemoryStore(), analyzer, { signal: new AbortController().signal, onProgress() {} });
  assert.equal(result.assets.length, 2); assert.equal(result.assets[0].hash, result.assets[1].hash);
  assert.deepEqual(result.assets[1].path, ['nested', 'copy.jpg']); assert.equal(result.skipped, 0);
});
test('single-size videos avoid expensive hashing; same-size candidates are fully hashed', async () => {
  const root = new Directory('root', [new FileHandle(file('a.mp4', 'same', 'video/mp4')), new FileHandle(file('b.mp4', 'same', 'video/mp4')), new FileHandle(file('large.mp4', 'different size', 'video/mp4'))]);
  const result = await scanScope(scopeFor(root), null, new MemoryStore(), analyzer, { signal: new AbortController().signal, onProgress() {} });
  assert.equal(result.assets.filter(a => a.hash).length, 2); assert.equal(result.assets.find(a => a.name === 'large.mp4').hash, null);
});
test('scan skips files changed during analysis and reports unavailable folders', async () => {
  const handle = new FileHandle(file('a.jpg', 'old')), blocked = new Directory('blocked');
  blocked.entries = async function* () { throw new DOMException('denied', 'NotAllowedError'); };
  const root = new Directory('root', [handle, blocked]);
  const changing = { async analyze(value, options) { handle.value = file('a.jpg', 'new-longer', 'image/jpeg', 200); return analyzer.analyze(value, options); } };
  const result = await scanScope(scopeFor(root), null, new MemoryStore(), changing, { signal: new AbortController().signal, onProgress() {} });
  assert.equal(result.assets.length, 0); assert.equal(result.skipped, 2);
});
test('valid cached analysis is reused but current protection is reapplied', async () => {
  const handle = new FileHandle(file('a.jpg', 'old')), root = new Directory('root', [handle]), store = new MemoryStore();
  const options = { signal: new AbortController().signal, onProgress() {} };
  const first = await scanScope(scopeFor(root), null, store, analyzer, options);
  await store.put('protections', first.assets[0].id, { assetId: first.assets[0].id, enabled: true });
  const second = await scanScope(scopeFor(root), null, store, { async analyze() { throw new Error('should reuse'); } }, options);
  assert.equal(second.assets.length, 1); assert.equal(second.assets[0].protected, true);
});
test('resolver refuses traversal and verifies root-relative membership', async () => {
  const handle = new FileHandle(file('a.jpg', 'one')), root = new Directory('root', [handle]);
  await assert.rejects(resolveFile(root, ['..', 'a.jpg']));
  root.resolve = async () => ['other.jpg']; await assert.rejects(resolveFile(root, ['a.jpg']));
});
test('file gateway differentiates absence from revoked permissions', async () => {
  const handle = new FileHandle(file('a.jpg', 'one')), root = new Directory('root', [handle]), store = new MemoryStore();
  const asset = { ...metadata('scope', ['a.jpg'], handle.value), hash: await hashBlob(handle.value) };
  const gateway = new BrowserFiles(scopeFor(root), store, analyzer);
  assert.equal((await gateway.inspect(snapshot(asset))).state, 'present');
  root.children.delete('a.jpg'); assert.equal((await gateway.inspect(snapshot(asset))).state, 'missing');
  root.granted = false; assert.equal((await gateway.inspect(snapshot(asset))).state, 'unavailable');
});
test('file gateway refuses metadata drift and protects files before removal', async () => {
  const handle = new FileHandle(file('a.jpg', 'one')), root = new Directory('root', [handle]), store = new MemoryStore();
  const asset = { ...metadata('scope', ['a.jpg'], handle.value), hash: await hashBlob(handle.value) };
  const gateway = new BrowserFiles(scopeFor(root), store, analyzer);
  handle.value = file('a.jpg', 'changed'); await assert.rejects(gateway.delete(snapshot(asset)));
  handle.value = file('a.jpg', 'one'); await store.put('protections', asset.id, { enabled: true }); await assert.rejects(gateway.delete(snapshot(asset)));
  await store.remove('protections', asset.id); await gateway.delete(snapshot(asset)); assert.equal(root.children.size, 0);
});
test('memory-only storage never permits approval', async () => {
  const store = new MemoryStore(); assert.equal(store.durable, false); await assert.rejects(store.approve());
});
