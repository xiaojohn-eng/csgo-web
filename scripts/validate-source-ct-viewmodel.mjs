/** Independent original T-AK vs CT-AK bytes and actual Three skin playback. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const root='.reference-assets/source-exports/',dir=root+'ak47-ct-arms/';
execFileSync(process.execPath,['scripts/validate-source-weapon.mjs',dir],{stdio:'ignore'});
const audit=JSON.parse(await fs.readFile(dir+'audit.json','utf8'));
const metadata=JSON.parse(await fs.readFile(dir+'ct-metadata.json','utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function parse(folder){
 const bytes=await fs.readFile(folder+'v_rif_ak47-with-arms-source-unit.glb'),size=bytes.readUInt32LE(12);
 const doc=JSON.parse(bytes.subarray(20,20+size)),bin=bytes.subarray(28+size);
 const accessor=i=>{const a=doc.accessors[i],v=doc.bufferViews[a.bufferView];assert(!v.byteStride&&!a.sparse);
  const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16},components={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
  const at=(v.byteOffset??0)+(a.byteOffset??0);return bin.subarray(at,at+a.count*widths[a.type]*components[a.componentType]);};
 const cpu=structuredClone(doc);cpu.materials=(cpu.materials??[]).map(m=>({name:m.name}));delete cpu.images;delete cpu.textures;delete cpu.extensionsRequired;delete cpu.extensionsUsed;
 cpu.buffers=[{byteLength:bin.length,uri:'data:application/octet-stream;base64,'+bin.toString('base64')}];
 globalThis.ProgressEvent??=class{constructor(type,data){this.type=type;Object.assign(this,data);}};
 const gltf=await new GLTFLoader().parseAsync(JSON.stringify(cpu),'');
 const nodes=new Map();for(const [obj,a]of gltf.parser.associations)if(a.nodes!==undefined)nodes.set(a.nodes,obj);
 const weapon=doc.skins.find(s=>s.joints.some(j=>doc.nodes[j].name==='v_weapon.ak47_parent'));
 return {bytes,doc,accessor,gltf,nodes,weapon,weaponBones:new Map(weapon.joints.map(j=>[doc.nodes[j].name,nodes.get(j)]))};
}
const original=await parse(root+'ak47-arms/'),ct=await parse(dir);
assert.equal(hash(ct.bytes),audit.glb.sha256);
assert.equal(ct.weapon.joints.length,58);
assert.deepEqual(ct.accessor(ct.weapon.inverseBindMatrices),original.accessor(original.weapon.inverseBindMatrices),'AK IBM changed');
let weaponAccessors=1,weaponChannels=0;
function gunMeshes(g){return g.doc.nodes.filter(n=>n.skin===g.doc.skins.indexOf(g.weapon)&&n.mesh!==undefined).map(n=>g.doc.meshes[n.mesh]);}
const oldMeshes=gunMeshes(original),newMeshes=gunMeshes(ct);assert.equal(newMeshes.length,oldMeshes.length);
for(let i=0;i<oldMeshes.length;i++)for(let j=0;j<oldMeshes[i].primitives.length;j++){
 const a=oldMeshes[i].primitives[j],b=newMeshes[i].primitives[j];
 for(const key of Object.keys(a.attributes)){assert.deepEqual(ct.accessor(b.attributes[key]),original.accessor(a.attributes[key]),'AK '+key);weaponAccessors++;}
 assert.deepEqual(ct.accessor(b.indices),original.accessor(a.indices),'AK triangle winding/index');weaponAccessors++;
}
for(const animation of original.doc.animations){
 const other=ct.doc.animations.find(a=>a.name===animation.name);assert(other);
 for(const channel of animation.channels){if(!original.weapon.joints.includes(channel.target.node))continue;
  const name=original.doc.nodes[channel.target.node].name;
  const match=other.channels.find(c=>ct.weapon.joints.includes(c.target.node)&&ct.doc.nodes[c.target.node].name===name&&c.target.path===channel.target.path);assert(match);
  const a=animation.samplers[channel.sampler],b=other.samplers[match.sampler];
  assert.equal(b.interpolation,a.interpolation);
  assert.deepEqual(ct.accessor(b.input),original.accessor(a.input),'AK time bytes');
  assert.deepEqual(ct.accessor(b.output),original.accessor(a.output),'AK '+name+' '+channel.target.path);weaponChannels++;
 }
}
const armSkin=ct.doc.skins.find(s=>s.name==='ct_arms_idf_ARM');assert.equal(armSkin.joints.length,48);
const rawBones=new Map(metadata.bones.map(b=>[b.name,b]));
const ci=new T.Matrix4().set(1,0,0,0,0,0,-1,0,0,1,0,0,0,0,0,1),rawIBMs=[];
const ibmBytes=ct.accessor(armSkin.inverseBindMatrices),ibmView=new DataView(ibmBytes.buffer,ibmBytes.byteOffset,ibmBytes.byteLength);
for(let i=0;i<48;i++){
 const raw=rawBones.get(ct.doc.nodes[armSkin.joints[i]].name),m=new T.Matrix4().set(...raw.inverseBind.flat()).multiply(ci);rawIBMs.push(m);
 m.elements.forEach((v,j)=>assert.equal(ibmView.getFloat32(i*64+j*4,true),Math.fround(v),'CT original IBM'));
}
const armBones=armSkin.joints.map(j=>ct.nodes.get(j)),armMeshes=[];
ct.gltf.scene.traverse(o=>{if(o.isSkinnedMesh&&o.skeleton.bones.includes(armBones[0]))armMeshes.push(o);});
assert(armMeshes.length);
let maxMergeError=0,maxVertexError=0,maxAttachmentError=0,boneSamples=0,vertexSamples=0,sampledTimes=0;
const matDiff=(a,b)=>Math.max(...a.elements.map((v,i)=>Math.abs(v-b.elements[i]))),point=new T.Vector3(),expected=new T.Vector3(),part=new T.Vector3();
const attachments=g=>{const a=[];g.gltf.scene.traverse(o=>{if(o.userData.source_attachment)a.push(o);});return a;};
const oldAttachments=attachments(original),ctAttachments=attachments(ct);assert.equal(oldAttachments.length,ctAttachments.length);
for(const [kind,check]of Object.entries(audit.clip_checks)){
 const mixers=[original,ct].map(g=>{const m=new T.AnimationMixer(g.gltf.scene),clip=g.gltf.animations.find(c=>c.name===check.action_name),action=m.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();action.paused=true;return {m,action};});
 const times=Array.from({length:check.frame_count},(_,i)=>i/check.fps);times.push(check.duration_seconds*.173,check.duration_seconds*.519);
 for(const time of times){
  mixers.forEach(({m,action},i)=>{action.time=time;m.update(0);[original,ct][i].gltf.scene.updateMatrixWorld(true);});sampledTimes++;
  const transforms=armSkin.joints.map((j,i)=>{
   const weaponBone=ct.weaponBones.get(ct.doc.nodes[j].name);if(!weaponBone)return null;
   maxMergeError=Math.max(maxMergeError,matDiff(weaponBone.matrixWorld,armBones[i].matrixWorld));boneSamples++;
   return new T.Matrix4().multiplyMatrices(weaponBone.matrixWorld,rawIBMs[i]);
  });
  for(let i=0;i<oldAttachments.length;i++){
   assert.deepEqual(ctAttachments[i].userData.source_attachment,oldAttachments[i].userData.source_attachment);
   maxAttachmentError=Math.max(maxAttachmentError,matDiff(ctAttachments[i].matrixWorld,oldAttachments[i].matrixWorld));
  }
  for(const mesh of armMeshes){const pos=mesh.geometry.attributes.position,weights=mesh.geometry.attributes.skinWeight,joints=mesh.geometry.attributes.skinIndex;
   for(let v=0;v<pos.count;v+=17){point.fromBufferAttribute(pos,v);mesh.applyBoneTransform(v,point);mesh.localToWorld(point);expected.set(0,0,0);
    for(let k=0;k<4;k++){const w=weights.getComponent(v,k);if(!w)continue;const m=transforms[joints.getComponent(v,k)];assert(m,'Weighted unmatched CT bone');part.fromBufferAttribute(pos,v).applyMatrix4(m);expected.addScaledVector(part,w);}
    maxVertexError=Math.max(maxVertexError,point.distanceTo(expected));vertexSamples++;
   }
  }
 }
 mixers.forEach(({m},i)=>{m.stopAllAction();m.uncacheRoot([original,ct][i].gltf.scene);});
}
// Blender's baked CT locals are an approximation (~0.09 mm worst observed).
// Production applies exact original matching-bone merge after sampling; its
// independent stricter matrix/vertex gate is tests/source-ct-viewmodel.test.ts.
assert(maxMergeError<.003&&maxVertexError<.005&&maxAttachmentError<1e-6,JSON.stringify({maxMergeError,maxVertexError,maxAttachmentError}));
const report={status:'passed',sha256:audit.glb.sha256,skins:[58,48],exactCTInverseBindMatrices:48,weaponAccessorsByteEqual:weaponAccessors,weaponAnimationChannelsByteEqual:weaponChannels,
 sampledTimes,boneSamples,vertexSamples,maxMergeErrorSourceUnits:maxMergeError,maxVertexErrorSourceUnits:maxVertexError,maxOriginalAttachmentError:maxAttachmentError,
 scope:'Every original frame plus two interior times per clip; original AK geometry/index/IBM/animation bytes, CT raw IBM, actual Three bones and weighted vertices',
 limitations:['Baked CT local keys retain a measured sub-millimetre approximation; production uses exact matching-bone merge','GPU/material review remains required','Original client comparison remains unverified']};
await fs.writeFile(dir+'ct-readback.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
