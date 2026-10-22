import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { hashBlob, textHash, canonical } from '../src/hashing.mjs';
import { Sha256, bytesToHex } from '../src/sha256.mjs';

test('SHA-256 matches native crypto at padding and block boundaries', async t => {
  for (const length of [0, 1, 2, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1023, 1024, 1025, 1024 * 1024 + 11]) {
    await t.test(`${length} bytes`, async () => {
      const input = randomBytes(length), expected = createHash('sha256').update(input).digest('hex');
      assert.equal(await hashBlob(new Blob([input]), { chunkSize: 997 }), expected);
    });
  }
});
test('SHA-256 is independent of arbitrary update partitions', () => {
  const input = randomBytes(2048), expected = createHash('sha256').update(input).digest('hex');
  for (const step of [1, 2, 7, 31, 55, 56, 63, 64, 65, 511, 1024, 4096]) {
    const digest = new Sha256();
    for (let at = 0; at < input.length; at += step) digest.update(input.subarray(at, at + step));
    assert.equal(bytesToHex(digest.digest()), expected);
  }
});
test('published empty, abc and million-a vectors', async () => {
  assert.equal(textHash(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(textHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await hashBlob(new Blob(['a'.repeat(1_000_000)])), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});
test('incremental hashing never asks for the full large file buffer', async () => {
  const data = randomBytes(3 * 1024 * 1024 + 33), original = new Blob([data]); let largest = 0;
  const blob = { size: original.size, arrayBuffer() { throw new Error('unbounded'); }, slice(start, end) { largest = Math.max(largest, end - start); return original.slice(start, end); } };
  assert.equal(await hashBlob(blob), createHash('sha256').update(data).digest('hex'));
  assert.ok(largest <= 1024 * 1024);
});
test('cancellation stops a partially hashed file', async () => {
  const controller = new AbortController();
  await assert.rejects(hashBlob(new Blob(['abcdef']), { chunkSize: 2, signal: controller.signal, onProgress: () => controller.abort() }), { name: 'AbortError' });
});
test('finalized hashes cannot be reused and invalid chunk sizes are rejected', async () => {
  const state = new Sha256(); state.digest();
  assert.throws(() => state.digest()); assert.throws(() => state.update(new Uint8Array()));
  await assert.rejects(hashBlob(new Blob(['a']), { chunkSize: 0 }));
});
test('canonical encoding sorts keys but preserves array order and Unicode', () => {
  assert.equal(canonical({ b: '照片', a: 1 }), canonical({ a: 1, b: '照片' }));
  assert.notEqual(canonical([1, 2]), canonical([2, 1]));
  assert.equal(textHash('照片🌅'), createHash('sha256').update('照片🌅').digest('hex'));
});
