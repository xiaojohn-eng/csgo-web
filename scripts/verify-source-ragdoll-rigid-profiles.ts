import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import {loadServerSourceCharacter} from '../server/source-character-data.js';
import {loadServerSourcePistol} from '../server/source-pistol-data.js';
import {loadServerSourceDeagle} from '../server/source-deagle-data.js';
import {loadServerSourceAWP} from '../server/source-awp-data.js';
import {loadServerSourceMap} from '../server/source-map-data.js';
import {createSourceLevel,type SourceSpawn} from '../game/source-level.js';
import {createSourcePoseDriver} from '../game/source-player-contract.js';
import {createSourceRagdollPoseDriver,parseSourceRagdollData,sourceRagdollVelocityFromWorld} from '../game/source-ragdoll.js';
import type {SourceCharacterPoseIndex} from '../game/source-character-pose.js';

await RAPIER.init();
const directory='public/source/csgo-12426148',manifest=(name:string)=>`${directory}/${name}/manifest.json`;
const data=parseSourceRagdollData(JSON.parse(readFileSync(`${directory}/ragdoll/ragdoll-data.json`,'utf8')));
const profiles:{team:'t'|'ct';weapon:string;poseIndex:SourceCharacterPoseIndex;poseVersion:string}[]=[];
for(const team of ['t','ct']as const){
  for(const weapon of ['vandal','m4a4','glock','usp','deagle','awp']){
    if(weapon==='vandal'||weapon==='m4a4'){
      const folder=weapon==='vandal'?(team==='t'?'character-ak':'character-ct-ak'):`character-${team}-m4`;
      profiles.push({team,weapon,...await loadServerSourceCharacter(manifest(folder))});
    }else{
      const path=manifest(`character-${team}-${weapon}`),loaded=weapon==='awp'?await loadServerSourceAWP(path,team)
        :weapon==='deagle'?await loadServerSourceDeagle(path,team):await loadServerSourcePistol(path,team,weapon as 'glock'|'usp');
      profiles.push({team,weapon,poseIndex:loaded.poseIndex.body,poseVersion:loaded.poseVersion});
    }
  }
}
const results=[];
for(const profile of profiles){
  const driver=createSourceRagdollPoseDriver(createSourcePoseDriver(profile.poseIndex,profile.poseVersion),profile.poseIndex,data);
  for(const state of ['Idle','Run','Crouch_Idle']as const){
    const player={id:`${profile.team}-${profile.weapon}-${state}`,weapon:profile.weapon,
      sourcePose:{state,cycle:.45,parameters:{move_x:state==='Run'?1:0,move_y:0,body_yaw:20,body_pitch:-15},blendMode:'sdk-3way'as const}};
    const restPose=driver.ragdoll!.capturePose(player);
    let corpse=driver.ragdoll!.beginRagdoll(player,{x:0,y:0,z:0},{x:170,y:0,z:42.5},undefined,restPose),tick=0;
    const initial=structuredClone(corpse);
    while(!corpse.settled&&tick++<600)corpse=driver.ragdoll!.stepRagdoll(player,1/60)!;
    assert(corpse.settled,player.id+' did not settle');assert.equal(corpse.quaternions?.length,64);
    assert.equal(corpse.restPose?.positions.length,profile.poseIndex.mainBoneCount*3);
    assert(corpse.positions.every(Number.isFinite));
    results.push({profile:player.id,mainBones:profile.poseIndex.mainBoneCount,ticks:tick,initial,settled:corpse});
    driver.ragdoll!.endRagdoll(player);
  }
}
// All ten corpses use actual original spawn points and shared map colliders.
// This is CPU contact/performance verification, never a LAN or browser test.
const map=await loadServerSourceMap(manifest('dust2')),world=new RAPIER.World({x:0,y:-20.32,z:0});
const level=createSourceLevel(world,map.level,map.collision),spawns=[...(map.level.spawns as SourceSpawn[]).filter(s=>s.team==='amber').slice(0,5),...(map.level.spawns as SourceSpawn[]).filter(s=>s.team==='blue').slice(0,5)];
world.step(); // Publish the newly attached original colliders to Rapier queries.
const baselineBodies=world.bodies.len(),mapBodies=spawns.map((spawn,i)=>{
  const profile=profiles.find(p=>p.team===(spawn.team==='amber'?'t':'ct')&&p.weapon==='vandal')!;
  const driver=createSourceRagdollPoseDriver(createSourcePoseDriver(profile.poseIndex,profile.poseVersion),profile.poseIndex,data);
  const y=level.groundHeight(spawn.x,spawn.z,spawn.y+.25);assert(y!==null,'Original spawn ground absent');
  const player={id:`map-${i}`,weapon:'vandal',sourcePose:{state:'Idle'as const,cycle:.4,parameters:{move_x:0,move_y:0}}};
  const ground={x:spawn.x,y:y+.02,z:spawn.z,yaw:spawn.yaw,metersPerSourceUnit:.0254,physicsWorld:world,surfaceY:level.groundHeight};
  const velocity=sourceRagdollVelocityFromWorld(ground,{x:1,y:.7,z:0});
  const state=driver.ragdoll!.beginRagdoll(player,{x:0,y:0,z:0},velocity,ground,driver.ragdoll!.capturePose(player));
  return{driver,player,ground,state,firstSettledTick:null as number|null};
});
const times:number[]=[],activeTimes:number[]=[];world.timestep=1/60;
for(let tick=0;tick<900;tick++){
  const start=performance.now();world.step();
  const active=mapBodies.some(body=>!body.state.settled);
  for(const body of mapBodies){body.state=body.driver.ragdoll!.stepRagdoll(body.player,1/60)!;if(body.state.settled&&body.firstSettledTick===null)body.firstSettledTick=tick;}
  const elapsed=performance.now()-start;times.push(elapsed);if(active)activeTimes.push(elapsed);
}
const contactRows=mapBodies.map(({player,state,ground,firstSettledTick})=>({id:player.id,firstSettledTick,origin:{x:ground.x,y:ground.y,z:ground.z,yaw:ground.yaw},state}));
for(const row of contactRows){assert(row.state.settled,row.id+' original map corpse did not settle');assert(row.state.positions.every(Number.isFinite));}
for(const body of mapBodies)body.driver.ragdoll!.endRagdoll(body.player);
assert.equal(world.bodies.len(),baselineBodies,'Corpse bodies leaked in shared map');
assert.equal(world.impulseJoints.len(),0,'Corpse joints leaked in shared map');
level.dispose();world.free();times.sort((a,b)=>a-b);activeTimes.sort((a,b)=>a-b);
const report={scope:'CPU original-pose and original-DustII-contact validation. No browser, service mutation or LAN sessions.',profiles:results.length,
  cases:results,map:{corpses:mapBodies.length,settled:contactRows.filter(r=>r.state.settled).length,worldStepAndReadMs:{p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],max:times.at(-1),activeTicks:activeTimes.length,activeP95:activeTimes[Math.floor(activeTimes.length*.95)]},rows:contactRows,cleanup:true}};
mkdirSync('output/fidelity-character',{recursive:true});const output=resolve('output/fidelity-character/rigid-profiles-and-map.json');writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({profiles:report.profiles,map:{...report.map,rows:undefined},output}));
