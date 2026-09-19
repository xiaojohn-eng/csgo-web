import {beforeAll,afterEach,expect,it,vi} from 'vitest';
import {Simulation,initPhysics} from '../game/simulation';
import RAPIER from '@dimforge/rapier3d-compat';
import {EMPTY_INPUT} from '../game/types';
import type {SourceScenario} from '../game/source-scenario';
import type {SourceActorPose,SourcePoint} from '../game/source-player-contract';
import {filterVisibility} from '../server/visibility';
import {flashExposure} from '../game/tactics';
beforeAll(initPhysics);const live:Simulation[]=[];afterEach(()=>live.splice(0).forEach(s=>s.dispose()));
function scenario():SourceScenario{
 const bounds={min:[-20,-8,-20] as [number,number,number],max:[20,10,20] as [number,number,number]};
 const box=(x:number,y:number,z:number)=>[-x,-y,-z,-x,-y,z,-x,y,-z,-x,y,z,x,-y,-z,x,-y,z,x,y,-z,x,y,z];
 const level:SourceScenario['level']={format:'source-level-v1',id:'source-fixture',name:'Source fixture',sourceBspSha256:'fixture',metersPerSourceUnit:.0254,
  worldBounds:bounds,boundsMeaning:'fixture',spawns:(['blue','amber']as const).map((team,i)=>({id:team,team,x:i?4:-4,y:-3.75,z:0,yaw:0,pitch:0,
   sourceClassname:'fixture',sourceOrigin:[0,0,0],sourceAngles:[0,0,0]})),sites:[{name:'A',sourceModel:1,hammerid:'A',bounds},{name:'B',sourceModel:2,hammerid:'B',bounds}],
  siteBinding:'fixture',navigation:null,navigationStatus:'none',sourceNavSha256:'nav-fixture',player:{standing:{halfExtents:[.4064,.9144,.4064],eyeHeight:1.6256},
   crouching:{halfExtents:[.4064,.6858,.4064],eyeHeight:1.1684},gravity:20.32,stepHeight:.4572,standableNormal:.7,sourceServerSha256:'fixture',hullMeaning:'Source AABB'}};
 const instance=(geometry:number,translation:[number,number,number],roles:('player'|'bullet'|'projectile')[],source={})=>({geometry,translation,roles,source,rotation:[0,0,0,1]as[number,number,number,number],scale:1});
 return{level,collision:{format:'source-map-collision-v1',sourceMap:level.id,sourceBspSha256:'fixture',metersPerSourceUnit:.0254,missingPHY:[],limits:[],
  geometries:[{id:0,kind:'convex',vertices:box(20,.5,20),source:{}},{id:1,kind:'convex',vertices:box(1,2,1),source:{}},
   {id:2,kind:'convex',vertices:box(20,3,.05),source:{}}],colliders:[instance(0,[0,-4.5,0],['player','bullet','projectile']),instance(2,[0,-1,-2],['player'])],
  sensors:[instance(1,[-4,-3,0],[],{classname:'func_bomb_target',model:1,hammerid:'A'}),instance(1,[4,-3,0],[],{classname:'func_bomb_target',model:2,hammerid:'B'})]},
  navigation:{format:'source-navigation-v1',version:16,subVersion:1,sourceBspSha256:'fixture',sourceNavSha256:'nav-fixture',metersPerSourceUnit:.0254,places:[],ladders:[],areas:[
   {id:1,flags:0,nw:[-300,-100,-4/.0254],se:[0,100,-4/.0254],neZ:-4/.0254,swZ:-4/.0254,place:0,connections:[[],[2],[],[]],ladders:[[],[]]},
   {id:2,flags:0,nw:[0,-100,-4/.0254],se:[300,100,-4/.0254],neZ:-4/.0254,swZ:-4/.0254,place:0,connections:[[],[],[],[1]],ladders:[[],[]]}]}};
}
function sim(data=scenario(),bots=false){const s=new Simulation('training',bots,data);live.push(s);return s;}
it('carries the verified simulation data identity in authoritative snapshots',()=>{
 const data=scenario();data.simulationVersion='verified-level:collision:navigation';
 const s=sim(data);s.addPlayer('p','P','blue');
 expect(s.scenarioIdentity?.simulationVersion).toBe(data.simulationVersion);
 expect(s.snapshot('p').simulationVersion).toBe(data.simulationVersion);
});
it('keeps each original rifle across input slots, purchases and surviving round spawns',()=>{
 const data=scenario();data.weapons=['vandal','m4a4'];data.defaultWeaponByTeam={amber:'vandal',blue:'m4a4'};
 const pose=(id:string)=>({id,advance:()=>({state:'Idle' as const,cycle:0,parameters:{}})});
 data.poseDriversByWeapon={amber:{vandal:pose('t-ak'),m4a4:pose('t-m4')},blue:{vandal:pose('ct-ak'),m4a4:pose('ct-m4')}};
 const s=sim(data),p=s.addPlayer('p','CT','blue');
 expect(p.weapon).toBe('m4a4');expect(p.sourcePoseVersion).toBe('ct-m4');
 s.setInput(p.id,{...EMPTY_INPUT,slot:1});s.step();expect(p.weapon).toBe('m4a4');expect(p.slot).toBe(0);
 expect(s.buy(p.id,'vandal')).toBe(true);expect(p.sourcePoseVersion).toBe('ct-ak');
 p.money=3400;expect(s.buy(p.id,'m4a4')).toBe(true);expect(p.sourcePoseVersion).toBe('ct-m4');
 s.nextRound();expect(p.weapon).toBe('m4a4');expect(p.ammo).toBe(30);expect(p.sourcePoseVersion).toBe('ct-m4');
 p.alive=false;s.nextRound();expect(p.weapon).toBe('m4a4');expect(p.ammo).toBe(30);
 expect(s.buy(p.id,'marshal')).toBe(false);
});
it('rewinds the target weapon as well as its pose when a purchase occurs after the shot time',()=>{
 const data=scenario();data.weapons=['vandal','m4a4'];data.defaultWeaponByTeam={amber:'vandal',blue:'m4a4'};
 const oldHit=vi.fn((_pose:SourceActorPose)=>({distance:5,head:false,group:3})),newHit=vi.fn((_pose:SourceActorPose)=>null);
 data.hitboxesByWeapon={blue:{m4a4:{id:'ct-m4',status:'verified-bone-hitboxes',raycast:oldHit},vandal:{id:'ct-ak',status:'verified-bone-hitboxes',raycast:newHit}}};
 const s=sim(data),p=s.addPlayer('p','T','amber'),target=s.addPlayer('e','CT','blue');s.step();const time=s.time;
 expect(s.buy(target.id,'vandal')).toBe(true);s.time+=.05;s.shoot(p,{...EMPTY_INPUT,time});
 expect(oldHit).toHaveBeenCalledOnce();expect(newHit).not.toHaveBeenCalled();
 expect(oldHit.mock.calls[0][0].weapon).toBe('m4a4');
});
it('routes original hitgroups and helmets through native bullet damage without applying generic armor twice',()=>{
 for(const [weapon,group,helmet,damage,armorAfter]of [
   ['vandal',2,true,27,95],['m4a4',1,true,92,80],['vandal',3,true,34,94],['vandal',6,true,27,100],['vandal',1,false,144,100],
 ]as const){
   const data=scenario();data.weapons=['vandal','m4a4'];data.hitboxes={id:'native-group-fixture',status:'verified-bone-hitboxes',
     raycast:()=>({distance:0,head:group===1,group})};
   const s=sim(data),p=s.addPlayer('p','T','amber'),target=s.addPlayer('e','CT','blue');
   p.weapon=p.primary=weapon;target.armor=100;target.helmet=helmet;s.step();s.shoot(p,{...EMPTY_INPUT,time:s.time});
   expect(target.hp).toBe(Math.max(0,100-damage));expect(target.armor).toBe(armorAfter);
   expect(s.events.findLast(e=>e.type==='hit')?.damage).toBe(damage);
 }
});
it('charges original armor prices and keeps a purchased helmet when repairing the vest',()=>{
 const s=sim(),p=s.addPlayer('p','T','amber');p.armor=100;p.helmet=false;p.money=350;
 expect(s.buy(p.id,'helmet')).toBe(true);expect(p.money).toBe(0);expect(p.helmet).toBe(true);expect(p.armor).toBe(100);
 p.money=2000;p.armor=40;expect(s.buy(p.id,'helmet')).toBe(false);expect(p.money).toBe(2000);
 expect(s.buy(p.id,'armor')).toBe(true);expect(p.money).toBe(1350);expect(p.armor).toBe(100);expect(p.helmet).toBe(true);
 p.helmet=false;p.armor=99;p.money=999;expect(s.buy(p.id,'helmet')).toBe(false);expect(p.armor).toBe(99);expect(p.helmet).toBe(false);
 p.money=1000;expect(s.buy(p.id,'helmet')).toBe(true);expect(p.money).toBe(0);expect(p.armor).toBe(100);expect(p.helmet).toBe(true);
});
it('keeps T and CT authority pose versions separate at spawn and prediction movement',()=>{
 const data=scenario();
 data.poseDrivers={amber:{id:'original-T',advance(p,previous,dt){expect(p.team).toBe('amber');return{state:'Idle',cycle:(previous.sourcePose?.cycle??0)+dt,parameters:{move_x:1}};}},
   blue:{id:'original-CT',advance(p,previous,dt){expect(p.team).toBe('blue');return{state:'Idle',cycle:(previous.sourcePose?.cycle??0)+dt,parameters:{move_x:-1}};}}};
 const a=sim(data),t=a.addPlayer('t','T','amber'),ct=a.addPlayer('ct','CT','blue');
 expect(t.sourcePoseVersion).toBe('original-T');expect(ct.sourcePoseVersion).toBe('original-CT');
 for(let i=0;i<12;i++){a.move(t,{...EMPTY_INPUT,mx:1});a.move(ct,{...EMPTY_INPUT,mx:-1});a.world.step();}
 expect(t.sourcePoseVersion).toBe('original-T');expect(ct.sourcePoseVersion).toBe('original-CT');
 expect(t.sourcePose!.parameters.move_x).toBe(1);expect(ct.sourcePose!.parameters.move_x).toBe(-1);
 expect(a.snapshot().players.map(p=>p.sourcePoseVersion)).toEqual(['original-T','original-CT']);
});
it('owns separate Source worlds, uses negative-height spawns and original eyes, and never enters C02 pose clearance',()=>{
 const data=scenario(),a=sim(data),b=sim(data),p=a.addPlayer('p','P','blue'),q=b.addPlayer('p','P','blue');
 expect(a.sourceLevel).not.toBe(b.sourceLevel);expect(p.y).toBeLessThan(-3.9);expect(p.sourceContract).toBe('csgo-player-12426148');
 expect(a.bodies.get(p.id)!.collider.shapeType()).toBe(RAPIER.ShapeType.Cuboid);
 const guard=vi.spyOn(a,'poseClearance').mockImplementation(()=>{throw Error('C02 called');});
 for(let i=0;i<60;i++){const input={...EMPTY_INPUT,seq:i,mx:1,time:i/60};a.move(p,input);a.world.step();b.move(q,input);b.world.step();}
 expect(p.y).toBeLessThan(-3.9);expect(p.x).toBeCloseTo(q.x,9);expect(guard).not.toHaveBeenCalled();
 expect(a.eyeOrigin(p).y-p.y).toBeCloseTo(1.6256,9);expect(a.scenarioIdentity?.mapId).toBe('source-fixture');
 a.dispose();expect(b.sourceLevel!.sight({x:0,y:0,z:0},{x:0,y:0,z:1})).toBe(true);
});
it('replays held jump from the authoritative snapshot without an extra landing jump',()=>{
 const a=sim(),b=sim(),p=a.addPlayer('p','P','blue'),q=b.addPlayer('p','P','blue');
 for(let i=0;i<60;i++){a.move(p,{...EMPTY_INPUT,jump:true});a.world.step();}
 const snap=a.snapshot().players[0];expect(snap.sourceJumpHeld).toBe(true);Object.assign(q,snap);
 for(let i=0;i<80;i++){a.move(p,{...EMPTY_INPUT,jump:true});a.world.step();b.move(q,{...EMPTY_INPUT,jump:true});b.world.step();}
 expect(q.y).toBeCloseTo(p.y,9);expect(q.vy).toBe(0);expect(q.grounded).toBe(true);
 b.move(q,{...EMPTY_INPUT});b.world.step();b.move(q,{...EMPTY_INPUT,jump:true});b.world.step();expect(q.vy).toBeGreaterThan(0);
});
it('uses Source query roles for shots, visibility and flash and supports original negative-height trigger planting',()=>{
 const s=sim(),p=s.addPlayer('p','P','blue');
 expect(s.wallDistance(0,-3,0,0,0,-1)).toBe(Infinity);expect(s.sourceLevel!.wallDistance(0,-3,0,0,0,-1,'player')).toBeCloseTo(1.95,4);
 expect(()=>flashExposure(p,{x:0,y:0,z:0})).toThrow('scene contract');
 expect(()=>filterVisibility(s.snapshot(p.id),p.id,0)).toThrow('scene contract');
 expect(flashExposure({...p,yaw:0}, {x:p.x,y:s.eyeOrigin(p).y,z:-3},s)).toBeGreaterThan(0);
 const enemy=s.addPlayer('e','E','amber');enemy.x=p.x;enemy.z=-3;enemy.y=p.y;
 const snap=s.snapshot(p.id);filterVisibility(snap,p.id,0,s);expect(snap.players[1].y).toBe(enemy.y);
 const attacker=s.addPlayer('a','A','amber');attacker.x=-4;attacker.z=0;attacker.y=-3.999;attacker.grounded=true;s.mode='demolition';s.phase='live';s.bomb.carrier=attacker.id;
 for(let i=0;i<181;i++)s.interact(attacker,{...EMPTY_INPUT,use:true},1/60);
 expect(s.bomb.planted).toBe(true);expect(s.bomb.site).toBe('A');expect(s.bomb.y).toBeLessThan(0);
});
it('keeps unsupported FALCON weapons outside Source and explicitly reports unavailable hitboxes',()=>{
 const s=sim(),p=s.addPlayer('p','P','blue');expect(s.buy(p.id,'marshal')).toBe(false);
 s.setInput(p.id,{...EMPTY_INPUT,slot:1});s.step();expect(p.weapon).toBe('vandal');expect(p.slot).toBe(0);
 expect(s.scenarioIdentity?.hitboxStatus).toBe('unavailable');
});
it('feeds a configured hitbox provider the original Source history pose and uses its head result',()=>{
 const data=scenario(),raycast=vi.fn((_pose:SourceActorPose,_origin:SourcePoint,_direction:SourcePoint,_max:number)=>({distance:5,head:true}));data.hitboxes={id:'fixture-verified',status:'verified-bone-hitboxes',raycast};
 const s=sim(data),p=s.addPlayer('p','P','blue'),e=s.addPlayer('e','E','amber');s.step();
 s.shoot(p,{...EMPTY_INPUT,time:s.time});expect(raycast).toHaveBeenCalled();expect(raycast.mock.calls[0][0].sourceContract).toBe('csgo-player-12426148');expect(e.hp).toBeLessThan(100);
});
it('consumes original NAV waypoints with Y and preserves route metadata',()=>{
 const s=sim(scenario(),true),p=s.addPlayer('p','P','blue',true);s.addPlayer('e','E','amber',true);
 p.flash=1;s.botInput(p,1/60);const path=s.ai.get(p.id)!.path;
 expect(path.length).toBeGreaterThan(0);expect(path.every(p=>Number.isFinite(p.y))).toBe(true);expect(path.some(p=>p.areaId===2)).toBe(true);
});
it('owns pose snapshots/history and finishes the last original shot clock after a round ends',()=>{
 const data=scenario();data.poseDriver={id:'original-pose-fixture',advance:p=>({state:'Idle',cycle:0,parameters:{move_x:0},fireTimeSeconds:p.shotIdle,
  fireCycleRate:1.25,fireCycle:Math.min(1,p.shotIdle*1.25),fireWeight:p.shotIdle<.8?1:0})};
 const s=sim(data),p=s.addPlayer('p','P','blue');expect(p.sourcePoseVersion).toBe(data.poseDriver.id);
 s.step();const snapshot=s.snapshot(),record=s.history.at(-1)!.players[0];snapshot.players[0].sourcePose!.parameters.move_x=99;
 expect(p.sourcePose!.parameters.move_x).toBe(0);expect(record.sourcePose!.parameters.move_x).toBe(0);
 s.shoot(p,{...EMPTY_INPUT});expect(p.sourcePose!.fireTimeSeconds).toBe(0);expect(p.sourcePose!.fireWeight).toBe(1);
 s.phase='ended';s.remaining=4;const position=[p.x,p.y,p.z];for(let i=0;i<51;i++)s.step();
 expect(p.sourcePose!.fireTimeSeconds).toBeCloseTo(.85,10);expect(p.sourcePose!.fireCycle).toBe(1);expect(p.sourcePose!.fireWeight).toBe(0);
 expect([p.x,p.y,p.z]).toEqual(position);expect(p.sourcePose!.cycle).toBe(0);
});
it('acknowledges every processed Source input so LAN reconciliation stops replaying accepted movement',()=>{
 const authority=sim(),p=authority.addPlayer('p','P','blue');
 const pending=[{...EMPTY_INPUT,seq:42,mz:-1},{...EMPTY_INPUT,seq:43,crouch:true}];
 for(const input of pending){authority.move(p,input);authority.world.step();expect(p.ack).toBe(input.seq);}
 const own=authority.snapshot('p').players.find(p=>p.id==='p')!;
 expect(pending.filter(input=>input.seq>own.ack)).toEqual([]);expect(own.crouch).toBe(true);
});

it('uses authority seed and native BEFORE state for Source rifle shots, not input seed or generic heat',()=>{
 const data=scenario();data.rifleSeed=()=>-1234567;
 const s=sim(data),p=s.addPlayer('p','P','amber');s.step();
 const before=structuredClone(p.sourceRifleHandling!);p.shotHeat=26;
 s.shoot(p,{...EMPTY_INPUT,seq:7,serverSeed:99} as typeof EMPTY_INPUT);
 const event=s.events.find(e=>e.type==='shot')!;
 expect(event.sourceRifleShot?.serverSeed).toBe(-1234567);
 expect(event.sourceRifleShot?.recoilIndex).toBe(before.weapons.ak47.recoilIndex);
 expect(p.sourceRifleHandling?.weapons.ak47.recoilIndex).toBe(1);
 const b=sim(data),q=b.addPlayer('q','Q','amber');b.step();
 b.shoot(q,{...EMPTY_INPUT,seq:900});const other=b.events.find(e=>e.type==='shot')!;
 expect([event.dx,event.dy,event.dz]).toEqual([other.dx,other.dy,other.dz]);
 const snap=s.snapshot();snap.players[0].sourceRifleHandling!.punch.angle=[999,0,0];
 expect(p.sourceRifleHandling!.punch.angle[0]).not.toBe(999);
});
it('replays Source accepted fire and reload from a JSON snapshot with identical deterministic handling',()=>{
 const data=scenario();data.rifleSeed=()=>77;
 const a=sim(data),p=a.addPlayer('p','P','amber');
 for(let i=1;i<=40;i++){a.setInput('p',{...EMPTY_INPUT,seq:i,fire:i>20});a.step();}
 const snapshot=JSON.parse(JSON.stringify(a.snapshot('p'))),b=sim(data),q=b.addPlayer('p','P','amber');
 Object.assign(q,snapshot.players[0]);b.time=snapshot.time;
 for(let i=41;i<=350;i++){
  const input={...EMPTY_INPUT,seq:i,fire:i<65||i>100,mx:i<75?.5:0,jump:i===80,reload:i===65,crouch:i>130};
  a.setInput('p',input);a.step();b.predictSourceCommand(q,input);
  expect(q.sourceRifleHandling).toEqual(p.sourceRifleHandling);
  expect([q.ammo,q.reserve,q.reload,q.cooldown]).toEqual([p.ammo,p.reserve,p.reload,p.cooldown]);
 }
 expect(b.events.filter(e=>e.type==='shot')).toHaveLength(0);
});
it('snapshots authoritative walking flags and replays mixed Shift/crouch/jump/fire commands',()=>{
 const data=scenario();data.rifleSeed=()=>77;const a=sim(data),p=a.addPlayer('p','P','amber');
 for(let i=1;i<=60;i++){a.setInput('p',{...EMPTY_INPUT,seq:i,mx:1,walk:i>35});a.step();}
 const snapshot=JSON.parse(JSON.stringify(a.snapshot('p'))),b=sim(data),q=b.addPlayer('p','P','amber');Object.assign(q,snapshot.players[0]);b.time=snapshot.time;
 expect(snapshot.players[0].sourceWalking).toBe(true);
 for(let i=61;i<=360;i++){
  const input={...EMPTY_INPUT,seq:i,mx:i<210?1:-1,walk:i<120||(i>220&&i<300),crouch:i>100&&i<140,jump:i===150,fire:i>240,reload:i===310};
  a.setInput('p',input);a.step();b.predictSourceCommand(q,input);
  expect([q.sourceWalking,q.sourceFallVelocity,q.sourceJumpHeld,q.crouch]).toEqual([p.sourceWalking,p.sourceFallVelocity,p.sourceJumpHeld,p.crouch]);
  expect(q.sourceRifleHandling).toEqual(p.sourceRifleHandling);expect([q.x,q.y,q.z,q.vx,q.vy,q.vz]).toEqual([p.x,p.y,p.z,p.vx,p.vy,p.vz]);
 }
});
