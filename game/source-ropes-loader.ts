import * as T from 'three';
import {sourceSha256} from './source-sha256';
import {SOURCE_ROPE_MATERIAL_RECEIPT} from './source-ropes-material-data';
import {createSourceRopesRender} from './source-ropes-render';
import type {SourceVisibilityIndex} from './source-visibility';
type Receipt={file:string;bytes:number;sha256:string};
export async function loadSourceRopesRender(options:{baseURL?:string;signal?:AbortSignal;visibility:SourceVisibilityIndex;skyLeafIds?:readonly number[]}){
 const base=new URL(options.baseURL??'/source/csgo-12426148/fidelity-world-20260913/ropes/',globalThis.location?.href??'http://127.0.0.1/');
 const bytes=async(r:Receipt)=>{if(!/^[a-z0-9.-]+$/.test(r.file)||r.bytes>1024*1024||r.bytes<1)throw Error('Invalid original rope receipt');
  const response=await fetch(new URL(r.file,base),{signal:options.signal,cache:'no-cache'});if(!response.ok)throw Error('Original rope HTTP '+response.status);
  const b=await response.arrayBuffer();if(b.byteLength!==r.bytes||await sourceSha256(new Uint8Array(b),options.signal)!==r.sha256)throw Error('Original rope SHA differs');return b;
 };
 let bitmap:ImageBitmap|undefined,texture:T.Texture|undefined,render:ReturnType<typeof createSourceRopesRender>|undefined,disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;render?.dispose();texture?.dispose();bitmap?.close();};
 try{
  const manifest=JSON.parse(new TextDecoder().decode(await bytes(SOURCE_ROPE_MATERIAL_RECEIPT)))as {
   format:string;material:string;shader:string;vmtSha256:string;textures:(Receipt&{width:number;height:number})[]};
  if(manifest.format!=='source-rope-material-v1'||manifest.material!=='cable/nuke_cable'||manifest.shader!=='splinerope'||manifest.textures.length!==1)
   throw Error('Original rope material identity differs');
  const r=manifest.textures[0];bitmap=await createImageBitmap(new Blob([await bytes(r)],{type:'image/png'}),
   {colorSpaceConversion:'none',premultiplyAlpha:'none',imageOrientation:'none'});
  if(bitmap.width!==r.width||bitmap.height!==r.height)throw Error('Original rope dimensions differ');
  texture=new T.Texture(bitmap);texture.name='cable/nuke_cable_001';texture.colorSpace=T.SRGBColorSpace;texture.flipY=false;
  texture.wrapS=T.ClampToEdgeWrapping;texture.wrapT=T.RepeatWrapping;texture.needsUpdate=true;options.signal?.throwIfAborted();
  render=createSourceRopesRender({texture,visibility:options.visibility,skyLeafIds:options.skyLeafIds});
  return {...render,audit:Object.assign(render.audit,{materialSha256:manifest.vmtSha256,textureSha256:r.sha256}),dispose};
 }catch(error){dispose();throw error;}
}
