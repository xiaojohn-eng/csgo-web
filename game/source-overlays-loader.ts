import * as T from 'three';
import {sourceSha256} from './source-sha256';
import {SOURCE_OVERLAYS_RECEIPT} from './source-overlays-data';
import {createSourceOverlays,validateSourceOverlays,type OverlayFile,type OverlayManifest,type OverlayGeometry} from './source-overlays';

export async function loadSourceOverlays(options:{baseURL?:string;signal?:AbortSignal;maxTextureSize:number;
  skyFaceIds?:readonly number[];createHDRMaterial:(original:T.MeshBasicMaterial)=>T.MeshBasicMaterial}){
  const base=new URL(options.baseURL??'/source/csgo-12426148/fidelity-world-20260913/overlays/',globalThis.location?.href??'http://127.0.0.1/');
  const textures=new Map<string,T.Texture>(),bitmaps:ImageBitmap[]=[];let disposed=false,checkedBytes=0;
  let render:ReturnType<typeof createSourceOverlays>|undefined;
  const dispose=()=>{if(disposed)return;disposed=true;render?.dispose();for(const t of textures.values())t.dispose();for(const b of bitmaps)b.close();};
  const bytes=async(r:OverlayFile)=>{
    if(!/^[a-z0-9.-]+$/.test(r.file)||!Number.isSafeInteger(r.bytes)||r.bytes<1||r.bytes>16*1024*1024||!/^[a-f0-9]{64}$/.test(r.sha256))throw Error('Invalid overlay file receipt');
    const response=await fetch(new URL(r.file,base),{signal:options.signal,cache:'no-cache'});if(!response.ok)throw Error('Original overlay HTTP '+response.status);
    const data=await response.arrayBuffer();if(data.byteLength!==r.bytes||await sourceSha256(new Uint8Array(data),options.signal)!==r.sha256)throw Error('Original overlay SHA differs: '+r.file);
    checkedBytes+=data.byteLength;options.signal?.throwIfAborted();return data;
  };
  try{
    const manifest=JSON.parse(new TextDecoder().decode(await bytes(SOURCE_OVERLAYS_RECEIPT)))as OverlayManifest;
    const geometry=JSON.parse(new TextDecoder().decode(await bytes(manifest.geometry)))as OverlayGeometry;
    validateSourceOverlays(manifest,geometry);
    // All decoders settle before releasing even when an earlier texture fails.
    const pending=await Promise.allSettled(manifest.textures.map(async r=>{
      if(r.width>options.maxTextureSize||r.height>options.maxTextureSize)throw Error('Original overlay exceeds GPU texture limit');
      const data=await bytes(r),bitmap=await createImageBitmap(new Blob([data],{type:'image/png'}),
        {colorSpaceConversion:'none',premultiplyAlpha:'none',imageOrientation:'none'});bitmaps.push(bitmap);
      if(bitmap.width!==r.width||bitmap.height!==r.height)throw Error('Original overlay texture dimensions differ');
      const texture=new T.Texture(bitmap);textures.set(r.source,texture);texture.name=r.source;texture.flipY=false;
      texture.colorSpace=T.SRGBColorSpace;texture.wrapS=r.clampS?T.ClampToEdgeWrapping:T.RepeatWrapping;
      texture.wrapT=r.clampT?T.ClampToEdgeWrapping:T.RepeatWrapping;texture.needsUpdate=true;
    }));
    for(const p of pending)if(p.status==='rejected')throw p.reason;options.signal?.throwIfAborted();
    render=createSourceOverlays(manifest,geometry,textures,options.createHDRMaterial,options.skyFaceIds);
    return {...render,audit:{...render.audit,checkedBytes,manifestSha256:SOURCE_OVERLAYS_RECEIPT.sha256},dispose};
  }catch(error){dispose();throw error;}
}
