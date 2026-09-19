// Independent Three readback of the private source CT + world AK composite.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {AnimationMixer, LoopOnce, Matrix4, Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import validator from 'gltf-validator';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'.reference-assets/source-exports/character-ct-ak');
const audit=JSON.parse(await fs.readFile(path.join(dir,'audit.json'),'utf8'));
assert.equal(audit.status,'passed_conversion_checks_grip_and_final_material_pending');
const bytes=await fs.readFile(path.join(dir,audit.glb.file));
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),audit.glb.sha256);
const validation=await validator.validateBytes(new Uint8Array(bytes),{maxIssues:100});
assert.equal(validation.issues.numErrors,0,JSON.stringify(validation.issues));
const size=bytes.readUInt32LE(12), doc=JSON.parse(bytes.subarray(20,20+size).toString()), bin=bytes.subarray(28+size);
assert.equal(bytes.readUInt32LE(8),bytes.length);assert.equal(doc.skins.length,2);
assert(doc.materials.every(m=>m.extensions?.KHR_materials_unlit&&m.pbrMetallicRoughness.baseColorTexture));
for(const material of doc.materials){
 const source=audit.materials.find(m=>m.name===material.name)?.textures.find(t=>t.parameter==='$basetexture');assert(source);
 const image=doc.images[doc.textures[material.pbrMetallicRoughness.baseColorTexture.index].source];
 const view=doc.bufferViews[image.bufferView],embedded=bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);
 assert.equal(crypto.createHash('sha256').update(embedded).digest('hex'),source.pngSha256,'Embedded reference PNG must remain byte-identical to original VTF decode');
}
const cpu=structuredClone(doc);
cpu.materials=(cpu.materials??[]).map(m=>({name:m.name}));
delete cpu.images;delete cpu.textures;delete cpu.extensionsRequired;delete cpu.extensionsUsed;
cpu.buffers=[{byteLength:bin.byteLength,uri:`data:application/octet-stream;base64,${bin.toString('base64')}`}];
globalThis.ProgressEvent??=class {constructor(type,data){this.type=type;Object.assign(this,data)}};
const gltf=await new GLTFLoader().parseAsync(JSON.stringify(cpu),'');
const byNode=new Map();
for(const [obj,association]of gltf.parser.associations)if(association.nodes!==undefined)byNode.set(association.nodes,obj);
const C=new Matrix4().set(1,0,0,0, 0,0,1,0, 0,-1,0,0, 0,0,0,1), Ci=C.clone().invert();
const mat=rows=>new Matrix4().set(...rows.flat());
const key=(x,y,z)=>[x,y,z].map(v=>v.toFixed(5)).join(',');
const models={};let maxInverseBindError=0;
for(const field of ['character','weapon']){
 const defs=audit[field+'Bones'],skin=doc.skins.find(s=>s.joints.length===defs.length);assert(skin);
 const bones=new Map(skin.joints.map(n=>[doc.nodes[n].name,byNode.get(n)]));assert.equal(bones.size,defs.length);
 const inverses=new Map(defs.map(b=>[b.name,mat([...Array.from({length:3},(_,r)=>b.inverse.map(col=>col[r])),[0,0,0,1]])]));
 const meshes=[],bindVertices=new Map();
 gltf.scene.traverse(obj=>{
  if(!obj.isSkinnedMesh||obj.skeleton.bones.length!==defs.length)return;meshes.push(obj);
  for(let i=0;i<obj.skeleton.bones.length;i++){
   const name=[...bones].find(([,bone])=>bone===obj.skeleton.bones[i])?.[0];assert(name);
   const expected=inverses.get(name).clone().multiply(Ci),actual=obj.skeleton.boneInverses[i];
   maxInverseBindError=Math.max(maxInverseBindError,...expected.elements.map((v,j)=>Math.abs(v-actual.elements[j])));
  }
  const p=obj.geometry.getAttribute('position');
  for(let i=0;i<p.count;i++){
   const k=key(p.getX(i),p.getY(i),p.getZ(i));
   if(!bindVertices.has(k))bindVertices.set(k,[]);bindVertices.get(k).push({obj,index:i});
  }
 });
 assert(meshes.length>0);models[field]={defs,bones,inverses,meshes,bindVertices};
}
assert.equal(maxInverseBindError,0,'Both independent source bind palettes must be exact');
const results=[],actualPoint=new Vector3(),expectedPoint=new Vector3(),scratchPoint=new Vector3();
for(const check of audit.clipChecks){
 const clip=gltf.animations.find(a=>a.name===check.name);assert(clip);
 assert(Math.abs(clip.duration-check.duration)<1e-5);
 assert.equal(Math.min(...clip.tracks.map(t=>t.times[0])),0);
 const mixer=new AnimationMixer(gltf.scene), action=mixer.clipAction(clip);
 action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
 let maxBoneError=0,maxVertexError=0,boneSamples=0,vertexSamples=0,maxCommonBoneError=0;
 for(const sample of check.samples){
  mixer.setTime(Math.min(sample.seconds,clip.duration));gltf.scene.updateMatrixWorld(true);
  for(const [field,model]of Object.entries(models)){
   const sourceWorld=new Map(Object.entries(sample[field]).map(([name,rows])=>[name,mat(rows)]));
   for(const [name,world]of sourceWorld){
    const expected=C.clone().multiply(world),actual=model.bones.get(name);assert(actual?.isBone);
    maxBoneError=Math.max(maxBoneError,...expected.elements.map((v,j)=>Math.abs(v-actual.matrixWorld.elements[j])));boneSamples++;
   }
   for(const v of audit.bindVertexSamples[field]){
    const [x,y,z]=v.position,candidates=model.bindVertices.get(key(x,z,-y));assert(candidates?.length,`Missing bind vertex ${field}/${v.mesh}/${v.index}`);
    expectedPoint.set(0,0,0);
    for(const [name,weight]of Object.entries(v.weights)){
     scratchPoint.fromArray(v.position).applyMatrix4(model.inverses.get(name)).applyMatrix4(sourceWorld.get(name));
     expectedPoint.addScaledVector(scratchPoint,weight);
    }
    expectedPoint.applyMatrix4(C);let best=Infinity;
    for(const {obj,index}of candidates){
     actualPoint.fromBufferAttribute(obj.geometry.getAttribute('position'),index);obj.applyBoneTransform(index,actualPoint);obj.localToWorld(actualPoint);
     best=Math.min(best,actualPoint.distanceTo(expectedPoint));
    }
    maxVertexError=Math.max(maxVertexError,best);vertexSamples++;
   }
  }
  for(const name of audit.boneMerge.commonNames){
   const a=models.character.bones.get(name).matrixWorld,b=models.weapon.bones.get(name).matrixWorld;
   maxCommonBoneError=Math.max(maxCommonBoneError,...a.elements.map((v,i)=>Math.abs(v-b.elements[i])));
  }
 }
 mixer.stopAllAction();mixer.uncacheRoot(gltf.scene);
 assert(maxBoneError<.002,`Bone matrix mismatch ${check.name}: ${maxBoneError}`);
 assert(maxVertexError<.002,`Original weighted source vertex mismatch ${check.name}: ${maxVertexError}`);
 assert(maxCommonBoneError<.002,`Bone-merge mismatch ${check.name}: ${maxCommonBoneError}`);
 results.push({name:check.name,duration:clip.duration,boneSamples,vertexSamples,maxBoneError,maxVertexError,maxCommonBoneError,
  sourceLeftGripGapMin:check.leftGripGapMin,sourceLeftGripGapMax:check.leftGripGapMax});
}
const report={status:'passed_conversion_readback_only',scope:'Independent Three CPU GLB animation, two original IBM palettes and weighted vertex readback',
 sha256:audit.glb.sha256,maxInverseBindError,clips:results,validation:validation.issues,
 limitations:['CPU loader omits materials only; final GPU Source Phong rendering remains separate.','Bone merge tested by source name; original client hand IK and locomotion rules remain unimplemented.','Left grip gaps are recorded evidence, not a passed two-hand-grip check.','SDK three-way and bilinear pose branches are explicit; App740 compiled anim_3wayblend default1 independently confirmed; runtime override unobserved. CT beret jiggle dynamics not implemented.']};
await fs.writeFile(path.join(dir,'three-readback.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
