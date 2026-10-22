import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'dist');
await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
await cp(path.join(root, 'public'), out, { recursive: true });
const worker = await build({ entryPoints: [path.join(root, 'src/analysis-worker.mjs')], bundle: true, write: false, format: 'iife', target: 'es2022', minify: true });
await build({ entryPoints: [path.join(root, 'src/app.mjs')], bundle: true, outfile: path.join(out, 'app.js'),
  format: 'iife', target: 'es2022', minify: true, sourcemap: true, define: { WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text) } });
await writeFile(path.join(out, 'build-info.json'), JSON.stringify({ version: '0.1.0', builtAt: new Date().toISOString(), processing: 'local-browser', externalModelsEnabledByDefault: false }, null, 2));
console.log(`Static Web app built: ${out}`);
