// Dedicated local GPU acceptance page. Build only: node scripts/serve-source-paint-styles.mjs --build-only
// Serve: CSGO_PAINT_PREVIEW_PORT=27035 node scripts/serve-source-paint-styles.mjs
import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';

const out = resolve('output/paint-styles-preview');
await mkdir(out, { recursive: true });
await build({ entryPoints: ['scripts/preview-source-paint-styles.ts'], bundle: true, format: 'esm',
  platform: 'browser', target: 'es2022', outfile: out + '/preview.js' });
await writeFile(out + '/index.html', `<!doctype html><html lang="zh-CN"><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>原版涂装 · 全着色器分支验收</title><link rel="icon" href="data:,">
<style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#10171e;color:#eef2f5;font:14px system-ui}h1{font-size:25px}h2{font-size:18px}p{line-height:1.6;color:#a9bac8}#status{position:sticky;top:0;background:#15232e;padding:14px;z-index:2;border-left:3px solid #63d4b7}#gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}article{padding:15px;background:#1b2934;border:1px solid #334651;border-radius:8px}.maps{display:flex;gap:5px}.maps canvas{width:50%;height:auto;image-rendering:auto;background:#222}img{display:block;width:100%;height:auto;border:1px solid #334651;margin:8px 0}pre{font-size:11px;white-space:pre-wrap;word-break:break-all;max-height:50vh;overflow:auto}.owner-step{margin:16px 0;padding:16px;background:#1b2934}.views{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:700px){.views{grid-template-columns:1fr}}</style>
<h1>原版涂装 · 全着色器分支验收</h1><p>默认逐枪检查每一种原着色器分支；<a href="/?all=1">检查完整可装备目录</a>。每张使用原始材质数据与 GPU 合成器，验收分辨率256/128；缩略图alpha只为展示置为不透明。完整原客户端画面对照仍独立。</p>
<div id="status">正在加载原始数据…</div><section id="gallery"></section>
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
        if (proof.format !== 'source-paint-styles-browser-proof-v1') throw Error('Unexpected proof');
        const name = `proof-${new Date().toISOString().replace(/[:.]/g, '-')}-${++sequence}.json`;
        await writeFile(resolve(out, name), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ saved: `output/paint-styles-preview/${name}` })); return;
      }
      if (request.method !== 'GET') throw Error('Read-only route');
      const mount = Object.keys(mounts).find(prefix => url.pathname.startsWith(prefix));
      const base = mount ? mounts[mount] : out;
      const relative = mount ? url.pathname.slice(mount.length)
        : (url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      const file = url.pathname === '/native-evidence.json' ? resolve('research/source-customweapon-all-programs.json')
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
  const port = Number(process.env.CSGO_PAINT_PREVIEW_PORT || 27035);
  server.listen(port, '127.0.0.1', () => console.log(`Paint styles GPU preview http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
