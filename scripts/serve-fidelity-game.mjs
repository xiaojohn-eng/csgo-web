// Frozen build for visual acceptance: continuing work cannot HMR-away a capture.
import {build} from 'vite';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
process.env.CSGO_BUILD_PROFILE='source';
const out=resolve('output/fidelity-fixes-2026-09-13/game-preview');
await build({configFile:resolve('vite.standalone.ts'),build:{outDir:out,copyPublicDir:false,emptyOutDir:true}});
if(process.argv.includes('--build-only'))process.exit(0);
const publicRoot=resolve('public');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css',
 '.json':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.glb':'model/gltf-binary','.woff2':'font/woff2','.svg':'image/svg+xml'};
createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');if(req.method!=='GET')throw Error('Read-only preview');
 const relative=decodeURIComponent(url.pathname==='/'?'index.html':url.pathname.slice(1));
 let file=resolve(out,relative);if(!file.startsWith(out+sep))throw Error('Invalid path');
 let bytes;try{bytes=await readFile(file);}catch{file=resolve(publicRoot,relative);if(!file.startsWith(publicRoot+sep))throw Error('Invalid asset path');bytes=await readFile(file);}
 res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
}catch{res.writeHead(404);res.end('Preview resource unavailable');}}).listen(27034,'127.0.0.1',()=>console.log('Frozen fidelity game http://127.0.0.1:27034/?map=de_dust2'));
