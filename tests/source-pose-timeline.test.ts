import {expect,it} from 'vitest';
import {interpolatePose} from '../game/pose-timeline';
import type {Player} from '../game/types';
const player=(patch:Partial<Player>={})=>({id:'p',x:0,y:-3,z:0,yaw:0,pitch:0,alive:true,deaths:0,team:'blue',
 crouch:false,stancePhase:0,stanceRate:0,stanceTarget:false,sourceContract:'csgo-player-12426148',sourcePoseVersion:'pose-a',
 sourcePose:{state:'Run',cycle:.95,upperCycle:.95,parameters:{move_x:1,move_y:0},fireTimeSeconds:.02,fireCycleRate:1.25,fireCycle:.025,fireWeight:1},...patch}) as Player;
it('samples unwrapped original clocks and a new shot at the same authoritative fractional time',()=>{
 const a=player(),b=player({x:.4,sourcePose:{...a.sourcePose!,cycle:1.35,upperCycle:1.35,fireTimeSeconds:.07,fireCycle:.0875}});
 const before=interpolatePose(a,b,.5,.2),after=interpolatePose(a,b,.75,.2);
 expect(before.sourcePose!.cycle).toBeCloseTo(1.15,12);expect(before.x).toBeCloseTo(.2,12);
 expect(before.sourcePose!.fireTimeSeconds).toBeCloseTo(.12,12);
 expect(after.sourcePose!.fireTimeSeconds).toBeCloseTo(.02,12);expect(after.sourcePose!.fireCycle).toBeCloseTo(.025,12);
 expect(a.sourcePose!.cycle).toBe(.95);
});
it('holds original pose state and instantaneous AABB stance until the actual state boundary',()=>{
 const a=player(),b=player({x:.4,crouch:true,stanceTarget:true,stancePhase:1,
 sourcePose:{...a.sourcePose!,state:'Crouch_Idle',cycle:0}});
 const mid=interpolatePose(a,b,.5,.1);expect(mid.x).toBe(.2);expect(mid.sourcePose).toEqual(a.sourcePose);
 expect(mid.stancePhase).toBe(0);expect(mid.crouch).toBe(false);expect(interpolatePose(a,b,1,.1)).toEqual(b);
});
it.each([{alive:false},{deaths:1},{sourcePoseVersion:'pose-b'},{sourceContract:undefined}])('does not interpolate across original pose identity/life changes: %j',patch=>{
 const a=player(),b=player({x:.4,...patch});expect(interpolatePose(a,b,.5,.1)).toEqual(a);
 expect(interpolatePose(a,b,1,.1)).toEqual(b);
});
