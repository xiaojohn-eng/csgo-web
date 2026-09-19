import * as T from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {sourceSha256} from './source-sha256';
import {DUST2_BSP_SHA256} from './source-identity';
import {SOURCE_WORLD_LAYERS_RECEIPT} from './source-world-layers-data';
import {decorateSourceWorldLayer,type WorldLayersManifest,type WorldLayerFile} from './source-world-layers';

export async function loadSourceWorldLayers(gltf:GLTF,options:{baseURL?:string;signal?:AbortSignal;maxTextureSize:number}){
  const base=new URL(options.baseURL??'/source/csgo-12426148/fidelity-world-20260913/world/',globalThis.location?.href??'http://127.0.0.1/');
  const textures=new Map<string,T.Texture>(),atlases:T.DataTexture[]=[],bitmaps:ImageBitmap[]=[];
  const geometryBindings:{geometry:T.BufferGeometry;previous:T.BufferAttribute|T.InterleavedBufferAttribute|undefined}[]=[];
  let disposed=false,checkedBytes=0;
  const dispose=()=>{if(disposed)return;disposed=true;
    for(const b of geometryBindings){if(b.previous)b.geometry.setAttribute('sourceWorldBlend',b.previous);else b.geometry.deleteAttribute('sourceWorldBlend');}
    for(const t of [...textures.values(),...atlases])t.dispose();for(const b of bitmaps)b.close();};
  const bytes=async(r:WorldLayerFile)=>{
    if(!/^[a-z0-9.-]+$/.test(r.file)||!Number.isSafeInteger(r.bytes)||r.bytes<1||r.bytes>64*1024*1024||!/^[a-f0-9]{64}$/.test(r.sha256))throw Error('Invalid world layer receipt');
    const response=await fetch(new URL(r.file,base),{signal:options.signal,cache:'no-cache'});if(!response.ok)throw Error('Original world layers HTTP '+response.status);
    const data=await response.arrayBuffer();
    if(data.byteLength!==r.bytes||await sourceSha256(new Uint8Array(data),options.signal)!==r.sha256)throw Error('Original world layer SHA differs: '+r.file);
    checkedBytes+=data.byteLength;options.signal?.throwIfAborted();return data;
  };
  try{
    const manifest=JSON.parse(new TextDecoder().decode(await bytes(SOURCE_WORLD_LAYERS_RECEIPT)))as WorldLayersManifest;
    if(manifest.format!=='source-world-layers-v1'||manifest.sourceBspSha256!==DUST2_BSP_SHA256||
      manifest.sourceWorldSha256!=='91b52e52b988e1b41b07b9cd365c159d615934fa49f07c3fa1e438d43269ffa8'||
      manifest.materials.length!==85||manifest.primitives.length!==85||manifest.atlases.length!==3||
      manifest.width!==2048||manifest.height!==1024||manifest.width>options.maxTextureSize)throw Error('Original world layers identity differs');
    const srgb=new Set(manifest.materials.map(m=>m.maps.$basetexture2).filter(Boolean));
    const pending=await Promise.allSettled([
      bytes(manifest.attributes),
      ...manifest.atlases.map(async(r,i)=>{
        if(r.layer!==i+1||r.bytes!==manifest.width*manifest.height*4)throw Error('Original directional atlas layout differs');
        const data=await bytes(r),t=new T.DataTexture(new Uint8Array(data),manifest.width,manifest.height,T.RGBAFormat,T.UnsignedByteType);
        atlases[i]=t;t.flipY=false;t.colorSpace=T.NoColorSpace;t.generateMipmaps=false;t.magFilter=t.minFilter=T.NearestFilter;t.needsUpdate=true;
      }),
      ...manifest.textures.map(async r=>{
        if(r.width>options.maxTextureSize||r.height>options.maxTextureSize)throw Error('Original world texture exceeds GPU limit');
        const data=await bytes(r),bitmap=await createImageBitmap(new Blob([data],{type:'image/png'}),
          {colorSpaceConversion:'none',premultiplyAlpha:'none',imageOrientation:'none'});bitmaps.push(bitmap);
        if(bitmap.width!==r.width||bitmap.height!==r.height)throw Error('Original world texture dimensions differ');
        const t=new T.Texture(bitmap);textures.set(r.source,t);t.name=r.source;t.flipY=false;
        t.colorSpace=srgb.has(r.source)?T.SRGBColorSpace:T.NoColorSpace;
        t.wrapS=r.clampS?T.ClampToEdgeWrapping:T.RepeatWrapping;t.wrapT=r.clampT?T.ClampToEdgeWrapping:T.RepeatWrapping;t.needsUpdate=true;
      }),
    ]);
    for(const p of pending)if(p.status==='rejected')throw p.reason;
    const data=(pending[0]as PromiseFulfilledResult<ArrayBuffer>).value;
    const rows=new Map(manifest.primitives.map(p=>[p.mesh+':'+p.primitive,p]));
    const seen=new Set<string>();const meshes:T.Mesh[]=[];gltf.scene.traverse(o=>{if((o as T.Mesh).isMesh)meshes.push(o as T.Mesh);});
    for(const mesh of meshes){
      const association=gltf.parser.associations.get(mesh)as{meshes?:number;primitives?:number}|undefined,
        key=association?.meshes+':'+association?.primitives,row=rows.get(key);
      if(!row||seen.has(key))throw Error('Original world primitive attribution differs');seen.add(key);
      const geometry=mesh.geometry;
      for(const [name,hash]of [['position',row.positionSha256],['uv1',row.uv1Sha256],['uv2',row.uv2Sha256]]){
        const a=geometry.getAttribute(name);if(!a||a.count!==row.vertices)throw Error('Original world layer vertex count differs');
        const raw=new Float32Array(a.count*a.itemSize);
        for(let i=0;i<a.count;i++)for(let c=0;c<a.itemSize;c++)raw[i*a.itemSize+c]=a.getComponent(i,c);
        if(await sourceSha256(new Uint8Array(raw.buffer),options.signal)!==hash)throw Error('Original world layer '+name+' alignment differs');
      }
      if(!Number.isSafeInteger(row.byteOffset)||row.byteOffset%4||row.byteOffset<0||row.byteOffset+row.vertices*8>data.byteLength)throw Error('Original world layer range differs');
      geometryBindings.push({geometry,previous:geometry.getAttribute('sourceWorldBlend')});
      geometry.setAttribute('sourceWorldBlend',new T.BufferAttribute(new Float32Array(data,row.byteOffset,row.vertices*2),2));
    }
    if(seen.size!==rows.size)throw Error('Original world layer coverage differs');
    const materials=new Map(manifest.materials.map(r=>[r.source.toLowerCase().replaceAll('\\','/'),r]));
    let decorated=0;
    return {audit:{...manifest.audit,materials:manifest.materials.length,textures:manifest.textures.length,directionalAtlases:3,
      inactiveAuthoredParameters:manifest.materials.flatMap(m=>{
        const keys=Object.keys(m.parameters).filter(k=>k==='$blendtintbybasealpha'||k.startsWith('$dropshadow'));
        return keys.length?[{source:m.source,keys}]:[];
      }),
      inactiveParameterEvidence:'tests/fixtures/source-world-layer-native.json: native shader registration, c26 command upload, NEWLAYER selectors and all valid dynamic programs',
      limitations:['Native zero-width blend-ramp NaN behavior is not claimed'],
      manifestSha256:SOURCE_WORLD_LAYERS_RECEIPT.sha256,checkedBytes,get decorated(){return decorated;}},
      decorateMaterial:(material:T.MeshBasicMaterial,original:T.Material)=>{
        const path=String(original.userData.full_path??'').toLowerCase().replaceAll('\\','/'),record=materials.get(path);
        // Overlays intentionally share this HDR factory but retain their own
        // geometry/material owner and cannot read world-only attributes.
        if(!record)return;decorateSourceWorldLayer(material,record,textures,atlases);decorated++;
      },dispose};
  }catch(error){dispose();throw error;}
}
