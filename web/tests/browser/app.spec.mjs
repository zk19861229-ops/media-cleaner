import { test, expect } from 'playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
// Route a synthetic secure origin locally; no network server or uploaded media.
async function openApp(page) {
  await page.route('https://spacekeeper.test/**', async route => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    if (!['index.html', 'app.js', 'styles.css', 'icon.svg'].includes(name)) return route.abort();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    await route.fulfill({ body: await readFile(path.join(dist, name)), contentType: types[path.extname(name)] });
  });
  await page.goto('https://spacekeeper.test/');
  await expect(page.getByRole('heading', { name: '给回忆，留点空间。' })).toBeVisible();
}
async function setupDirectory(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(`test-${crypto.randomUUID()}`, { create: true });
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#7a55d8'; ctx.fillRect(0, 0, 100, 100);
    const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    for (const name of ['a.png', 'b.png', 'c.png']) {
      const handle = await directory.getFileHandle(name, { create: true }), writer = await handle.createWritable();
      await writer.write(image); await writer.close();
    }
    // Real OPFS handles exercise IndexedDB cloning, resolve(), getFile() and removeEntry().
    // Only the native picker is substituted; native OS permission prompts still need manual acceptance.
    window.__testDirectory = directory;
    window.showDirectoryPicker = async () => directory;
    return directory.name;
  });
}
test('demo supports preview and export, never offers deletion', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await openApp(page); await page.getByRole('button', { name: '体验演示', exact: true }).click();
  await expect(page.getByRole('heading', { name: '把选择，留给自己。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '导出清理计划' })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看并确认清理' })).toHaveCount(0);
  await page.locator('.asset-thumb').first().click(); await expect(page.locator('#preview-dialog')).toBeVisible();
  await page.getByRole('button', { name: '关闭预览' }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出清理计划' }).click();
  expect((await download).suggestedFilename()).toMatch(/^spacekeeper-plan-/); expect(errors).toEqual([]);
});
test('real browser directory handles delete only after the explicit confirmation', async ({ page }) => {
  await openApp(page); await setupDirectory(page);
  await page.locator('.hero').getByRole('button', { name: '选择文件夹' }).click();
  await page.getByRole('button', { name: '分析并生成计划' }).click();
  await expect(page.getByRole('button', { name: '查看并确认清理' })).toBeEnabled();
  const count = () => page.evaluate(async () => { let n = 0; for await (const _ of window.__testDirectory.values()) n++; return n; });
  expect(await count()).toBe(3);
  await page.getByRole('button', { name: '查看并确认清理' }).click();
  await page.getByRole('button', { name: '返回检查' }).click(); expect(await count()).toBe(3);
  await page.getByRole('button', { name: '查看并确认清理' }).click();
  await page.getByRole('button', { name: '确认永久删除 2 项' }).click();
  await expect(page.getByText('成功删除文件的逻辑大小', { exact: true })).toBeVisible(); expect(await count()).toBe(1);
});
test('changed target is skipped, and a reloaded plan retains its selections', async ({ page }) => {
  await openApp(page); await setupDirectory(page);
  await page.locator('.hero').getByRole('button', { name: '选择文件夹' }).click();
  await page.getByRole('button', { name: '分析并生成计划' }).click();
  const boxes = page.locator('[data-select]'); await expect(boxes).toHaveCount(2);
  await boxes.first().uncheck(); await page.reload();
  await expect(page.locator('[data-select]:checked')).toHaveCount(1);
  const filename = await page.locator('.asset-row').filter({ has: page.locator('[data-select]:checked') }).locator('.file-name').innerText();
  // Retrieve the real persisted handle after reload, and modify a generated test target.
  await page.evaluate(async name => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('spacekeeper-web', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const scopes = await new Promise(resolve => { const r = db.transaction('scopes').objectStore('scopes').getAll(); r.onsuccess = () => resolve(r.result); });
    const file = await scopes[0].handle.getFileHandle(name), writer = await file.createWritable(); await writer.write('changed test bytes'); await writer.close(); db.close();
  }, filename);
  await page.getByRole('button', { name: '查看并确认清理' }).click(); await page.getByRole('button', { name: '确认永久删除 1 项' }).click();
  await expect(page.getByText('目标文件已变化', { exact: true })).toBeVisible();
});
test('mobile layout has no horizontal overflow and settings disclose data scope', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openApp(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByText('仅在当前页面内存中保存', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-settings.png', fullPage: true });
});
