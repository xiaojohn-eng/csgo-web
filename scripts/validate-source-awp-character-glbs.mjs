/** Original combined body/world binary segments, exact IBMs and glTF schema. */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import validator from 'gltf-validator';
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
for(const team of ['t','ct']){
 const folder=`.reference-assets/source-exports/awp-character-candidates/character-${team}-awp`,read=async name=>JSON.parse(await fs.readFile(folder+'/'+name,'utf8'));
 const a=await read('assembly-readback.json'),rig=await read('rig.json'),body=await read('body-pose-data.json'),world=await read('world-pose-data.json'),raw=await fs.readFile(folder+'/character.glb');
 assert.equal(sha(raw),a.modelSHA256);const size=raw.readUInt32LE(12),doc=JSON.parse(raw.subarray(20,20+size).toString()),bin=raw.subarray(28+size);
 assert.equal(doc.animations?.length??0,0);assert.equal(doc.skins.length,2);assert.equal(rig.boneMerge.length,3);assert.equal(rig.attachments.length,14);
 for(const segment of a.binarySegments)assert.equal(sha(bin.subarray(segment.offset,segment.offset+segment.bytes)),segment.sha256);
 let count=0;for(const role of ['body','world']){
  const map=rig.mappings[role],skin=doc.skins[map.skinIndex],defs=role==='body'?body.mainBones:world.bones,accessor=doc.accessors[skin.inverseBindMatrices],view=doc.bufferViews[accessor.bufferView];assert.equal(accessor.componentType,5126);assert.equal(accessor.type,'MAT4');assert(!view.byteStride);
  for(const j of map.joints){assert.equal(skin.joints[j.skinJoint],j.gltfNode);assert.equal(doc.nodes[j.gltfNode].name,defs[j.bone].name);for(let c=0;c<16;c++)assert.equal(bin.readFloatLE((view.byteOffset??0)+(accessor.byteOffset??0)+j.skinJoint*64+c*4),defs[j.bone].inverseBindGltf[c]);count++;}
 }
 assert.equal(count,team==='t'?165:168);const result=await validator.validateBytes(new Uint8Array(raw),{maxIssues:10000});assert.equal(result.issues.numErrors,0);
 const report={status:'passed-original-awp-character-glb',team,modelSHA256:sha(raw),exactOriginalIBM:count,originalBinarySegments:a.binarySegments,validation:result.issues,limitations:['Numeric asset/schema verification; actual GPU material acceptance remains separate.']};
 await fs.writeFile(folder+'/gltf-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,originalBinarySegments:undefined,validation:{errors:result.issues.numErrors,warnings:result.issues.numWarnings}}));
}
