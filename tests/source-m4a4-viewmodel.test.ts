import {beforeAll,describe,it,expect} from 'vitest';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {createSourceM4A4Viewmodel,prepareSourceM4A4Viewmodel,SOURCE_M4A4_VIEWMODEL_SHA256} from '../game/source-m4a4-viewmodel';
import {createSourceCTArmMaterial,type SourceCTArmTextures} from '../game/source-ct-viewmodel-materials';
import {createSourceArmsMaterial} from '../game/source-materials';
import {createSourceViewmodel,sampleSourceViewmodel,sourceAttachment,inspectSourceViewmodel,disposeSourceViewmodel,startSourceInspection,startSourceDraw,updateSourceViewmodel} from '../game/source-viewmodel';
import type {Player} from '../game/types';
const texture=()=>new T.DataTexture(new Uint8Array([17,34,55,128]),1,1);
const ctTextures=():SourceCTArmTextures=>({sleeve:{base:texture(),normal:texture()},glove:{base:texture(),normal:texture(),exponent:texture()}});
function compile(material:T.Material){const shader={uniforms:T.UniformsUtils.clone(T.ShaderLib.phong.uniforms),vertexShader:T.ShaderLib.phong.vertexShader,fragmentShader:T.ShaderLib.phong.fragmentShader}as Parameters<T.Material['onBeforeCompile']>[0];material.onBeforeCompile(shader,{}as T.WebGLRenderer);return shader;}
const directory='.reference-assets/source-exports/m4a4/';
async function cpu(folder:string){
 const bytes=readFileSync(folder+(folder.includes('/m4a4/')?'v_rif_m4a1-with-arms-source-unit.glb':'v_rif_ak47-with-arms-source-unit.glb')),size=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(12,true),doc=JSON.parse(bytes.subarray(20,20+size).toString()),bin=bytes.subarray(28+size);
 doc.materials=doc.materials.map((m:{name:string})=>({name:m.name}));delete doc.images;delete doc.textures;delete doc.extensionsUsed;delete doc.extensionsRequired;
 doc.buffers=[{byteLength:bin.byteLength,uri:'data:application/octet-stream;base64,'+Buffer.from(bin).toString('base64')}];
 if(!globalThis.ProgressEvent)globalThis.ProgressEvent=class{constructor(type:string,data:object){Object.assign(this,{type},data);}}as unknown as typeof ProgressEvent;
 return new GLTFLoader().parseAsync(JSON.stringify(doc),'');
}
describe.runIf(existsSync(directory+'m4a4-metadata.json'))('actual original CT48 / M4A4 57 runtime playback',()=>{
 let gltf:GLTF,tgltf:GLTF;
 beforeAll(async()=>{[gltf,tgltf]=await Promise.all([cpu(directory),cpu('.reference-assets/source-exports/ak47-arms/')]);});
 it('keeps exact bone merge and raw CT skin vertices at all original frames and interior samples',()=>{
  const model=createSourceM4A4Viewmodel(gltf,texture(),texture(),ctTextures()),metadata=JSON.parse(readFileSync(directory+'m4a4-metadata.json','utf8')),audit=JSON.parse(readFileSync(directory+'audit.json','utf8'));
  // The shipped GLB is this export plus the rifle's other two fire variants; the export
  // itself, and what the port pins, are both recorded in the tracked append record.
  const appended=JSON.parse(readFileSync('research/source-weapon-fire-variants.json','utf8')).assets.find((row:{asset:string})=>row.asset==='m4a4');
  expect(audit.glb.sha256).toBe(appended.previousGLBSHA256);
  expect(SOURCE_M4A4_VIEWMODEL_SHA256).toBe(appended.resultGLBSHA256);
  const weapon=new Map<string,T.Bone>(),arms:T.Bone[]=[],meshes:T.SkinnedMesh[]=[];
  model.traverse(o=>{if(o instanceof T.Bone){if(o.userData.sourceFPSkin==='weapon')weapon.set(o.userData.sourceFPBoneName,o);if(o.userData.sourceFPSkin==='arms')arms.push(o);}if(o instanceof T.SkinnedMesh&&o.skeleton.bones.some(b=>b.userData.sourceFPSkin==='arms'))meshes.push(o);});
  const ibms=meshes.map(m=>m.skeleton.boneInverses.map(i=>i.elements.slice())),raw=new Map<string,T.Matrix4>(metadata.arms.bones.map((b:{name:string;inverseBind:number[][]})=>[b.name,new T.Matrix4().set(...b.inverseBind.flat()as Parameters<T.Matrix4['set']>)]));
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
  writeFileSync(directory+'runtime-readback.json',JSON.stringify({status:'passed',times,bonePairs:times*47,vertices,maxMatrixErrorMetres:matrixError,maxVertexErrorMetres:vertexError,meanUpdateMilliseconds:milliseconds/times,rawCTInverseBindsPreserved:48,sourceGlbSha256:appended.previousGLBSHA256},null,2)+'\n');disposeSourceViewmodel(model);
 });
 it('keeps clones independent, original clip controls and both animated attachments unchanged',()=>{
  const a=createSourceM4A4Viewmodel(gltf,texture(),texture(),ctTextures()),b=createSourceM4A4Viewmodel(gltf,texture(),texture(),ctTextures());
  const tmaps={base:texture(),normal:texture(),exponent:texture()},t=createSourceViewmodel(tgltf,texture(),texture(),{skin:tmaps,glove:tmaps});
  expect(inspectSourceViewmodel(a).armsProfile).toBe('ct_arms_idf');expect(inspectSourceViewmodel(t).armsProfile).toBe('t_arms');
  expect(inspectSourceViewmodel(a).surfaces.map(s=>s.name)).toEqual(expect.arrayContaining(['Source_CT_IDF_Sleeves_VertexLitGeneric','Source_CT_Gloves_VertexLitGeneric']));
  expect(inspectSourceViewmodel(a).weapon).toBe('m4a4');
  expect(inspectSourceViewmodel(a).clips.map(c=>c.name)).toEqual(['idle','fire','reload','inspect','draw']);
  startSourceDraw(a);updateSourceViewmodel(a,undefined,.1);expect(inspectSourceViewmodel(a).pose).toBe('draw');
  sampleSourceViewmodel(a,'draw',1);expect(sourceAttachment(a,'muzzle',a).elements.every(Number.isFinite)).toBe(true);
  expect(inspectSourceViewmodel(b).pose).toBe('idle');expect(inspectSourceViewmodel(b).time).toBe(0);
  startSourceInspection(a);updateSourceViewmodel(a,undefined,.1);expect(inspectSourceViewmodel(a).pose).toBe('inspect');
  updateSourceViewmodel(a,undefined,.1,true);expect(inspectSourceViewmodel(a).pose).toBe('idle');
  updateSourceViewmodel(a,{alive:true,reload:1,shotIdle:9}as Player,.1);expect(inspectSourceViewmodel(a).pose).toBe('reload');
  disposeSourceViewmodel(a);sampleSourceViewmodel(b,'inspect',3);expect(inspectSourceViewmodel(b).time).toBe(3);disposeSourceViewmodel(b);disposeSourceViewmodel(t);
 });
 it('rejects mixed T skeletons instead of silently displaying T bare arms',()=>{
  expect(()=>prepareSourceM4A4Viewmodel(tgltf)).toThrow(/identity/);
 });
});
