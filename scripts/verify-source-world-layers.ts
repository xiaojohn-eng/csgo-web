/** Parse the actual immutable GLB and bind every verified layer attribute.
 * PNG dimensions are inspected, not GPU-decoded: this is a CPU asset contract
 * check, not a browser screenshot, shader compile or frame-rate acceptance.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadSourceWorldLayers} from '../game/source-world-layers-loader';
import {applySourceWorldLightmaps} from '../game/source-world-lightmaps';
import {createSourceWorldBatch} from '../game/source-world-batch';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const directory=resolve(root,'public/source/csgo-12426148/fidelity-world-20260913/world');
const globals=globalThis as unknown as {self:typeof globalThis;createImageBitmap:typeof createImageBitmap};
globals.self=globalThis;
const originalFetch=globalThis.fetch;
globalThis.fetch=async input=>{
  const url=new URL(String(input));
  if(url.origin!=='http://world-sidecar.invalid'||!/^\/[a-z0-9.-]+$/.test(url.pathname))throw Error('Unexpected verification fetch: '+url.href);
  return new Response(await readFile(resolve(directory,url.pathname.slice(1))));
};
let inspectedPNGs=0,closedPNGs=0;
globals.createImageBitmap=(async(blob:Blob)=>{
  const b=Buffer.from(await blob.arrayBuffer());if(b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid original PNG');
  inspectedPNGs++;return {width:b.readUInt32BE(16),height:b.readUInt32BE(20),close(){closedPNGs++;}};
})as typeof createImageBitmap;
const loader=new GLTFLoader();
loader.register(()=>({name:'WorldContractTexturePlaceholder',loadTexture:async()=>new T.Texture()})as never);
let layers:Awaited<ReturnType<typeof loadSourceWorldLayers>>|undefined,hdr:ReturnType<typeof applySourceWorldLightmaps>|undefined,batch:ReturnType<typeof createSourceWorldBatch>|undefined;
try{
  const bytes=await readFile(resolve(root,'.reference-assets/source-exports/dust2-lightmapped/world.glb'));
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(hash!=='91b52e52b988e1b41b07b9cd365c159d615934fa49f07c3fa1e438d43269ffa8')throw Error('Original GLB changed');
  const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  layers=await loadSourceWorldLayers(gltf,{baseURL:'http://world-sidecar.invalid/',maxTextureSize:8192});
  const descriptor=JSON.parse(await readFile(resolve(root,'.reference-assets/source-exports/dust2-lightmapped/lightmaps.json'),'utf8'));
  const atlas=await readFile(resolve(root,'.reference-assets/source-exports/dust2-lightmapped/lightmap-0.rgbexp32'));
  hdr=applySourceWorldLightmaps(gltf.scene,descriptor,atlas.buffer.slice(atlas.byteOffset,atlas.byteOffset+atlas.byteLength),layers.decorateMaterial);
  if(layers.audit.decorated!==85)throw Error('Original material coverage differs');
  batch=createSourceWorldBatch(gltf.scene);
  let vertices=0,triangles=0;gltf.scene.traverse(o=>{const mesh=o as T.Mesh;if(mesh.isMesh){const a=mesh.geometry.getAttribute('sourceWorldBlend');if(!a)throw Error('Batch lost original blend attribute');vertices+=a.count;triangles+=(mesh.geometry.index?.count??a.count)/3;}});
  if(triangles!==302307||vertices!==373369)throw Error('World layer geometry coverage differs');
  if(batch.audit.sourceTriangles+batch.audit.skipped.length<1)throw Error('No real world geometry');
  const report={sourceWorldSha256:hash,scope:'CPU asset binding and shader injection; texture placeholders for original GLB, PNG header-only sidecars; no GPU/browser/frame-rate claim',
    ...layers.audit,batch:batch.audit,retainedLayerVertices:vertices,unchangedWorldTriangles:triangles,inspectedPNGs,shaderCount:hdr.materials};
  batch.dispose();batch=undefined;hdr.dispose();hdr=undefined;layers.dispose();layers=undefined;
  if(closedPNGs!==inspectedPNGs)throw Error('World texture ownership leaked');
  const target=resolve(root,'research/source-world-layer-binding.json');await mkdir(dirname(target),{recursive:true});
  await writeFile(target,JSON.stringify({...report,closedPNGs},null,2)+'\n');
  console.log(JSON.stringify({materials:report.decorated,vertices,triangles:report.batch.sourceTriangles,groups:report.batch.groups,inspectedPNGs,closedPNGs}));
}finally{batch?.dispose();hdr?.dispose();layers?.dispose();globalThis.fetch=originalFetch;}
