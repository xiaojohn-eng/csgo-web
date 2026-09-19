/** Actual Simulation input path and original DustII geometry. The payload is
 * filtered and MessagePack-roundtripped with the server's Packr options; this
 * is CPU/protocol evidence, not a live LAN session or browser screenshot. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Packr} from 'msgpackr';
import {Quaternion,Vector3} from 'three';
const args=process.argv.slice(2),arg=(key:string,fallback:string)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const appRoot=resolve(arg('--app-root','.')),root=resolve(appRoot,'public/source/csgo-12426148'),manifest=(name:string)=>`${root}/${name}/manifest.json`;
const mainHEAD=execFileSync('git',['rev-parse','HEAD'],{cwd:appRoot,encoding:'utf8'}).trim(),simulationSHA256=createHash('sha256').update(readFileSync(resolve(appRoot,'game/simulation.ts'))).digest('hex');
const moduleAt=(name:string)=>import(pathToFileURL(resolve(appRoot,name+'.ts')).href);
const [mapModule,characterModule,pistolModule,deagleModule,awpModule,profilesModule,ragdollModule,simModule,types,visibility,tactics,colliders]=await Promise.all([
 'server/source-map-data','server/source-character-data','server/source-pistol-data','server/source-deagle-data','server/source-awp-data','game/source-rifle-profiles','game/source-ragdoll','game/simulation','game/types','server/visibility','game/tactics','game/source-grenade-colliders'].map(moduleAt));
const [map,tAk,ctAk,tM4,ctM4,tGlock,ctGlock,tUsp,ctUsp,tDeagle,ctDeagle,tAwp,ctAwp]=await Promise.all([
 mapModule.loadServerSourceMap(manifest('dust2')),
 ...['character-ak','character-ct-ak','character-t-m4','character-ct-m4'].map(name=>characterModule.loadServerSourceCharacter(manifest(name))),
 ...(['glock','usp']as const).flatMap(weapon=>(['t','ct']as const).map(team=>pistolModule.loadServerSourcePistol(manifest(`character-${team}-${weapon}`),team,weapon))),
 ...(['t','ct']as const).map(team=>deagleModule.loadServerSourceDeagle(manifest(`character-${team}-deagle`),team)),
 ...(['t','ct']as const).map(team=>awpModule.loadServerSourceAWP(manifest(`character-${team}-awp`),team)),
]);
const ragdoll=ragdollModule.parseSourceRagdollData(JSON.parse(readFileSync(`${root}/ragdoll/ragdoll-data.json`,'utf8')));
const profiles=profilesModule.createSourceRifleProfiles({amber:{vandal:tAk,m4a4:tM4},blue:{vandal:ctAk,m4a4:ctM4}},map.simulationVersion,{amber:tGlock,blue:ctGlock},{amber:tUsp,blue:ctUsp},{amber:tDeagle,blue:ctDeagle},{amber:tAwp,blue:ctAwp},ragdoll);
await simModule.initPhysics();const packr=new Packr({useRecords:false}),rows:any[]=[],failures:string[]=[];
for(const team of ['amber','blue'])for(const kind of ['he','smoke','flash']){
 const simulation=new simModule.Simulation('training',false,{...map,...profiles});let seq=0;
 const row:any={team,kind,input:{style:'underhand',pitch:-.4,holdTicks:12},samples:[],checks:{}};rows.push(row);
 try{
  const p=simulation.addPlayer('thrower','Grenade integration',team),inventory=kind==='he'?'grenades':kind==='smoke'?'smokes':'flashes';
  const input=(hold=false,release=false)=>({...types.EMPTY_INPUT,seq:++seq,yaw:p.yaw,pitch:-.4,time:simulation.time,utility:kind,grenadeHold:hold,aim:release});
  const step=(hold=false,release=false)=>{simulation.setInput(p.id,input(hold,release));simulation.step();};
  for(let i=0;i<90;i++)step();assert(p.grounded);assert(p[inventory]>0);
  row.spawn={x:p.x,y:p.y,z:p.z,yaw:p.yaw,groundY:simulation.sourceLevel.groundHeight(p.x,p.z,p.y+.3),inventory:p[inventory]};
  for(let i=0;i<12;i++)step(true);assert(p.sourceGrenadeHold);assert.equal(simulation.grenades.length,0);
  const before=p[inventory];step(false,true);assert.equal(p[inventory],before-1);assert.equal(simulation.grenades.length,1);
  const projectileId=simulation.grenades[0].id,releaseTime=simulation.time-1/60,initialQ=new Quaternion().copy(simulation.grenades[0].body.rotation());
  row.projectileId=projectileId;row.releaseTime=releaseTime;
  let wireFrames=0,maxRotation=0,maxNormError=0,lastVy:number|null=null,lastContactTick=-999,seenDetonation=false,smokeBorn=0,smokeGone=false;
  const hull=colliders.SOURCE_GRENADE_COLLIDERS[kind].hullMetres as number[],q=new Quaternion(),v=new Vector3();
  for(let tick=0;tick<1200;tick++){
   const projectile=simulation.grenades.find((g:any)=>g.id===projectileId),snapshot=simulation.snapshot(p.id);
   visibility.filterVisibility(snapshot,p.id,0,simulation);const decoded=packr.unpack(packr.pack(snapshot));
   const wire=decoded.grenades.find((g:any)=>g.id===projectileId);
   if(projectile){
    assert(wire?.rotation,'Missing server grenade quaternion after recipient filter + MessagePack');
    const position=projectile.body.translation(),rotation=projectile.body.rotation(),velocity=projectile.body.linvel();
    assert.deepEqual(wire.rotation,{...rotation});assert.equal(wire.kind,kind);wireFrames++;
    q.copy(rotation);maxNormError=Math.max(maxNormError,Math.abs(q.length()-1));maxRotation=Math.max(maxRotation,initialQ.angleTo(q));
    const originalX=wire.rotation.x;wire.rotation.x+=1;assert.equal(simulation.snapshot().grenades.find((g:any)=>g.id===projectileId).rotation.x,originalX);wire.rotation.x=originalX;
    const contacts:any[]=[];
    simulation.world.contactPairsWith(projectile.body.collider(0),(other:any)=>{
     const metadata=simulation.sourceLevel.collision.metadata.get(other.handle);if(!metadata||metadata.sensor)return;
     simulation.world.contactPair(projectile.body.collider(0),other,(manifold:any)=>{for(let j=0;j<manifold.numContacts();j++)if(manifold.contactDist(j)<.006)contacts.push({distance:manifold.contactDist(j),normal:{...manifold.normal()},source:metadata.source});});
    });
    const groundY=simulation.sourceLevel.groundHeight(position.x,position.z,position.y+.25,20);
    let hullMinY=Infinity;for(let i=0;i<hull.length;i+=3){v.fromArray(hull,i).applyQuaternion(q).add(position);hullMinY=Math.min(hullMinY,v.y);}
    const sample={tick:simulation.tick,t:simulation.time-releaseTime,pose:wire,velocity:{...velocity},groundY,hullMinY,hullClearance:groundY===null?null:hullMinY-groundY,contacts};
    if(contacts.length){lastContactTick=tick;if(!row.firstMapContact)row.firstMapContact=sample;}
    if(lastVy!==null&&lastVy<-.3&&velocity.y>.05&&tick-lastContactTick<4&&!row.firstGroundBounce)row.firstGroundBounce=sample;
    if(tick===0||tick%6===0||contacts.length&&!row.samples.at(-1)?.contacts?.length)row.samples.push(sample);
    row.lastProjectile=sample;lastVy=velocity.y;
   }
   const event=decoded.events.find((e:any)=>e.by===p.id&&e.type===(kind==='he'?'grenade':kind));
   if(event&&!seenDetonation){
    seenDetonation=true;const groundY=simulation.sourceLevel.groundHeight(event.x,event.z,event.y+.25,20);
    row.detonation={...event,t:event.time-releaseTime,groundY,centerClearance:groundY===null?null:event.y-groundY};assert(!wire);assert(!projectile);
    if(kind==='smoke'){
     const smoke=decoded.smokes.find((s:any)=>s.id===projectileId);assert(smoke);assert.deepEqual([smoke.x,smoke.y,smoke.z],[event.x,event.y,event.z]);
     row.smokeInitial=smoke;smokeBorn=simulation.time;
    }else break;
   }
   if(kind==='smoke'&&seenDetonation){
    const smoke=decoded.smokes.find((s:any)=>s.id===projectileId);
    if(smoke){
     if(smoke.remaining>2)row.smokeFull={...smoke,radius:tactics.smokeRadius(smoke)};
     if(smoke.remaining<.2)row.smokeTail={...smoke,radius:tactics.smokeRadius(smoke)};
    }else{smokeGone=true;row.smokeRemoved={time:simulation.time,age:simulation.time-smokeBorn};break;}
   }
   step();
  }
  row.checks={consumedOne:true,wireFrames,maxRotationRadians:maxRotation,maxQuaternionNormError:maxNormError,originalMapContact:!!row.firstMapContact,groundBounce:!!row.firstGroundBounce,detonated:seenDetonation,smokeRemoved:kind==='smoke'?smokeGone:null};
  assert(wireFrames>20&&maxRotation>.5&&maxNormError<1e-5,'Grenade did not visibly rotate with a valid transmitted quaternion');
  assert(row.firstMapContact&&row.firstGroundBounce,'No real map contact and ground bounce before detonation');assert(seenDetonation,'Grenade did not detonate');
  assert(row.detonation.groundY!==null,'No original map support below detonation');assert(Math.abs(row.lastProjectile.hullClearance)<.015,'Original grenade hull did not reach the real support surface');
  const fuse=kind==='smoke'?1.8:1.5;assert(row.detonation.t>=fuse-1e-6&&row.detonation.t<=fuse+2/60,'Grenade detonation clock drifted');
  if(kind==='smoke'){
   assert(smokeGone&&row.smokeRemoved.age>=16&&row.smokeRemoved.age<16.05,'Smoke did not expire on its authority timer');
   assert(row.smokeFull.radius>3.4&&row.smokeTail.radius<.5,'Smoke did not shrink before removal');
   if(row.detonation.groundY<0)assert(row.smokeInitial.y<0,'Below-zero Source smoke was raised to an artificial plane');
  }
  row.status='passed';
 }catch(error){row.status='failed';row.error=String(error);failures.push(`${team}/${kind}: ${error}`);}finally{simulation.dispose();}
}
const output=resolve(arg('--output',resolve(appRoot,'output/fidelity-fixes-2026-09-13/grenade-integration.json'))),report={status:failures.length?'failed':'passed',mainHEAD,mainHEADEnd:execFileSync('git',['rev-parse','HEAD'],{cwd:appRoot,encoding:'utf8'}).trim(),simulationSHA256,simulationVersion:map.simulationVersion,
 scope:'Six actual Simulation input-driven throws (three utilities at both original team spawns), natural physics and fuse/smoke clocks. Recipient-filtered MessagePack payload roundtrip; not live LAN transport, browser/GPU evidence, or native CS:GO ballistic/fuse equivalence.',failures,rows};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,mainHEAD,output,failures,rows:rows.map(row=>({team:row.team,kind:row.kind,status:row.status,checks:row.checks,bounceTime:row.firstGroundBounce?.t,detonationTime:row.detonation?.t,groundY:row.detonation?.groundY,finalHullClearance:row.lastProjectile?.hullClearance,smokeRemoved:row.smokeRemoved}))}));
if(failures.length)process.exitCode=1;
