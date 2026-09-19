import * as T from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {sourceSha256} from './source-sha256';
import {applySourceFoliageLighting,type SourceFoliageBinding} from './source-foliage-lighting';
import {sourcePropFoliageCandidate,validateSourceTreeState,type SourceTreeState,type SourceTreeBinding} from './source-prop-foliage';
import {SOURCE_TREESWAY_PROGRAM_SHA256} from './source-treesway-glsl';
import type {SourcePropMaterialSource} from './source-prop-lighting';
type Receipt={url:string;bytes:number;sha256:string};
interface RecordBinding extends SourceTreeBinding {propId:number;mesh:number;primitive:number;model:string;material:string;materialName:string;meshToSceneMatrix:number[];
 mappingOffset:number;lightingVertexOffset:number;lightingVertexCount:number;vertexCount:number;indexCount:number;attributeSha256:{POSITION:string;NORMAL:string;TEXCOORD_0:string};indexSha256:string;}
export interface SourceFoliageDescriptor {format:'source-prop-foliage-v1';sourceBspSha256:string;originalGLBSha256:string;programSha256:string;
 records:RecordBinding[];materials:SourcePropMaterialSource[];files:Record<'remap.u32'|'lighting.bin',Receipt>}
const bsp='b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc',original='55937fce28a53461520fa2c531384f65f0f8b69df1a8205245466b6064ab5232';
const attributes={POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv'};
const raw=(a:T.BufferAttribute|T.InterleavedBufferAttribute)=>{if(a instanceof T.InterleavedBufferAttribute)throw Error('Original leaf tight attribute storage differs');return new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength);};
/** All original instance matrices, source rows, attribute/index bytes and exact
 * remap are checked before creating GPU resources. No nearest-point matching. */
export async function prepareSourceFoliageData(gltf:GLTF,d:SourceFoliageDescriptor,remap:ArrayBuffer,lighting:ArrayBuffer,signal?:AbortSignal){
 signal?.throwIfAborted();
 if(d.format!=='source-prop-foliage-v1'||d.sourceBspSha256!==bsp||d.originalGLBSha256!==original||d.programSha256!==SOURCE_TREESWAY_PROGRAM_SHA256||!Array.isArray(d.records)||d.records.length>70||!Array.isArray(d.materials))throw Error('Original foliage descriptor identity differs');
 for(const [name,bytes] of [['remap.u32',remap],['lighting.bin',lighting]] as const){const r=d.files[name];if(!r||bytes.byteLength!==r.bytes||await sourceSha256(new Uint8Array(bytes),signal)!==r.sha256)throw Error('Original foliage binary receipt differs: '+name);}
 const records=new Map(d.records.map(r=>[r.propId+':'+r.mesh+':'+r.primitive,r])),materials=new Map(d.materials.map(m=>[m.source,m]));
 if(records.size!==d.records.length||materials.size!==d.materials.length||d.materials.some(m=>!sourcePropFoliageCandidate(m)))throw Error('Duplicate/unsupported original foliage identity');
 const meshes:T.Mesh[]=[];gltf.scene.traverse(o=>{if((o as T.Mesh).isMesh)meshes.push(o as T.Mesh);});
 gltf.scene.updateWorldMatrix(true,true);const inverse=gltf.scene.matrixWorld.clone().invert(),bindings:SourceFoliageBinding[]=[];
 const checked=new Map<T.BufferGeometry,string>();let checkedBytes=0;
 for(const mesh of meshes){
  if(Array.isArray(mesh.material))continue;
  const source=materials.get(mesh.material.userData.full_path??mesh.material.name);if(!source)continue;
  signal?.throwIfAborted();
  const association=gltf.parser.associations.get(mesh) as {meshes?:number;primitives?:number}|undefined;
  let anchor:T.Object3D|null=mesh;while(anchor&&!/^static_prop_\d+$/.test(anchor.name))anchor=anchor.parent;
  const id=anchor?Number(anchor.name.slice(12)):NaN,key=id+':'+association?.meshes+':'+association?.primitives,r=records.get(key);
  if(!r||r.material!==source.source||r.materialName!==mesh.material.name||anchor?.userData.sourceModel!==r.model)throw Error('Original foliage instance/material identity differs');
  records.delete(key);
  const relative=new T.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld);
  if(r.meshToSceneMatrix.length!==16||!r.meshToSceneMatrix.every(Number.isFinite)||relative.elements.some((value,i)=>Math.abs(value-r.meshToSceneMatrix[i])>1e-7))throw Error('Original foliage model transform differs');
  const g=mesh.geometry,geometryKey=r.mesh+':'+r.primitive,previous=checked.get(g);
  if(previous&&previous!==geometryKey)throw Error('Unexpected original foliage geometry alias');
  if(!previous){
   if(g.attributes.position.count!==r.vertexCount||g.index?.count!==r.indexCount)throw Error('Original foliage accessor counts differ');
   for(const [semantic,name] of Object.entries(attributes)){const attr=g.attributes[name];if(!attr)throw Error('Original foliage attribute missing');const bytes=raw(attr);if(await sourceSha256(bytes,signal)!==r.attributeSha256[semantic as keyof typeof attributes])throw Error('Original foliage attribute SHA differs: '+semantic);checkedBytes+=bytes.byteLength;}
   const bytes=raw(g.index!);if(await sourceSha256(bytes,signal)!==r.indexSha256)throw Error('Original foliage index SHA differs');checkedBytes+=bytes.byteLength;checked.set(g,geometryKey);
  }
  bindings.push({mesh,source,materialName:r.materialName,sourceModelRows:r.sourceModelRows,mappingOffset:r.mappingOffset,lightingVertexOffset:r.lightingVertexOffset,lightingVertexCount:r.lightingVertexCount,vertexCount:r.vertexCount,indexCount:r.indexCount});
 }
 if(records.size||bindings.length!==d.records.length)throw Error('Original foliage mesh coverage differs');signal?.throwIfAborted();
 return {bindings,remap:new Uint32Array(remap),lighting:new Uint8Array(lighting),verification:{checkedBytes,uniqueGeometryReceipts:checked.size,originalMatricesVerified:true,hashVerified:true}};
}
/** Off by default. Explicit original time/wind required when enabled. Existing
 * R5 lighting owner remains independent and must continue excluding these leaves. */
export async function loadSourceFoliage(gltf:GLTF,options:{enabled?:boolean;baseURL:string;state:SourceTreeState;signal?:AbortSignal;maxTextureSize?:number}){
 if(!options.enabled)return {audit:{enabled:false},dispose(){},setState(_state:SourceTreeState){}};
 validateSourceTreeState(options.state);const {signal}=options;signal?.throwIfAborted();
 const base=new URL(options.baseURL,globalThis.location?.href??'http://127.0.0.1/');
 const response=await fetch(new URL('manifest.json',base),{signal,cache:'no-cache'});if(!response.ok)throw Error('Foliage manifest HTTP '+response.status);
 const manifest=await response.json() as {format:string;file:Receipt};if(manifest.format!=='source-prop-foliage-receipt-v1'||manifest.file.url!=='bindings.json')throw Error('Original foliage manifest differs');
 const bytes=async(r:Receipt)=>{if(!['bindings.json','remap.u32','lighting.bin'].includes(r.url)||!Number.isSafeInteger(r.bytes)||r.bytes<1||r.bytes>8*1024*1024||!/^[a-f0-9]{64}$/.test(r.sha256))throw Error('Invalid foliage file receipt');const response=await fetch(new URL(r.url,base),{signal,cache:'no-cache'});if(!response.ok)throw Error('Foliage bytes HTTP '+response.status);const b=await response.arrayBuffer();if(b.byteLength!==r.bytes||await sourceSha256(new Uint8Array(b),signal)!==r.sha256)throw Error('Original foliage file SHA differs');return b;};
 const d=JSON.parse(new TextDecoder().decode(await bytes(manifest.file))) as SourceFoliageDescriptor;
 if(d.records?.length!==70)throw Error('Original 70 foliage bindings required');
 const [remap,lighting]=await Promise.all([bytes(d.files['remap.u32']),bytes(d.files['lighting.bin'])]);
 const data=await prepareSourceFoliageData(gltf,d,remap,lighting,signal);signal?.throwIfAborted();
 const owner=applySourceFoliageLighting(gltf.scene,{...data,state:options.state,maxTextureSize:options.maxTextureSize});
 return {audit:{enabled:true,...owner.audit,verification:data.verification},dispose:owner.dispose,setState:owner.setState};
}
