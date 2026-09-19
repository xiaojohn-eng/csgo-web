import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT} from '../game/types';
import type {SourceScenario} from '../game/source-scenario';
const folder='.reference-assets/source-exports/dust2',read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const bytes=fs.readFileSync(folder+'/collision-ivp-corrected/collision.json');
const data:SourceScenario={level:read(folder+'/level.json'),collision:JSON.parse(bytes.toString()),navigation:read(folder+'/navigation/navigation.json'),rifleSeed:()=>42};
await initPhysics();const a=new Simulation('training',false,data),b=new Simulation('training',false,data),u=.0254;
const p=a.addPlayer('p','Walk','amber'),q=b.addPlayer('p','Replay','amber');
Object.assign(p,{x:1400*u,y:40*u,z:-1000*u,yaw:0,grounded:false});Object.assign(q,structuredClone(p));
let maxPenetration=0,replayed=0;const frames=[];
try{
 for(let i=0;i<330;i++){
  const phase=i<30?'settle':i<90?'run':i<210?'walk':i<270?'duck':'stand-walk';
  const input={...EMPTY_INPUT,seq:i+1,mz:phase==='settle'?0:-1,walk:phase==='walk'||phase==='duck'||phase==='stand-walk',crouch:phase==='duck'};
  a.setInput(p.id,input);a.step();
  if(i===150){const snapshot=JSON.parse(JSON.stringify(a.snapshot(p.id)));Object.assign(q,snapshot.players.find((v:{id:string})=>v.id===p.id));b.time=snapshot.time;b.tick=snapshot.tick;}
  else if(i>150){b.predictSourceCommand(q,input);assert.deepEqual([q.x,q.y,q.z,q.sourceWalking,q.sourceFallVelocity,q.sourceRifleHandling],[p.x,p.y,p.z,p.sourceWalking,p.sourceFallVelocity,p.sourceRifleHandling]);replayed++;}
  const half=a.sourceLevel!.player[p.crouch?'crouching':'standing'].halfExtents,shape=new RAPIER.Cuboid(...half),center={x:p.x,y:p.y+half[1],z:p.z};
  const owned=(a as unknown as {bodies:Map<string,{collider:RAPIER.Collider}>}).bodies.get(p.id)!.collider,hits:RAPIER.Collider[]=[];
  a.world.intersectionsWithShape(center,{x:0,y:0,z:0,w:1},shape,c=>{hits.push(c);return true;},RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,a.sourceLevel!.queryGroups('player'),owned);
  for(const c of hits){const contact=c.contactShape(shape,center,{x:0,y:0,z:0,w:1},0);if(contact)maxPenetration=Math.max(maxPenetration,-contact.distance);}
  frames.push({tick:i,phase,feet:{x:p.x,y:p.y,z:p.z},speedSource:Math.hypot(p.vx,p.vz)/u,walking:p.sourceWalking,crouch:p.crouch,grounded:p.grounded});
 }
 assert(frames[120]!.walking);assert(frames[240]!.crouch&&!frames[240]!.walking);assert(!frames.at(-1)!.crouch&&frames.at(-1)!.walking);
 assert(maxPenetration<.001);assert(replayed===179);
 fs.writeFileSync('output/tests/source-walking-dust2.json',JSON.stringify({status:'real_dust2_walking_duck_stand_and_json_replay_pass',collisionSha256:createHash('sha256').update(bytes).digest('hex'),frames,maxPenetration,replayed},null,2)+'\n');
 console.log(JSON.stringify({status:'pass',maxPenetration,replayed,phases:[frames[29],frames[89],frames[209],frames[269],frames[329]]}));
}finally{a.dispose();b.dispose();}
