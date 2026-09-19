import {afterEach,beforeAll,expect,it} from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT,validateInput,type Player} from '../game/types';
import {advanceStance,stanceBlend} from '../game/falcon-stance';
import {CHARACTER,capsuleHeight,characterHitVolumes,eyeOrigin} from '../game/character-contract';

beforeAll(initPhysics);
const games:Simulation[]=[];
afterEach(()=>games.splice(0).forEach(s=>s.dispose()));
function fixture(){
  const s=new Simulation('training',false);games.push(s);
  s.world.createCollider(RAPIER.ColliderDesc.cuboid(10,.1,10).setTranslation(100,-.1,100));
  const p=s.addPlayer('stance','Stance','amber');Object.assign(p,{x:100,y:.015,z:100,yaw:0,pitch:0});
  s.world.step();return {s,p};
}
function move(s:Simulation,p:Player,crouch:boolean,n:number){
  for(let i=0;i<n;i++){s.move(p,{...EMPTY_INPUT,seq:p.ack+1,crouch,yaw:p.yaw,pitch:p.pitch});s.world.step();}
}

it('uses the exact critically damped phase and retains velocity through reversal',()=>{
  const initial={stancePhase:0,stanceRate:0,stanceTarget:false};
  const first=advanceStance(initial,true,1/60);
  expect(first.stancePhase).toBeCloseTo(1-1.3*Math.exp(-.3),14);
  expect(stanceBlend(first)).toBeGreaterThan(0);expect(stanceBlend(first)).toBeLessThan(.01);
  const reversed=advanceStance(first,false,1/60);
  expect(reversed.stancePhase).toBeGreaterThan(first.stancePhase);
  const results=[30,60,120].map(hz=>{
    let state=initial;for(let i=0;i<hz;i++)state=advanceStance(state,true,1/hz);return state;
  });
  for(const state of results){expect(state.stancePhase).toBeCloseTo(results[0].stancePhase,13);
    expect(state.stanceRate).toBeCloseTo(results[0].stanceRate,13);}
});

it('fixed simulation ticks produce the same stance regardless of render grouping',()=>{
  const results=[30,60,120].map(hz=>{
    const {s,p}=fixture();let accumulator=0,tick=0;
    for(let frame=0;frame<hz*2;frame++){
      accumulator+=60/hz;
      while(accumulator>=1){move(s,p,tick<45||tick>=80,1);tick++;accumulator--;}
    }
    return {phase:p.stancePhase,rate:p.stanceRate,height:capsuleHeight(p),y:p.y,tick};
  });
  expect(results[0]).toEqual(results[1]);expect(results[1]).toEqual(results[2]);
});

it('continuous stance preserves feet and covers measured deep-crouch head height',()=>{
  const {s,p}=fixture();
  // Elevated support proves real floor contact, independent of Simulation's y>=0 world clamp.
  s.world.createCollider(RAPIER.ColliderDesc.cuboid(2,.1,2).setTranslation(100,1.9,100));
  p.y=2.015;s.world.step();move(s,p,true,1);
  expect(capsuleHeight(p)).toBeLessThan(CHARACTER.standingHeight);
  expect(capsuleHeight(p)).toBeGreaterThan(1.8);
  move(s,p,true,89);
  const {body,collider}=s.bodies.get(p.id)!;
  const actual=2*(collider.halfHeight()+collider.radius());
  expect(actual).toBeCloseTo(1.34,5);expect(actual).toBeGreaterThan(1.319180);
  expect(body.translation().y-actual/2).toBeCloseTo(p.y,5);
  expect(p.y).toBeLessThan(2.03);expect(p.y).toBeGreaterThanOrEqual(2);
  expect(s.snapshot(p.id).players.find(v=>v.id===p.id)).toMatchObject({stancePhase:p.stancePhase,
    stanceRate:p.stanceRate,stanceTarget:true});
});

it('a real Rapier roof absent from authored BOXES blocks growth and preserves the visible phase',()=>{
  const {s,p}=fixture();move(s,p,true,90);
  const roof=s.world.createCollider(RAPIER.ColliderDesc.cuboid(1,.1,1).setTranslation(100,1.6,100));
  s.world.step();move(s,p,false,120);
  const phase=p.stancePhase,actual=2*(s.bodies.get(p.id)!.collider.halfHeight()+.3);
  expect(phase).toBeGreaterThan(.1);expect(phase).toBeLessThan(1);
  expect(p.stanceRate).toBe(0);expect(p.stanceTarget).toBe(false);
  expect(p.y+actual).toBeLessThanOrEqual(1.5+.001);
  expect(actual).toBeCloseTo(capsuleHeight(p),5);
  move(s,p,false,30);expect(p.stancePhase).toBeCloseTo(phase,5);
  // Walk out from the unchanged roof, then release the remaining stance progress.
  for(let i=0;i<100;i++){s.move(p,{...EMPTY_INPUT,seq:p.ack+1,mx:1,yaw:0});s.world.step();}
  expect(p.x).toBeGreaterThan(101.4);move(s,p,false,90);
  expect(capsuleHeight(p)).toBeCloseTo(CHARACTER.standingHeight,5);
  expect(s.world.getCollider(roof.handle)).toBeDefined();
});

it('prediction replay restores collider height from copied authoritative stance before moving',()=>{
  const {s,p}=fixture();const prediction=fixture();move(s,p,true,20);
  Object.assign(prediction.p,p);
  const input={...EMPTY_INPUT,seq:p.ack+1,crouch:true,yaw:0,pitch:0};
  s.move(p,input);s.world.step();prediction.s.move(prediction.p,input);prediction.s.world.step();
  expect(prediction.p.stancePhase).toBe(p.stancePhase);
  expect(prediction.p.stanceRate).toBe(p.stanceRate);
  expect(prediction.s.bodies.get(prediction.p.id)!.collider.halfHeight())
    .toBeCloseTo(s.bodies.get(p.id)!.collider.halfHeight(),6);
});

it('rewind uses historical yaw, full pitch and stance instead of the current head location',()=>{
  const {s,p:target}=fixture();target.team='blue';target.armor=0;
  Object.assign(target,{stancePhase:1,stanceRate:0,stanceTarget:true,crouch:true,yaw:Math.PI/2,pitch:1.5});
  s.setInput(target.id,{...EMPTY_INPUT,crouch:true,yaw:target.yaw,pitch:target.pitch});s.step();
  const past=s.history.at(-1)!, recorded=past.players.find(p=>p.id===target.id)!;
  expect(recorded).toMatchObject({yaw:Math.PI/2,pitch:1.5,stancePhase:1,stanceRate:0,stanceTarget:true});
  const historicalHead=characterHitVolumes(recorded)[0].center;
  Object.assign(target,{yaw:-Math.PI/2,pitch:-1.5,crouch:false,stancePhase:0,stanceRate:0,stanceTarget:false});
  expect(Math.hypot(historicalHead.x-characterHitVolumes(target)[0].center.x,
    historicalHead.y-characterHitVolumes(target)[0].center.y)).toBeGreaterThan(.4);
  const shooter=s.addPlayer('marksman','Marksman','amber');
  Object.assign(shooter,{x:0,y:0,z:0,yaw:0,pitch:0,stancePhase:1,stanceRate:0,stanceTarget:true,
    crouch:true,weapon:'marshal',shotHeat:0});
  const localEye=eyeOrigin(shooter);
  Object.assign(shooter,{x:historicalHead.x-localEye.x,y:historicalHead.y-localEye.y,z:105});
  const origin=eyeOrigin(shooter);s.time=past.time+.1;
  s.shoot(shooter,{...EMPTY_INPUT,seq:1,time:past.time,aim:true});
  expect(s.events.some(e=>e.type==='hit'&&e.target===target.id&&e.head)).toBe(true);
  expect(s.events.find(e=>e.type==='shot')).toMatchObject({x:origin.x,y:origin.y,z:origin.z});
});

it('control transfer preserves stance and combat resources while spawn explicitly resets stance',()=>{
  const {s,p}=fixture();move(s,p,true,10);Object.assign(p,{hp:34,ammo:0,money:150});
  const before={phase:p.stancePhase,rate:p.stanceRate,target:p.stanceTarget,hp:p.hp,ammo:p.ammo,money:p.money};
  const handle=s.bodies.get(p.id)!.collider.handle;
  const transferred=s.transferControl(p.id,'new','New',true);
  expect({phase:transferred.stancePhase,rate:transferred.stanceRate,target:transferred.stanceTarget,
    hp:transferred.hp,ammo:transferred.ammo,money:transferred.money}).toEqual(before);
  expect(s.bodies.get('new')!.collider.handle).toBe(handle);
  s.spawn(transferred);
  expect(transferred).toMatchObject({stancePhase:0,stanceRate:0,stanceTarget:false,crouch:false});
  expect(2*(s.bodies.get('new')!.collider.halfHeight()+.3)).toBeCloseTo(1.86,5);
});

it('keeps legal pitch ±1.5 while rejecting client-supplied stance state',()=>{
  for(const pitch of [-1.5,1.5]){
    const input=validateInput({...EMPTY_INPUT,pitch,stancePhase:1,stanceRate:0,stanceTarget:true});
    expect(input?.pitch).toBe(pitch);expect(input).not.toHaveProperty('stancePhase');
  }
});

it('diagnoses the remaining extreme-pitch head-wall overlap without hiding it with a bigger root capsule',()=>{
  const {s,p}=fixture();Object.assign(p,{stancePhase:1,stanceRate:0,stanceTarget:true,crouch:true,pitch:1.5});
  move(s,p,true,1);
  s.world.createCollider(RAPIER.ColliderDesc.cuboid(1,1,.05).setTranslation(100,1,100.41));s.world.step();
  const clearance=s.poseClearance(p);
  expect(CHARACTER.radius).toBe(.3);
  expect(s.hasStanceClearance(p,capsuleHeight(p))).toBe(true);
  expect(clearance.head.length).toBeGreaterThan(0);
  expect(clearance.head[0].penetration).toBeGreaterThan(.05);
  // This is an explicit unresolved diagnostic, not a head-wall movement fix.
});
