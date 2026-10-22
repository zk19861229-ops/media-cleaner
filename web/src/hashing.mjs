import { Sha256, bytesToHex } from './sha256.mjs';

export function textHash(text) {
  return bytesToHex(new Sha256().update(new TextEncoder().encode(text)).digest());
}

/** Incremental SHA-256: memory is bounded even for multi-gigabyte videos. */
export async function hashBlob(blob, { signal, onProgress = () => {}, chunkSize = 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new Error('无效分块大小');
  const state = new Sha256();
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    signal?.throwIfAborted();
    state.update(new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer()));
    onProgress(Math.min(offset + chunkSize, blob.size), blob.size);
  }
  signal?.throwIfAborted();
  return bytesToHex(state.digest());
}

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
