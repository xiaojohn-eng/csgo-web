import {expect,it} from 'vitest';
import {characterHitVolumes,eyeOrigin,type CharacterPose} from '../game/character-contract';
import {falconBodyReferences} from '../game/falcon-body-reference';

const hitsPoint=(p:CharacterPose,q:number[])=>characterHitVolumes(p).some(s=>Math.hypot(q[0]-s.center.x,q[1]-s.center.y,q[2]-s.center.z)<=s.radius);
const hitsForwardRay=(p:CharacterPose,x:number,y:number)=>characterHitVolumes(p).some(s=>Math.hypot(x-s.center.x,y-s.center.y)<=s.radius);

it('covers the measured deep-crouch boot tip missed by the former root spheres',()=>{
 // Original C02 uniform vertex 10360, Reload .65s, blend1, pitch-1.5, yawPI/2.
 expect(hitsPoint({crouch:true,stancePhase:1,pitch:-1.5,yaw:Math.PI/2},[-.11726925398,.003697208,.20699433964])).toBe(true);
});

it('keeps real empty lower-leg lanes open instead of filling them with a root sphere',()=>{
 // 324 independent rays against actual posed C02 triangles were empty at these heights/X.
 for(const stancePhase of [0,.5,1])for(const pitch of [-1.5,0,1.5])for(const x of [-.025,0,.025])for(const y of [.06,.12,.18,.24]){
  expect(hitsForwardRay({crouch:stancePhase>0,stancePhase,pitch,yaw:0},x,y),`${stancePhase}/${pitch}/${x}/${y}`).toBe(false);
 }
});

it('does not join the two standing knees across an independently measured empty point',()=>{
 // Original posed triangles leave 31.177mm clearance at the midpoint; +X ray crosses 2 surfaces.
 expect(hitsPoint({crouch:false,stancePhase:0},[0,.496890243303,-.017072573857])).toBe(false);
});

it('covers the actual deep-crouch knee location rather than the actor root',()=>{
 expect(hitsPoint({crouch:true,stancePhase:1},[-.134336199,.424326276,-.293149760])).toBe(true);
});

it('covers the measured half-crouch mixed pelvis/thigh seam without closing the lower gap',()=>{
 // Original uniform vertex3, Reload .65s, blend.5, pitch+1.5, measured independently.
 expect(hitsPoint({crouch:true,stancePhase:.5,pitch:1.5},[.03476282381254315,.4998011618670592,.10655578572061924])).toBe(true);
 // Independent held-out Reload1.05s / blend.75 left seam vertex5063.
 expect(hitsPoint({crouch:true,stancePhase:.6736481776669303,pitch:.75},[-.00935539835879959,.3666310374990451,.0825963593752218])).toBe(true);
});

it('transforms body volumes with yaw and origin while preserving the head as index zero',()=>{
 const pose={crouch:true,stancePhase:.73,pitch:1.5,yaw:0},base=characterHitVolumes(pose);
 const rotated=characterHitVolumes({...pose,yaw:Math.PI/2,x:12,y:3,z:-7});
 expect(base[0].head).toBe(true);expect(base.filter(s=>s.head)).toHaveLength(1);
 expect(base.length).toBe(rotated.length);
 for(let i=0;i<base.length;i++){
  expect(rotated[i].center.x).toBeCloseTo(12+base[i].center.z,8);
  expect(rotated[i].center.y).toBeCloseTo(3+base[i].center.y,8);
  expect(rotated[i].center.z).toBeCloseTo(-7-base[i].center.x,8);
  expect(rotated[i].radius).toBe(base[i].radius);
 }
});

it('reconstructs a saved CharacterPose without reading or mutating present stance state',()=>{
 const past={crouch:true,stancePhase:1,pitch:-1.5,yaw:1,x:4,y:2,z:3};
 const copy=structuredClone(past),before=characterHitVolumes(past),eye=eyeOrigin(past);
 const current={...past,stancePhase:0,pitch:1.5};characterHitVolumes(current);
 expect(characterHitVolumes(past)).toEqual(before);expect(past).toEqual(copy);expect(eyeOrigin(past)).toEqual(eye);
});

it('reconstructs original C02 deep-crouch knee bones while both original ankle anchors stay planted',()=>{
 // Independent original GLTFLoader + ACTION03 Idle0 pose readback, no helper-derived expectation.
 const legs=falconBodyReferences({yaw:0,pitch:0,blend:1}).legs;
 const expected=[[-.13390323322623512,.3922947746775908,-.25488410482555224],
  [.1339031549705853,.3922949051040962,-.2548843444539134]];
 for(let i=0;i<2;i++)for(let axis=0;axis<3;axis++)expect(legs[i].knee[axis]).toBeCloseTo(expected[i][axis],5);
 expect(legs[0].ankle).toEqual([-.116968017,.101624393,.014533871]);
 expect(legs[1].ankle).toEqual([.116968147,.101624563,.014533522]);
});
