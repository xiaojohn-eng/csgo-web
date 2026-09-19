import {beforeAll,describe,it,expect} from 'vitest';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {createSourceCTViewmodel,prepareSourceCTViewmodel,SOURCE_CT_VIEWMODEL_SHA256} from '../game/source-ct-viewmodel';
import {createSourceCTArmMaterial,type SourceCTArmTextures} from '../game/source-ct-viewmodel-materials';
import {createSourceArmsMaterial} from '../game/source-materials';
import {createSourceViewmodel,sampleSourceViewmodel,sourceAttachment,inspectSourceViewmodel,disposeSourceViewmodel,startSourceInspection,updateSourceViewmodel} from '../game/source-viewmodel';
import type {Player} from '../game/types';
const texture=()=>new T.DataTexture(new Uint8Array([17,34,55,128]),1,1);
const ctTextures=():SourceCTArmTextures=>({sleeve:{base:texture(),normal:texture()},glove:{base:texture(),normal:texture(),exponent:texture()}});
function compile(material:T.Material){const shader={uniforms:T.UniformsUtils.clone(T.ShaderLib.phong.uniforms),vertexShader:T.ShaderLib.phong.vertexShader,fragmentShader:T.ShaderLib.phong.fragmentShader}as Parameters<T.Material['onBeforeCompile']>[0];material.onBeforeCompile(shader,{}as T.WebGLRenderer);return shader;}
describe('original CT sleeve/glove VMT shader contract',()=>{
 it('uses constant sleeve exponent12 with normal-alpha mask and no Half-Lambert/texture exponent',()=>{
  const maps=ctTextures(),handle=createSourceCTArmMaterial('sleeve',maps),shader=compile(handle.material);
  expect(shader.uniforms.sourceCTBoost.value).toBe(1);expect(shader.uniforms.sourceCTFresnel.value.toArray()).toEqual([.2,.2,1]);
  expect(shader.uniforms.sourceCTRimExponent.value).toBe(15);expect(shader.fragmentShader).toContain('material.specularShininess=12.0');
  expect(shader.fragmentShader).toContain('texture2D(normalMap,vNormalMapUv).a');expect(shader.fragmentShader).not.toContain('texture2D(sourceCTExponent');
  expect(shader.fragmentShader).not.toContain('sourceCTDiffuse');expect(handle.material.normalScale.toArray()).toEqual([1,-1]);handle.dispose();
 });
 it('uses CT glove exponentR/rimA and leaves default T glove rim10 unchanged',()=>{
  const maps=ctTextures(),ct=createSourceCTArmMaterial('glove',maps),original=createSourceArmsMaterial('glove',maps.glove),shader=compile(ct.material),t=compile(original.material);
  expect(shader.uniforms.sourceCTRimExponent.value).toBe(4);expect(t.uniforms.sourceRimExponent.value).toBe(10);
  expect(shader.fragmentShader).toContain('1.0+149.0*sourceCTParams.r');expect(shader.fragmentShader).toContain('sourceCTParams.a*sourceCTF2*sourceCTF2');
  expect(shader.fragmentShader).toContain('sourceCTDiffuse*sourceCTDiffuse');expect(shader.uniforms.sourceCTTint.value.toArray()).toEqual([.7,.8,1]);
  let disposed=0;maps.glove.exponent.addEventListener('dispose',()=>disposed++);ct.dispose();original.dispose();expect(disposed).toBe(0);
 });
});
const directory='.reference-assets/source-exports/ak47-ct-arms/';
async function cpu(folder:string){
 const bytes=readFileSync(folder+'v_rif_ak47-with-arms-source-unit.glb'),size=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(12,true),doc=JSON.parse(bytes.subarray(20,20+size).toString()),bin=bytes.subarray(28+size);
 doc.materials=doc.materials.map((m:{name:string})=>({name:m.name}));delete doc.images;delete doc.textures;delete doc.extensionsUsed;delete doc.extensionsRequired;
 doc.buffers=[{byteLength:bin.byteLength,uri:'data:application/octet-stream;base64,'+Buffer.from(bin).toString('base64')}];
 if(!globalThis.ProgressEvent)globalThis.ProgressEvent=class{constructor(type:string,data:object){Object.assign(this,{type},data);}}as unknown as typeof ProgressEvent;
 return new GLTFLoader().parseAsync(JSON.stringify(doc),'');
}
describe.runIf(existsSync(directory+'ct-metadata.json'))('actual original CT48 / AK58 playback and T regression',()=>{
 let gltf:GLTF,tgltf:GLTF;
 beforeAll(async()=>{[gltf,tgltf]=await Promise.all([cpu(directory),cpu('.reference-assets/source-exports/ak47-arms/')]);});
 it('keeps exact bone merge and raw CT skin vertices at all original frames and interior samples',()=>{
  const model=createSourceCTViewmodel(gltf,texture(),texture(),ctTextures()),metadata=JSON.parse(readFileSync(directory+'ct-metadata.json','utf8')),audit=JSON.parse(readFileSync(directory+'audit.json','utf8'));
  expect(audit.glb.sha256).toBe(SOURCE_CT_VIEWMODEL_SHA256);
  const weapon=new Map<string,T.Bone>(),arms:T.Bone[]=[],meshes:T.SkinnedMesh[]=[];
  model.traverse(o=>{if(o instanceof T.Bone){if(o.userData.sourceFPSkin==='weapon')weapon.set(o.userData.sourceFPBoneName,o);if(o.userData.sourceFPSkin==='arms')arms.push(o);}if(o instanceof T.SkinnedMesh&&o.skeleton.bones.some(b=>b.userData.sourceFPSkin==='arms'))meshes.push(o);});
  const ibms=meshes.map(m=>m.skeleton.boneInverses.map(i=>i.elements.slice())),raw=new Map<string,T.Matrix4>(metadata.bones.map((b:{name:string;inverseBind:number[][]})=>[b.name,new T.Matrix4().set(...b.inverseBind.flat()as Parameters<T.Matrix4['set']>)]));
  const ci=new T.Matrix4().set(1,0,0,0,0,0,-1,0,0,1,0,0,0,0,0,1),point=new T.Vector3(),sum=new T.Vector3(),part=new T.Vector3();
  let matrixError=0,vertexError=0,times=0,vertices=0,milliseconds=0,worst={};
  for(const [kind,c]of Object.entries(audit.clip_checks)as [Parameters<typeof sampleSourceViewmodel>[1],{frame_count:number;fps:number;duration_seconds:number}][]){
   const samples=Array.from({length:c.frame_count},(_,i)=>i/c.fps);samples.push(.173*c.duration_seconds,.519*c.duration_seconds);
   for(const time of samples){const start=performance.now();sampleSourceViewmodel(model,kind,time);milliseconds+=performance.now()-start;times++;
    for(const bone of arms){const gun=weapon.get(bone.userData.sourceFPBoneName);if(gun)for(let j=0;j<16;j++){const e=Math.abs(gun.matrixWorld.elements[j]-bone.matrixWorld.elements[j]);if(e>matrixError){matrixError=e;worst={kind,time,bone:bone.userData.sourceFPBoneName,index:j,gun:gun.matrixWorld.elements[j],arm:bone.matrixWorld.elements[j]};}}}
    for(const mesh of meshes){const pos=mesh.geometry.attributes.position,joints=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
     const matrices=mesh.skeleton.bones.map(b=>{const gun=weapon.get(b.userData.sourceFPBoneName);return gun?gun.matrixWorld.clone().multiply(raw.get(b.userData.sourceFPBoneName)!).multiply(ci):null;});
     for(let i=0;i<pos.count;i+=37){point.fromBufferAttribute(pos,i);mesh.applyBoneTransform(i,point);mesh.localToWorld(point);sum.set(0,0,0);
      for(let k=0;k<4;k++){const weight=weights.getComponent(i,k);if(weight){const m=matrices[joints.getComponent(i,k)]!;part.fromBufferAttribute(pos,i).applyMatrix4(m);sum.addScaledVector(part,weight);}}
      vertexError=Math.max(vertexError,point.distanceTo(sum));vertices++;
     }
    }
   }
  }
  expect(matrixError,JSON.stringify(worst)).toBeLessThan(1e-12);expect(vertexError).toBeLessThan(1e-6);expect(meshes.map(m=>m.skeleton.boneInverses.map(i=>i.elements.slice()))).toEqual(ibms);
  writeFileSync(directory+'runtime-readback.json',JSON.stringify({status:'passed',times,bonePairs:times*47,vertices,maxMatrixErrorMetres:matrixError,maxVertexErrorMetres:vertexError,meanUpdateMilliseconds:milliseconds/times,rawCTInverseBindsPreserved:48,sourceGlbSha256:SOURCE_CT_VIEWMODEL_SHA256},null,2)+'\n');disposeSourceViewmodel(model);
 });
 it('keeps clones independent, original clip controls and both animated attachments unchanged',()=>{
  const a=createSourceCTViewmodel(gltf,texture(),texture(),ctTextures()),b=createSourceCTViewmodel(gltf,texture(),texture(),ctTextures());
  const tmaps={base:texture(),normal:texture(),exponent:texture()},t=createSourceViewmodel(tgltf,texture(),texture(),{skin:tmaps,glove:tmaps});
  expect(inspectSourceViewmodel(a).armsProfile).toBe('ct_arms_idf');expect(inspectSourceViewmodel(t).armsProfile).toBe('t_arms');
  expect(inspectSourceViewmodel(a).surfaces.map(s=>s.name)).toEqual(expect.arrayContaining(['Source_CT_IDF_Sleeves_VertexLitGeneric','Source_CT_Gloves_VertexLitGeneric']));
  for(const [pose,time]of [['idle',0],['fire',.3],['reload',1.12],['inspect',2.34]]as const){sampleSourceViewmodel(a,pose,time);sampleSourceViewmodel(t,pose,time);
   for(const attachment of ['muzzle','ejection']as const)expect(sourceAttachment(a,attachment,a).elements).toEqual(sourceAttachment(t,attachment,t).elements);
  }
  expect(inspectSourceViewmodel(b).pose).toBe('idle');expect(inspectSourceViewmodel(b).time).toBe(0);
  startSourceInspection(a);updateSourceViewmodel(a,undefined,.1);expect(inspectSourceViewmodel(a).pose).toBe('inspect');
  updateSourceViewmodel(a,undefined,.1,true);expect(inspectSourceViewmodel(a).pose).toBe('idle');
  updateSourceViewmodel(a,{alive:true,reload:1,shotIdle:9}as Player,.1);expect(inspectSourceViewmodel(a).pose).toBe('reload');
  disposeSourceViewmodel(a);sampleSourceViewmodel(b,'inspect',3);expect(inspectSourceViewmodel(b).time).toBe(3);disposeSourceViewmodel(b);disposeSourceViewmodel(t);
 });
 it('rejects mixed T skeletons instead of silently displaying T bare arms',()=>{
  expect(()=>prepareSourceCTViewmodel(tgltf)).toThrow(/identity/);
 });
});
