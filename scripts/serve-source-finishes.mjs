// The per-weapon finish composition, as a real-browser preview: the same staged bytes the game
// fetches, composed by the same compositor the game uses. Three original finishes are
// composed so the difference between them is visible and measurable.
//
// Run `python3 scripts/stage-source-paint-kits.py` and
// `python3 scripts/stage-source-ak-patterns.py` first: `/catalogue/`, `/patterns/` and
// `/shared/` map onto the staged directories the game itself reads, because the
// compositor verifies every byte against a manifest.
import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';

const out = resolve('output/ak-finishes-preview');
const mounts = {
  '/catalogue/': resolve('public/source/csgo-12426148/skins'),
  '/patterns/': resolve('public/source/csgo-12426148/ak-patterns'),
  '/shared/': resolve('public/source/csgo-12426148/redline-inputs'),
  // A weapon whose inputs are staged per weapon: its own sampled textures, its own Phong
  // values and its own finishes all hang off this tree.
  '/kit-inputs/': resolve('public/source/csgo-12426148/kit-inputs-fidelity-20260913'),
};
await mkdir(out, { recursive: true });
await build({ entryPoints: ['scripts/preview-source-finishes.ts'], bundle: true, format: 'esm',
  platform: 'browser', target: 'es2022', outfile: out + '/preview.js' });
await writeFile(out + '/index.html', `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>原版 AK 涂装合成</title><link rel="icon" href="data:,">
<style>*{box-sizing:border-box}body{margin:0;padding:28px;color:#e7edf2;background:#10171c;font:14px system-ui}h1{font-size:26px;margin:0 0 10px}.note{color:#c8aa70;margin-bottom:20px;font-size:12px}#status{color:#91cbb9;padding:14px 0}main{display:grid;grid-template-columns:1fr 420px;gap:24px}#gallery{display:flex;flex-wrap:wrap;gap:12px;align-content:start}canvas{display:block;width:320px;height:320px;background:repeating-conic-gradient(#33414d 0% 25%,#22313b 0% 50%) 50%/20px 20px;border:1px solid #33404a}article{background:#1b242a;padding:14px;margin-bottom:14px;border:1px solid #33404a;border-radius:8px}pre{font-size:11px;line-height:1.5;max-height:85vh;overflow:auto;white-space:pre-wrap;word-break:break-all}p{white-space:pre-wrap;font-size:12px;color:#a5b5c2}</style>
<h1>原版 AK 涂装合成 · 同一合成器、不同涂装</h1><div id="status">正在核对原始数据并合成…</div>
<div class="note">三张原涂装各自用<b>自己的</b>图案贴图、自己的 Phong 值与自己的磨损窗口合成。颜色/指数图若互相相同，说明涂装没有真正参与合成。</div>
<main><section id="gallery"></section><aside><p id="readout"></p><pre id="details"></pre></aside></main><script type="module" src="/preview.js"></script></html>`);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png' };
const port = Number(process.env.CSGO_AK_FINISH_PREVIEW_PORT || 27026);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const mount = Object.keys(mounts).find((prefix) => url.pathname.startsWith(prefix));
    const base = mount ? mounts[mount] : out;
    const relative = mount ? url.pathname.slice(mount.length) : (url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    const file = resolve(base, decodeURIComponent(relative));
    if (!file.startsWith(base + sep)) throw Error('Invalid path');
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Original AK finish preview http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
