import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const directory of ['src', 'scripts', 'tests']) {
  for (const file of await readdir(new URL(`../${directory}/`, import.meta.url))) {
    if (!file.endsWith('.mjs')) continue;
    const result = spawnSync(process.execPath, ['--check', new URL(`../${directory}/${file}`, import.meta.url).pathname], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log('JavaScript syntax checks passed.');
