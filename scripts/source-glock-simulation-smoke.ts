import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadServerSourceMap} from '../server/source-map-data.js';
import {loadServerSourceCharacter} from '../server/source-character-data.js';
import {loadServerSourcePistol} from '../server/source-pistol-data.js';
import {createSourceRifleProfiles} from '../game/source-rifle-profiles.js';
import {Simulation,initPhysics} from '../game/simulation.js';
import {EMPTY_INPUT,type Player} from '../game/types.js';
import {sampleSourcePistolCharacterPose} from '../game/source-pistol-character-pose.js';
import {sourceCharacterBrowserBoneMatrices} from '../game/source-character-pose.js';
import {sourceActorMatrix} from '../game/source-player-contract.js';
const root='public/source/csgo-12426148',manifest=(name:string)=>`${root}/${name}/manifest.json`;
const [map,tAk,ctAk,tM4,ctM4,tGlock,ctGlock]=await Promise.all([
 loadServerSourceMap(manifest('dust2')),loadServerSourceCharacter(manifest('character-ak')),loadServerSourceCharacter(manifest('character-ct-ak')),
 loadServerSourceCharacter(manifest('character-t-m4')),loadServerSourceCharacter(manifest('character-ct-m4')),
 loadServerSourcePistol(manifest('character-t-glock'),'t','glock'),loadServerSourcePistol(manifest('character-ct-glock'),'ct','glock'),
]);
const pistols={amber:tGlock,blue:ctGlock},profiles=createSourceRifleProfiles({amber:{vandal:tAk,m4a4:tM4},blue:{vandal:ctAk,m4a4:ctM4}},map.simulationVersion,pistols);
const scenario={...map,...profiles,pistolSeed:()=>42,rifleSeed:()=>77},out:any={status:'running',simulationVersion:profiles.simulationVersion,manifestSHA256:{},cases:[],jsonReplayFrames:0,earlyReloadTransfers:[],disposedWithoutWasmBorrowError:false};
for(const name of ['dust2','character-t-glock','character-ct-glock'])out.manifestSHA256[name]=createHash('sha256').update(readFileSync(manifest(name))).digest('hex');
await initPhysics();
function torso(p:Player){
 const index=pistols[p.team].poseIndex,sample=sampleSourcePistolCharacterPose(index,p.sourcePistolPose!),bones=sourceCharacterBrowserBoneMatrices(sample.body,sourceActorMatrix(p));
 const h=index.body.data.hitboxSets[0].hitboxes.find(h=>h.group===2)!;
 const [pitch,yaw,roll]=h.extensionFloat32.slice(0,3).map(v=>v*Math.PI/180),cp=Math.cos(pitch),sp=Math.sin(pitch),cy=Math.cos(yaw),sy=Math.sin(yaw),cr=Math.cos(roll),sr=Math.sin(roll);
 const rotation=[cp*cy,cp*sy,-sp,sr*sp*cy-cr*sy,sr*sp*sy+cr*cy,sr*cp,cr*sp*cy+sr*sy,cr*sp*sy-sr*cy,cr*cp];
 const local=h.min.map((v,i)=>(v+h.max[i])/2),rotated=[0,1,2].map(r=>local.reduce((n,v,c)=>n+rotation[c*3+r]*v,0)),at=h.bone*16;
 const xyz=[0,1,2].map(r=>bones[at+12+r]+rotated.reduce((n,v,c)=>n+bones[at+c*4+r]*v,0));return{x:xyz[0],y:xyz[1],z:xyz[2]};
}
for(const team of ['amber','blue']as const)for(const crouch of [false,true]){
 const s=new Simulation('training',false,scenario);
 try{
  const t=s.addPlayer('t','T','amber'),ct=s.addPlayer('ct','CT','blue');assert(s.buy(ct.id,'glock'));
  const shooter=team==='amber'?t:ct,target=team==='amber'?ct:t;
  Object.assign(shooter,{x:1400*.0254,y:40*.0254,z:-1000*.0254,vx:0,vy:0,vz:0});Object.assign(target,{x:1400*.0254,y:40*.0254,z:-1150*.0254,vx:0,vy:0,vz:0,armor:0});
  for(let seq=1;seq<=100;seq++){
   s.setInput(shooter.id,{...EMPTY_INPUT,seq,slot:1});s.setInput(target.id,{...EMPTY_INPUT,seq,slot:1,crouch});s.step();
  }
  assert(shooter.sourcePistolPose&&target.sourcePistolPose);assert(shooter.weapon==='glock'&&target.weapon==='glock');s.history=[];
  const point=torso(target),eye=s.eyeOrigin(shooter),dx=point.x-eye.x,dy=point.y-eye.y,dz=point.z-eye.z,length=Math.hypot(dx,dy,dz),direction={x:dx/length,y:dy/length,z:dz/length};
  const mapDistance=s.wallDistance(eye.x,eye.y,eye.z,direction.x,direction.y,direction.z),witness=s.sourcePlayerContract!.raycast(target,eye,direction,mapDistance);assert(witness,'Original torso bone witness must precede actual map wall');
  s.setInput(shooter.id,{...EMPTY_INPUT,seq:101,slot:1,fire:true,time:s.time+1/60,yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(dy,Math.hypot(dx,dz))});
  s.setInput(target.id,{...EMPTY_INPUT,seq:101,slot:1,crouch});s.step();
  const shot=s.events.findLast(e=>e.by===shooter.id&&e.sourcePistolShot),hit=s.events.findLast(e=>e.by===shooter.id&&e.type==='hit');
  assert(shot&&hit&&target.hp<100,'Accepted Glock command must trace actual original body and apply damage');assert.equal(shooter.ammo,19);assert.equal(shot.sourcePistolShot!.serverSeed,42);
  out.cases.push({team,crouch,sourcePoseVersion:target.sourcePoseVersion,feet:{x:target.x,y:target.y,z:target.z},witness,mapDistance,healthAfter:target.hp,ammoAfter:shooter.ammo,shot:shot.sourcePistolShot,hit});
 }finally{s.dispose();}
}
const a=new Simulation('training',false,scenario),b=new Simulation('training',false,{...scenario,pistolSeed:()=>{throw Error('Predicted authority seed');}});
try{
 const p=a.addPlayer('p','T','amber'),q=b.addPlayer('p','T','amber');
 for(let seq=1;seq<=85;seq++){a.setInput(p.id,{...EMPTY_INPUT,seq,slot:1});a.step();}
 const snapshot=JSON.parse(JSON.stringify(a.snapshot(p.id)));Object.assign(q,snapshot.players[0]);b.time=snapshot.time;b.tick=snapshot.tick;
 for(let seq=86;seq<=425;seq++){
  const input={...EMPTY_INPUT,seq,slot:(seq>=160&&seq<175?0:1)as 0|1,mz:seq<145?-.35:0,walk:seq<120,crouch:seq>=120&&seq<145,jump:seq===150,aim:seq===100,fire:seq===115||seq===248,reload:seq===260||seq===285};
  const oldAmmo=p.ammo,oldReload=p.sourceGlock?.command.reloading;
  a.setInput(p.id,input);a.step();b.predictSourceCommand(q,input);
  if(seq===260){assert.equal(p.sourceGlock!.command.reloading,false,'Native burst nextPrimary must reject this early reload request');out.earlyReloadRequest={seq,time:a.time,nextPrimary:p.sourceGlock!.command.nextPrimary,rejected:true};}
  if(seq===285)assert.equal(p.sourceGlock!.command.reloading,true,'Retry after the actual burst primary clock must accept reload');
  if(oldReload&&p.ammo>oldAmmo)out.earlyReloadTransfers.push({seq,time:a.time,ammo:p.ammo,reserve:p.reserve,reloading:p.sourceGlock!.command.reloading,ownerNextAttack:p.sourceGlock!.command.ownerNextAttack,cycle:p.sourceGlock!.animation!.cycle,viewmodelTime:{...p.sourceViewmodelTime}});
  assert.deepEqual(q.sourceViewmodelTime,p.sourceViewmodelTime);assert.deepEqual(q.sourceGlock,p.sourceGlock);assert.deepEqual(q.sourceRifleHandling,p.sourceRifleHandling);assert.deepEqual(q.sourcePistolPose,p.sourcePistolPose);
  assert.deepEqual([q.x,q.y,q.z,q.vx,q.vy,q.vz,q.ammo,q.reserve],[p.x,p.y,p.z,p.vx,p.vy,p.vz,p.ammo,p.reserve]);out.jsonReplayFrames++;
 }
 assert.equal(b.events.filter(e=>e.type==='shot').length,0);
 assert.equal(out.earlyReloadTransfers.length,1);assert(out.earlyReloadTransfers[0].reloading&&out.earlyReloadTransfers[0].time<out.earlyReloadTransfers[0].ownerNextAttack,'AE54 must transfer before the attack deadline');
}finally{a.dispose();b.dispose();}
out.status='passed';out.disposedWithoutWasmBorrowError=true;out.boundaries=['Actual production SHA-gated map/pistol graphs and collision; private CPU Simulation only, not browser/LAN gameplay proof.','Original torso OBB witness uses complete sampled pistol body plus its raw original hitbox metadata.','Original Glock AE54 dispatch and shared index0 VM times are integrated; other rifle animation sequence/parity reconstruction is not claimed.'];
writeFileSync('output/tests/source-glock-simulation-smoke.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({status:out.status,cases:out.cases.map((c:any)=>({team:c.team,crouch:c.crouch,healthAfter:c.healthAfter})),jsonReplayFrames:out.jsonReplayFrames,disposedWithoutWasmBorrowError:true}));
