import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = await realpath(fileURLToPath(new URL('../dist', import.meta.url)));
const port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = path.resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
    if (target !== root && !target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    const resolved = await realpath(target);
    if (!resolved.startsWith(root + path.sep) || !(await stat(resolved)).isFile()) throw new Error('not found');
    const body = await readFile(resolved);
    response.writeHead(200, { 'Content-Type': types[path.extname(resolved)] || 'application/octet-stream',
      'Content-Length': body.length, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.on('error', error => { console.error(`Cannot start local preview: ${error.code}. Open dist/index.html for read-only preview, or use an HTTPS static host.`); process.exitCode = 1; });
server.listen(port, host, () => console.log(`Space Keeper Web: http://${host}:${port}`));
