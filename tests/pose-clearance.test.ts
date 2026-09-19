import {afterAll,afterEach,beforeAll,expect,it} from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {writeFileSync,mkdirSync} from 'node:fs';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT,type Player} from '../game/types';
import {CHARACTER,capsuleHeight,characterReferences,eyeOrigin} from '../game/character-contract';
import {BOXES} from '../game/map';
beforeAll(initPhysics);const games:Simulation[]=[],observations:Record<string,unknown>={};
afterEach(()=>games.splice(0).forEach(s=>s.dispose()));
afterAll(()=>{const out=new URL('../output/tests/clearance/',import.meta.url);mkdirSync(out,{recursive:true});
  writeFileSync(new URL(`${process.env.CLEARANCE_EVIDENCE??'latest'}-observations.json`,out),JSON.stringify(observations,null,2));});
function fixture(phase=1){
  const s=new Simulation('training',false);games.push(s);
  s.world.createCollider(RAPIER.ColliderDesc.cuboid(12,.1,12).setTranslation(100,-.1,100));
  const p=s.addPlayer('clearance','Clearance','amber');
  Object.assign(p,{x:100,y:.015,z:100,yaw:0,pitch:0,stancePhase:phase,stanceRate:0,stanceTarget:phase>0,crouch:phase>0});
  s.world.step();s.move(p,{...EMPTY_INPUT,crouch:phase>0});s.world.step();return {s,p};
}
function wall(s:Simulation,axis:'x'|'z',at:number,halfLength=2,halfThickness=.05){
  const shape=axis==='x'?RAPIER.ColliderDesc.cuboid(halfThickness,2,halfLength).setTranslation(at,2,100):
    RAPIER.ColliderDesc.cuboid(halfLength,2,halfThickness).setTranslation(100,2,at);
  const c=s.world.createCollider(shape);s.world.step();return c;
}
function advance(s:Simulation,p:Player,patch:Partial<typeof EMPTY_INPUT>={},n=1){
  for(let i=0;i<n;i++){s.move(p,{...EMPTY_INPUT,seq:p.ack+1,yaw:p.yaw,pitch:p.pitch,crouch:p.stanceTarget,...patch});s.world.step();}
}
function penetration(s:Simulation,p:Player){const state=s.poseClearance(p);return Math.max(0,...state.head.map(x=>x.penetration),...state.eye.map(x=>x.penetration));}

it.each([0,.5,1].flatMap(phase=>[-1.5,1.5].flatMap(pitch=>[0,Math.PI/2].map(yaw=>({phase,pitch,yaw})))))
  ('keeps head and eyes clear while accepting phase=$phase pitch=$pitch yaw=$yaw',({phase,pitch,yaw})=>{
    const {s,p}=fixture(phase);const before={...p};
    const head=characterReferences({...p,pitch,yaw}).head;
    const axis=Math.abs(head.x-p.x)>Math.abs(head.z-p.z)?'x':'z';
    const sign=Math.sign(head[axis]-p[axis]);wall(s,axis,100+sign*.41);
    advance(s,p,{pitch,yaw});const after={...p};
    observations[`turn-${phase}-${pitch}-${yaw}`]={before,after,penetration:penetration(s,p),head:characterReferences(p).head,eye:eyeOrigin(p)};
    expect(p.pitch).toBe(pitch);expect(p.yaw).toBe(yaw);expect(CHARACTER.radius).toBe(.3);
    expect(penetration(s,p)).toBeLessThan(.001);
    expect(s.hasStanceClearance(p,capsuleHeight(p))).toBe(true);
    expect(Math.abs(p.y-before.y)).toBeLessThan(.02);
  });

it('forward movement stops at the actual offset head instead of driving the head through a thin wall',()=>{
  const {s,p}=fixture(0);wall(s,'z',98.5,3,.015);
  advance(s,p,{pitch:-1.5,mz:-1},160);
  observations.forward={p:{...p},penetration:penetration(s,p)};
  expect(p.z).toBeGreaterThan(98.7);expect(p.z).toBeLessThan(99.2);
  expect(penetration(s,p)).toBeLessThan(.001);
  expect(p.pitch).toBe(-1.5);
});

it('resolves a two-wall corner with root displacement rather than rejecting the legal view',()=>{
  const {s,p}=fixture(1);wall(s,'x',100.41);wall(s,'z',100.41);
  advance(s,p,{yaw:Math.PI/4,pitch:1.5});
  observations.corner={p:{...p},penetration:penetration(s,p)};
  expect(p.yaw).toBe(Math.PI/4);expect(p.pitch).toBe(1.5);
  expect(penetration(s,p)).toBeLessThan(.001);expect(s.hasStanceClearance(p,capsuleHeight(p))).toBe(true);
});

it('an impossible narrow turn retains the last legal pose without pushing through the opposite wall',()=>{
  const {s,p}=fixture(1);wall(s,'z',99.62);wall(s,'z',100.38);const before={...p};
  advance(s,p,{pitch:1.5});
  observations.narrow={before,after:{...p},resolution:s.poseResolution(p),penetration:penetration(s,p)};
  expect(s.poseResolution(p)?.status).toBe('blocked');expect(p.pitch).toBe(before.pitch);
  expect(p.x).toBe(before.x);expect(p.z).toBe(before.z);
  expect(penetration(s,p)).toBeLessThan(.001);expect(s.hasStanceClearance(p,capsuleHeight(p))).toBe(true);
});

it('a half-turn checks its swept head arc even when both endpoint poses are clear',()=>{
  const {s,p}=fixture(1);advance(s,p,{pitch:1.5});
  s.world.createCollider(RAPIER.ColliderDesc.cuboid(.03,1,.03).setTranslation(100.41,1,100));s.world.step();
  expect(penetration(s,p)).toBe(0);
  advance(s,p,{yaw:Math.PI,pitch:1.5});
  observations.arc={p:{...p},resolution:s.poseResolution(p)};
  expect(p.yaw).toBe(Math.PI);expect(p.pitch).toBe(1.5);
  expect(p.x).toBeLessThan(99.99);expect(s.poseResolution(p)?.status).toBe('corrected');
  expect(penetration(s,p)).toBeLessThan(.001);
});

it('repairs a shallow initial root/head wall penetration without dropping the feet or restricting pitch',()=>{
  const {s,p}=fixture(1);p.pitch=1.5;wall(s,'z',100.25);const before={...p};
  expect(penetration(s,p)).toBeGreaterThan(.15);
  advance(s,p,{pitch:1.5});
  observations.initialRecovery={before,after:{...p},resolution:s.poseResolution(p)};
  expect(s.poseResolution(p)?.initiallyLegal).toBe(false);expect(s.poseResolution(p)?.status).toBe('corrected');
  expect(p.pitch).toBe(1.5);expect(penetration(s,p)).toBeLessThan(.001);
  expect(s.hasStanceClearance(p,capsuleHeight(p))).toBe(true);
  expect(Math.abs(p.y-before.y)).toBeLessThan(.02);
});

it('reports an initially invalid too-narrow placement as unresolved, never as a corrected legal pose',()=>{
  const {s,p}=fixture(1);wall(s,'z',99.70);wall(s,'z',100.30);const before={...p};
  advance(s,p,{pitch:1.5,mx:1});
  observations.invalidPlacement={before,after:{...p},resolution:s.poseResolution(p)};
  expect(s.poseResolution(p)?.status).toBe('unresolved');expect(s.poseResolution(p)?.initiallyLegal).toBe(false);
  expect(p.x).toBe(before.x);expect(p.z).toBe(before.z);expect(p.vx).toBe(0);
  expect(s.hasStanceClearance(p,capsuleHeight(p))).toBe(false);
});

it('a low roof keeps stance and feet legal through full-pitch turns and a blocked stand-up',()=>{
  const {s,p}=fixture(1);s.world.createCollider(RAPIER.ColliderDesc.cuboid(2,.1,2).setTranslation(100,1.55,100));s.world.step();
  advance(s,p,{yaw:Math.PI/2,pitch:1.5});expect(p.pitch).toBe(1.5);
  advance(s,p,{yaw:-Math.PI/2,pitch:-1.5});expect(p.pitch).toBe(-1.5);
  advance(s,p,{crouch:false},100);
  observations.lowRoof={p:{...p},resolution:s.poseResolution(p),penetration:penetration(s,p)};
  expect(p.stancePhase).toBeGreaterThan(.1);expect(p.y+capsuleHeight(p)).toBeLessThan(1.451);
  expect(penetration(s,p)).toBeLessThan(.001);expect(p.y).toBeGreaterThanOrEqual(0);
});

it('authority and prediction replay produce the same corrected pose and status',()=>{
  const a=fixture(1),b=fixture(1);wall(a.s,'z',100.41);wall(b.s,'z',100.41);
  for(let i=0;i<45;i++){
    const input={...EMPTY_INPUT,seq:i+1,crouch:true,yaw:Math.sin(i/8),pitch:1.5,mx:i<20?.2:0};
    a.s.move(a.p,input);a.s.world.step();b.s.move(b.p,input);b.s.world.step();
    expect({x:a.p.x,y:a.p.y,z:a.p.z,yaw:a.p.yaw,pitch:a.p.pitch,phase:a.p.stancePhase})
      .toEqual({x:b.p.x,y:b.p.y,z:b.p.z,yaw:b.p.yaw,pitch:b.p.pitch,phase:b.p.stancePhase});
    expect(a.s.poseResolution(a.p)?.status).toBe(b.s.poseResolution(b.p)?.status);
  }
  observations.prediction={authority:{...a.p},prediction:{...b.p}};
});

it('retains authored stair ascent and elevated foot support under the shared correction',()=>{
  const step={x:100,y:.1,z:99,w:2,h:.2,d:1,kind:'step' as const};BOXES.push(step);
  try{
    const {s,p}=fixture(0);let maxY=p.y;
    for(let i=0;i<80;i++){advance(s,p,{mz:-1});maxY=Math.max(maxY,p.y);}
    observations.stair={p:{...p},maxY};
    expect(maxY).toBeGreaterThan(.19);expect(p.z).toBeLessThan(98.4);
    expect(penetration(s,p)).toBeLessThan(.001);
  }finally{BOXES.splice(BOXES.indexOf(step),1);}
});

it('uses fixed-body obstacles consistently while ignoring non-blocking sensors',()=>{
  const {s,p}=fixture(1);
  const body=s.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(100,2,100.41));
  s.world.createCollider(RAPIER.ColliderDesc.cuboid(2,2,.05),body);
  s.world.createCollider(RAPIER.ColliderDesc.cuboid(2,2,2).setTranslation(100,2,100).setSensor(true));
  s.world.step();advance(s,p,{pitch:1.5});
  observations.fixedBody={p:{...p},resolution:s.poseResolution(p)};
  expect(p.pitch).toBe(1.5);expect(p.z).toBeLessThan(99.90);
  expect(penetration(s,p)).toBeLessThan(.001);expect(s.hasStanceClearance(p,capsuleHeight(p))).toBe(true);
});
