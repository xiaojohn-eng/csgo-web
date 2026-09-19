import fs from 'node:fs';import {beforeAll,expect,it} from 'vitest';
import {prepareSourceCharacterPose,type SourceCharacterPoseIndex} from '../game/source-character-pose';
import {createSourceHitboxes} from '../game/source-hitboxes';
import type {SourceActorPose} from '../game/source-player-contract';
const available=fs.existsSync('output/tests/source-hitbox-native.json');const test=available?it:it.skip;
let oracle:any;const indices=new Map<string,SourceCharacterPoseIndex>();
beforeAll(()=>{if(!available)return;oracle=JSON.parse(fs.readFileSync('output/tests/source-hitbox-native.json','utf8'));
 for(const team of ['t','ct']){const folder=`.reference-assets/source-exports/character-${team}/continuous`;
  indices.set(team,prepareSourceCharacterPose(JSON.parse(fs.readFileSync(`${folder}/pose-data.json`,'utf8')),fs.readFileSync(`${folder}/frames.f64.bin`)));}
});
const browser=(v:number[])=>({x:v[0]*.0254,y:v[2]*.0254,z:-v[1]*.0254});
test('matches actual App740 CPU groups and distances for 440 original T/CT rays, preserving only native-proven coincident surface ambiguity',()=>{
 let maxError=0,coincident=0;for(const actor of oracle.actors){const index=indices.get(actor.team)!,version=actor.dataSha256,provider=createSourceHitboxes(index,version);
  for(const ray of oracle.rays.filter((r:any)=>r.team===actor.team)){
   const origin=browser(ray.start),end=browser(ray.end),range=Math.hypot(end.x-origin.x,end.y-origin.y,end.z-origin.z);
   const p={x:0,y:0,z:0,yaw:-Math.PI/2,pitch:0,crouch:false,sourcePose:actor.samples[ray.sample],sourcePoseVersion:version} satisfies SourceActorPose;
   const hit=provider.raycast(p,origin,{x:(end.x-origin.x)/range,y:(end.y-origin.y)/range,z:(end.z-origin.z)/range},range);
   if(hit?.hitbox!==ray.original.hitbox){
    const tie=oracle.coincidentFloat32Surfaces.find((v:any)=>v.team===actor.team&&v.sample===ray.sample&&v.targetHitbox===ray.targetHitbox);
    expect(tie,`${actor.team} sample${ray.sample} target${ray.targetHitbox}`).toBeDefined();
    expect(tie.originalIndividualHitboxes).toContain(hit?.hitbox);expect(tie.individual[0].fraction).toBe(tie.individual[1].fraction);coincident++;
   }
   expect(hit?.head).toBe(ray.original.group===1);maxError=Math.max(maxError,Math.abs(hit!.distance-ray.original.fraction*range));
  }}expect(maxError).toBeLessThan(1e-6);expect(coincident).toBeLessThanOrEqual(1);console.log('Original CPU maximum hit distance error metres',maxError,'native-coincident surface IDs',coincident);
});
test('applies actor root/yaw without changing the original relative hit result or contaminating another actor',()=>{
 for(const actor of oracle.actors){const provider=createSourceHitboxes(indices.get(actor.team)!,actor.dataSha256);
  for(const yaw of [0,.7,2.4]){const position={x:-31,y:-3.2,z:62},angle=yaw+Math.PI/2,c=Math.cos(angle),s=Math.sin(angle);
   const transform=(source:number[])=>{const v=browser(source);return{x:position.x+c*v.x+s*v.z,y:position.y+v.y,z:position.z-s*v.x+c*v.z};};
   const ray=oracle.rays.find((r:any)=>r.team===actor.team&&r.sample===5&&r.targetHitbox===11),a=transform(ray.start),b=transform(ray.end),range=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
   const pose={...position,yaw,pitch:0,crouch:true,sourcePose:actor.samples[5],sourcePoseVersion:actor.dataSha256};
   const before=JSON.stringify(pose),hit=provider.raycast(pose,a,{x:(b.x-a.x)/range,y:(b.y-a.y)/range,z:(b.z-a.z)/range},range);
   expect(hit?.hitbox).toBe(ray.original.hitbox);expect(hit?.distance).toBeCloseTo(ray.original.fraction*range,5);expect(JSON.stringify(pose)).toBe(before);
  }}
});
test('respects a nearer world limit and rejects a ray aimed above the original actor',()=>{
 for(const actor of oracle.actors){const provider=createSourceHitboxes(indices.get(actor.team)!,actor.dataSha256);
  const pose={x:0,y:0,z:0,yaw:-Math.PI/2,pitch:0,crouch:false,sourcePose:actor.samples[0],sourcePoseVersion:actor.dataSha256};
  const ray=oracle.rays.find((r:any)=>r.team===actor.team&&r.sample===0&&r.targetHitbox===11),a=browser(ray.start),b=browser(ray.end),range=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
  expect(provider.raycast(pose,a,{x:(b.x-a.x)/range,y:(b.y-a.y)/range,z:(b.z-a.z)/range},.1)).toBeNull();
  expect(provider.raycast(pose,browser([-100,0,200]),{x:1,y:0,z:0},10)).toBeNull();
 }
});
test('rejects wrong pose identity and unverified capsule metadata before claiming a hit',()=>{
 const index=indices.get('t')!,provider=createSourceHitboxes(index,'expected');
 expect(()=>provider.raycast({x:0,y:0,z:0,yaw:0,pitch:0,crouch:false,sourcePose:oracle.actors[0].samples[0],sourcePoseVersion:'other'},browser([0,0,0]),{x:1,y:0,z:0},10)).toThrow('version mismatch');
 const old=index.data.hitboxSets[0].hitboxes[0].sourceBytesHex,bytes=Buffer.from(old,'hex');bytes.writeFloatLE(1,48);
 const clone={...index,data:{...index.data,hitboxSets:[{...index.data.hitboxSets[0],hitboxes:[{...index.data.hitboxSets[0].hitboxes[0],sourceBytesHex:bytes.toString('hex')}]}]}};
 expect(()=>createSourceHitboxes(clone,'expected')).toThrow('verified OBB');expect(index.data.hitboxSets[0].hitboxes[0].sourceBytesHex).toBe(old);
});
