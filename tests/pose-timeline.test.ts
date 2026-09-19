import { beforeAll, afterAll, expect, it } from 'vitest';
import * as T from 'three';
import { Art } from '../game/scene';
import { Game } from '../game/runtime';
import { Simulation, initPhysics } from '../game/simulation';
import { RemoteTimeline, samplePoseFrame } from '../game/pose-timeline';
import type { Player, Snapshot } from '../game/types';
import { EMPTY_INPUT } from '../game/types';

let sim: Simulation;
beforeAll(async () => { await initPhysics(); sim = new Simulation('training', false); });
afterAll(() => sim.dispose());

it('renders a supplied remote pose without lagging its root behind its rotation and stance', () => {
  const p = sim.addPlayer('remote', 'Remote', 'blue');
  Object.assign(p, { x: 2, y: .015, z: 4, yaw: .75, stancePhase: .5 });
  const root = new T.Group(); root.userData.ready = true; root.userData.mixer = {};
  const art = Object.assign(Object.create(Art.prototype), {
    actors: new Map([[p.id, root]]), clouds: [],
    actor: () => root,
    magazineDrops: { spawn() {} },
    // GPU and actual clip sampling are outside this CPU transform test.
    assets: { animateOperator() {}, updateDeath() {return true;}, takeMagazineDrop() {return null;} },
  });
  art.updateActors([p], 'observer', 1 / 60);
  expect(root.position.toArray()).toEqual([2, .015, 4]);
  expect(root.rotation.y).toBe(.75);
});

it('timestamps a shot with the remote pose actually drawn, not the newest received snapshot', () => {
  const g = Object.assign(Object.create(Game.prototype), {
    seq: 0, keys: new Set(), pressed: new Set(), paused: false,
    firing: true, firePressed: false, aim: false, yaw: 0, pitch: 0,
    online: true, renderTime: 10.1, snapshot: { time: 10.2 },
  });
  expect(g.input().time).toBe(10.1);
  g.online = false;
  expect(g.input().time).toBe(10.2);
});

function player(patch: Partial<Player> = {}): Player {
  return { ...sim.players[0], id: 'target', x: 0, y: 0, z: 0, yaw: 179*Math.PI/180,
    pitch: -.6, alive: true, deaths: 0, crouch: false, stancePhase: 0, stanceRate: 0,
    stanceTarget: false, ...patch };
}
function frame(time: number, players: Player[], round=1): Snapshot {
  return { ...sim.snapshot('observer'), time, tick: Math.round(time*60), round, players };
}

it('samples position, short-arc yaw, pitch, stance and reload at the same fractional time', () => {
  const a = player({reload:1.5}), b = player({x:.4,z:.2,yaw:-179*Math.PI/180,pitch:.6,
    stancePhase:1,stanceRate:2,stanceTarget:true,crouch:true,reload:1.4});
  const input = [frame(10,[a]),frame(10.1,[b])];
  const copy = JSON.stringify(input);
  const result = samplePoseFrame(input,10.05)!;
  expect(result.time).toBe(10.05);
  expect(result.players[0].x).toBeCloseTo(.2,10);
  expect(result.players[0].z).toBeCloseTo(.1,10);
  expect(result.players[0].yaw).toBeCloseTo(Math.PI,10);
  expect(result.players[0].pitch).toBeCloseTo(0,10);
  expect(result.players[0].stancePhase).toBeCloseTo(.5,10);
  expect(result.players[0].reload).toBeCloseTo(1.45,10);
  expect(JSON.stringify(input)).toBe(copy);
});

it('advances the remote fire clip and switches at the authoritative new-shot time, not the packet boundary', () => {
  const a=player({shotIdle:.02}),b=player({shotIdle:.07});
  expect(samplePoseFrame([frame(10,[a]),frame(10.05,[b])],10.025)!.players[0].shotIdle).toBeCloseTo(.045,10);
  const reset=player({shotIdle:.01});
  expect(samplePoseFrame([frame(10,[b]),frame(10.05,[reset])],10.025)!.players[0].shotIdle).toBeCloseTo(.095,10);
  expect(samplePoseFrame([frame(10,[b]),frame(10.05,[reset])],10.045)!.players[0].shotIdle).toBeCloseTo(.005,10);
  expect(samplePoseFrame([frame(10,[b]),frame(10.05,[reset])],10.05)!.players[0].shotIdle).toBe(.01);
});

it('recognizes a new shot during packet loss even when the final shotIdle value increased', () => {
  const frames=[frame(10,[player({shotIdle:.02})]),frame(10.2,[player({shotIdle:.07})])];
  // Newest known shot started at 10.20 - .07 = 10.13, not at the arrival of B.
  expect(samplePoseFrame(frames,10.13)!.players[0].shotIdle).toBeCloseTo(0,10);
  expect(samplePoseFrame(frames,10.15)!.players[0].shotIdle).toBeCloseTo(.02,10);
});

it.each(['ended', 'match'] as const)('finishes the last fire clock during %s without firing or moving again', phase => {
  const s = new Simulation('training', false);
  try {
    const p = s.addPlayer('winner', 'Winner', 'amber');
    Object.assign(p, {shotIdle:0, cooldown:0, grounded:true});
    s.phase = phase; s.remaining = 4;
    s.setInput(p.id, {...EMPTY_INPUT, fire:true, mx:1});
    const a = s.snapshot(p.id), original = {hp:p.hp, ammo:p.ammo, x:p.x, y:p.y, z:p.z};
    for (let i=0;i<3;i++) s.step();
    const b = s.snapshot(p.id), mid = samplePoseFrame([a,b], (a.time+b.time)/2)!;
    expect(p.shotIdle).toBeCloseTo(.05,10);
    expect(mid.players[0].shotIdle).toBeCloseTo(.025,10);
    expect({hp:p.hp, ammo:p.ammo, x:p.x, y:p.y, z:p.z}).toEqual(original);
    expect(s.events.filter(e=>e.type==='shot')).toHaveLength(0);
  } finally {s.dispose();}
});

it('does not interpolate through a wall on teleport, revive an old life, or expose a new ID early', () => {
  for (const patch of [{x:20}, {alive:false}, {deaths:1}, {team:'amber' as const}]) {
    const a=player(),b=player(patch), frames=[frame(10,[a]),frame(10.1,[b,player({id:'joined'})])];
    expect(samplePoseFrame(frames,10.05)!.players).toEqual([a]);
    expect(samplePoseFrame(frames,10.1)!.players).toEqual([b,player({id:'joined'})]);
  }
  const a=player();
  expect(samplePoseFrame([frame(10,[a]),frame(10.1,[])],10.1)!.players).toEqual([]);
});

it('holds at the last actual pose during packet loss and never rewinds playback on late arrival', () => {
  const timeline=new RemoteTimeline();
  timeline.push(frame(10,[player()]),1000);
  timeline.push(frame(10.1,[player({x:.4})]),1100);
  expect(timeline.sample(1150)!.players[0].x).toBeCloseTo(.2,10);
  expect(timeline.sample(5000)!.time).toBe(10.1);
  timeline.push(frame(10.15,[player({x:.6})]),5000);
  expect(timeline.sample(5000)!.time).toBe(10.1);
  timeline.push(frame(10.12,[player({x:99})]),5100); // old packet is not a new epoch
  expect(timeline.sample(5100)!.time).toBe(10.15);
  expect(timeline.sample(5100)!.players[0].x).toBe(.6);
});

it('resets the whole playback clock on a new round and a reconnected room', () => {
  const timeline=new RemoteTimeline();
  timeline.push(frame(10,[player()]),1000);timeline.sample(1000);
  timeline.push(frame(11,[player({x:30})],2),2000);
  expect(timeline.sample(2000)!.players[0].x).toBe(30);
  timeline.reset();expect(timeline.sample(2000)).toBeNull();
  timeline.push(frame(1,[player({x:-20})]),3000);
  expect(timeline.sample(3000)!.time).toBe(1);
});

it('uses the same wall-clock remote pose at 30, 60 and 120 rendering frames per second', () => {
  const results=[30,60,120].map(hz=>{
    const timeline=new RemoteTimeline();
    for (let i=0;i<=6;i++)timeline.push(frame(10+i*.05,[player({x:i*.2,stancePhase:i/6})]),1000+i*50);
    for(let i=0;1300+i*1000/hz<1380;i++)timeline.sample(1300+i*1000/hz);
    return timeline.sample(1380)!;
  });
  expect(results[0]).toEqual(results[1]);expect(results[1]).toEqual(results[2]);
  expect(results[0].players[0].x).toBeCloseTo(1.12,10);
});

it('hits the actual mid-frame target instead of snapping the rewind to the next server frame', () => {
  const s=new Simulation('training',false);
  try {
    const shooter=s.addPlayer('shooter','Shooter','amber'),target=s.addPlayer('target','Target','blue');
    Object.assign(shooter,{x:101,y:0,z:110,yaw:0,pitch:0,grounded:true,shotHeat:0});
    Object.assign(target,{x:102,y:0,z:100,yaw:0,pitch:0,armor:0});
    s.time=10.1;s.history=[{time:10,players:[{...target,x:100}]},{time:10.1,players:[{...target}]}];
    s.shoot(shooter,{...EMPTY_INPUT,time:10.05,seq:1});
    expect(target.hp).toBeLessThan(100);
  } finally {s.dispose();}
});

it('cannot damage a respawned life by rewinding to its old dead or pre-death body', () => {
  for(const alive of [false,true]) {
    const s=new Simulation('training',false);
    try {
      const shooter=s.addPlayer('shooter','Shooter','amber'),target=s.addPlayer('target','Target','blue');
      Object.assign(shooter,{x:100,y:0,z:110,yaw:0,pitch:0,grounded:true,shotHeat:0});
      Object.assign(target,{x:100,y:0,z:100,yaw:0,pitch:0,armor:0,deaths:1});
      s.time=10.1;s.history=[{time:10,players:[{...target,alive,deaths:0}]}];
      s.shoot(shooter,{...EMPTY_INPUT,time:10,seq:1});
      expect(target.hp).toBe(100);
    } finally {s.dispose();}
  }
});

it('interpolates the last real step history into the current authority frame without a false team change', () => {
  const s=new Simulation('training',false);
  try {
    const shooter=s.addPlayer('shooter','Shooter','amber'),target=s.addPlayer('target','Target','blue');
    Object.assign(shooter,{x:101,y:0,z:110,yaw:0,pitch:0,grounded:true,shotHeat:0});
    Object.assign(target,{x:100,y:0,z:100,yaw:0,pitch:0,armor:0});
    s.setInput(shooter.id,{...EMPTY_INPUT});s.setInput(target.id,{...EMPTY_INPUT});s.step();
    const recorded=s.history.at(-1)!,recordedTime=recorded.time;
    expect(recorded.players.find(p=>p.id===target.id)!.x).toBeCloseTo(100,7);
    target.x=102;s.time=recordedTime+.1;
    s.shoot(shooter,{...EMPTY_INPUT,time:recordedTime+.05,seq:1});
    expect(target.hp).toBeLessThan(100);
  } finally {s.dispose();}
});
