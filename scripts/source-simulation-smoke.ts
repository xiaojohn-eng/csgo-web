import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {Simulation,initPhysics} from '../game/simulation.js';import {EMPTY_INPUT} from '../game/types.js';
import type {SourceScenario} from '../game/source-scenario.js';
import {prepareSourceCharacterPose} from '../game/source-character-pose.js';
import {createSourcePoseDriver} from '../game/source-player-contract.js';
const folder='.reference-assets/source-exports/dust2';
const characterFolder='.reference-assets/source-exports/character-t/continuous',poseBytes=fs.readFileSync(`${characterFolder}/pose-data.json`);
const poseDataSha256=createHash('sha256').update(poseBytes).digest('hex');
const poseIndex=prepareSourceCharacterPose(JSON.parse(poseBytes.toString()),fs.readFileSync(`${characterFolder}/frames.f64.bin`));
const scenario:SourceScenario={mapId:'de_dust2-source-12426148',level:JSON.parse(fs.readFileSync(`${folder}/level.json`,'utf8')),
 collision:JSON.parse(fs.readFileSync(`${folder}/collision/collision.json`,'utf8')),navigation:JSON.parse(fs.readFileSync(`${folder}/navigation/navigation.json`,'utf8')),
 poseDriver:createSourcePoseDriver(poseIndex,`csgo-t-ak-12426148:${poseDataSha256.slice(0,16)}`)};
await initPhysics();const sims:Simulation[]=[];const make=(bots=false)=>{const s=new Simulation('training',bots,scenario);sims.push(s);return s;};
const start=performance.now(),spawnSim=make();for(const team of ['blue','amber']as const)for(let i=0;i<15;i++)spawnSim.addPlayer(`${team}-${i}`,`${team}-${i}`,team);
for(let i=0;i<90;i++)spawnSim.step();const spawns=spawnSim.players.map(p=>({id:p.id,team:p.team,feet:{x:p.x,y:p.y,z:p.z},grounded:p.grounded,eye:spawnSim.eyeOrigin(p),source:p.sourceContract}));
assert(spawns.length===30&&spawns.every(p=>p.grounded&&p.source==='csgo-player-12426148'));assert(spawns.filter(p=>p.team==='blue').every(p=>p.feet.y<0));
console.log('SPAWNS',spawns.length,'negative CT',spawns.filter(p=>p.feet.y<0).length);
const routes=JSON.parse(fs.readFileSync('output/tests/source-player-movement.json','utf8')).walks as {label:string;start:number[];end:number[];stance:'standing'|'crouching';reached:boolean}[];
const routeSim=make(),u=scenario.level.metersPerSourceUnit;const point=(p:number[])=>({x:p[0]*u,y:p[2]*u,z:-p[1]*u});
const walks=routes.map(route=>{const p=routeSim.addPlayer('route','Route','blue'),from=point(route.start),target=point(route.end);Object.assign(p,from,{vx:0,vy:0,vz:0,crouch:route.stance==='crouching',sourceJumpHeld:false});
 for(let i=0;i<90;i++){routeSim.move(p,{...EMPTY_INPUT,crouch:p.crouch});routeSim.world.step();}
 let ticks=0,blocked=0,maxBlocked=0;const touched=new Set<number>();
 for(;ticks<1800;ticks++){
  const dx=target.x-p.x,dz=target.z-p.z;if(Math.hypot(dx,dz)<.08)break;
  const before={x:p.x,z:p.z};routeSim.move(p,{...EMPTY_INPUT,mz:-1,yaw:Math.atan2(-dx,-dz),crouch:route.stance==='crouching'});routeSim.world.step();
  blocked=Math.hypot(p.x-before.x,p.z-before.z)<.0001?blocked+1:0;maxBlocked=Math.max(blocked,maxBlocked);if(blocked>=90)break;
 }
 const remaining=Math.hypot(p.x-target.x,p.z-target.z),result={...route,remaining,reached:remaining<.08,ticks,maxBlocked,final:{x:p.x,y:p.y,z:p.z}};
 routeSim.remove(p.id);routeSim.world.step();assert(result.reached===route.reached,route.label+' '+route.stance);console.log('ROUTE',route.stance,route.label,result.reached,ticks);return result;
});
const authority=make(),prediction=make(),a=authority.addPlayer('p','P','blue'),p=prediction.addPlayer('p','P','blue');
for(let i=0;i<100;i++){authority.move(a,{...EMPTY_INPUT,jump:true,mx:.2});authority.world.step();}
Object.assign(p,authority.snapshot('p').players[0]);let maxReplayError=0;
for(let i=0;i<90;i++){const input={...EMPTY_INPUT,jump:true,mx:.2};authority.move(a,input);authority.world.step();prediction.move(p,input);prediction.world.step();maxReplayError=Math.max(maxReplayError,Math.hypot(a.x-p.x,a.y-p.y,a.z-p.z));assert.deepEqual(a.sourcePose,p.sourcePose);}
assert(maxReplayError<1e-7);const replay={ticks:90,maxReplayError,jumpHeld:p.sourceJumpHeld,mapId:authority.snapshot().mapId,sourceBspSha256:authority.snapshot().sourceBspSha256,poseExactlyEqual:true,pose:p.sourcePose,poseVersion:p.sourcePoseVersion};
const aiSim=make(true);aiSim.fillBots();const origins=new Map(aiSim.players.map(p=>[p.id,{x:p.x,y:p.y,z:p.z}]));for(const p of aiSim.players)p.flash=999;
const cpu:number[]=[];const visited=new Map<string,Set<number>>(),maxPaths=new Map<string,number>();
for(let i=0;i<1800;i++){
 const began=performance.now();aiSim.step();cpu.push(performance.now()-began);
 for(const p of aiSim.players){const state=aiSim.ai.get(p.id)!;maxPaths.set(p.id,Math.max(maxPaths.get(p.id)??0,state.path.length));
  const set=visited.get(p.id)??new Set<number>();for(const w of state.path)if(w.areaId!==undefined)set.add(w.areaId);visited.set(p.id,set);}
}
const bots=aiSim.players.map(p=>{const from=origins.get(p.id)!;return{id:p.id,from,final:{x:p.x,y:p.y,z:p.z},grounded:p.grounded,
 distance:Math.hypot(p.x-from.x,p.y-from.y,p.z-from.z),maxPathWaypoints:maxPaths.get(p.id),plannedAreaIds:[...visited.get(p.id)!],
 pending:aiSim.ai.get(p.id)!.path.slice(0,4),pose:p.sourcePose,poseVersion:p.sourcePoseVersion};});
console.log('BOTS',bots.map(b=>({id:b.id,distance:b.distance,waypoints:b.maxPathWaypoints})));
assert(bots.every(b=>b.maxPathWaypoints!>0),'Every bot used original NAV waypoints');
assert(bots.every(b=>b.distance>9),'Every bot traversed real walk-only NAV beyond its original spawn');
assert(bots.every(b=>b.poseVersion===scenario.poseDriver!.id),'All authority actors use the same original pose data identity');
cpu.sort((a,b)=>a-b);const pct=(p:number)=>cpu[Math.floor((cpu.length-1)*p)];
const statistics={samples:cpu.length,meanMs:cpu.reduce((a,b)=>a+b,0)/cpu.length,p50Ms:pct(.5),p95Ms:pct(.95),p99Ms:pct(.99),maxMs:cpu.at(-1)};
const result={scenario:aiSim.scenarioIdentity,spawns,walks,replay,bots,cpu:statistics,
 scope:'10 AI training actors with original pose inputs/clocks; flash suppresses combat visibility so all exercise original walk-only NAV. 1800 fixed simulated 60Hz ticks, not real-time or renderer/network test. Skeleton sample/raycast cost excluded until verified hitbox provider exists.',
 combatAcceptance:false,combatBoundary:'No verified hitbox provider installed; Source shots do not fall back to C02 hit geometry.',
 implementationSHA256:Object.fromEntries(['game/simulation.ts','game/source-player-movement.ts','game/source-player-contract.ts','game/source-scenario.ts','game/types.ts','server/visibility.ts','game/tactics.ts'].map(path=>[path,createHash('sha256').update(fs.readFileSync(path)).digest('hex')])),
 totalMilliseconds:performance.now()-start,freedWithoutWasmBorrowError:false};
for(const s of sims){s.dispose();s.dispose();}result.freedWithoutWasmBorrowError=true;
fs.writeFileSync('output/tests/source-simulation.json',JSON.stringify(result,null,2)+'\n');console.log('PASS',JSON.stringify(statistics));
