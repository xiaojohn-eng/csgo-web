import * as T from 'three';
import {sourceSha256} from './source-sha256';
import {prepareSourcePropDecalUv,type SourcePropDecalUvManifest} from './source-prop-decal-uv';
import type {SourcePropTintAssets} from './source-prop-tint-loader';
import type {SourcePropDecalAssets} from './source-prop-decal-loader';
export interface SourcePropTintDecalAssets {tints:SourcePropTintAssets;decals:SourcePropDecalAssets}
type File={url:string;bytes:number;sha256:string};
interface Manifest{format:string;sourceBspSha256:string;textures:(File&{source:string;width:number;height:number;clampS:boolean;clampT:boolean})[];
  materials:{material:string;tintSource:string;decalSource:string;mode:number}[];instanceRGBA:File&{count:number}}
const names=new Set(['models/props/de_dust/hr_dust/dust_crates/dust_shipping_crate_01_painted_decals','models/props/de_dust/hr_dust/dust_crates/dust_shipping_crate_02_painted_decals']);
const natural=(n:number)=>Number.isSafeInteger(n)&&n>0,hash=(v:string)=>/^[a-f0-9]{64}$/.test(v);
/** Borrows only textures already verified by the caller's R3/R4 owners. The
 * compound owner never disposes those textures; dispose it before those owners.
 * All new original bytes remain SHA-verified on insecure HTTP LAN. */
export async function loadSourcePropTintDecal(options:{baseURL:string;signal?:AbortSignal;maxTextureSize?:number;borrowedTint?:SourcePropTintAssets;borrowedDecal?:SourcePropDecalAssets}){
  const {signal}=options,maximum=options.maxTextureSize??8192,base=new URL(options.baseURL,globalThis.location?.href??'http://127.0.0.1/');
  if(!natural(maximum))throw Error('Invalid compound texture size');signal?.throwIfAborted();
  const get=async(path:string)=>{signal?.throwIfAborted();const r=await fetch(new URL(path,base),{signal,cache:'no-cache'});if(!r.ok)throw Error('Original compound HTTP '+r.status);return r;};
  const m:Manifest=await(await get('manifest.json')).json();
  if(m.format!=='source-prop-tint-decal-v1'||m.sourceBspSha256!=='b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'||!Array.isArray(m.materials)||!Array.isArray(m.textures)||m.materials.length!==2||m.textures.length!==3)throw Error('Original compound identity differs');
  if(new Set(m.materials.map(v=>v.material)).size!==2||m.materials.some(v=>!names.has(v.material)||v.mode!==1))throw Error('Outside original compound material subset');
  const sources=new Map(m.textures.map(v=>[v.source,v]));if(sources.size!==3)throw Error('Duplicate compound texture');
  let totalBytes=0;
  for(const t of m.textures){
    if(!/^[a-zA-Z0-9_-]+\.png$/.test(t.url)||!/^materials\/[^:]+\.vtf$/.test(t.source)||t.source.includes('..')||!hash(t.sha256)||!natural(t.bytes)||t.bytes>32*1024*1024||!natural(t.width)||!natural(t.height)||Math.max(t.width,t.height)>maximum||typeof t.clampS!=='boolean'||typeof t.clampT!=='boolean')throw Error('Invalid compound texture receipt');
    let w=t.width,h=t.height;while(true){totalBytes+=w*h*4;if(w===1&&h===1)break;w=Math.max(1,w>>1);h=Math.max(1,h>>1);}
  }
  if(totalBytes>32*1024*1024||m.materials.some(v=>!sources.has(v.tintSource)||!sources.has(v.decalSource)))throw Error('Compound texture budget/identity differs');
  if(m.instanceRGBA?.url!=='instance-rgba.u8'||m.instanceRGBA.count!==3158||m.instanceRGBA.bytes!==12632||!hash(m.instanceRGBA.sha256))throw Error('Invalid compound RGB receipt');
  let checkedBytes=0;const bytes=async(file:File)=>{const b=await(await get(file.url)).arrayBuffer();if(b.byteLength!==file.bytes||await sourceSha256(new Uint8Array(b),signal)!==file.sha256)throw Error('Original compound binary receipt differs');checkedBytes+=b.byteLength;signal?.throwIfAborted();return b;};
  const rgba=new Uint8Array(await bytes(m.instanceRGBA));
  const pool=new Map<string,T.Texture>();for(const a of [options.borrowedTint,options.borrowedDecal])for(const r of a?.materials.values()??[])pool.set(r.source,r.texture);
  const used=new Map<string,T.Texture>(),owned:T.Texture[]=[],images:ImageBitmap[]=[];let disposed=false,uv:Awaited<ReturnType<typeof prepareSourcePropDecalUv>>|undefined;
  const dispose=()=>{if(disposed)return;disposed=true;uv?.dispose();for(const t of owned)t.dispose();for(const image of images)image.close();};
  try{
    for(const t of m.textures){
      const borrowed=pool.get(t.source);
      if(borrowed){
        const image=borrowed.image as {width?:number;height?:number}|undefined;
        if(borrowed.colorSpace!==T.SRGBColorSpace||borrowed.flipY||image?.width!==t.width||image?.height!==t.height||borrowed.wrapS!==(t.clampS?T.ClampToEdgeWrapping:T.RepeatWrapping)||borrowed.wrapT!==(t.clampT?T.ClampToEdgeWrapping:T.RepeatWrapping))throw Error('Borrowed original compound sampling differs');
        used.set(t.source,borrowed);continue;
      }
      const b=await bytes(t),image=await createImageBitmap(new Blob([b],{type:'image/png'}),{colorSpaceConversion:'none',premultiplyAlpha:'none',imageOrientation:'none'});images.push(image);signal?.throwIfAborted();
      if(image.width!==t.width||image.height!==t.height)throw Error('Original compound decoded size differs');
      const texture=new T.Texture(image);texture.colorSpace=T.SRGBColorSpace;texture.flipY=false;texture.wrapS=t.clampS?T.ClampToEdgeWrapping:T.RepeatWrapping;texture.wrapT=t.clampT?T.ClampToEdgeWrapping:T.RepeatWrapping;
      texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;owned.push(texture);used.set(t.source,texture);
    }
    const manifest:SourcePropDecalUvManifest=await(await get('uv-remap.json')).json();if(!/^[a-zA-Z0-9_-]+\.f32$/.test(manifest.file?.url??''))throw Error('Invalid compound UV2 path');
    uv=await prepareSourcePropDecalUv(manifest,await bytes(manifest.file),maximum,4*1024*1024,signal);
    return {tints:{materials:new Map(m.materials.map(v=>[v.material,{source:v.tintSource,texture:used.get(v.tintSource)!}])),rgba},
      decals:{materials:new Map(m.materials.map(v=>[v.material,{source:v.decalSource,texture:used.get(v.decalSource)!,mode:1 as const}])),uv},
      audit:{materials:2,textures:used.size,ownedTextures:owned.length,borrowedTextures:used.size-owned.length,totalTextureBytesIncludingMipmaps:totalBytes,checkedBytes,hashVerified:true,
        borrowedTextureBoundary:'Original texture identities already SHA-verified by caller R3/R4 owners',instanceAlphaUsed:false,originalUV2:uv.audit,manualColorAdjustment:false},dispose};
  }catch(error){dispose();throw error;}
}
