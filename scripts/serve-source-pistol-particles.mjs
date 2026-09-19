import {build} from 'esbuild';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
const out=resolve('output/pistol-particles-preview'),data=resolve('.reference-assets/source-exports/pistol-particles');await mkdir(out,{recursive:true});
await build({entryPoints:['scripts/preview-source-pistol-particles.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:out+'/preview.js'});
await writeFile(out+'/index.html',`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>原手枪粒子 · 数据与纹理</title><link rel="icon" href="data:,">
<style>*{box-sizing:border-box}body{margin:0;padding:28px;color:#e7edf2;background:#11181d;font:14px system-ui}h1{font-size:26px;margin:0 0 10px}.note{color:#c8aa70;margin-bottom:20px}#status{color:#91cbb9;padding:14px 0}main{display:grid;grid-template-columns:1fr 420px;gap:24px}article{background:#1c252c;padding:18px;margin-bottom:18px;border:1px solid #34414a;border-radius:8px}h3{font-size:13px;word-break:break-all}img{display:block;max-width:100%;max-height:290px;object-fit:contain;background:repeating-conic-gradient(#33414d 0% 25%,#22313b 0% 50%) 50%/20px 20px}canvas{display:block;margin-top:12px;background:#28353f}select{max-width:100%;padding:8px;background:#293943;color:white;border:1px solid #4d626f}pre{font-size:11px;line-height:1.5;max-height:85vh;overflow:auto;white-space:pre-wrap;word-break:break-all}p{font-size:12px;color:#a5b5c2}aside{position:sticky;top:18px;align-self:start}</style>
<h1>原手枪粒子 · main / core</h1><div id="status">正在核对原始数据…</div><div class="note">原 PCF 发射、寿命、速度与原 VTF / sheet 已执行呈现。原随机表、整批初始化顺序与首帧时间门控已移植；原 seed 分配、亚 7ms 多批发射、完整触发、深度羽化与 HDR 仍有缺口；烟雾和火花子系统尚未移植。</div>
<article><canvas id="particle-canvas" style="width:100%;max-width:920px;height:auto" width="920" height="440"></canvas><p id="readout"></p>
<button id="replay">重放原闪光</button> <label><input id="playing" type="checkbox" checked> 40 倍慢放</label>
<label>时间 <input id="clock" type="range" min="0" max="40" step="0.05" value="10"></label>
<label>方向 <input id="yaw" type="range" min="-180" max="180" step="1" value="0"></label>
<select id="mode"><option value="both">main + core</option><option value="main">仅 main</option><option value="core">仅 core</option></select></article>
<main><section id="gallery"></section><aside><select id="system"></select><pre id="details"></pre></aside></main><script type="module" src="/preview.js"></script></html>`);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.bin':'application/octet-stream'};
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1'),isData=url.pathname.startsWith('/data/'),base=isData?data:out,
 file=resolve(base,decodeURIComponent(isData?url.pathname.slice(6):url.pathname==='/'?'index.html':url.pathname.slice(1)));
 if(!file.startsWith(base+sep))throw Error('Invalid path');const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
 }catch{res.writeHead(404);res.end('Not found');}});
server.listen(27024,'127.0.0.1',()=>console.log('Original pistol particles data preview http://127.0.0.1:27024'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
