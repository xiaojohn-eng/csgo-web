import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const output = '.reference-assets/source-exports/dust2/visibility/preview-source-visibility.js';
await build({ entryPoints: ['scripts/preview-source-visibility.ts'], bundle: true, format: 'esm', platform: 'browser',
  target: 'es2022', external: ['three'], outfile: output });
const files = ['scripts/preview-source-visibility.ts', 'game/source-visibility.ts', 'game/source-visibility-render.ts', output], receipt = {};
for (const path of files) {
  const raw = await readFile(path); receipt[path] = { bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') };
}
await writeFile(output + '.build.json', JSON.stringify({ status: 'built', external: ['three'], files: receipt }, null, 2) + '\n');
console.log(JSON.stringify(receipt));
