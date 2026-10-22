import test from 'node:test';
import assert from 'node:assert/strict';
import { Analyzer } from '../src/worker-client.mjs';

test('a crashed worker rejects pending and subsequent work instead of hanging the scan', async t => {
  const originals = new Map(['WORKER_SOURCE', 'Worker'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  globalThis.WORKER_SOURCE = '';
  globalThis.Worker = class {
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  const analyzer = new Analyzer();
  const pending = analyzer.analyze(new Blob(['sample']));
  analyzer.worker.onerror();
  await assert.rejects(pending, /分析线程启动失败/);
  await assert.rejects(analyzer.analyze(new Blob(['next'])), /分析线程启动失败/);
  assert.equal(analyzer.worker.terminated, true);
  assert.equal(analyzer.pending.size, 0);
});
