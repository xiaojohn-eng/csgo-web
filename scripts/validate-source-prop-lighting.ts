/** Actual GLTFLoader/Three object and original data readback. Image decoding is
 * substituted with empty Texture objects; this explicitly is not GPU proof. */
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {applySourcePropLighting} from '../game/source-prop-lighting';
import {prepareSourcePropLightingData,type PropVhvDescriptor} from './preview-source-prop-lighting';
import assert from 'node:assert/strict';
import {prepareSourcePropDecalUv} from '../game/source-prop-decal-uv';
import type {SourcePropDecalAssets} from '../game/source-prop-decal-loader';
const directory='.reference-assets/source-exports/dust2-vhv/',started=performance.now();
const insecure=process.argv.includes('--insecure');
const unbumped=process.argv.includes('--unbumped');
const decalMultiply=process.argv.includes('--decal');
if(insecure)Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
const read=(path:string)=>readFileSync(path);
const binary=(path:string)=>new Uint8Array(read(path)).buffer;
const raw=binary('.reference-assets/source-exports/dust2/props.glb');
const loader=new GLTFLoader();let emptyTextureCount=0;
loader.register(()=>({name:'CPU_NO_IMAGE_DECODE',loadTexture:async()=>{emptyTextureCount++;const texture=new T.Texture();texture.flipY=false;return texture;}}));
const gltf=await loader.parseAsync(raw,''),geometries=new Set<T.BufferGeometry>();
const before:{mesh:T.Mesh;geometry:T.BufferGeometry;material:T.Material|T.Material[];index:T.BufferAttribute|null;attributes:Record<string,T.BufferAttribute|T.InterleavedBufferAttribute>;matrix:number[]}[]=[];
gltf.scene.traverse(o=>{const mesh=o as T.Mesh;if(mesh.isMesh){geometries.add(mesh.geometry);before.push({mesh,geometry:mesh.geometry,material:mesh.material,index:mesh.geometry.index,
  attributes:{...mesh.geometry.attributes},matrix:mesh.matrix.toArray()});}});
const descriptor:PropVhvDescriptor=JSON.parse(read(directory+'remap/runtime.json').toString());
let decals:SourcePropDecalAssets|undefined;
if(decalMultiply){
  const manifest=JSON.parse(read(directory+'decal/manifest.json').toString());
  const textures=new Map<string,T.Texture>();
  for(const t of manifest.textures){const png=read(directory+'decal/'+t.url);assert.equal(png.length,t.bytes);assert.equal(createHash('sha256').update(png).digest('hex'),t.sha256);
    const texture=new T.Texture();texture.flipY=false;texture.colorSpace=T.SRGBColorSpace;textures.set(t.source,texture);}
  decals={uv:await prepareSourcePropDecalUv(JSON.parse(read(directory+'decal/uv-remap.json').toString()),binary(directory+'decal/original-decal-uv.f32')),materials:new Map(manifest.materials.map((m:{material:string;decalSource:string;mode:1|2})=>[m.material,{texture:textures.get(m.decalSource)!,source:m.decalSource,mode:m.mode}]))};
}
const data=await prepareSourcePropLightingData(gltf,descriptor,binary(directory+'remap/original-prop-to-vhv.u32'),binary(directory+'instance-lighting.bin'),undefined,unbumped,decals);
const created=performance.now(),handle=applySourcePropLighting(gltf.scene,data),applyMilliseconds=performance.now()-created;
const skippedReasons:Record<string,{meshes:number;triangles:number}>={};
for(const skip of data.verification.skipped)for(const reason of skip.reasons){const entry=skippedReasons[reason]??={meshes:0,triangles:0};entry.meshes++;entry.triangles+=skip.triangles;}
const materials=new Set<T.Material>(),lookups=new Set<T.Texture>();let uniformsChecked=0;
for(const binding of data.bindings){
  const material=binding.mesh.material as T.Material;materials.add(material);
  const shader={uniforms:{},vertexShader:T.ShaderLib.basic.vertexShader,fragmentShader:T.ShaderLib.basic.fragmentShader} as Parameters<T.Material['onBeforeCompile']>[0];
  material.onBeforeCompile(shader,{} as T.WebGLRenderer);
  assert.equal(shader.uniforms.sourceInstanceOffset.value,binding.lightingVertexOffset);assert.equal(shader.uniforms.sourceMappingOffset.value,binding.mappingOffset);
  if(binding.decalMap){assert.equal(shader.uniforms.sourceDecalUvMap.value,decals!.uv.texture);assert.equal(shader.uniforms.sourceDecalUvOffset.value,binding.decalUv!.offset);assert.equal(shader.uniforms.sourceDecalMap.value,binding.decalMap);assert.equal(shader.uniforms.sourceDecalScale.value,Number(binding.source.parameters.$decalblendmode));}
  lookups.add(shader.uniforms.sourceVhvRemap.value);lookups.add(shader.uniforms.sourceVhvLighting.value);uniformsChecked++;
}
assert.equal(lookups.size,2);assert.equal(materials.size,data.bindings.length);
for(const row of before){assert.equal(row.mesh.geometry,row.geometry);assert.equal(row.geometry.index,row.index);assert.deepEqual(row.mesh.matrix.toArray(),row.matrix);
  for(const [key,value] of Object.entries(row.attributes))assert.equal(row.geometry.attributes[key],value);}
let disposed=0;for(const t of lookups)t.addEventListener('dispose',()=>disposed++);
handle.dispose();handle.dispose();decals?.uv.dispose();assert.equal(disposed,2);for(const row of before)assert.equal(row.mesh.material,row.material);
const receipt={status:'actual_Three_original_geometry_and_per_instance_uniform_readback_passed',originalGLBSha256:createHash('sha256').update(new Uint8Array(raw)).digest('hex'),
  sourceBspSha256:descriptor.sourceBspSha256,meshInstances:before.length,uniqueGeometries:geometries.size,emptyTextureCount,
  appliedMeshes:handle.audit.appliedMeshes,appliedTriangles:data.verification.eligibleTriangles,uniqueMaterials:new Set(data.bindings.map(b=>b.source.source)).size,
  uniqueGeometryReceipts:data.verification.uniqueGeometryReceipts,checkedVertexBytes:data.verification.checkedVertexBytes,skippedMeshes:data.verification.skipped.length,
  skippedTriangles:data.verification.skipped.reduce((n,r)=>n+r.triangles,0),lookupBytes:handle.audit.lookupBytes,lookupDimensions:[handle.audit.textureWidth,handle.audit.mapHeight,handle.audit.lightHeight],
  uniformsChecked,skippedReasons,geometryModified:false,imagesDecoded:false,gpuVerified:false,applyMilliseconds,totalMilliseconds:performance.now()-started,
  secureCryptoAvailable:Boolean(globalThis.crypto?.subtle),hashBackend:insecure?'noble-js HTTP absence fixture':'native WebCrypto',
  plainUnbumpedEnabled:unbumped,plainUnbumpedMeshes:handle.audit.plainUnbumpedMeshes,decalMultiplyEnabled:decalMultiply,decalMultiplyMeshes:handle.audit.decalMultiplyMeshes};
writeFileSync(directory+'remap/three-verification'+(unbumped?'-unbumped':'')+(decalMultiply?'-decal':'')+(insecure?'-http':'')+'.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
