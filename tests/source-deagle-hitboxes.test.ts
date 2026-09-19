import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {createSourceDeagleHitboxes} from '../game/source-deagle-hitboxes';
import type {SourceDeagleCharacterPoseInput} from '../game/source-deagle-character-pose';
import {deagleRuntimeFixture,readDeagleJson} from './source-deagle-runtime-fixture';
const browser=(v:number[])=>({x:v[0]*.0254,y:v[2]*.0254,z:-v[1]*.0254});
it('reuses native CPU hit evidence only after proving identical original T/CT body bytes and graph, including reload layers',()=>{
 const oracle=readDeagleJson('output/tests/source-pistol-hitbox-native.json'),ties=readDeagleJson('output/tests/source-pistol-hitbox-ties-native.json');
 let rays=0,layered=0,maxError=0;const mismatches:unknown[]=[];
 for(const team of ['t','ct']as const){
  const {index,version,data,folder}=deagleRuntimeFixture(team),profile=`${team}-glock`,actor=oracle.actors.find((a:{profile:string})=>a.profile===profile);
  const original=readDeagleJson(`.reference-assets/source-exports/pistol-candidates/character-${profile}/body-pose-data.json`);
  // World weapon identity differs; the native player OBB corpus is applicable
  // only because every consumed original body transform and hitbox byte agrees.
  for(const key of ['frames','mainBones','animationBones','mainToAnimation','sequences','descriptors','hitboxSets','states'])expect(data[key]).toEqual(original[key]);
  expect(createHash('sha256').update(readFileSync(folder+'/body-frames.f64.bin')).digest('hex')).toBe(original.frames.sha256);
  const provider=createSourceDeagleHitboxes(index,version);
  for(const r of oracle.rays.filter((r:{profile:string})=>r.profile===profile)){
   const input=actor.samples[r.sample]as SourceDeagleCharacterPoseInput;
   if(input.bodyLayers?.some(l=>l.sequence!=='Reload_PISTOL')||input.world.layers?.some(l=>!index.world.named.has(l.sequence)))continue;
   const origin=browser(r.start),end=browser(r.end),length=Math.hypot(end.x-origin.x,end.y-origin.y,end.z-origin.z);
   const p={x:0,y:0,z:0,yaw:-Math.PI/2,pitch:0,crouch:input.body.state.startsWith('Crouch'),weapon:'deagle',team:team==='t'?'amber':'blue',sourcePoseVersion:version,sourcePistolPose:input};
   const h=provider.raycast(p as never,origin,{x:(end.x-origin.x)/length,y:(end.y-origin.y)/length,z:(end.z-origin.z)/length},length);
   expect(h?.group,`${profile}/${r.sample}/${r.targetHitbox}`).toBe(r.original.group);
   if(h?.hitbox!==r.original.hitbox)mismatches.push({profile,sample:r.sample,target:r.targetHitbox,actual:h?.hitbox,expected:r.original.hitbox});
   maxError=Math.max(maxError,Math.abs(h!.distance-r.original.fraction*length));rays++;if(input.bodyLayers?.length)layered++;
  }
 }
 expect(rays).toBeGreaterThan(400);expect(layered).toBeGreaterThan(100);expect(maxError).toBeLessThan(1e-6);
 for(const mismatch of mismatches)expect(ties).toContainEqual(expect.objectContaining({...mismatch as object,identicalNativeFraction:true,sameGroup:true}));
});
it('rejects missing complete Deagle pose, cross-weapon/team state and stale animation identity',()=>{
 const {index,version,at}=deagleRuntimeFixture('t'),provider=createSourceDeagleHitboxes(index,version),p=at(10.5),origin={x:1,y:1,z:0},direction={x:-1,y:0,z:0};
 expect(()=>createSourceDeagleHitboxes({...index,weapon:'glock'}as never,version)).toThrow(/Deagle graph/);
 expect(()=>provider.raycast({...p,sourcePistolPose:undefined}as never,origin,direction,10)).toThrow(/complete Deagle/);
 expect(()=>provider.raycast({...p,weapon:'glock'}as never,origin,direction,10)).toThrow(/identity/);
 expect(()=>provider.raycast({...p,team:'blue'}as never,origin,direction,10)).toThrow(/identity/);
 expect(()=>provider.raycast({...p,sourcePoseVersion:'old'}as never,origin,direction,10)).toThrow(/version/);
});
