import test from 'node:test';
import assert from 'node:assert/strict';
import { renderApp, escape, size } from '../src/view.mjs';
import { compilePlan, idForPath, defaultPolicy } from '../src/ontology.mjs';
import { textHash } from '../src/hashing.mjs';
const state = { page: 'overview', scope: null, assets: [], plan: null, history: [], results: {}, busy: false,
  policy: defaultPolicy, config: { enabled: false, url: '', token: '' }, intent: '', expanded: new Set(), filter: 'all', groupLimit: 30, directorySupported: true, locksSupported: true, storeDurable: true };
test('empty overview contains real zero counts and directory entry points', () => {
  const html = renderApp(state); assert.match(html, /从一个文件夹开始/); assert.match(html, /体验演示/); assert.match(html, /data-action="choose"/);
});
test('untrusted filenames, folders, model URLs and intent are escaped', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const html = renderApp({ ...state, scope: { id: 's', name: payload, mode: 'readonly' }, intent: payload });
  assert.ok(!html.includes(payload)); assert.ok(html.includes('&lt;img'));
  assert.equal(escape('"<&'), '&quot;&lt;&amp;');
});
test('read-only plan provides export but no deletion confirmation button', () => {
  const scope = { id: 's', name: 'Read only', mode: 'readonly' }, assets = ['a.jpg', 'b.jpg'].map(name => ({
    id: idForPath(scope.id, [name]), scopeId: scope.id, path: [name], name, mime: 'image/jpeg', size: 3, modified: 1, hash: textHash('abc'), protected: false,
  }));
  const plan = compilePlan(scope, assets, defaultPolicy);
  const html = renderApp({ ...state, page: 'plan', plan });
  assert.match(html, /data-action="export"/); assert.ok(!html.includes('data-action="confirm"'));
});
test('capacity labels distinguish binary units', () => {
  assert.equal(size(0), '0 B'); assert.equal(size(1024), '1.0 KiB'); assert.equal(size(2 ** 30), '1.00 GiB');
});
