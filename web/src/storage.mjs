import { approvalMatches, assertManifest } from './ontology.mjs';

const TABLES = ['scopes', 'assets', 'plans', 'approvals', 'journal', 'protections', 'settings'];
export class Store {
  durable = true;
  constructor(db) { this.db = db; }
  static async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('spacekeeper-web', 1);
      request.onupgradeneeded = () => { for (const name of TABLES) request.result.createObjectStore(name); };
      request.onsuccess = () => resolve(new Store(request.result));
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('请关闭其他旧版页面后重试'));
    });
  }
  async get(table, key) {
    return new Promise((resolve, reject) => {
      const request = this.db.transaction(table).objectStore(table).get(key);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  async all(table) {
    return new Promise((resolve, reject) => {
      const request = this.db.transaction(table).objectStore(table).getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  async put(table, key, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(table, 'readwrite', { durability: 'strict' });
      tx.objectStore(table).put(value, key);
      tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('记录保存失败'));
    });
  }
  async remove(table, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(table, 'readwrite'); tx.objectStore(table).delete(key);
      tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('记录更新失败'));
    });
  }
  async savePlan(plan, expectedVersion = null) {
    assertManifest(plan);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('plans', 'readwrite', { durability: 'strict' }), store = tx.objectStore('plans');
      let failure;
      const request = store.get(plan.id);
      request.onsuccess = () => {
        const current = request.result;
        if (expectedVersion !== null && (!current || current.version !== expectedVersion || current.status !== 'REVIEW')) {
          failure = new Error('计划已在其他页面更新，请重新打开'); tx.abort(); return;
        }
        if (expectedVersion === null && current) { failure = new Error('计划已存在'); tx.abort(); return; }
        store.put(plan, plan.id);
      };
      tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('计划保存失败'));
    });
  }
  async approve(plan, approval) {
    if (!this.durable || !approvalMatches(plan, approval)) throw new Error('缺少可靠的确认记录');
    assertManifest(plan);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['plans', 'approvals'], 'readwrite', { durability: 'strict' });
      let failure;
      const request = tx.objectStore('plans').get(plan.id);
      request.onsuccess = () => {
        if (request.result?.status !== 'REVIEW' || !approvalMatches(request.result, approval)) {
          failure = new Error('计划已变化，请重新确认'); tx.abort(); return;
        }
        tx.objectStore('plans').put({ ...plan, status: 'APPROVED' }, plan.id);
        tx.objectStore('approvals').put(approval, plan.id);
      };
      tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('确认未保存'));
    });
  }
  async setStatus(planId, status) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('plans', 'readwrite', { durability: 'strict' }), store = tx.objectStore('plans');
      const request = store.get(planId); let failure;
      request.onsuccess = () => {
        const plan = request.result;
        const allowed = { APPROVED: ['RUNNING'], RUNNING: ['RUNNING', 'COMPLETED', 'PARTIAL'] };
        if (!plan || !allowed[plan.status]?.includes(status)) { failure = new Error('无效的执行状态'); tx.abort(); return; }
        store.put({ ...plan, status }, planId);
      };
      tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('状态保存失败'));
    });
  }
}

/** Private browsing / storage failures: analysis remains usable, deletion stays unavailable. */
export class MemoryStore {
  durable = false;
  tables = new Map(TABLES.map(name => [name, new Map()]));
  async get(table, key) { return structuredClone(this.tables.get(table).get(key)); }
  async all(table) { return structuredClone([...this.tables.get(table).values()]); }
  async put(table, key, value) { this.tables.get(table).set(key, structuredClone(value)); }
  async remove(table, key) { this.tables.get(table).delete(key); }
  async savePlan(plan, expectedVersion = null) {
    const current = await this.get('plans', plan.id);
    if (expectedVersion !== null && (current?.version !== expectedVersion || current.status !== 'REVIEW')) throw new Error('计划已变化');
    assertManifest(plan); await this.put('plans', plan.id, plan);
  }
  async approve() { throw new Error('本地存储不可用，不能执行删除'); }
}
