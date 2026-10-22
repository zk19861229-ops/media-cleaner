import test from 'node:test';
import assert from 'node:assert/strict';
import { endpoint, interpretPolicy, recommend } from '../src/gateway.mjs';
const config = { enabled: true, url: 'https://models.example.test', token: 'test-only' };
test('gateway rejects cleartext endpoints, URL credentials, queries and fragments', () => {
  for (const value of ['http://localhost:8000', 'https://key:secret@example.com', 'https://example.com?key=secret', 'https://example.com/#secret']) assert.throws(() => endpoint(value));
  assert.equal(endpoint('https://example.com/base/'), 'https://example.com/base');
});
test('LLM returns only supported boolean settings; transport has no cookies or redirects', async t => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => { request = { url, ...options }; return new Response(JSON.stringify({ includeSimilar: false, protectScreenshots: true })); });
  const result = await interpretPolicy(config, '保留截图', { includeSimilar: true, protectScreenshots: true });
  assert.equal(result.includeSimilar, false); assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error');
  assert.equal(request.headers.Authorization, 'Bearer test-only');
  assert.deepEqual(Object.keys(JSON.parse(request.body)).sort(), ['current', 'intent']);
});
test('LLM malformed or extended policy is rejected', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ includeSimilar: 'true', protectScreenshots: true, deleteAll: true })));
  await assert.rejects(interpretPolicy(config, '清理', { includeSimilar: true, protectScreenshots: true }));
});
test('Jev requests contain only per-request aliases and approved derived metrics', async t => {
  let body;
  t.mock.method(globalThis, 'fetch', async (_, request) => { body = JSON.parse(request.body); return new Response(JSON.stringify({ decision: 'RECOMMEND_KEEPER', keeperId: 'm1', confidence: .8 })); });
  const group = { relation: 'VISUALLY_SIMILAR', members: [0, 1].map(i => ({ id: `private-${i}`, name: 'private.jpg', path: ['secret'], hash: 'secret', width: 100, height: 80, sharpness: 3, protected: false })) };
  const result = await recommend(config, group);
  assert.equal(result.keeperAssetId, 'private-1');
  assert.deepEqual(Object.keys(body.members[0]).sort(), ['height', 'id', 'protected', 'sharpness', 'width']);
  assert.ok(!JSON.stringify(body).includes('private')); assert.ok(!JSON.stringify(body).includes('secret'));
});
test('out-of-group decision, error status and oversized responses fail closed', async t => {
  const group = { relation: 'VISUALLY_SIMILAR', members: [{ id: 'a', width: 1, height: 1, sharpness: 0, protected: false }] };
  for (const response of [new Response('{"decision":"RECOMMEND_KEEPER","keeperId":"outside","confidence":0.99}'), new Response('unavailable', { status: 503 }), new Response('x'.repeat(65537))]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(recommend(config, group)); mock.mock.restore();
  }
});
test('disabled model mode makes no network call', async t => {
  const mock = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not run'); });
  await assert.rejects(interpretPolicy({ ...config, enabled: false }, '清理', {})); assert.equal(mock.mock.callCount(), 0);
});
