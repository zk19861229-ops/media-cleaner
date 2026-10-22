import { hashBlob } from './hashing.mjs';

async function imageMetrics(file) {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const width = bitmap.width, height = bitmap.height;
    if (width < 64 || height < 64) return null;
    const scale = Math.min(1, 256 / Math.max(width, height));
    const canvas = new OffscreenCanvas(Math.max(3, Math.round(width * scale)), Math.max(3, Math.round(height * scale)));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const gray = (pixels, at) => (pixels[at] * 299 + pixels[at + 1] * 587 + pixels[at + 2] * 114) / 1000;
    let sum = 0, count = 0;
    for (let y = 1; y < canvas.height - 1; y += 2) for (let x = 1; x < canvas.width - 1; x += 2) {
      const at = (y * canvas.width + x) * 4;
      const laplacian = 4 * gray(data, at) - gray(data, at - 4) - gray(data, at + 4) - gray(data, at - canvas.width * 4) - gray(data, at + canvas.width * 4);
      sum += laplacian * laplacian; count++;
    }
    const tiny = new OffscreenCanvas(9, 8), small = tiny.getContext('2d', { willReadFrequently: true });
    small.drawImage(canvas, 0, 0, 9, 8);
    const pixels = small.getImageData(0, 0, 9, 8).data;
    let hash = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const at = (y * 9 + x) * 4;
      hash = (hash << 1n) | (gray(pixels, at) > gray(pixels, at + 4) ? 1n : 0n);
    }
    return { width, height, perceptualHash: hash.toString(16).padStart(16, '0'), sharpness: count ? sum / count : 0 };
  } catch { return null; }
  finally { bitmap?.close(); }
}
self.onmessage = async ({ data }) => {
  const { id, file, doHash, doMetrics } = data;
  try {
    const hash = doHash ? await hashBlob(file, { onProgress: (done, total) => self.postMessage({ id, progress: { done, total } }) }) : null;
    const metrics = doMetrics ? await imageMetrics(file) : null;
    self.postMessage({ id, result: { hash, ...(metrics ?? { width: 0, height: 0, perceptualHash: null, sharpness: 0 }) } });
  } catch (error) { self.postMessage({ id, error: error.name ?? 'ReadError' }); }
};
