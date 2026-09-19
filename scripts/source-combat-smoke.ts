import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash}from'node:crypto';
import {Simulation,initPhysics}from'../game/simulation.js';import{EMPTY_INPUT,type Player}from'../game/types.js';
import{prepareSourceCharacterPose,sampleSourceCharacterPose,sourceCharacterBrowserBoneMatrices,type SourceCharacterPoseIndex}from'../game/source-character-pose.js';
import{createSourcePoseDriver,sourceActorMatrix}from'../game/source-player-contract.js';import{createSourceHitboxes}from'../game/source-hitboxes.js';
import type{SourceScenario}from'../game/source-scenario.js';
const folder='.reference-assets/source-exports/dust2',load=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const scenario:SourceScenario={mapId:'de_dust2-source-12426148',level:load(`${folder}/level.json`),collision:load(`${folder}/collision/collision.json`),navigation:load(`${folder}/navigation/navigation.json`),poseDrivers:{},hitboxesByTeam:{}};
const indices=new Map<string,SourceCharacterPoseIndex>();
for(const [team,name,prefix]of[['amber','t','csgo-t-ak-12426148:'],['blue','ct','csgo-ct-ak-12426148:']]as const){const folder=`.reference-assets/source-exports/character-${name}/continuous`,raw=fs.readFileSync(`${folder}/pose-data.json`),index=prepareSourceCharacterPose(JSON.parse(raw.toString()),fs.readFileSync(`${folder}/frames.f64.bin`)),version=prefix+createHash('sha256').update(raw).digest('hex').slice(0,16);
 indices.set(team,index);scenario.poseDrivers![team]=createSourcePoseDriver(index,version);scenario.hitboxesByTeam![team]=createSourceHitboxes(index,version);}
await initPhysics();const sim=new Simulation('training',false,scenario),out:any={cases:[],freedWithoutWasmBorrowError:false};
try{
 let a=sim.addPlayer('a','A','amber'),b=sim.addPlayer('b','B','blue');const u=.0254;
 const resetActors=()=>{sim.remove('a');sim.remove('b');a=sim.addPlayer('a','A','amber');b=sim.addPlayer('b','B','blue');};
 const place=(p:Player,source:number[],crouch=false)=>{Object.assign(p,{x:source[0]*u,y:source[2]*u,z:-source[1]*u,vx:0,vy:0,vz:0,alive:true,hp:100,armor:0,deaths:0,grounded:true,crouch,sourceJumpHeld:false,shotIdle:10,shotHeat:0,recoil:0,shots:0,ammo:30,cooldown:0});
  for(let i=0;i<90;i++){sim.move(p,{...EMPTY_INPUT,crouch});sim.world.step();}};
 const head=(p:Player)=>{const index=indices.get(p.team)!,bones=sourceCharacterBrowserBoneMatrices(sampleSourceCharacterPose(index,p.sourcePose!),sourceActorMatrix(p));const h=index.data.hitboxSets[0].hitboxes.find(h=>h.boneName.endsWith('_Head')&&h.group===1)!;
  const angles=h.extensionFloat32.slice(0,3).map(v=>v*Math.PI/180),[pitch,yaw,roll]=angles,cp=Math.cos(pitch),sp=Math.sin(pitch),cy=Math.cos(yaw),sy=Math.sin(yaw),cr=Math.cos(roll),sr=Math.sin(roll);
  const rotation=[cp*cy,cp*sy,-sp,sr*sp*cy-cr*sy,sr*sp*sy+cr*cy,sr*cp,cr*sp*cy+sr*sy,cr*sp*sy-sr*cy,cr*cp];
  const local=[h.min[0]*.2+h.max[0]*.8,(h.min[1]+h.max[1])*.5,(h.min[2]+h.max[2])*.5],rotated=[0,1,2].map(r=>local.reduce((sum,v,c)=>sum+rotation[c*3+r]*v,0)),at=h.bone*16;
  const world=[0,1,2].map(r=>bones[at+12+r]+rotated.reduce((sum,v,c)=>sum+bones[at+c*4+r]*v,0));return{x:world[0],y:world[1],z:world[2]};};
 for(const swap of[false,true])for(const crouch of[false,true]){
  resetActors();const shooter=swap?b:a,target=swap?a:b;place(shooter,[1400,1000,40]);place(target,[1400,1150,40],crouch);sim.history=[];
  const origin=sim.eyeOrigin(shooter),aim=head(target),dx=aim.x-origin.x,dy=aim.y-origin.y,dz=aim.z-origin.z,range=Math.hypot(dx,dy,dz),direction={x:dx/range,y:dy/range,z:dz/range};
  const map=sim.wallDistance(origin.x,origin.y,origin.z,direction.x,direction.y,direction.z),hit=sim.sourcePlayerContract!.raycast(target,origin,direction,map);assert(hit?.head,'Head bone witness must hit real head OBB before Dust2 wall');
  shooter.yaw=Math.atan2(-dx,-dz);shooter.pitch=Math.atan2(dy,Math.hypot(dx,dz));sim.time+=1;sim.shoot(shooter,{...EMPTY_INPUT,time:sim.time,seq:1});
  assert(target.hp<100,'Original head witness must damage through actual Simulation.shoot');out.cases.push({shooter:shooter.team,target:target.team,crouch,feet:{x:target.x,y:target.y,z:target.z},eye:origin,hit,mapDistance:map,hp:target.hp,poseVersion:target.sourcePoseVersion});
 }
 // Actual history pose is the only hit target even when current root moved.
 resetActors();place(a,[1400,1000,40]);place(b,[1400,1150,40]);const origin=sim.eyeOrigin(a),aim=head(b),dx=aim.x-origin.x,dy=aim.y-origin.y,dz=aim.z-origin.z;
 a.yaw=Math.atan2(-dx,-dz);a.pitch=Math.atan2(dy,Math.hypot(dx,dz));sim.time=30.1;sim.history=[{time:30,players:sim.snapshot().players}];b.x+=2;
 sim.shoot(a,{...EMPTY_INPUT,time:30,seq:1});assert(b.hp<100);out.rewind={historicalHit:true,currentRootMovedMetres:2,hp:b.hp};
 const cpu:number[]=[];a.cooldown=0;b.hp=1e9;b.alive=true;sim.history=[];b.x-=2;
 for(let i=0;i<300;i++){const t=performance.now();sim.sourcePlayerContract!.raycast(b,origin,{x:dx/Math.hypot(dx,dy,dz),y:dy/Math.hypot(dx,dy,dz),z:dz/Math.hypot(dx,dy,dz)},100);cpu.push(performance.now()-t);}
 cpu.sort((a,b)=>a-b);out.raycastCPU={samples:cpu.length,meanMs:cpu.reduce((a,b)=>a+b)/cpu.length,p95Ms:cpu[Math.floor(cpu.length*.95)],p99Ms:cpu[Math.floor(cpu.length*.99)],maxMs:cpu.at(-1)};
 const combat=new Simulation('training',true,scenario);try{combat.fillBots();const ticks:number[]=[];let cursor=0,shots=0;
  for(let i=0;i<1800;i++){const began=performance.now();combat.step();ticks.push(performance.now()-began);for(const event of combat.events){if(event.id>cursor&&event.type==='shot')shots++;cursor=Math.max(cursor,event.id);}}
  ticks.sort((a,b)=>a-b);out.fullCombatCPU={samples:ticks.length,meanMs:ticks.reduce((a,b)=>a+b)/ticks.length,p50Ms:ticks[899],p95Ms:ticks[1709],p99Ms:ticks[1781],maxMs:ticks.at(-1),shots,
   kills:combat.players.reduce((n,p)=>n+p.kills,0),actors:combat.players.map(p=>({id:p.id,x:p.x,y:p.y,z:p.z,pose:p.sourcePoseVersion,kills:p.kills,deaths:p.deaths})),randomness:'Existing bot AI uses deterministic id/time hash and target choices; no separate injected RNG. Native lag/gameplay randomness not reproduced.'};
  assert(shots>0,'Full combat benchmark must include actual Simulation.shoot and native-box queries');
 }finally{combat.dispose();}
 out.boundary='Original rotated OBB and history routing evidence; current existing weapon damage/recoil are not asserted equivalent to native AK. CPU per-ray includes complete original pose bone sampling; fullCombatCPU separately includes10AI movement/NAV/pose/history and actual combat shots. No network/GPU claim.';
}finally{sim.dispose();out.freedWithoutWasmBorrowError=true;}
fs.writeFileSync('output/tests/source-combat.json',JSON.stringify(out,null,2)+'\n');console.log('PASS',out.cases.map((r:any)=>({shooter:r.shooter,crouch:r.crouch,hp:r.hp,hitbox:r.hit.hitbox})),out.raycastCPU,out.fullCombatCPU);
