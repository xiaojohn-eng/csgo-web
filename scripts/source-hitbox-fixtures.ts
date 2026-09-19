import fs from 'node:fs';import {createHash} from 'node:crypto';
import {prepareSourceCharacterPose,sampleSourceCharacterPose,type SourceCharacterPoseInput} from '../game/source-character-pose.js';
const actors=[];
for(const team of ['t','ct']){
 const folder=`.reference-assets/source-exports/character-${team}/continuous`,raw=fs.readFileSync(`${folder}/pose-data.json`);
 const index=prepareSourceCharacterPose(JSON.parse(raw.toString()),fs.readFileSync(`${folder}/frames.f64.bin`));
 const states=['Idle','Walk','Run','Crouch_Idle','Crouch_Walk'] as const;
 const samples=states.flatMap((state,i)=>[.17,.83].map((cycle,j)=>{
  const input:SourceCharacterPoseInput={state,cycle,upperCycle:cycle*.7,parameters:{move_x:j?.707:1,move_y:j?-.707:0,body_yaw:i*9-18,body_pitch:j?32:-21},fireCycle:.31,fireWeight:j,blendMode:'sdk-3way'};
  return {input,sourceWorldMatrices:[...sampleSourceCharacterPose(index,input).sourceWorldMatrices]};
 }));
 actors.push({team,dataSha256:createHash('sha256').update(raw).digest('hex'),hitboxes:index.data.hitboxSets[0].hitboxes,boneCount:index.mainBoneCount,samples});
}
fs.writeFileSync('output/tests/source-hitbox-input.json',JSON.stringify({actors}));console.log('T/CT original samples',actors.map(a=>({team:a.team,bones:a.boneCount,samples:a.samples.length})));
