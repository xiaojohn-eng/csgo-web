/** Actual immutable GLB material/source texture binding, no geometry import or
 * GPU. Sharp decodes every lower PNG and checks its original VTF pixel receipt;
 * the browser ImageBitmap API is substituted with explicit owned CPU handles. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import sharpModule from 'sharp';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadSourcePropMips,type SourcePropMipManifest} from '../game/source-map-prop-mips';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sharp=sharpModule as (bytes:Uint8Array)=>{ensureAlpha():{raw():{toBuffer(options:{resolveWithObject:true}):Promise<{data:Uint8Array;info:{width:number;height:number}}>}}};
const directory=resolve(root,'public/source/csgo-12426148/fidelity-world-20260913/prop-mips');
const manifest:SourcePropMipManifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8'));
const raw=await readFile(resolve(root,'.reference-assets/source-exports/dust2/props.glb'));
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');assert.equal(hash(raw),manifest.originalGLBSha256);
const size=new DataView(raw.buffer,raw.byteOffset,raw.byteLength).getUint32(12,true),doc=JSON.parse(raw.subarray(20,20+size).toString()),binary=raw.subarray(28+size);
let bypassedMeshes=0,baseImages=0,decodedLowerImages=0,closedLowerImages=0;
const textures:T.Texture[]=[];
const loader=new GLTFLoader();
loader.register(()=>({name:'CPU_MATERIAL_ONLY',loadMesh:async()=>{bypassedMeshes++;return new T.Group();},
  loadTexture:async(index:number)=>{
    const image=doc.images[doc.textures[index].source],v=doc.bufferViews[image.bufferView];
    const b=binary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength),data=await sharp(b).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const texture=new T.Texture({width:data.info.width,height:data.info.height} as ImageBitmap);texture.flipY=false;
    textures.push(texture);baseImages++;return texture;
  }})as never);
const gltf=await loader.parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'');
const originalFetch=globalThis.fetch,originalBitmap=globalThis.createImageBitmap;
let corruptFile:string|undefined;
globalThis.fetch=async input=>{
  const url=new URL(String(input));assert.equal(url.origin,'http://prop-mip-test.invalid');assert.match(url.pathname,/^\/[a-z0-9.-]+$/);
  const data=await readFile(resolve(directory,url.pathname.slice(1)));if(url.pathname.slice(1)===corruptFile)data[0]^=1;
  return new Response(data);
};
const levels=new Map(manifest.textures.flatMap(t=>t.levels.map(l=>[l.sha256,l] as const)));
globalThis.createImageBitmap=(async(blob:Blob)=>{
  const encoded=new Uint8Array(await blob.arrayBuffer()),receipt=levels.get(hash(encoded));assert(receipt);
  const {data,info}=await sharp(encoded).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(hash(data),receipt.rgbaSha256);
  decodedLowerImages++;return {width:info.width,height:info.height,close(){closedLowerImages++;}} as ImageBitmap;
})as typeof createImageBitmap;
let owner:Awaited<ReturnType<typeof loadSourcePropMips>>|undefined;
try{
  owner=await loadSourcePropMips(gltf,{baseURL:'http://prop-mip-test.invalid/'});
  assert.equal(owner.audit.textures,6);assert.equal(owner.audit.enabled,true);assert.equal(textures.length,6);
  const before=textures.map(t=>({t,image:t.image,colorSpace:t.colorSpace,channel:t.channel,flipY:t.flipY}));
  for(const {t,image} of before){assert.equal(t.mipmaps[0],image);assert.equal(t.generateMipmaps,false);}
  owner.setEnabled(false);for(const t of textures){assert.equal(t.generateMipmaps,true);assert.equal(t.mipmaps.length,0);}
  owner.setEnabled(true);for(const b of before){assert.equal(b.t.image,b.image);assert.equal(b.t.colorSpace,b.colorSpace);assert.equal(b.t.channel,b.channel);assert.equal(b.t.flipY,b.flipY);}
  const audit={...owner.audit};owner.dispose();owner=undefined;assert.equal(closedLowerImages,decodedLowerImages);
  const positiveDecoded=decodedLowerImages;
  corruptFile=manifest.textures[0].levels[0].file;
  await assert.rejects(loadSourcePropMips(gltf,{baseURL:'http://prop-mip-test.invalid/'}),/SHA differs/);
  assert.equal(closedLowerImages,decodedLowerImages);
  for(const t of textures){assert.equal(t.generateMipmaps,true);assert.equal(t.mipmaps.length,0);}
  const receipt={...audit,scope:'Actual GLTF material dependencies, exact lower PNG pixels and reversible texture state; no geometry/GPU/browser/framerate verification',
    originalGLBSha256:hash(raw),baseImages,positiveDecoded,decodedLowerImages,closedLowerImages,bypassedMeshes,geometryImported:false,
    corruptMipRejectsBeforeAnyTextureMutation:true,allConcurrentDecodersSettledBeforeCleanup:true};
  await writeFile(resolve(root,'research/source-prop-mips-binding.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
}finally{owner?.dispose();for(const t of textures)t.dispose();globalThis.fetch=originalFetch;globalThis.createImageBitmap=originalBitmap;}
