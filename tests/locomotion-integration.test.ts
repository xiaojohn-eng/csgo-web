import {afterEach,beforeAll,expect,it} from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT,validateInput,type Player} from '../game/types';
import {characterReferences,characterHitVolumes,eyeOrigin} from '../game/character-contract';
import {falconPoseReferences} from '../game/falcon-head-reference';
import {falconBodyReferences,falconBodyHitVolumes} from '../game/falcon-body-reference';
import {sampleFootTargets,interpolateLocomotion} from '../game/locomotion';
import {samplePoseFrame} from '../game/pose-timeline';
import {clearancePose,resolvePoseMotion} from '../game/pose-clearance';

beforeAll(initPhysics);
const games:Simulation[]=[];
afterEach(()=>games.splice(0).forEach(s=>s.dispose()));
const moving={stridePhase:.15,strideWeight:1,strideSpeed:4.8,strideX:0,strideZ:-1,grounded:true};
const stride=(p:Partial<Player>)=>[p.stridePhase,p.strideWeight,p.strideSpeed,p.strideX,p.strideZ,p.grounded];
function fixture(){
 const s=new Simulation('training',false);games.push(s);
 s.world.createCollider(RAPIER.ColliderDesc.cuboid(15,.1,15).setTranslation(100,-.1,100));
 const p=s.addPlayer('walker','Walker','amber');
 Object.assign(p,{x:100,y:.015,z:100,yaw:0,pitch:0,grounded:true});
 s.world.step();s.move(p,{...EMPTY_INPUT});s.world.step();return {s,p};
}
function walk(s:Simulation,p:Player,patch:Partial<typeof EMPTY_INPUT>,n=1){
 for(let i=0;i<n;i++){s.move(p,{...EMPTY_INPUT,seq:p.ack+1,yaw:p.yaw,pitch:p.pitch,...patch});s.world.step();}
}

it('legacy poses retain Idle0 head/eye and anchored feet; moving references share one pelvis shift',()=>{
 const idle=characterReferences({crouch:false}),base=falconPoseReferences({yaw:0,pitch:0,blend:0});
 expect(idle.head).toEqual(base.head);expect(idle.eye).toEqual(base.eye);
 expect(idle.feet.left.offset).toEqual({x:0,y:0,z:0});
 const p={crouch:false,...moving},refs=characterReferences(p);
 const feet=sampleFootTargets(moving,{direction:{x:0,z:-1},crouch:0,grounded:true});
 expect(refs.feet).toEqual(feet);expect(refs.pelvisDrop).toBeGreaterThan(0);
 expect(refs.head.y).toBeCloseTo(base.head.y-feet.pelvisDrop,12);
 expect(refs.eye.y).toBeCloseTo(base.eye.y-feet.pelvisDrop,12);
 expect(refs.pelvisShift[1]).toBeCloseTo(-feet.pelvisDrop,12);
});

it('authority body chains and boot volumes follow the same sampled ankle and knee after yaw/root transformation',()=>{
 const input={yaw:.9,pitch:.3,blend:.4,origin:{x:5,y:2,z:7},...moving};
 const body=falconBodyReferences(input),feet=body.feet;
 for(const [i,side] of ['left','right'].entries()){
  const f=side==='left'?feet.left:feet.right,l=body.legs[i];
  expect(l.hip).toEqual([f.hip.x,f.hip.y,f.hip.z]);
  expect(l.knee).toEqual([f.knee.x,f.knee.y,f.knee.z]);
  expect(l.ankle).toEqual([f.position.x,f.position.y,f.position.z]);
 }
 const idle=falconBodyHitVolumes({...input,strideWeight:0,strideSpeed:0});
 const active=falconBodyHitVolumes(input);
 for(let i=0;i<active.length;i++)if(active[i].region==='foot'){
  const f=active[i].side==='left'?feet.left:feet.right;
  const expected={x:Math.cos(input.yaw)*f.offset.x+Math.sin(input.yaw)*f.offset.z,
   y:f.offset.y,z:-Math.sin(input.yaw)*f.offset.x+Math.cos(input.yaw)*f.offset.z};
  for(const k of ['x','y','z'] as const)expect(active[i].center[k]-idle[i].center[k]).toBeCloseTo(expected[k],10);
 }
 expect(characterHitVolumes({crouch:false,...moving})[0].center).toEqual(characterReferences({crouch:false,...moving}).head);
});

it('accepted movement drives gait; a wall cannot advance phase without progress and releasing smoothly settles the feet',()=>{
 const {s,p}=fixture();walk(s,p,{mz:-1},90);
 expect(p.stridePhase).toBeGreaterThan(2);expect(p.strideWeight).toBeGreaterThan(.99);
 const raised=characterReferences(p).feet;
 expect(Math.abs(raised.left.offset.z)+Math.abs(raised.right.offset.z)).toBeGreaterThan(.05);
 s.world.createCollider(RAPIER.ColliderDesc.cuboid(3,2,.05).setTranslation(100,2,p.z-.7));s.world.step();
 walk(s,p,{mz:-1},80);
 for(let i=0;i<120;i++){
  const phase=p.stridePhase!,z=p.z;walk(s,p,{mz:-1});
  // Rapier may consume contact skin after small depenetration. Such accepted
  // millimetre motion may take a small step, but a stationary root never runs.
  if(p.stridePhase!>phase)expect(z-p.z).toBeGreaterThan(.03/60);
 }
 walk(s,p,{},90);const phase=p.stridePhase;walk(s,p,{},60);expect(p.stridePhase).toBe(phase);
 expect(p.strideWeight).toBeLessThan(.0001);
 expect(Math.hypot(...Object.values(characterReferences(p).feet.left.offset))).toBeLessThan(.00001);
});

it('prediction replay, snapshots, history and explicit spawn preserve/reset the complete shared state',()=>{
 const a=fixture(),b=fixture();
 for(let i=0;i<65;i++){
  const input={...EMPTY_INPUT,seq:i+1,mx:i<30?1:-.5,mz:-.6,crouch:i>40,yaw:i*.01};
  a.s.setInput(a.p.id,input);a.s.step();b.s.setInput(b.p.id,input);b.s.step();
  expect(stride(a.p)).toEqual(stride(b.p));expect(characterReferences(a.p)).toEqual(characterReferences(b.p));
 }
 expect(a.p.stridePhase).toBeGreaterThan(0);
 expect(stride(a.s.snapshot(a.p.id).players[0])).toEqual(stride(a.p));
 expect(stride(a.s.history.at(-1)!.players[0])).toEqual(stride(a.p));
 a.s.spawn(a.p);expect(stride(a.p).slice(0,5)).toEqual([0,0,0,0,-1]);
});

it('rewind interpolates unwrapped stride and normalized local direction at the same pose time',()=>{
 const {p}=fixture();const a={...p,...moving,stridePhase:.99,strideX:1,strideZ:0};
 const b={...a,x:a.x+.2,stridePhase:1.03,strideX:0,strideZ:-1,strideWeight:.8,strideSpeed:3};
 const middle=samplePoseFrame([{time:10,players:[a]},{time:10.1,players:[b]}],10.05)!.players[0];
 expect(middle.stridePhase).toBeCloseTo(1.01,10);expect(middle.strideWeight).toBeCloseTo(.9,10);
 expect(middle.strideSpeed).toBeCloseTo(3.9,10);
 expect(Math.hypot(middle.strideX!,middle.strideZ!)).toBeCloseTo(1,10);
 expect(middle.strideX).toBeCloseTo(Math.SQRT1_2,10);expect(middle.strideZ).toBeCloseTo(-Math.SQRT1_2,10);
 expect(characterReferences(middle).feet.left.phase).toBeCloseTo(.01,10);
 const reset={...b,stridePhase:0};
 expect(samplePoseFrame([{time:10,players:[a]},{time:10.1,players:[reset]}],10.05)!.players[0]).toEqual(a);
});

it('clearance candidates carry gait and an impossible turn restores every gait field and grounded state',()=>{
 const {s,p}=fixture();Object.assign(p,{...moving,strideSpeed:.7,strideWeight:.05});
 for(const z of [99.62,100.38])s.world.createCollider(RAPIER.ColliderDesc.cuboid(3,2,.05).setTranslation(100,2,z));
 s.world.step();const from=clearancePose(p);
 expect(stride(from)).toEqual(stride(p));
 const to={...from,pitch:1.5,stridePhase:.24,strideWeight:.8,strideX:1,strideZ:0,grounded:false};
 const result=resolvePoseMotion(s.world,from,to,s.bodies.get(p.id)!.collider);
 expect(result.status).toBe('blocked');expect(stride(result.pose)).toEqual(stride(from));
 expect(result.pose.pitch).toBe(from.pitch);
});

it('airborne simulation freezes stride phase and fades swing instead of running in midair',()=>{
 const {s,p}=fixture();walk(s,p,{mz:-1},50);walk(s,p,{mz:-1,jump:true});
 expect(p.grounded).toBe(false);const phase=p.stridePhase,weight=p.strideWeight!;
 walk(s,p,{mz:-1},6);expect(p.stridePhase).toBe(phase);expect(p.strideWeight).toBeLessThan(weight);
 expect(characterReferences(p).feet.left.contact).toBe(false);
});

it('the same saved moving boot is hittable on authority rewind while its present Idle0 boot is elsewhere',()=>{
 const {s,p:shooter}=fixture(),target=s.addPlayer('target','Target','blue');
 Object.assign(target,{x:100,y:.015,z:100,yaw:0,pitch:0,armor:0,stancePhase:0,crouch:false});
 const past={...target,...moving,stridePhase:0};
 const boot=falconBodyHitVolumes({...past,blend:0,origin:past}).find(v=>v.region==='foot'&&v.side==='left')!;
 Object.assign(shooter,{x:98,y:0,z:boot.center.z,yaw:-Math.PI/2,pitch:0,weapon:'marshal',shotHeat:0,grounded:true});
 const eye=eyeOrigin(shooter);shooter.y+=boot.center.y-eye.y;shooter.z+=boot.center.z-eye.z;
 s.time=1;s.history=[{time:.9,players:[{...shooter},past]}];
 s.shoot(shooter,{...EMPTY_INPUT,seq:51,aim:true,time:.9});
 expect(s.events.find(e=>e.type==='hit')).toMatchObject({by:shooter.id,target:target.id,head:false});
 expect(target.hp).toBeLessThan(100);
 target.hp=100;shooter.shotHeat=0;s.events=[];
 s.shoot(shooter,{...EMPTY_INPUT,seq:51,aim:true,time:1});
 expect(s.events.some(e=>e.type==='hit')).toBe(false);expect(target.hp).toBe(100);
});

it('client input cannot supply a locomotion state and 180-degree direction reversal uses one deterministic arc',()=>{
 const input=validateInput({...EMPTY_INPUT,...moving});
 for(const key of ['stridePhase','strideWeight','strideSpeed','strideX','strideZ'])expect(input).not.toHaveProperty(key);
 const a={...moving,strideX:1,strideZ:0},b={...moving,strideX:-1,strideZ:0};
 const middle=interpolateLocomotion(a,b,.5);
 expect(middle.strideX).toBeCloseTo(0,10);expect(middle.strideZ).toBeCloseTo(1,10);
 const reverse=interpolateLocomotion(b,a,.5);
 expect(reverse.strideX).toBeCloseTo(0,10);expect(reverse.strideZ).toBeCloseTo(-1,10);
});

it.each(['forward','strafe'] as const)('keeps the shared moving boots outside a thin wall during %s movement',direction=>{
 const {s,p}=fixture(),forward=direction==='forward';
 const wall=s.world.createCollider((forward?RAPIER.ColliderDesc.cuboid(3,2,.05):RAPIER.ColliderDesc.cuboid(.05,2,3))
  .setTranslation(forward?100:103,2,forward?97:100));s.world.step();
 for(let i=0;i<100;i++){
  walk(s,p,{mz:forward?-1:0,mx:forward?0:1});
  for(const sphere of falconBodyHitVolumes({...p,blend:0,origin:p}).filter(v=>v.region==='foot')){
   const contact=wall.contactShape(new RAPIER.Ball(sphere.radius),sphere.center,{x:0,y:0,z:0,w:1},0);
   expect(Math.max(0,-(contact?.distance??0)),`${direction} tick ${i} ${sphere.side}`).toBeLessThan(.002);
  }
 }
});
