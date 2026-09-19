import {readFileSync} from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import * as T from 'three';
import {createSourceAmbientSampler,decodeSourceHDRCube,loadSourceEnvCubemaps,SOURCE_WORLD_TO_SOURCE} from '../game/source-env-cubemaps';
import {createSourceAWPMaterial,createSourceAWPScopeMaterial} from '../game/source-awp-materials';
import {createSourceFinishMaterial} from '../game/source-materials';
import native from '../research/source-ambient-runtime.json';

const base=path.resolve('public/source/csgo-12426148/environment-probes');
const manifest=JSON.parse(readFileSync(path.join(base,'manifest.json'),'utf8'));
const files=new Map<string,Uint8Array>(manifest.files.map((r:{path:string})=>[r.path,new Uint8Array(readFileSync(path.join(base,r.path)))]));
const sampler=createSourceAmbientSampler(files);
afterEach(()=>vi.unstubAllGlobals());
function shader(material:T.Material){const s={uniforms:T.UniformsUtils.clone(T.ShaderLib.phong.uniforms),vertexShader:T.ShaderLib.phong.vertexShader,fragmentShader:T.ShaderLib.phong.fragmentShader} as T.WebGLProgramParametersWithUniforms;material.onBeforeCompile(s,{}as T.WebGLRenderer);return s;}
function before(scene:T.Scene,camera:T.Camera){scene.updateMatrixWorld(true);scene.onBeforeRender({}as T.WebGLRenderer,scene,camera,{}as T.BufferGeometry,{}as T.Material,{}as T.Group);}
function after(scene:T.Scene,camera:T.Camera){scene.onAfterRender({}as T.WebGLRenderer,scene,camera,{}as T.BufferGeometry,{}as T.Material,{}as T.Group);}
async function load(){vi.stubGlobal('fetch',async(url:string)=>new Response(readFileSync(path.join(base,url.replace('/fixture/','')))));return loadSourceEnvCubemaps('/fixture');}

describe('original Dust II environment probes',()=>{
 it('matches the actual installed x64 ambient sampler at all sixteen probes and thirty spawn eyes',()=>{
  expect(native.cases).toHaveLength(46);
  for(const row of native.cases){
   const sample=sampler.sampleSourcePosition(new T.Vector3(...row.sourcePosition as [number,number,number]));
   expect(sample?.leaf).toBe(row.leaf);
   const actual=sample?.faces??Array.from({length:6},()=>[0,0,0]);
   actual.flat().forEach((c,i)=>expect(c).toBeCloseTo(row.nativeFaces.flat()[i],5));
  }
  expect(Math.fround(native.rawConstant255.value*native.power2Table.exponent0)).toBe(1);
 });
 it('keeps all sixteen original HDR cubes and six source mip levels without generated pixels',()=>{
  expect(manifest.probes).toHaveLength(16);
  for(const p of manifest.probes){const b=files.get(p.cube)!,handle=decodeSourceHDRCube(b),cube=handle.cube;
   expect(cube.images).toHaveLength(6);expect(cube.type).toBe(T.HalfFloatType);expect(cube.generateMipmaps).toBe(false);
   expect(cube.mipmaps).toHaveLength(5);expect(cube.images[0].image.width).toBe(32);
   const raw=new DataView(b.buffer,b.byteOffset,b.byteLength);const firstBase=b.byteLength-6*32*32*8;
   expect(cube.images[0].image.data![0]).toBe(raw.getUint16(firstBase,true));
   expect(cube.images[5].image.data![7]).toBe(raw.getUint16(firstBase+5*32*32*8+14,true));
   handle.dispose();
  }
  expect(()=>decodeSourceHDRCube(files.get(manifest.probes[0].cube)!.subarray(0,200))).toThrow();
 });
 it('finds actual BSP leaves and source HDR ambient data at probe locations in both axis systems',()=>{
  let count=0;const results:number[]=[];
  for(const p of manifest.probes){
   const source=new T.Vector3(...p.sourcePosition as [number,number,number]),a=sampler.sampleSourcePosition(source);
   const world=source.clone().applyMatrix3(SOURCE_WORLD_TO_SOURCE.clone().invert()).multiplyScalar(.0254);
   const b=sampler.sampleWorldPosition(world);
   expect(b?.leaf).toBe(a?.leaf);expect(b?.resolvedLeaf).toBe(a?.resolvedLeaf);
   if(a&&b)b.faces.flat().forEach((c,i)=>expect(c).toBeCloseTo(a.faces.flat()[i],12));
   if(a){count++;expect(a.sampleCount).toBeGreaterThan(0);expect(a.faces.flat().every(Number.isFinite)).toBe(true);results.push(a.faces.flat().reduce((n,c)=>n+c,0));}
  }
  expect(count).toBeGreaterThan(10);expect(new Set(results).size).toBeGreaterThan(10);
 });
 it('agrees with the independently staged map spawn axes, not viewmodel-local axes',()=>{
  const level=JSON.parse(readFileSync(path.resolve('public/source/csgo-12426148/dust2/level.json'),'utf8'));
  for(const spawn of level.spawns){
   const world=new T.Vector3(spawn.x,spawn.y+level.player.standing.eyeHeight,spawn.z);
   const source=new T.Vector3(...spawn.sourceOrigin as [number,number,number]);source.z+=64;
   const a=sampler.sampleSourcePosition(source),b=sampler.sampleWorldPosition(world);
   expect(b?.leaf).toBe(a?.leaf);if(a&&b)b.faces.flat().forEach((c,i)=>expect(c).toBeCloseTo(a.faces.flat()[i],10));
  }
 });
 it('gives world/FP separate live lighting uniforms, then restores borrowed/default/finish material identities',async()=>{
  const owner=await load(),scene=new T.Scene(),camera=new T.PerspectiveCamera(),geometry=new T.BoxGeometry(),baseMap=new T.Texture(),exp=new T.Texture();
  const awp=createSourceAWPMaterial('awp',baseMap,exp),scope=createSourceAWPScopeMaterial(baseMap,exp);
  const mesh=new T.Mesh(geometry,[awp.material,scope.material]),other=new T.Mesh(geometry,awp.material);scene.add(mesh,other);
  const probe=manifest.probes[0].sourcePosition;mesh.position.set(probe[0]*.0254,probe[2]*.0254,-probe[1]*.0254);other.position.copy(mesh.position).add(new T.Vector3(10,0,0));
  const original=mesh.material,binding=owner.bindScene(scene);before(scene,camera);
  const applied=mesh.material as T.Material[];expect(applied).not.toBe(original);expect(applied[0]).not.toBe(other.material);
  const s=shader(applied[0]);expect(s.uniforms.sourceEnvEnabled.value).toBe(1);expect(s.uniforms.sourceEnvMap.value.isCubeTexture).toBe(true);
  expect(s.uniforms.sourceAmbientEnabled.value).toBe(1);expect(s.fragmentShader).toContain('irradiance=PI*sourceAmbientRadiance');
  expect(applied[0].userData.sourceProbeBinding.probeId).toBe(manifest.probes[0].id);
  after(scene,camera);expect(mesh.material).toBe(original);expect(other.material).toBe(awp.material);
  const finish=createSourceFinishMaterial({name:'Source_AWP_Finish',phongBoost:2,phongAlbedoBoost:60,phongFresnelRanges:[.8,.8,1]},baseMap,exp);
  mesh.material=[finish.material,scope.material];const selected=mesh.material;before(scene,camera);
  expect(shader((mesh.material as T.Material[])[0]).uniforms.sourceAlbedoBoost.value).toBe(60);after(scene,camera);expect(mesh.material).toBe(selected);
  mesh.material=original;before(scene,camera);after(scene,camera);expect(mesh.material).toBe(original);
  expect(binding.audit().activeDrawSwaps).toBe(0);binding.dispose();owner.dispose();finish.dispose();awp.dispose();scope.dispose();geometry.dispose();baseMap.dispose();exp.dispose();
 });
 it('skips hidden ancestry, wrong layers and override passes while retaining colour views and stationary samples',async()=>{
  const owner=await load(),scene=new T.Scene(),camera=new T.PerspectiveCamera(),geometry=new T.BoxGeometry(),baseMap=new T.Texture(),exp=new T.Texture();
  const awp=createSourceAWPMaterial('awp',baseMap,exp),group=new T.Group(),mesh=new T.Mesh(geometry,awp.material);
  group.add(mesh);scene.add(group);const binding=owner.bindScene(scene);
  const traverse=vi.spyOn(scene,'traverse');
  before(scene,camera);const originalView=mesh.material;after(scene,camera);
  expect(binding.audit()).toMatchObject({materialViews:1,createdViews:1,ambientQueries:1});
  group.visible=false;before(scene,camera);expect(mesh.material).toBe(awp.material);after(scene,camera);
  group.visible=true;camera.layers.set(22);before(scene,camera);expect(mesh.material).toBe(awp.material);after(scene,camera);
  camera.layers.set(0);const depth=new T.MeshDepthMaterial();scene.overrideMaterial=depth;
  before(scene,camera);expect(mesh.material).toBe(awp.material);after(scene,camera);scene.overrideMaterial=null;
  awp.material.visible=false;before(scene,camera);after(scene,camera);awp.material.visible=true;
  before(scene,camera);expect(mesh.material).toBe(originalView);after(scene,camera);
  expect(binding.audit()).toMatchObject({materialViews:1,createdViews:1,releasedViews:0,ambientQueries:1,skippedOverridePasses:1});
  mesh.position.x+=1;before(scene,camera);after(scene,camera);expect(binding.audit().ambientQueries).toBe(2);
  // No full scene traversal is used per pass; hidden and particle passes do not churn views.
  expect(traverse).not.toHaveBeenCalled();traverse.mockRestore();
  binding.dispose();expect(binding.audit()).toMatchObject({materialViews:0,indexedMeshes:0,releasedViews:1});
  owner.dispose();awp.dispose();depth.dispose();geometry.dispose();baseMap.dispose();exp.dispose();
 });
 it('indexes new subtrees, sees live material replacements and releases removed actors without sharing light uniforms',async()=>{
  const owner=await load(),scene=new T.Scene(),camera=new T.PerspectiveCamera(),geometry=new T.BoxGeometry(),baseMap=new T.Texture(),exp=new T.Texture();
  const awp=createSourceAWPMaterial('awp',baseMap,exp),plain=new T.MeshBasicMaterial(),binding=owner.bindScene(scene),group=new T.Group();
  const a=new T.Mesh(geometry,plain as T.Material),b=new T.Mesh(geometry,awp.material);group.add(a,b);scene.add(group);
  before(scene,camera);after(scene,camera);expect(binding.audit().createdViews).toBe(1);
  a.material=awp.material;a.position.x=12;before(scene,camera);
  expect(a.material).not.toBe(b.material);expect(shader(a.material).uniforms.sourceAmbientCube).not.toBe(shader(b.material).uniforms.sourceAmbientCube);
  after(scene,camera);expect(binding.audit()).toMatchObject({createdViews:2,materialViews:2,indexedMeshes:2});
  scene.remove(group);expect(binding.audit()).toMatchObject({materialViews:0,indexedMeshes:0,releasedViews:2});
  // Detached trees cannot retain listeners or recreate material views when later modified.
  group.add(new T.Mesh(geometry,awp.material));before(scene,camera);after(scene,camera);
  expect(binding.audit()).toMatchObject({materialViews:0,indexedMeshes:0,createdViews:2});
  scene.add(group);before(scene,camera);after(scene,camera);expect(binding.audit().materialViews).toBe(3);
  awp.dispose();expect(binding.audit().materialViews).toBe(0);
  binding.dispose();owner.dispose();plain.dispose();geometry.dispose();baseMap.dispose();exp.dispose();
 });
 it('rejects changed map resources before a source probe can be marked bound',async()=>{
  vi.stubGlobal('fetch',async()=>new Response('{}'));await expect(loadSourceEnvCubemaps('/fixture')).rejects.toThrow('manifest SHA mismatch');
 });
});
