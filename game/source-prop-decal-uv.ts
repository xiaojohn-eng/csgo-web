import * as T from 'three';
import {sourceSha256} from './source-sha256';

export interface SourcePropDecalUvRecord {
  mesh:number;primitive:number;model:string;material:string;offset:number;vertexCount:number;verified:boolean;sha256:string;
}
export interface SourcePropDecalUvManifest {
  format:'source-prop-decal-uv-v1';sourceBspSha256:string;originalGLBSha256:string;
  file:{url:string;bytes:number;sha256:string};records:SourcePropDecalUvRecord[];
}
export interface SourcePropDecalUvBinding {texture:T.DataTexture;width:number;offset:number;vertexCount:number}
const natural=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const bsp='b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc';
const original='55937fce28a53461520fa2c531384f65f0f8b69df1a8205245466b6064ab5232';

/** Exact raw VVD UV2 mapped by oriented POSITION+UV0 triangles. Per-triangle
 * duplicates are accepted only with identical UV2; unverified records stay off.
 * This lookup never inserts attributes or changes existing GLTF geometry. */
export async function prepareSourcePropDecalUv(manifest:SourcePropDecalUvManifest,bytes:ArrayBuffer,maximum=8192,budget=4*1024*1024,signal?:AbortSignal){
  signal?.throwIfAborted();
  if(manifest.format!=='source-prop-decal-uv-v1'||manifest.sourceBspSha256!==bsp||manifest.originalGLBSha256!==original||!Array.isArray(manifest.records))throw Error('Original decal UV2 identity differs');
  if(!natural(maximum)||maximum<1||maximum>32768||!natural(budget)||!bytes.byteLength||bytes.byteLength%8||bytes.byteLength!==manifest.file.bytes||bytes.byteLength>budget)throw Error('Decal UV2 byte budget exceeded');
  if(await sourceSha256(new Uint8Array(bytes),signal)!==manifest.file.sha256)throw Error('Original decal UV2 binary receipt differs');
  const records=new Map<string,SourcePropDecalUvRecord>();let end=0;
  for(const r of manifest.records){
    const key=r.mesh+':'+r.primitive;
    if(records.has(key)||![r.mesh,r.primitive,r.offset,r.vertexCount].every(natural)||!r.vertexCount||r.offset!==end||
      typeof r.verified!=='boolean'||!r.model.startsWith('models/')||!r.material.startsWith('models/')||!/^[a-f0-9]{64}$/.test(r.sha256))throw Error('Invalid exact decal UV2 record');
    end=r.offset+r.vertexCount;if(end*8>bytes.byteLength)throw Error('Decal UV2 range exceeds payload');
    if(await sourceSha256(new Uint8Array(bytes,r.offset*8,r.vertexCount*8),signal)!==r.sha256)throw Error('Original decal UV2 record receipt differs');
    records.set(key,r);
  }
  if(end*8!==bytes.byteLength)throw Error('Decal UV2 payload has unclaimed records');
  const width=Math.min(4096,maximum),height=Math.ceil(end/width),lookupBytes=width*height*8;
  if(height>maximum||lookupBytes>budget)throw Error('Decal UV2 lookup budget exceeded');
  const pixels=new Float32Array(width*height*2),view=new DataView(bytes);
  for(let i=0;i<bytes.byteLength/4;i++){const n=view.getFloat32(i*4,true);if(!Number.isFinite(n))throw Error('Decal UV2 payload is non-finite');pixels[i]=n;}
  signal?.throwIfAborted();
  const texture=new T.DataTexture(pixels,width,height,T.RGFormat,T.FloatType);texture.internalFormat='RG32F';
  texture.colorSpace=T.NoColorSpace;texture.flipY=false;texture.generateMipmaps=false;texture.minFilter=texture.magFilter=T.NearestFilter;texture.unpackAlignment=1;texture.needsUpdate=true;
  let disposed=false;return {texture,width,records,audit:{records:records.size,verifiedRecords:[...records.values()].filter(r=>r.verified).length,lookupBytes,checkedBytes:bytes.byteLength},
    dispose:()=>{if(!disposed){disposed=true;texture.dispose();}}};
}

export function validateSourcePropDecalUv(binding:SourcePropDecalUvBinding|undefined,vertexCount:number){
  if(!binding)throw Error('Original decal UV2 binding missing');
  const {texture,width,offset}=binding,image=texture.image;
  if(!texture.isDataTexture||texture.format!==T.RGFormat||texture.type!==T.FloatType||texture.colorSpace!==T.NoColorSpace||texture.flipY||texture.generateMipmaps||
    texture.minFilter!==T.NearestFilter||texture.magFilter!==T.NearestFilter||width!==image.width||!natural(offset)||binding.vertexCount!==vertexCount||offset+vertexCount>image.width*image.height)
    throw Error('Original decal UV2 lookup contract differs');
}
