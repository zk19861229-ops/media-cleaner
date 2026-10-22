/* WORKER_SOURCE is embedded by the build, so no network request is needed to start analysis. */
export class Analyzer {
  constructor() {
    this.url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    try { this.worker = new Worker(this.url); }
    catch (error) { URL.revokeObjectURL(this.url); throw error; }
    this.pending = new Map();
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      if (data.progress) { pending.progress(data.progress); return; }
      this.pending.delete(data.id); pending.cleanup();
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
    };
    this.worker.onerror = () => this.close(new Error('分析线程启动失败，请使用较新版本浏览器'));
  }
  analyze(file, { hash = true, metrics = true, signal, onProgress = () => {} } = {}) {
    signal?.throwIfAborted();
    if (this.closedReason) return Promise.reject(this.closedReason);
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const cancel = () => this.close(new DOMException('分析已暂停', 'AbortError'));
      signal?.addEventListener('abort', cancel, { once: true });
      this.pending.set(id, { resolve, reject, progress: onProgress, cleanup: () => signal?.removeEventListener('abort', cancel) });
      this.worker.postMessage({ id, file, doHash: hash, doMetrics: metrics });
    });
  }
  close(reason = new DOMException('分析结束', 'AbortError')) {
    if (this.closedReason) return;
    this.closedReason = reason;
    this.worker.terminate(); URL.revokeObjectURL(this.url);
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(reason); }
    this.pending.clear();
  }
}
