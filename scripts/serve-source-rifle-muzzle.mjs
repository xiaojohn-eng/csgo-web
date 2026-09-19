// The original rifle third-person muzzle, as a data preview: the same staged bytes
// the game fetches, baked at fixed clock times so a 15 ms effect can be inspected.
// The page is bundled from `scripts/preview-source-rifle-muzzle.ts` and served with
// `/data/` mapped onto the export directory, exactly like the pistol's preview.
import {build} from 'esbuild';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
// `/data/` is the staged directory the game itself fetches, not the export: the
// renderer verifies every byte against the staged resource manifest, so the preview
// has to see exactly those files. Run `python3 scripts/stage-source-muzzle-particles.py`
// first, the same way the game's own build does.
const out=resolve('output/rifle-muzzle-preview'),data=resolve('public/source/csgo-12426148/muzzle-particles');
await mkdir(out,{recursive:true});
await build({entryPoints:['scripts/preview-source-rifle-muzzle.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:out+'/preview.js'});
await writeFile(out+'/index.html',`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>原步枪第三人称枪口 · 数据与纹理</title><link rel="icon" href="data:,">
<style>*{box-sizing:border-box}body{margin:0;padding:28px;color:#e7edf2;background:#10171c;font:14px system-ui}h1{font-size:26px;margin:0 0 10px}.note{color:#c8aa70;margin-bottom:20px}#status{color:#91cbb9;padding:14px 0}main{display:grid;grid-template-columns:1fr 380px;gap:24px}article{background:#1b242a;padding:18px;margin-bottom:18px;border:1px solid #33404a;border-radius:8px}h3{font-size:13px;word-break:break-all}img{display:block;max-width:100%;max-height:240px;object-fit:contain;image-rendering:pixelated;background:repeating-conic-gradient(#33414d 0% 25%,#22313b 0% 50%) 50%/20px 20px}canvas{display:block;margin-top:12px;background:#1d262d}aside{position:sticky;top:18px;align-self:start}pre{font-size:11px;line-height:1.5;max-height:85vh;overflow:auto;white-space:pre-wrap;word-break:break-all}p{font-size:12px;color:#a5b5c2}</style>
<h1>原步枪第三人称枪口 · vent + glow + 火焰</h1><div id="status">正在核对原始数据…</div>
<div class="note">固定原版时钟采样：一枪的三套原系统（<code>_vent</code> 闪光、<code>_glow</code> 辉光、<code>_main</code> 火焰）按原参数绘制。枪口烟、抛壳烟、火花与 AWP 连续火焰尚未移植，原参数与原图集已随图入库。</div>
<article><canvas id="particle-canvas" style="width:100%;max-width:1080px;height:auto" width="1080" height="460"></canvas><p id="readout"></p>
<button id="replay">重放原枪口</button> <label><input id="playing" type="checkbox" checked> 40 倍慢放</label>
<label>时间 <input id="clock" type="range" min="0" max="40" step="0.05" value="6"></label>
<label>枪管方向 <input id="yaw" type="range" min="-180" max="180" step="1" value="0"></label>
<select id="mode"><option value="both">三套子系</option><option value="vent">仅闪光</option></select></article>
<main><section id="gallery"></section><aside><pre id="details"></pre></aside></main><script type="module" src="/preview.js"></script></html>`);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.bin':'application/octet-stream'};
const port=Number(process.env.CSGO_RIFLE_PREVIEW_PORT||27025);
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1'),isData=url.pathname.startsWith('/data/'),base=isData?data:out,
 file=resolve(base,decodeURIComponent(isData?url.pathname.slice(6):url.pathname==='/'?'index.html':url.pathname.slice(1)));
 if(!file.startsWith(base+sep))throw Error('Invalid path');const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
}catch{res.writeHead(404);res.end('Not found');}});
server.listen(port,'127.0.0.1',()=>console.log(`Original rifle muzzle data preview http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
