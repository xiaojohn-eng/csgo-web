import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {awpCharacterFixture,readAWPCharacterJson} from './source-awp-character-fixture';
import {createSourceAWPCharacterHitboxes} from '../game/source-awp-character-hitboxes';
const browser=(v:number[])=>({x:v[0]*.0254,y:v[2]*.0254,z:-v[1]*.0254});
it('matches original server OBB instructions on 4092 AWP rays including full reload poses',()=>{
 const oracle=readAWPCharacterJson('output/tests/source-awp-character-hitbox-native.json'),tiePath='output/tests/source-awp-character-hitbox-ties-native.json',ties=existsSync(tiePath)?readAWPCharacterJson(tiePath):[];
 let rays=0,layered=0,maxError=0;const requests:{profile:string;sample:number;target:number;actual:number;expected:number}[]=[];
 expect(oracle.serverSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');
 for(const team of ['t','ct']as const){
  const f=awpCharacterFixture(team),profile=team+'-awp',actor=oracle.actors.find((a:{profile:string})=>a.profile===profile),provider=createSourceAWPCharacterHitboxes(f.index,f.version);
  expect(createHash('sha256').update(readFileSync(f.folder+'/body-pose-data.json')).digest('hex')).toBe(actor.dataSha256);
  for(const ray of oracle.rays.filter((r:{profile:string})=>r.profile===profile)){
   const input=actor.samples[ray.sample],origin=browser(ray.start),end=browser(ray.end),length=Math.hypot(end.x-origin.x,end.y-origin.y,end.z-origin.z);
   const pose={x:0,y:0,z:0,yaw:-Math.PI/2,pitch:0,crouch:input.body.state.startsWith('Crouch'),weapon:'awp',team:team==='t'?'amber':'blue',sourcePoseVersion:f.version,sourceAWPPose:input};
   const hit=provider.raycast(pose as never,origin,{x:(end.x-origin.x)/length,y:(end.y-origin.y)/length,z:(end.z-origin.z)/length},length);
   expect(hit?.group,`${profile}/${ray.sample}/${ray.targetHitbox}`).toBe(ray.original.group);expect(hit?.head).toBe(ray.original.group===1);
   maxError=Math.max(maxError,Math.abs(hit!.distance-ray.original.fraction*length));rays++;if(input.bodyLayers?.length)layered++;
   if(hit?.hitbox!==ray.original.hitbox)requests.push({profile,sample:ray.sample,target:ray.targetHitbox,actual:hit!.hitbox!,expected:ray.original.hitbox});
  }
 }
 writeFileSync('output/tests/source-awp-character-hitbox-tie-requests.json',JSON.stringify(requests,null,2)+'\n');
 for(const request of requests){const proof=ties.find((t:typeof request)=>Object.keys(request).every(k=>t[k as keyof typeof request]===request[k as keyof typeof request]));expect(proof,JSON.stringify(request)).toBeDefined();expect(proof.sameGroup).toBe(true);expect(proof.fractionUlpDifference).toBeLessThanOrEqual(2);}
 // Original CPU matrices/intersections use float32; this corpus's independent
 // mathutils world-matrix rounding reaches 1.82 micrometres after unit scale.
 // Groups/head are exact; distance is explicitly bounded to 2 micrometres.
 expect(rays).toBe(4092);expect(layered).toBe(3960);expect(maxError).toBeLessThan(2e-6);
 writeFileSync('output/awp-character-hitbox-verification.json',JSON.stringify({status:'passed-original-native-awp-hitboxes',rays,layeredRays:layered,maximumDistanceErrorMeters:maxError,sameGroupHitboxIDBoundaries:requests.length,identicalNativeFractionTies:ties.filter((t:{identicalNativeFraction:boolean})=>t.identicalNativeFraction).length,maximumNativeBoundaryUlpDifference:Math.max(0,...ties.map((t:{fractionUlpDifference:number})=>t.fractionUlpDifference)),sourceServerSHA256:oracle.serverSha256},null,2)+'\n');
});
it('rejects missing complete pose, wrong weapon/team and old animation identity',()=>{
 const f=awpCharacterFixture('t'),provider=createSourceAWPCharacterHitboxes(f.index,f.version),pose={x:0,y:0,z:0,yaw:0,pitch:0,crouch:false,weapon:'awp',team:'amber',sourcePoseVersion:f.version,sourceAWPPose:f.reference.cases[70].input},origin={x:1,y:1,z:0},direction={x:-1,y:0,z:0};
 expect(()=>provider.raycast({...pose,sourceAWPPose:undefined}as never,origin,direction,10)).toThrow(/complete AWP/);
 expect(()=>provider.raycast({...pose,weapon:'deagle'}as never,origin,direction,10)).toThrow(/identity/);
 expect(()=>provider.raycast({...pose,team:'blue'}as never,origin,direction,10)).toThrow(/identity/);
 expect(()=>provider.raycast({...pose,sourcePoseVersion:'stale'}as never,origin,direction,10)).toThrow(/version/);
});
