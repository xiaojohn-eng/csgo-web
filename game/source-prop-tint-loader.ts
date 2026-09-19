import * as T from 'three';
import {sourceSha256} from './source-sha256';
type Receipt={url:string;bytes:number;sha256:string};
interface TintManifest {
  format:'source-prop-tint-v1';sourceBspSha256:string;
  textures:(Receipt&{source:string;width:number;height:number;clampS:boolean;clampT:boolean})[];
  materials:{material:string;tintSource:string}[];
  instanceRGBA:Receipt&{count:number};
}
export interface SourcePropTintAssets {
  materials:Map<string,{texture:T.Texture;source:string}>;rgba:Uint8Array;
}
const bsp='b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc';
const positive=(v:number)=>Number.isSafeInteger(v)&&v>0;
const hash=(v:string)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);

/** Owns only the extra original tint textures/decoded images. 16 MiB including
 * mip chains and 8 textures by default; original instance RGB is SHA-verified
 * on insecure HTTP LAN too. Does not allocate geometry or mutate the scene. */
export async function loadSourcePropTint(options:{baseURL:string;signal?:AbortSignal;maxTextureSize?:number;maxTextureBytes?:number}){
  const {signal}=options,maximum=options.maxTextureSize??8192,budget=options.maxTextureBytes??16*1024*1024;
  if(!positive(maximum)||!positive(budget))throw Error('Invalid tint texture budget');
  const base=new URL(options.baseURL,globalThis.location?.href??'http://127.0.0.1/');signal?.throwIfAborted();
  const response=await fetch(new URL('manifest.json',base),{signal,cache:'no-cache'});if(!response.ok)throw Error('Tint manifest HTTP '+response.status);
  const manifest:TintManifest=await response.json();
  if(manifest.format!=='source-prop-tint-v1'||manifest.sourceBspSha256!==bsp||!Array.isArray(manifest.textures)||!Array.isArray(manifest.materials))throw Error('Original tint manifest identity differs');
  const rgbaFile=manifest.instanceRGBA;
  if(rgbaFile?.url!=='instance-rgba.u8'||rgbaFile.count!==3158||rgbaFile.bytes!==3158*4||!hash(rgbaFile.sha256))throw Error('Original instance RGB receipt invalid');
  const bySource=new Map(manifest.textures.map(t=>[t.source,t]));
  if(bySource.size!==manifest.textures.length||new Set(manifest.materials.map(m=>m.material)).size!==manifest.materials.length)throw Error('Duplicate tint identity');
  if(manifest.textures.length>8||manifest.materials.length>64)throw Error('Tint resource count budget exceeded');
  let textureBytes=0;
  for(const t of manifest.textures){
    if(!positive(t.width)||!positive(t.height)||Math.max(t.width,t.height)>maximum||!positive(t.bytes)||t.bytes>16*1024*1024)throw Error('Tint texture budget exceeded');
    if(!/^[a-zA-Z0-9_-]+\.png$/.test(t.url)||!/^materials\/[^:]+\.vtf$/.test(t.source)||t.source.includes('..')||!hash(t.sha256)||typeof t.clampS!=='boolean'||typeof t.clampT!=='boolean')throw Error('Invalid tint texture receipt');
    let w=t.width,h=t.height;while(true){textureBytes+=w*h*4;if(w===1&&h===1)break;w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));}
  }
  if(textureBytes>budget)throw Error('Tint texture budget exceeded');
  for(const m of manifest.materials)if(typeof m.material!=='string'||!m.material.startsWith('models/')||!bySource.has(m.tintSource))throw Error('Original tint material identity differs');
  let checkedBytes=0;
  const bytes=async(file:Receipt,label:string)=>{
    signal?.throwIfAborted();const r=await fetch(new URL(file.url,base),{signal,cache:'no-cache'});if(!r.ok)throw Error(label+' HTTP '+r.status);
    const b=await r.arrayBuffer();if(b.byteLength!==file.bytes||await sourceSha256(new Uint8Array(b),signal)!==file.sha256)throw Error(label+' receipt differs');
    checkedBytes+=b.byteLength;signal?.throwIfAborted();return b;
  };
  const rgba=new Uint8Array(await bytes(rgbaFile,'Original instance RGB'));
  const textures=new Map<string,T.Texture>(),images:ImageBitmap[]=[];let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;for(const texture of textures.values())texture.dispose();for(const image of images)image.close();};
  try{
    for(const t of manifest.textures){
      const b=await bytes(t,'Original tint texture');
      const image=await createImageBitmap(new Blob([b],{type:'image/png'}),{colorSpaceConversion:'none',premultiplyAlpha:'none',imageOrientation:'none'});
      images.push(image);signal?.throwIfAborted();if(image.width!==t.width||image.height!==t.height)throw Error('Original tint decoded dimensions differ');
      const texture=new T.Texture(image);texture.colorSpace=T.SRGBColorSpace;texture.flipY=false;
      texture.wrapS=t.clampS?T.ClampToEdgeWrapping:T.RepeatWrapping;texture.wrapT=t.clampT?T.ClampToEdgeWrapping:T.RepeatWrapping;
      texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;textures.set(t.source,texture);
    }
    return {materials:new Map(manifest.materials.map(m=>[m.material,{texture:textures.get(m.tintSource)!,source:m.tintSource}])),rgba,
      audit:{textures:textures.size,textureBytesIncludingMipmaps:textureBytes,checkedBytes,hashVerified:true,originalInstanceCount:3158,
        instanceAlphaUsed:false,manualColorAdjustment:false,branch:'four original pure bumped tint material candidates'},dispose};
  }catch(error){dispose();throw error;}
}
