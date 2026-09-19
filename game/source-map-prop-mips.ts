import * as T from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {sourceSha256} from './source-sha256';
import {SOURCE_PROP_MIPS_RECEIPT} from './source-map-prop-mips-data';

type FileReceipt={file:string;bytes:number;sha256:string};
export type SourcePropMipRecord={materialIndex:number;material:string;slot:'map'|'normalMap';textureIndex:number;
  source:string;sourceSha256:string;width:number;height:number;mipCount:number;normalGreenInverted:boolean;
  levels:(FileReceipt&{level:number;width:number;height:number;rgbaSha256:string})[]};
export type SourcePropMipManifest={format:'source-prop-authored-mips-v1';sourceBspSha256:string;originalGLBSha256:string;textures:SourcePropMipRecord[]};
type Binding={record:SourcePropMipRecord;texture:T.Texture;levels:ImageBitmap[]};

/** Borrow texture identity so existing material clones and uniforms all see
 * the same authored chain. Level zero is the untouched GLTF image. */
export function applySourcePropMips(bindings:Binding[],enabled=true){
  const seen=new Set<T.Texture>();
  for(const {record:r,texture:t,levels} of bindings){
    const image=t.image as {width?:number;height?:number}|undefined;
    if(seen.has(t)||!t.isTexture||t.flipY||t.channel!==0||t.type!==T.UnsignedByteType||t.format!==T.RGBAFormat||
      image?.width!==r.width||image?.height!==r.height||t.mipmaps.length||!t.generateMipmaps||
      t.colorSpace!==(r.slot==='map'?T.SRGBColorSpace:T.NoColorSpace))throw Error('Original prop mip texture identity differs');
    seen.add(t);
    if(levels.length!==r.mipCount-1||r.levels.length!==levels.length||!levels.length)throw Error('Incomplete original prop mip chain');
    let w=r.width,h=r.height;
    for(let i=0;i<levels.length;i++){
      w=Math.max(1,w>>1);h=Math.max(1,h>>1);
      if(r.levels[i].level!==i+1||r.levels[i].width!==w||r.levels[i].height!==h||levels[i].width!==w||levels[i].height!==h)
        throw Error('Original prop mip dimensions differ');
    }
    if(w!==1||h!==1)throw Error('Original prop mip chain omits final level');
  }
  const saved=bindings.map(b=>({...b,originalMipmaps:b.texture.mipmaps,generateMipmaps:b.texture.generateMipmaps,
    authored:[b.texture.image,...b.levels] as T.Texture['mipmaps']}));
  const audit={enabled:false,textures:bindings.length,lowerLevels:bindings.reduce((n,b)=>n+b.levels.length,0),
    baseMipUnchanged:true,materialIdentityUnchanged:true,scope:'Authored mip chain for three audited stone/roof materials only'};
  let disposed=false;
  const setEnabled=(value:boolean)=>{
    if(disposed)throw Error('Original prop mip owner disposed');
    if(audit.enabled===value)return;
    for(const b of saved){b.texture.mipmaps=value?b.authored:b.originalMipmaps;b.texture.generateMipmaps=value?false:b.generateMipmaps;b.texture.needsUpdate=true;}
    audit.enabled=value;
  };
  const dispose=()=>{if(disposed)return;setEnabled(false);disposed=true;};
  setEnabled(enabled);return {audit,setEnabled,dispose};
}

/** Settle all lower-mip decoders before applying or releasing anything. This
 * owner closes only its bitmaps; original GLTF textures/base images are borrowed. */
export async function loadSourcePropMips(gltf:GLTF,options:{baseURL?:string;signal?:AbortSignal;enabled?:boolean}={}){
  const base=new URL(options.baseURL??'/source/csgo-12426148/fidelity-world-20260913/prop-mips/',globalThis.location?.href??'http://127.0.0.1/');
  const bitmaps:ImageBitmap[]=[];let owner:ReturnType<typeof applySourcePropMips>|undefined,disposed=false,checkedBytes=0;
  const dispose=()=>{if(disposed)return;disposed=true;owner?.dispose();for(const b of bitmaps)b.close();};
  const bytes=async(r:FileReceipt)=>{
    if(!/^[a-z0-9.-]+$/.test(r.file)||!Number.isSafeInteger(r.bytes)||r.bytes<1||r.bytes>4*1024*1024||!/^[a-f0-9]{64}$/.test(r.sha256))throw Error('Invalid original prop mip receipt');
    const response=await fetch(new URL(r.file,base),{signal:options.signal,cache:'no-cache'});
    if(!response.ok)throw Error('Original prop mip HTTP '+response.status);
    const data=await response.arrayBuffer();
    if(data.byteLength!==r.bytes||await sourceSha256(new Uint8Array(data),options.signal)!==r.sha256)throw Error('Original prop mip SHA differs: '+r.file);
    checkedBytes+=data.byteLength;options.signal?.throwIfAborted();return data;
  };
  try{
    const manifest=JSON.parse(new TextDecoder().decode(await bytes(SOURCE_PROP_MIPS_RECEIPT))) as SourcePropMipManifest;
    if(manifest.format!=='source-prop-authored-mips-v1'||manifest.sourceBspSha256!=='b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'||
      manifest.originalGLBSha256!=='55937fce28a53461520fa2c531384f65f0f8b69df1a8205245466b6064ab5232'||manifest.textures.length!==6)throw Error('Original prop mip source identity differs');
    const bindings:Binding[]=[];
    const pending=await Promise.allSettled(manifest.textures.map(async r=>{
      const definition=gltf.parser.json.materials[r.materialIndex];
      const info=r.slot==='map'?definition?.pbrMetallicRoughness?.baseColorTexture:definition?.normalTexture;
      if(definition?.name!==r.material||info?.index!==r.textureIndex||r.normalGreenInverted!==(r.slot==='normalMap'))throw Error('Original GLTF mip material identity differs');
      const material=await gltf.parser.getDependency('material',r.materialIndex) as T.MeshStandardMaterial;
      if(material.name!==r.material||material.userData.full_path!==r.material||!material[r.slot]?.isTexture)throw Error('Original prop mip material binding differs');
      const results=await Promise.allSettled(r.levels.map(async level=>{
        const data=await bytes(level),bitmap=await createImageBitmap(new Blob([data],{type:'image/png'}),
          {colorSpaceConversion:'none',premultiplyAlpha:'none',imageOrientation:'none'});bitmaps.push(bitmap);return bitmap;
      }));
      for(const result of results)if(result.status==='rejected')throw result.reason;
      bindings.push({record:r,texture:material[r.slot]!,levels:results.map(r=>(r as PromiseFulfilledResult<ImageBitmap>).value)});
    }));
    for(const result of pending)if(result.status==='rejected')throw result.reason;
    options.signal?.throwIfAborted();owner=applySourcePropMips(bindings,options.enabled!==false);
    return {audit:Object.assign(owner.audit,{checkedBytes,manifestSha256:SOURCE_PROP_MIPS_RECEIPT.sha256}),setEnabled:owner.setEnabled,dispose};
  }catch(error){dispose();throw error;}
}
