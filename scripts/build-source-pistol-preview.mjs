import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
const out='.reference-assets/source-exports/pistol-preview';await mkdir(out,{recursive:true});
await build({entryPoints:['scripts/preview-source-pistol.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',external:['three','three/*'],outfile:out+'/preview.js'});
await writeFile(out+'/index.html',`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>原手枪第一人称检查</title><link rel="icon" href="data:,">
<style>body{margin:0;background:#26333f;color:#eee;font:14px system-ui}canvas{display:block}aside{position:absolute;top:18px;left:18px;padding:14px;background:#16202aee;border-radius:8px;max-width:85vw}select,button,input{margin:5px;padding:5px}#status{margin:6px 0}small{color:#abbccc}</style>
<script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script>
<canvas></canvas><aside><b>原手枪 · 第一人称动作检查</b><div id="status">加载中</div><select id="weapon"><option value="glock">Glock-18</option><option value="usp">USP-S</option></select><select id="team"><option value="t">T 手臂</option><option value="ct">CT 手臂</option></select><select id="clip"></select><br><button id="play" disabled>播放动作与原音效</button><button id="stop">中断动作</button><input id="time" type="range" min="0" max="6.5" step="0.01" value="0"><button id="unload">卸载资源</button><br><small>固定原版时间采样；中性预览光照，尚未接入手枪对战</small></aside><script type="module" src="./preview.js"></script></html>`);
