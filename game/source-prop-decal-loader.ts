import * as T from 'three';
import {sourceSha256} from './source-sha256';
import {prepareSourcePropDecalUv,type SourcePropDecalUvManifest} from './source-prop-decal-uv';
export interface SourcePropDecalAssets {materials:Map<string,SourcePropDecalResource>;uv:Awaited<ReturnType<typeof prepareSourcePropDecalUv>>}

export interface SourcePropDecalResource {texture:T.Texture;source:string;mode:1|2}
interface Manifest {
  format:'source-prop-decal-v1';sourceBspSha256:string;
  textures:{source:string;url:string;bytes:number;sha256:string;width:number;height:number;clampS:boolean;clampT:boolean}[];
  materials:{material:string;decalSource:string;mode:1|2}[];
}
const bsp='b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc';
const positive=(n:number)=>Number.isSafeInteger(n)&&n>0;

/** Owns only additional raw decal textures. All bytes are SHA-verified even on
 * insecure HTTP LAN; no ImageBitmap color conversion, premultiplication or flip.
 * A separate 32 MiB default budget includes full mip chains, and 8 textures max.
 */
export async function loadSourcePropDecals(options:{baseURL:string;signal?:AbortSignal;maxTextureSize?:number;maxTextureBytes?:number}){
  const {signal}=options,maximum=options.maxTextureSize??8192,budget=options.maxTextureBytes??32*1024*1024;
  const base=new URL(options.baseURL,globalThis.location?.href??'http://127.0.0.1/');signal?.throwIfAborted();
  const response=await fetch(new URL('manifest.json',base),{signal,cache:'no-cache'});if(!response.ok)throw Error('Decal manifest HTTP '+response.status);
  const manifest:Manifest=await response.json();
  if(manifest.format!=='source-prop-decal-v1'||manifest.sourceBspSha256!==bsp||!Array.isArray(manifest.textures)||!Array.isArray(manifest.materials))throw Error('Original decal manifest identity differs');
  const bySource=new Map(manifest.textures.map(t=>[t.source,t]));
  if(bySource.size!==manifest.textures.length||new Set(manifest.materials.map(m=>m.material)).size!==manifest.materials.length)throw Error('Duplicate decal identity');
  let textureBytes=0;
  if(!positive(maximum)||!positive(budget)||manifest.textures.length>8)throw Error('Invalid decal texture budget');
  for(const t of manifest.textures){
    if(!positive(t.width)||!positive(t.height)||Math.max(t.width,t.height)>maximum||!positive(t.bytes)||t.bytes>32*1024*1024)throw Error('Decal texture budget exceeded');
    if(!/^[a-zA-Z0-9_-]+\.png$/.test(t.url)||!/^materials\/[^:]+\.vtf$/.test(t.source)||t.source.includes('..')||!/^[a-f0-9]{64}$/.test(t.sha256))throw Error('Invalid decal texture receipt');
    let w=t.width,h=t.height;while(true){textureBytes+=w*h*4;if(w===1&&h===1)break;w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));}
  }
  if(textureBytes>budget)throw Error('Decal texture budget exceeded');
  for(const m of manifest.materials)if(!bySource.has(m.decalSource)||![1,2].includes(m.mode)||!m.material.startsWith('models/'))throw Error('Original decal material identity differs');
  const textures=new Map<string,T.Texture>(),images:ImageBitmap[]=[];let disposed=false,checkedBytes=0;
  let uv:Awaited<ReturnType<typeof prepareSourcePropDecalUv>>|undefined;
  const dispose=()=>{if(disposed)return;disposed=true;uv?.dispose();for(const texture of textures.values())texture.dispose();for(const image of images)image.close();};
  try{
    for(const t of manifest.textures){
      const r=await fetch(new URL(t.url,base),{signal,cache:'no-cache'});if(!r.ok)throw Error('Decal texture HTTP '+r.status);
      const bytes=await r.arrayBuffer();if(bytes.byteLength!==t.bytes||await sourceSha256(new Uint8Array(bytes),signal)!==t.sha256)throw Error('Original decal texture receipt differs');
      checkedBytes+=bytes.byteLength;signal?.throwIfAborted();
      const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{colorSpaceConversion:'none',premultiplyAlpha:'none',imageOrientation:'none'});
      images.push(image);signal?.throwIfAborted();
      if(image.width!==t.width||image.height!==t.height)throw Error('Original decal decoded dimensions differ');
      const texture=new T.Texture(image);texture.colorSpace=T.SRGBColorSpace;texture.flipY=false;
      texture.wrapS=t.clampS?T.ClampToEdgeWrapping:T.RepeatWrapping;texture.wrapT=t.clampT?T.ClampToEdgeWrapping:T.RepeatWrapping;
      texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;
      textures.set(t.source,texture);
    }
    const uvResponse=await fetch(new URL('uv-remap.json',base),{signal,cache:'no-cache'});if(!uvResponse.ok)throw Error('Decal UV2 manifest HTTP '+uvResponse.status);
    const uvManifest:SourcePropDecalUvManifest=await uvResponse.json();
    if(!/^[a-zA-Z0-9_-]+\.f32$/.test(uvManifest.file?.url??''))throw Error('Invalid decal UV2 receipt path');
    const uvResponseBytes=await fetch(new URL(uvManifest.file.url,base),{signal,cache:'no-cache'});if(!uvResponseBytes.ok)throw Error('Decal UV2 HTTP '+uvResponseBytes.status);
    uv=await prepareSourcePropDecalUv(uvManifest,await uvResponseBytes.arrayBuffer(),maximum,4*1024*1024,signal);
    const materials=new Map<string,SourcePropDecalResource>(manifest.materials.map(m=>[m.material,{texture:textures.get(m.decalSource)!,source:m.decalSource,mode:m.mode}]));
    return {materials,uv,audit:{textures:textures.size,textureBytesIncludingMipmaps:textureBytes,checkedBytes,hashVerified:true,manualColorAdjustment:false,uv:uv.audit},dispose};
  }catch(error){dispose();throw error;}
}
