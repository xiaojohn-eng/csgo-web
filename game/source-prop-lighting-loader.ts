import * as T from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {applySourcePropLighting,sourcePropBranch,type SourcePropLightingBinding,type SourcePropMaterialSource} from './source-prop-lighting';
import {sourceSha256} from './source-sha256';
import {loadSourcePropDecals,type SourcePropDecalAssets} from './source-prop-decal-loader';
import {loadSourcePropStructuralTint} from './source-prop-tint-structures';
import {loadSourcePropTint,type SourcePropTintAssets} from './source-prop-tint-loader';
import {loadSourcePropTintDecal,type SourcePropTintDecalAssets} from './source-prop-tint-decal-loader';

type Receipt={url:string;bytes:number;sha256:string};
export interface PropVhvDescriptor {
  format:'source-prop-vhv-v1';sourceBspSha256:string;originalGLBSha256:string;
  files:{remap:Receipt;lighting:Receipt};materials:SourcePropMaterialSource[];
  records:{mesh:number;primitive:number;model:string;skin:number;part:number;material:number;materialName:string;materialSource:string;
    vertexCount:number;indexCount:number;sourceModelIndex:number;mapOffset:number;mapBytes:number;verified:boolean;
    attributeSha256:Record<string,string>;indexSha256:string}[];
  instances:{index:number;model:string;skin:number;modelIndex:number;lightingVertexOffset:number;lightingVertexCount:number}[];
}
const bsp='b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc';
const original='55937fce28a53461520fa2c531384f65f0f8b69df1a8205245466b6064ab5232';
const attributeNames:Record<string,string>={POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv'};
const digest=sourceSha256;
function attributeBytes(attribute:T.BufferAttribute|T.InterleavedBufferAttribute){
  if(attribute instanceof T.InterleavedBufferAttribute)throw Error('VHV adapter expects exact tight original accessor storage');
  return new Uint8Array(attribute.array.buffer,attribute.array.byteOffset,attribute.array.byteLength);
}

/** CPU-only preparation is separately testable. Hashes every eligible original
 * POSITION/NORMAL/UV/index once, including lossless meshopt decoded buffers.
 * No image decoding, scene edits, GPU allocations, or nearest-point matching. */
export async function prepareSourcePropLightingData(gltf:GLTF,descriptor:PropVhvDescriptor,remapBytes:ArrayBuffer,lightingBytes:ArrayBuffer,signal?:AbortSignal,enablePlainUnbumped=false,decals?:SourcePropDecalAssets,tints?:SourcePropTintAssets,compound?:SourcePropTintDecalAssets){
  signal?.throwIfAborted();
  if(descriptor.format!=='source-prop-vhv-v1'||descriptor.sourceBspSha256!==bsp||descriptor.originalGLBSha256!==original)
    throw Error('VHV original BSP/GLB identity differs');
  for(const [key,bytes] of [['remap',remapBytes],['lighting',lightingBytes]] as const){
    const receipt=descriptor.files[key];
    if(bytes.byteLength!==receipt.bytes||await digest(new Uint8Array(bytes),signal)!==receipt.sha256)throw Error('VHV binary receipt differs: '+key);
  }
  const records=new Map(descriptor.records.map(r=>[r.mesh+':'+r.primitive,r])),instances=new Map(descriptor.instances.map(i=>[i.index,i]));
  const sources=new Map(descriptor.materials.map(m=>[m.source,m]));
  if(records.size!==descriptor.records.length||instances.size!==descriptor.instances.length||sources.size!==descriptor.materials.length)
    throw Error('Duplicate original VHV descriptor identity');
  const meshes:T.Mesh[]=[];gltf.scene.traverse(object=>{if((object as T.Mesh).isMesh)meshes.push(object as T.Mesh);});
  const verified=new Map<T.BufferGeometry,string>(),bindings:SourcePropLightingBinding[]=[],skipped:{mesh:string;material:string;reasons:string[];triangles:number}[]=[];
  const seenInstances=new Set<number>();let checkedVertexBytes=0,appliedTriangles=0;
  for(const mesh of meshes){
    signal?.throwIfAborted();
    // GLTFLoader r185 records primitives at loadMesh:3909, but @types currently
    // omits that field from GLTFReference. Keep this observed extension local.
    const association=gltf.parser.associations.get(mesh) as {meshes?:number;primitives?:number}|undefined;
    const record=records.get(association?.meshes+':'+association?.primitives);
    if(!record)throw Error('Original GLTF primitive association missing: '+mesh.name);
    let anchor:T.Object3D|null=mesh;while(anchor&&!/^static_prop_\d+$/.test(anchor.name))anchor=anchor.parent;
    const instance=anchor?instances.get(Number(anchor.name.slice(12))):undefined;
    if(!anchor||!instance||instance.model!==record.model||instance.skin!==record.skin||instance.modelIndex!==record.sourceModelIndex||
      anchor.userData.sourceModel!==instance.model||anchor.userData.sourceSkin!==instance.skin)throw Error('Original static prop instance identity differs: '+mesh.name);
    seenInstances.add(instance.index);
    const source=sources.get(record.materialSource);
    if(!source||Array.isArray(mesh.material)||mesh.material.name!==record.materialName||mesh.material.userData.full_path!==record.materialSource)
      throw Error('Original prop material identity missing: '+record.materialName);
    const isCompound=!!source.parameters.$tintmasktexture&&!!source.parameters.$decaltexture;
    const selectedTint=isCompound?compound?.tints:tints,selectedDecal=isCompound?compound?.decals:decals;
    const reasons=sourcePropBranch(source,enablePlainUnbumped,!!decals,!!tints,!!compound);
    const tint=source.parameters.$tintmasktexture?selectedTint?.materials.get(source.source):undefined;
    if(!reasons.length&&source.parameters.$tintmasktexture){
      if(!tint)reasons.push('outside bounded original tint material candidates');
      if(isCompound&&(mesh.material.transparent||mesh.material.opacity!==1||mesh.material.alphaTest!==0))reasons.push('compound requires original opaque material');
      const color=(mesh.material as T.MeshBasicMaterial).color;
      if(!color||color.r!==1||color.g!==1||color.b!==1)reasons.push('tint requires original white material color');
    }
    if(!record.verified)reasons.push('ambiguous original triangle lighting identity');
    const uvRecord=source.parameters.$decaltexture?selectedDecal?.uv.records.get(record.mesh+':'+record.primitive):undefined;
    if(!reasons.length&&source.parameters.$decaltexture&&selectedDecal&&!uvRecord?.verified)reasons.push('exact original UV2 unavailable');
    if(source.parameters.$bumpmap&&!source.mapped?.includes('tangent normal with green inversion'))reasons.push('original normal conversion receipt missing');
    if(reasons.length){skipped.push({mesh:mesh.name,material:record.materialName,reasons,triangles:record.indexCount/3});continue;}
    if(tint){
      const originalPath='materials/'+String(source.parameters.$tintmasktexture).replaceAll('\\','/').toLowerCase().replace(/\.vtf$/,'')+'.vtf';
      if(tint.source!==originalPath||!selectedTint||selectedTint.rgba.length!==3158*4||!Number.isInteger(instance.index)||instance.index<0||instance.index>=3158)throw Error('Original tint/instance RGB identity differs');
    }
    const decal=source.parameters.$decaltexture?selectedDecal?.materials.get(source.source):undefined;
    if(source.parameters.$decaltexture){
      const originalPath='materials/'+String(source.parameters.$decaltexture).replaceAll('\\','/').toLowerCase().replace(/\.vtf$/,'')+'.vtf';
      if(!uvRecord||uvRecord.material!==source.source||uvRecord.model!==record.model||uvRecord.vertexCount!==record.vertexCount)throw Error('Original decal UV2 primitive identity differs');
      if(!decal||decal.source!==originalPath||String(decal.mode)!==String(source.parameters.$decalblendmode))throw Error('Original decal material binding differs: '+source.source);
    }
    const key=record.mesh+':'+record.primitive,geometry=mesh.geometry,previous=verified.get(geometry);
    if(previous&&previous!==key)throw Error('Unexpected cross-primitive geometry alias');
    if(!previous){
      if(geometry.attributes.position.count!==record.vertexCount||geometry.index?.count!==record.indexCount)throw Error('Original prop accessor counts differ');
      for(const [semantic,expected] of Object.entries(record.attributeSha256)){
        const attr=geometry.attributes[attributeNames[semantic]];
        if(!attr)throw Error('Unsupported original prop attribute: '+semantic);
        const bytes=attributeBytes(attr);if(await digest(bytes,signal)!==expected)throw Error('Original prop accessor bytes differ: '+semantic);checkedVertexBytes+=bytes.byteLength;
      }
      const bytes=attributeBytes(geometry.index!);if(await digest(bytes,signal)!==record.indexSha256)throw Error('Original prop index bytes differ');checkedVertexBytes+=bytes.byteLength;
      verified.set(geometry,key);
    }
    if(record.mapOffset%4||record.mapBytes!==record.vertexCount*4)throw Error('Original VHV remap layout differs');
    const originalMaterial=await gltf.parser.getDependency('material',record.material) as T.MeshStandardMaterial;
    if(originalMaterial.name!==record.materialName||(source.parameters.$bumpmap&&!originalMaterial.normalMap))throw Error('Original prop normal texture missing');
    bindings.push({mesh,source,materialName:record.materialName,normalMap:originalMaterial.normalMap??undefined,normalGreenInverted:true,decalMap:decal?.texture,decalUv:decal&&uvRecord&&selectedDecal?{texture:selectedDecal.uv.texture,width:selectedDecal.uv.width,offset:uvRecord.offset,vertexCount:uvRecord.vertexCount}:undefined,mappingOffset:record.mapOffset/4,
      vertexCount:record.vertexCount,indexCount:record.indexCount,lightingVertexOffset:instance.lightingVertexOffset,lightingVertexCount:instance.lightingVertexCount,
      tintMap:tint?.texture,instanceRGB:tint&&selectedTint?Array.from(selectedTint.rgba.subarray(instance.index*4,instance.index*4+3)):undefined});
    appliedTriangles+=record.indexCount/3;
  }
  return {bindings,remap:new Uint32Array(remapBytes),lighting:new Uint8Array(lightingBytes),enablePlainUnbumped,enableDecalMultiply:!!decals,enableTintMask:!!tints,enableTintDecal:!!compound,
    verification:{eligibleMeshes:bindings.length,eligibleTriangles:appliedTriangles,uniqueGeometryReceipts:verified.size,checkedVertexBytes,
      observedInstances:seenInstances.size,skipped,originalGeometryUnchanged:true,nearestMatching:false}};
}

/** Caller owns the GLTF and calls this handle.dispose() first.
 * baseURL points to dust2-vhv/remap/; no HTML, renderer, or game singleton edits. */
export async function loadSourcePropLighting(gltf:GLTF,options:{baseURL:string;signal?:AbortSignal;maxTextureSize?:number;maxBytes?:number;enablePlainUnbumped?:boolean;enableDecalMultiply?:boolean;enableTintMask?:boolean;enableTintDecal?:boolean;enableStructuralTint?:boolean}){
  const base=new URL(options.baseURL,globalThis.location?.href??'http://127.0.0.1/');
  const url=new URL('runtime.json',base),response=await fetch(url,{signal:options.signal,cache:'no-cache'});if(!response.ok)throw Error('VHV descriptor HTTP '+response.status);
  const descriptor:PropVhvDescriptor=await response.json();
  const fetchBytes=async(file:Receipt)=>{const result=await fetch(new URL(file.url,url),{signal:options.signal,cache:'no-cache'});if(!result.ok)throw Error('VHV bytes HTTP '+result.status);return result.arrayBuffer();};
  const [remap,lighting]=await Promise.all([fetchBytes(descriptor.files.remap),fetchBytes(descriptor.files.lighting)]);
  const decals=options.enableDecalMultiply?await loadSourcePropDecals({baseURL:new URL('../decal/',url).href,signal:options.signal,maxTextureSize:options.maxTextureSize}):undefined;
  let structuralTint:Awaited<ReturnType<typeof loadSourcePropStructuralTint>>|undefined;
  let tints:Awaited<ReturnType<typeof loadSourcePropTint>>|undefined,compound:Awaited<ReturnType<typeof loadSourcePropTintDecal>>|undefined;
  try{
    if(options.enableTintMask)tints=await loadSourcePropTint({baseURL:new URL('../tint/',url).href,signal:options.signal,maxTextureSize:options.maxTextureSize});
    if(options.enableStructuralTint){
      if(!tints)throw Error('Structural tint requires the original tint registry');
      structuralTint=await loadSourcePropStructuralTint({baseURL:new URL('../tint-structures/',url).href,borrowedTint:tints,signal:options.signal,maxTextureSize:options.maxTextureSize});
    }
    if(options.enableTintDecal)compound=await loadSourcePropTintDecal({baseURL:new URL('../tint-decal/',url).href,signal:options.signal,maxTextureSize:options.maxTextureSize,borrowedTint:tints,borrowedDecal:decals});
    const data=await prepareSourcePropLightingData(gltf,descriptor,remap,lighting,options.signal,options.enablePlainUnbumped,decals,structuralTint??tints,compound);options.signal?.throwIfAborted();
    const handle=applySourcePropLighting(gltf.scene,{...data,maxTextureSize:options.maxTextureSize,maxBytes:options.maxBytes});
    // Batch inputs are the exact verified bindings the shader owner installed;
    // the batching adapter treats a missing mesh material replacement as an error.
    const batch={bindings:data.bindings,remap:data.remap,lighting:data.lighting,
      lookup:handle.lookup,enableDecalMultiply:!!decals,enableTintMask:!!tints,enableTintDecal:!!compound};
    return {audit:{...handle.audit,verification:data.verification,decalTextures:decals?.audit??null,tintTextures:tints?.audit??null,tintDecalTextures:compound?.audit??null,structuralTint:structuralTint?.audit??null},dispose:()=>{handle.dispose();compound?.dispose();structuralTint?.dispose();decals?.dispose();tints?.dispose();},batch};
  }catch(error){compound?.dispose();structuralTint?.dispose();decals?.dispose();tints?.dispose();throw error;}
}
