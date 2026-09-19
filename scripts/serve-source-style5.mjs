// Dedicated local GPU acceptance page. Build only: node scripts/serve-source-style5.mjs --build-only
// Serve: CSGO_STYLE5_PREVIEW_PORT=27029 node scripts/serve-source-style5.mjs
import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { resolve, extname, sep } from 'node:path';

const out = resolve('output/style5-preview');
await mkdir(out, { recursive: true });
const original = await readFile('.reference-assets/source-exports/ak47-redline-programs/seed-uv.json');
const control = JSON.parse(original).cases.find(row => row.seed === 422);
if (!control?.matrices?.pattern?.nativeMatrix) throw Error('Original seed-422 matrix control missing');
await writeFile(out + '/redline-control.json', JSON.stringify({
  sourceSha256: createHash('sha256').update(original).digest('hex'), seed: 422,
  matrices: control.matrices,
}) + '\n');
await build({ entryPoints: ['scripts/preview-source-style5.ts'], bundle: true, format: 'esm',
  platform: 'browser', target: 'es2022', outfile: out + '/preview.js' });
await writeFile(out + '/index.html', `<!doctype html><html lang="zh-CN"><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>原版涂装 · Style 5 验收</title><link rel="icon" href="data:,">
<style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#10171e;color:#eef2f5;font:14px system-ui}h1{font-size:25px}h2{font-size:18px}p{line-height:1.6;color:#a9bac8}#status{position:sticky;top:0;background:#15232e;padding:14px;z-index:2;border-left:3px solid #63d4b7}#gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}article{padding:15px;background:#1b2934;border:1px solid #334651;border-radius:8px}.maps{display:flex;gap:5px}.maps canvas{width:50%;height:auto;image-rendering:auto;background:#222}img{display:block;width:100%;height:auto;border:1px solid #334651;margin:8px 0}pre{font-size:11px;white-space:pre-wrap;word-break:break-all;max-height:50vh;overflow:auto}.owner-step{margin:16px 0;padding:16px;background:#1b2934}.views{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:700px){.views{grid-template-columns:1fr}}</style>
<h1>原版涂装 · Style 5 与材质切换验收</h1><p>10 张涂装使用实际游戏合成器。颜色和指数图分别保留原 RGBA；缩略图仅将 alpha 显示为不透明，alpha 本身是反光数据。下方以原 AWP 第一人称和世界模型检查换装与恢复。此页面验证浏览器渲染与资源生命周期，完整原客户端画面对照仍是独立验收。</p>
<div id="status">正在加载原始数据…</div><h2>10 张 Style 5 与 AK 红线对照</h2><section id="gallery"></section>
<h2>同一 AWP：默认 → 雷击 → 无畏战神 → 雷击 → 默认</h2><section id="owner"></section>
<details><summary>结构化证据</summary><pre id="details"></pre></details><script type="module" src="/preview.js"></script></html>`);
console.log(`Built dedicated preview at ${out}`);
if (!process.argv.includes('--build-only')) {
  const mounts = { '/source/': resolve('public/source') };
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary' };
  let sequence = 0;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'POST' && url.pathname === '/evidence') {
        const chunks = []; let total = 0;
        for await (const chunk of request) {
          total += chunk.length;
          if (total > 2_000_000) throw Error('Evidence exceeds limit');
          chunks.push(chunk);
        }
        const proof = JSON.parse(Buffer.concat(chunks).toString());
        if (proof.format !== 'source-style5-browser-proof-v1') throw Error('Unexpected proof');
        const name = `proof-${new Date().toISOString().replace(/[:.]/g, '-')}-${++sequence}.json`;
        await writeFile(resolve(out, name), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ saved: `output/style5-preview/${name}` })); return;
      }
      if (request.method !== 'GET') throw Error('Read-only route');
      const mount = Object.keys(mounts).find(prefix => url.pathname.startsWith(prefix));
      const base = mount ? mounts[mount] : out;
      const relative = mount ? url.pathname.slice(mount.length)
        : (url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      const file = url.pathname === '/native-evidence.json' ? resolve('research/source-style5-overrides.json')
        : resolve(base, decodeURIComponent(relative));
      if (url.pathname !== '/native-evidence.json' && !file.startsWith(base + sep)) throw Error('Invalid path');
      const bytes = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(bytes);
    } catch (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Preview resource unavailable');
      console.error(String(error));
    }
  });
  const port = Number(process.env.CSGO_STYLE5_PREVIEW_PORT || 27029);
  server.listen(port, '127.0.0.1', () => console.log(`Style 5 GPU preview http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
