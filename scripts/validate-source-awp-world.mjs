/** All 445 original frames, 94 raw float32 IBMs and 14 attachment matrices. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {AnimationMixer,LoopOnce,Vector3,Quaternion,Matrix4} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import validator from 'gltf-validator';
const dir=path.resolve(process.argv[2]??'.reference-assets/source-exports/awp-candidates/awp-world');
const json=async name=>JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));
const audit=await json('audit.json'),data=await json('continuous/pose-data.json'),frames=await json('continuous/original-frames.json');
assert.equal(data.sourceModel,'models/weapons/w_snip_awp.mdl');assert.equal(data.bones.length,94);
const bytes=await fs.readFile(audit.glb.path),sha=crypto.createHash('sha256').update(bytes).digest('hex');assert.equal(sha,audit.glb.sha256);
const validation=await validator.validateBytes(new Uint8Array(bytes),{maxIssues:100});assert.equal(validation.issues.numErrors,0);
const size=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+size).toString()),binary=bytes.subarray(28+size),cpu=structuredClone(doc);
cpu.materials=cpu.materials.map(m=>({name:m.name}));delete cpu.images;delete cpu.textures;delete cpu.extensionsUsed;delete cpu.extensionsRequired;
cpu.buffers=[{byteLength:binary.byteLength,uri:'data:application/octet-stream;base64,'+binary.toString('base64')}];
globalThis.ProgressEvent??=class{constructor(type,data){Object.assign(this,{type},data);}};
const gltf=await new GLTFLoader().parseAsync(JSON.stringify(cpu),''),byNode=new Map();
for(const[o,a]of gltf.parser.associations)if(a.nodes!==undefined)byNode.set(a.nodes,o);
assert.equal(doc.skins.length,1);const skin=doc.skins[0];assert.equal(skin.joints.length,94);
const bones=new Map(skin.joints.map(n=>[doc.nodes[n].name,byNode.get(n)])),attachments=new Map();
gltf.scene.traverse(o=>{if(o.userData.source_attachment){assert(o.parent.isBone);assert(!attachments.has(o.userData.source_attachment.name));attachments.set(o.userData.source_attachment.name,o);}});
assert.equal(attachments.size,14);
const c=new Matrix4().set(1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1),unit=new Vector3(1,1,1);
const difference=(a,b)=>Math.max(...a.elements.map((v,i)=>Math.abs(v-b.elements[i])));
const result={sourceFrames:0,boneMatrices:0,attachmentMatrices:0,maxBoneMatrixErrorSourceUnits:0,maxAttachmentMatrixErrorSourceUnits:0,inverseBindMatrices:0};
for(const[name,original]of Object.entries(frames)){
 const check=Object.values(audit.clip_checks).find(c=>c.sequence===name),clip=gltf.animations.find(c=>c.name===check.action_name);
 assert(clip);assert(Math.abs(clip.duration-(original.frames-1)/original.fps)<1e-5);
 const mixer=new AnimationMixer(gltf.scene),action=mixer.clipAction(clip);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
 for(let f=0;f<original.frames;f++){
  mixer.setTime(Math.min(f/original.fps,clip.duration));gltf.scene.updateMatrixWorld(true);const worlds=[];
  for(let i=0;i<data.bones.length;i++){
   const b=data.bones[i],local=new Matrix4().compose(new Vector3(...original.positions[f][i]),new Quaternion(...original.quaternionsXYZW[f][i]).normalize(),unit);
   worlds.push(b.parent<0?local:worlds[b.parent].clone().multiply(local));
   result.maxBoneMatrixErrorSourceUnits=Math.max(result.maxBoneMatrixErrorSourceUnits,difference(c.clone().multiply(worlds[i]),bones.get(b.name).matrixWorld));result.boneMatrices++;
  }
  for(const a of data.attachments){
   const local=new Matrix4().set(...a.matrix,0,0,0,1),expected=c.clone().multiply(worlds[a.parent_bone]).multiply(local).multiply(c.clone().invert());
   const error=difference(expected,attachments.get(a.name).matrixWorld);result.maxAttachmentMatrixErrorSourceUnits=Math.max(result.maxAttachmentMatrixErrorSourceUnits,error);result.attachmentMatrices++;
  }
  result.sourceFrames++;
 }
 mixer.stopAllAction();mixer.uncacheRoot(gltf.scene);
}
const accessor=doc.accessors[skin.inverseBindMatrices],view=doc.bufferViews[accessor.bufferView];assert.equal(accessor.componentType,5126);assert.equal(accessor.type,'MAT4');assert(!view.byteStride);
for(let i=0;i<skin.joints.length;i++){
 const bone=data.bones.find(b=>b.name===doc.nodes[skin.joints[i]].name);
 for(let j=0;j<16;j++)assert.equal(binary.readFloatLE((view.byteOffset??0)+(accessor.byteOffset??0)+i*64+j*4),Math.fround(bone.inverseBindGltf[j]));
 result.inverseBindMatrices++;
}
assert.equal(result.sourceFrames,445);assert.equal(result.boneMatrices,41830);assert.equal(result.attachmentMatrices,6230);assert.equal(result.inverseBindMatrices,94);
assert(result.maxBoneMatrixErrorSourceUnits<.003);assert(result.maxAttachmentMatrixErrorSourceUnits<.003);
const report={status:'passed',glbSha256:sha,scope:'Independent Three CPU readback of all original AWP world frames and raw IBMs',...result,validation:validation.issues,limitations:['GPU materials, scope optics and player bone merge are separate.']};
await fs.writeFile(path.join(dir,'dense-readback.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
