import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import { createSourceLevel, type SourceLevelData } from '../game/source-level.js';
import { createSourcePlayerMovement, type SourceMovementState, type SourceMovementInput } from '../game/source-player-movement.js';
import type { SourceMapCollisionData } from '../game/source-map-collision.js';
import { sourceNavHeight, type SourceNavigationData } from '../game/source-navigation.js';

const folder='.reference-assets/source-exports/dust2';
const corrected=process.argv.includes('--corrected');
const data=JSON.parse(fs.readFileSync(`${folder}/level.json`,'utf8')) as SourceLevelData;
const collisionBytes=fs.readFileSync(`${folder}/${corrected?'collision-ivp-corrected':'collision'}/collision.json`);
const collision=JSON.parse(collisionBytes.toString()) as SourceMapCollisionData;
const nav=JSON.parse(fs.readFileSync(`${folder}/navigation/navigation.json`,'utf8')) as SourceNavigationData;
const u=data.metersPerSourceUnit,dt=1/60,identity={x:0,y:0,z:0,w:1};
const sourcePoint=(p:readonly number[])=>({x:p[0]*u,y:p[2]*u,z:-p[1]*u});
const idle:SourceMovementInput={forward:0,right:0,yaw:0,jump:false,crouch:false,dt,maxSpeed:215*u};
await RAPIER.init();const world=new RAPIER.World({x:0,y:-data.player.gravity,z:0});world.timestep=dt;
const level=createSourceLevel(world,data,collision),movement=createSourcePlayerMovement(world,level);
const groups=level.queryGroups('player'),flags=RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
world.step();
function contacts(feet:SourceMovementState['feet'],stance:SourceMovementState['stance'],self?:RAPIER.Collider){
  const [x,y,z]=level.player[stance].halfExtents,center={...feet,y:feet.y+y},shape=new RAPIER.Cuboid(x,y,z),hits:RAPIER.Collider[]=[];
  world.intersectionsWithShape(center,identity,shape,c=>{hits.push(c);return true;},flags,groups,self);
  return hits.flatMap(c=>{const contact=c.contactShape(shape,center,identity,0);return contact&&contact.distance<0?
    [{source:level.collision.metadata.get(c.handle)?.source,distance:contact.distance,normal:contact.normal1}]:[];});
}
function actor(feet:SourceMovementState['feet'],stance:SourceMovementState['stance']='standing'){
  const half=level.player[stance].halfExtents;
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(feet.x,feet.y+half[1],feet.z));
  const collider=world.createCollider(RAPIER.ColliderDesc.cuboid(...half).setCollisionGroups(groups),body);world.step();
  let state:SourceMovementState={feet:{...feet},velocity:{x:0,y:0,z:0},grounded:false,stance,jumpHeld:false};
  let maxPenetration=0,ticks=0;const cpu:number[]=[];
  function tick(input:Partial<SourceMovementInput>={}){
    const started=performance.now(),next=movement.step(body,collider,state,{...idle,crouch:state.stance==='crouching',...input});
    state=next;world.step();cpu.push(performance.now()-started);ticks++;
    for(const contact of contacts(state.feet,state.stance,collider))maxPenetration=Math.max(maxPenetration,-contact.distance);
    assert(Object.values(state.feet).every(Number.isFinite));
    return next;
  }
  function settle(){let landed=-1;for(let i=0;i<180;i++){tick();if(state.grounded&&landed<0)landed=i;if(landed>=0&&i-landed>=15)break;}return landed;}
  return {body,collider,tick,settle,get state(){return state;},get maxPenetration(){return maxPenetration;},get ticks(){return ticks;},cpu,
    dispose(){world.removeRigidBody(body);world.step();}};
}
const cpu:number[]=[];
const spawns=(['standing','crouching'] as const).flatMap(stance=>data.spawns.map(spawn=>{
  const a=actor(spawn,stance),landedTick=a.settle(),result={id:spawn.id,team:spawn.team,stance,authored:{x:spawn.x,y:spawn.y,z:spawn.z},
    landedTick,final:a.state,maxPenetration:a.maxPenetration,ticks:a.ticks};cpu.push(...a.cpu);a.dispose();return result;
}));
console.log('SPAWNS',spawns.length,'landed',spawns.filter(s=>s.landedTick>=0).length,'maxPen',Math.max(...spawns.map(s=>s.maxPenetration)));
const routes=[
  {label:'middle to doors',start:[-400,900,16],end:[-400,1800,16]},
  {label:'long approach',start:[1400,1000,40],end:[1400,2200,40]},
  {label:'B site interior original blocked AABB endpoint',start:[-1560,2560,40],end:[-1440,2820,40]},
  {label:'A site interior',start:[1110,2510,102],end:[1200,2580,102]},
  {label:'CT authored stair line',start:[256,2200,-50],end:[256,2440,-50]},
  {label:'B site inset reachable endpoint',start:[-1560,2560,40],end:[-1456,2804,40]},
];
const walks=(['standing','crouching'] as const).flatMap(stance=>routes.map(route=>{
  const a=actor(sourcePoint(route.start),stance),landedTick=a.settle(),target=sourcePoint(route.end);
  const samples:unknown[]=[],touched=new Map<string,unknown>();let blockedRun=0,maxBlockedRun=0,steps=0;
  for(;steps<1800;steps++){
    const before=a.state.feet,dx=target.x-before.x,dz=target.z-before.z,distance=Math.hypot(dx,dz);
    if(distance<.08)break;
    const result=a.tick({forward:1,yaw:Math.atan2(-dx,-dz)});
    const progress=Math.hypot(result.feet.x-before.x,result.feet.z-before.z);
    blockedRun=progress<.0001?blockedRun+1:0;maxBlockedRun=Math.max(maxBlockedRun,blockedRun);
    for(const hit of result.collisions){const source=hit.handle===null?null:level.collision.metadata.get(hit.handle)?.source;if(source)touched.set(JSON.stringify(source),source);}
    if(steps%30===0||blockedRun===90)samples.push({tick:steps,feet:result.feet,velocity:result.velocity,grounded:result.grounded,stepped:result.stepped});
    if(blockedRun===90)break;
  }
  const final=a.state,remaining=Math.hypot(final.feet.x-target.x,final.feet.z-target.z);
  const result={...route,stance,landedTick,reached:remaining<.08,remaining,steps,maxBlockedRun,final,maxPenetration:a.maxPenetration,
    touched:[...touched.values()],endpointPenetrations:contacts({...target,y:final.feet.y},stance,a.collider),samples};
  cpu.push(...a.cpu);a.dispose();console.log('ROUTE',stance,route.label,result.reached,remaining,steps,'pen',result.maxPenetration);return result;
}));
// NAV areas are only candidate sample locations. A real full AABB collision
// query, not flags or a NAV rectangle, decides low-ceiling feasibility.
let lowCeilingCandidate:{areaId:number;flags:number;feet:SourceMovementState['feet'];contacts:ReturnType<typeof contacts>}|null=null;
let testedNavPoints=0;
for(const area of [...nav.areas].sort((a,b)=>Number(Boolean(b.flags&1))-Number(Boolean(a.flags&1)))){
  const x=(area.nw[0]+area.se[0])/2,y=(area.nw[1]+area.se[1])/2,z=sourceNavHeight(area,x,y);
  const feet=sourcePoint([x,y,z+.25]);testedNavPoints++;
  if(contacts(feet,'crouching').some(c=>c.distance<-.0001))continue;
  const stand=contacts(feet,'standing');if(!stand.some(c=>c.distance<-.01))continue;
  const a=actor(feet,'crouching'),landed=a.settle();
  if(landed>=0&&a.maxPenetration<.001&&contacts(a.state.feet,'standing',a.collider).some(c=>c.distance<-.01))
    lowCeilingCandidate={areaId:area.id,flags:area.flags,feet:a.state.feet,contacts:contacts(a.state.feet,'standing',a.collider)};
  a.dispose();if(lowCeilingCandidate)break;
}
let lowCeiling:unknown=null;
if(lowCeilingCandidate){
  const a=actor(lowCeilingCandidate.feet,'crouching');a.settle();const before=a.state,attempt=a.tick({crouch:false});
  const blockers=attempt.stanceBlockers.map(handle=>level.collision.metadata.get(handle)?.source);
  lowCeiling={...lowCeilingCandidate,testedNavPoints,before,attempt,blockers,maxPenetration:a.maxPenetration};cpu.push(...a.cpu);a.dispose();
  assert(attempt.stanceBlocked&&attempt.stance==='crouching');
}
console.log('LOW CEILING',lowCeilingCandidate?.areaId??null,'candidates',testedNavPoints);
const jumpActor=actor(data.spawns.find(s=>s.team==='amber')!);jumpActor.settle();const jumpGround={...jumpActor.state.feet};
const jumpSamples:unknown[]=[];let jumpCount=0,landedAfterJump=-1,maxY=jumpGround.y;
for(let i=0;i<180;i++){const s=jumpActor.tick({jump:true});jumpCount+=Number(s.jumped);maxY=Math.max(maxY,s.feet.y);
  if(i>10&&s.grounded&&landedAfterJump<0)landedAfterJump=i;
  if(i%10===0)jumpSamples.push({tick:i,feet:s.feet,velocity:s.velocity,grounded:s.grounded,jumped:s.jumped});}
jumpActor.tick({jump:false});const fresh=jumpActor.tick({jump:true});
const jumps={ground:jumpGround,jumpCount,landedAfterJump,apexRise:maxY-jumpGround.y,freshPressJumped:fresh.jumped,maxPenetration:jumpActor.maxPenetration,samples:jumpSamples};
cpu.push(...jumpActor.cpu);jumpActor.dispose();
// At the previously evidenced oblique PLAYERCLIP edge, approach obliquely then
// steer along its boundary. Check actual hull penetration and tangential motion.
const edgeActor=actor(sourcePoint([-1560,2560,40]));edgeActor.settle();const edgeStart={...edgeActor.state.feet},edgeSamples:unknown[]=[];
let edgeContacts=0;for(let i=0;i<240;i++){
  const target=sourcePoint([-1390,2840,40]),dx=target.x-edgeActor.state.feet.x,dz=target.z-edgeActor.state.feet.z;
  const s=edgeActor.tick({forward:1,yaw:i<150?Math.atan2(-dx,-dz):Math.PI/2});
  edgeContacts+=s.collisions.filter(hit=>hit.handle!==null&&level.collision.metadata.get(hit.handle)?.source.brush===846).length;
  if(i%15===0)edgeSamples.push({tick:i,feet:s.feet,velocity:s.velocity,grounded:s.grounded});
}
const slantedEdge={start:edgeStart,final:edgeActor.state,brush846Contacts:edgeContacts,maxPenetration:edgeActor.maxPenetration,samples:edgeSamples};
cpu.push(...edgeActor.cpu);edgeActor.dispose();
movement.dispose();movement.dispose();level.dispose();assert.equal(world.colliders.len(),0);world.free();
cpu.sort((a,b)=>a-b);const pct=(p:number)=>cpu[Math.min(cpu.length-1,Math.floor(p*(cpu.length-1)))];
const result={sourceBspSha256:data.sourceBspSha256,sourceServerSha256:data.player.sourceServerSha256,
  sourceCollisionSha256:createHash('sha256').update(collisionBytes).digest('hex'),parameters:movement.parameters,
  fixedDt:dt,callerWeaponMaxSpeed:idle.maxSpeed,maxPenetrationTolerance:.001,spawns,walks,lowCeiling,jumps,slantedEdge,
  cpu:{samples:cpu.length,scope:'one actor movement + world.step; full Dust2 colliders, no renderer/network',meanMs:cpu.reduce((a,b)=>a+b,0)/cpu.length,p50Ms:pct(.5),p95Ms:pct(.95),p99Ms:pct(.99),maxMs:cpu.at(-1)},
  freedWithoutWasmBorrowError:true,implementationSha256:createHash('sha256').update(fs.readFileSync('game/source-player-movement.ts')).digest('hex')};
const outputAt=process.argv.indexOf('--output'),outputPath=outputAt>=0?process.argv[outputAt+1]:`output/tests/source-player-movement${corrected?'-ivp-corrected':''}.json`;
if(!outputPath)throw Error('--output needs a path');
fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
assert(spawns.every(s=>s.landedTick>=0&&s.final.grounded&&s.maxPenetration<.001),'All 30 original spawns land in both stances');
assert(walks.filter(w=>!w.label.includes('original blocked')).every(w=>w.reached&&w.maxPenetration<.001),'All feasible routes pass without hull penetration');
assert(walks.filter(w=>w.label.includes('original blocked')).every(w=>!w.reached&&w.endpointPenetrations.some(p=>p.source?.brush===846)),'Original impossible B endpoint remains blocked by brush 846');
assert(lowCeiling,'Find a real Source low-ceiling location');
assert(jumps.jumpCount===1&&jumps.landedAfterJump>0&&jumps.freshPressJumped&&jumps.maxPenetration<.001,'Held jump and fresh repress on real map');
assert(slantedEdge.brush846Contacts>0&&slantedEdge.maxPenetration<.001,'Oblique playerclip contacts without hull penetration');
console.log('PASS',JSON.stringify({cpu:result.cpu,jumps,lowCeilingArea:lowCeilingCandidate?.areaId},null,2));
