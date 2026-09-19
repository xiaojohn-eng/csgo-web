import {readFileSync,writeFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {prepareSourceCharacterPose} from '../game/source-character-pose';
import {prepareSourcePistolCharacterPose,prepareSourcePistolWorldPose,type SourcePistolCharacterPoseIndex} from '../game/source-pistol-character-pose';
import {createSourcePistolHitboxes} from '../game/source-pistol-hitboxes';
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
let oracle:any;const indices=new Map<string,SourcePistolCharacterPoseIndex>();
beforeAll(()=>{oracle=read('output/tests/source-pistol-hitbox-native.json');
 for(const a of oracle.actors){const f=`.reference-assets/source-exports/pistol-candidates/character-${a.profile}`;
  indices.set(a.profile,prepareSourcePistolCharacterPose(prepareSourceCharacterPose(read(f+'/body-pose-data.json'),readFileSync(f+'/body-frames.f64.bin')),prepareSourcePistolWorldPose(read(f+'/world-pose-data.json'),readFileSync(f+'/world-frames.f64.bin'))));}
});
const browser=(v:number[])=>({x:v[0]*.0254,y:v[2]*.0254,z:-v[1]*.0254});
it('uses the same full pistol body layers as rendering and matches original CPU hits except native-proven equal-fraction arm boundaries',()=>{
 let maxError=0,layered=0;const mismatches:unknown[]=[];
 for(const a of oracle.actors){const provider=createSourcePistolHitboxes(indices.get(a.profile)!,a.dataSha256);
  for(const r of oracle.rays.filter((r:any)=>r.profile===a.profile)){
   const input=a.samples[r.sample],origin=browser(r.start),end=browser(r.end),length=Math.hypot(end.x-origin.x,end.y-origin.y,end.z-origin.z);
   const p={x:0,y:0,z:0,yaw:-Math.PI/2,pitch:0,crouch:input.body.state.startsWith('Crouch'),sourcePoseVersion:a.dataSha256,sourcePistolPose:input};
   const h=provider.raycast(p,origin,{x:(end.x-origin.x)/length,y:(end.y-origin.y)/length,z:(end.z-origin.z)/length},length);
   expect(h?.group,`${a.profile}/${r.sample}/${r.targetHitbox}`).toBe(r.original.group);
   if(h?.hitbox!==r.original.hitbox)mismatches.push({profile:a.profile,sample:r.sample,target:r.targetHitbox,actual:h?.hitbox,expected:r.original.hitbox});
   maxError=Math.max(maxError,Math.abs(h!.distance-r.original.fraction*length));
   if(input.bodyLayers.length)layered++;
  }
 }
 const ties=read('output/tests/source-pistol-hitbox-ties-native.json');
 for(const tie of ties){expect(tie.identicalNativeFraction&&tie.sameGroup).toBe(true);expect(tie.individual[0].original.fraction).toBe(tie.individual[1].original.fraction);}
 expect(layered).toBeGreaterThan(100);expect(maxError).toBeLessThan(1e-6);
 expect(mismatches).toEqual(ties.map(({profile,sample,target,actual,expected}:any)=>({profile,sample,target,actual,expected})));
 writeFileSync('output/tests/source-pistol-hitbox-validation.json',JSON.stringify({status:'passed-bounded-original-pistol-body-hitboxes',rays:oracle.rays.length,layeredRays:layered,maxDistanceErrorMetres:maxError,
  nativeCoincidentBoundaries:mismatches,scope:'All original hitgroups agree; listed arm pairs have identical original float32 fractions. No widened geometry epsilon or claim of bitwise SSE box-ID equality.'},null,2)+'\n');
});
it('rejects missing complete pistol state instead of silently using the rifle body sampler',()=>{
 const a=oracle.actors[0],provider=createSourcePistolHitboxes(indices.get(a.profile)!,a.dataSha256);
 const p={x:0,y:0,z:0,yaw:0,pitch:0,crouch:false,sourcePoseVersion:a.dataSha256,sourcePistolPose:undefined};
 expect(()=>provider.raycast(p as never,{x:1,y:1,z:0},{x:-1,y:0,z:0},10)).toThrow(/complete pistol/);
});
