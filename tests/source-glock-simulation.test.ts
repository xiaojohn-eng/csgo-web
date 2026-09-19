import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT,validateInput,type Input,type Player} from '../game/types';
import {sourceSimulationFixture} from './fixtures/source-simulation-fixture';
import {sourceGlockRuntimeFrame,sourceGlockRuntimePostThink} from '../game/source-glock-runtime';
import {sourcePistolHandlingMovementTick} from '../game/source-pistol-handling';
import {sourcePlayerAccuracyContext} from '../game/source-player-handling';
import {sourceCommandSeed} from '../game/source-seed';
import {sourcePunchTick} from '../game/source-punch';
import type {SourceScenario} from '../game/source-scenario';
beforeAll(initPhysics);const live:Simulation[]=[];afterEach(()=>live.splice(0).forEach(s=>s.dispose()));
function scenario(){const d=sourceSimulationFixture();d.weapons=['vandal','m4a4','glock'];d.defaultWeaponByTeam={amber:'vandal',blue:'m4a4'};d.defaultSecondaryWeaponByTeam={amber:'glock'};d.rifleSeed=()=>77;d.pistolSeed=()=>42;return d;}
function sim(d:SourceScenario=scenario()){const s=new Simulation('training',false,d);live.push(s);return s;}
function command(s:Simulation,p:Player,seq:number,input:Partial<Input>={},dt=1/60){s.setInput(p.id,{...EMPTY_INPUT,seq,slot:p.slot,...input});s.step(dt);}
function equip(s:Simulation,p:Player){command(s,p,1,{slot:1});for(let i=2;i<=80;i++)command(s,p,i);}
it('keeps primary inventory while buying a two-team Glock and leaves legacy loadouts unchanged',()=>{
 const s=sim(),t=s.addPlayer('t','T','amber'),ct=s.addPlayer('c','CT','blue');
 expect(t.secondary).toBe('glock');expect(t.sourceGlock?.command.clip).toBe(20);expect(ct.secondary).toBeUndefined();expect(ct.sourceGlock).toBeUndefined();
 ct.ammo=17;ct.reserve=51;ct.money=400;expect(s.buy(ct.id,'glock')).toBe(true);
 expect([ct.primary,ct.weapon,ct.slot,ct.primaryAmmo,ct.primaryReserve,ct.ammo,ct.reserve,ct.money]).toEqual(['m4a4','glock',1,17,51,20,120,200]);
 expect(s.buy(ct.id,'glock')).toBe(false);expect([ct.primaryAmmo,ct.primaryReserve,ct.money]).toEqual([17,51,200]);
 command(s,ct,1,{slot:0});expect([ct.weapon,ct.ammo,ct.reserve]).toEqual(['m4a4',17,51]);
 const old=new Simulation('training',false);live.push(old);const p=old.addPlayer('p','P','amber');expect(old.buy(p.id,'glock')).toBe(false);
 command(old,p,1,{slot:1});expect(p.weapon).toBe('sidearm');expect(p.sourceGlock).toBeUndefined();
});
it('restores the correct primary magazine at a new round and resets dead CT secondary to its source default',()=>{
 const s=sim(),p=s.addPlayer('p','T','amber'),ct=s.addPlayer('ct','CT','blue');equip(s,p);expect(s.buy(ct.id,'glock')).toBe(true);
 command(s,p,81,{fire:true});s.nextRound();
 expect([p.weapon,p.slot,p.ammo,p.reserve,p.secondary,p.pistolAmmo]).toEqual(['vandal',0,30,90,'glock',20]);
 expect([ct.weapon,ct.ammo,ct.secondary,ct.pistolAmmo]).toEqual(['m4a4',30,'glock',20]);
 ct.alive=false;s.nextRound();expect([ct.weapon,ct.ammo,ct.secondary,ct.sourceGlock]).toEqual(['m4a4',30,undefined,undefined]);
});
it('uses original draw and wait-for-release gates, and held single fire accepts exactly one shot',()=>{
 const s=sim(),p=s.addPlayer('p','T','amber');
 for(let seq=1;seq<=100;seq++)command(s,p,seq,{slot:1,fire:true});
 expect(p.weapon).toBe('glock');expect(p.ammo).toBe(20);expect(p.sourceGlock!.command.waitForNoAttack).toBe(true);expect(s.events.filter(e=>e.type==='shot')).toHaveLength(0);
 command(s,p,101,{fire:false});command(s,p,102,{fire:true});for(let seq=103;seq<=145;seq++)command(s,p,seq,{fire:true});
 const shots=s.events.filter(e=>e.type==='shot');expect(shots).toHaveLength(1);expect(p.ammo).toBe(19);expect(shots[0].sourcePistolShot?.source).toBe('primary');expect(shots[0].sourceRifleShot).toBeUndefined();
 expect(()=>s.shoot(p,{...EMPTY_INPUT})).toThrow('command bridge');expect(p.ammo).toBe(19);
});
it('follows native burst queue and current-command seeds, applying original bullet damage exactly once',()=>{
 let currentSeed=100;const d=scenario();d.pistolSeed=()=>currentSeed;d.hitboxes={id:'body-only',status:'verified-bone-hitboxes',raycast:()=>({distance:0,head:false,group:2})};
 const s=sim(d),p=s.addPlayer('p','T','amber'),target=s.addPlayer('ct','CT','blue');target.armor=0;equip(s,p);
 command(s,p,81,{aim:true});expect(p.sourceGlock!.command.mode).toBe(1);
 currentSeed=800;command(s,p,82,{fire:true});
 for(let seq=83;seq<=91;seq++){currentSeed=seq*13;command(s,p,seq,{fire:false});}
 const shots=s.events.filter(e=>e.type==='shot'&&e.by===p.id);expect(shots).toHaveLength(3);expect(shots.map(e=>e.sourcePistolShot?.source)).toEqual(['primary','queued','queued']);
 expect(target.hp).toBe(10);expect(target.armor).toBe(0);expect(p.ammo).toBe(17);expect(s.events.filter(e=>e.type==='hit')).toHaveLength(3);
 for(const shot of shots){expect(shot.sourcePistolShot?.commandSeed).toBe(sourceCommandSeed(shot.seq!));expect(shot.sourcePistolShot?.serverSeed).toBe(shot.seq===82?800:shot.seq!*13);}
 expect(shots[1].sourcePistolShot?.scheduledTime).toBeLessThanOrEqual(shots[1].time!);expect(shots[2].sourcePistolShot?.scheduledTime).toBeGreaterThan(shots[1].sourcePistolShot!.scheduledTime);
});
it('allocates one authority seed per player command and never accepts client handling or seed fields',()=>{
 const supplier=vi.fn(()=>77),d=scenario();d.pistolSeed=supplier;const s=sim(d),p=s.addPlayer('p','T','amber');
 for(let i=0;i<10;i++)command(s,p,5,{slot:1});expect(supplier).toHaveBeenCalledOnce();
 const input=validateInput({...EMPTY_INPUT,seq:6,aim:true,slot:1,serverSeed:19,commandSeed:23,sourceGlock:{command:{clip:999}},secondary:'m4a4',sourcePistolPose:{body:'fake'}})!;
 expect(input).toEqual({...EMPTY_INPUT,seq:6,aim:true,slot:1});command(s,p,6,input);expect(supplier).toHaveBeenCalledTimes(2);expect(p.ammo).toBe(20);
});
it('runs only the bridge weapon phase after one player punch movement tick',()=>{
 const s=sim(),p=s.addPlayer('p','T','amber');equip(s,p);
 for(let seq=81;seq<=130;seq++){
  const before=structuredClone(p.sourceGlock!),dt=1/64,now=s.time+dt,input={...EMPTY_INPUT,seq,slot:1 as const,fire:seq%13===0,aim:seq===95,reload:seq===115};
  const weaponFrame=sourceGlockRuntimeFrame({...before,handling:sourcePistolHandlingMovementTick(before.handling,dt)},
   {now,dt,buttons:(input.fire?1:0)|(input.aim?2048:0)|(input.reload?8192:0),commandSeed:sourceCommandSeed(seq),accuracy:sourcePlayerAccuracyContext(p),execution:{type:'authority',serverSeed:42}});
  const expected=sourceGlockRuntimePostThink(weaponFrame.state,{now,viewmodelTime:p.sourceViewmodelTime!});
  command(s,p,seq,input,dt);expect(p.sourceGlock).toEqual(expected.state);expect(p.sourceRifleHandling!.punch).toEqual(expected.state.handling.punch);
 }
});
it('preserves shared punch, primary ammo and inactive Glock state across holster and re-deploy',()=>{
 const s=sim(),p=s.addPlayer('p','T','amber');equip(s,p);command(s,p,81,{fire:true});const punch=structuredClone(p.sourceRifleHandling!.punch),glock=structuredClone(p.sourceGlock!);
 command(s,p,82,{slot:0});expect(p.sourceRifleHandling!.punch).toEqual(sourcePunchTick(punch,1/60));expect(p.sourceGlock!.handling.punch).toEqual(p.sourceRifleHandling!.punch);
 expect(p.sourceGlock!.command.clip).toBe(19);expect(p.ammo).toBe(30);const penalty=p.sourceGlock!.handling.weapons.glock18.penalty;
 for(let i=83;i<105;i++)command(s,p,i,{slot:0,fire:i===90});expect(p.sourceGlock!.handling.weapons.glock18.penalty).toBe(penalty);expect(p.ammo).toBe(29);
 const primary=[p.ammo,p.reserve],shared=structuredClone(p.sourceRifleHandling!.punch);command(s,p,105,{slot:1});
 expect(p.sourceRifleHandling!.punch).toEqual(sourcePunchTick(shared,1/60));expect([p.primaryAmmo,p.primaryReserve]).toEqual(primary);expect(p.ammo).toBe(19);
 expect(p.sourceGlock!.command.burstRemaining).toBe(0);expect(p.sourceGlock!.action!.generation).toBeGreaterThan(glock.action!.generation);expect(p.cooldown).toBeGreaterThan(1);
});
it('applies native AE54 early ammo transfer after command, keeps the reload gate, and cancels on holster',()=>{
 const s=sim(),p=s.addPlayer('p','T','amber');equip(s,p);command(s,p,81,{fire:true});for(let i=82;i<=95;i++)command(s,p,i);
 command(s,p,96,{reload:true});expect(p.sourceGlock!.command.reloading).toBe(true);expect(p.ammo).toBe(19);
 const first=p.sourceGlock!.handling.weapons.glock18.recoilIndex;command(s,p,97,{reload:true});expect(p.sourceGlock!.handling.weapons.glock18.recoilIndex).toBeLessThanOrEqual(first);
 const doneAt=p.sourceGlock!.command.ownerNextAttack;let seq=98,previousCycle=0;
 while(!p.sourceGlock!.command.reloadVisComplete&&seq<200){previousCycle=p.sourceGlock!.animation!.cycle;command(s,p,seq++,{fire:true});}
 expect(previousCycle).toBeLessThanOrEqual(Math.fround(.411764711));expect(p.sourceGlock!.animation!.cycle).toBeGreaterThan(Math.fround(.411764711));
 expect(s.time).toBeLessThan(doneAt);expect([p.ammo,p.reserve]).toEqual([20,119]);expect(p.sourceGlock!.command.reloading).toBe(true);expect(s.events.filter(e=>e.type==='shot')).toHaveLength(1);
 while(s.time+1/60<doneAt){command(s,p,seq++);expect([p.ammo,p.reserve]).toEqual([20,119]);}
 command(s,p,seq++);expect([p.ammo,p.reserve]).toEqual([20,119]);expect(p.sourceGlock!.command.reloading).toBe(false);
 command(s,p,seq++,{fire:true});for(let j=0;j<12;j++)command(s,p,seq++);command(s,p,seq++,{reload:true});command(s,p,seq++,{slot:0});
 expect(p.sourceGlock!.command.reloading).toBe(false);expect(p.sourceGlock!.command.clip).toBe(19);
});
it('replays 400 movement, single/burst, reload, slot and landing commands from a complete JSON snapshot',()=>{
 const a=sim(),p=a.addPlayer('p','T','amber');equip(a,p);const snapshot=JSON.parse(JSON.stringify(a.snapshot('p')));
 const d=scenario();d.pistolSeed=d.rifleSeed=()=>{throw Error('Prediction requested authority seed');};const b=sim(d),q=b.addPlayer('p','T','amber');Object.assign(q,snapshot.players[0]);b.time=snapshot.time;b.tick=snapshot.tick;
 for(let seq=81;seq<=480;seq++){
  const input={...EMPTY_INPUT,seq,slot:(seq>=225&&seq<261?0:1)as 0|1,fire:seq<150?seq%11===0:seq>=180&&seq<210||seq===350||seq>=230&&seq<=250,
   aim:seq===155,reload:seq===220||seq===370,jump:seq===150,mx:seq<180?.5:0,walk:seq<115,crouch:seq>=120&&seq<145};
  command(a,p,seq,input);b.predictSourceCommand(q,input);
  expect(q.sourceViewmodelTime).toEqual(p.sourceViewmodelTime);expect(q.sourceGlock).toEqual(p.sourceGlock);expect(q.sourceRifleHandling).toEqual(p.sourceRifleHandling);
  expect([q.weapon,q.slot,q.ammo,q.reserve,q.primaryAmmo,q.primaryReserve,q.reload,q.cooldown,q.sourceFallVelocity]).toEqual([p.weapon,p.slot,p.ammo,p.reserve,p.primaryAmmo,p.primaryReserve,p.reload,p.cooldown,p.sourceFallVelocity]);
  expect([q.x,q.y,q.z,q.vx,q.vy,q.vz]).toEqual([p.x,p.y,p.z,p.vx,p.vy,p.vz]);
  if(seq%31===0)Object.assign(q,JSON.parse(JSON.stringify(q)));
 }
 expect(b.events.filter(e=>e.type==='shot')).toHaveLength(0);
});
it('isolates nested pistol state, pose and bullet receipts across snapshot and rewind history',()=>{
 const d=scenario(),driver={id:'glock-pose',advance:()=>({state:'Idle' as const,cycle:0,parameters:{move_x:0}}),pistolPose:(p:Player)=>({body:p.sourcePose!,world:{parameters:{body_yaw:0,body_pitch:0,aim_blend_stand_idle:1,aim_blend_stand_walk:0,aim_blend_stand_run:0,aim_blend_crouch_idle:0,aim_blend_crouch_walk:0},cycle:0}})};
 d.poseDriversByWeapon={amber:{glock:driver}};const s=sim(d),p=s.addPlayer('p','T','amber');equip(s,p);command(s,p,81,{fire:true});
 const snapshot=s.snapshot(),record=s.history.at(-1)!.players[0];snapshot.players[0].sourceGlock!.command.clip=999;snapshot.players[0].sourceGlock!.handling.punch.angle=[999,0,0];
 snapshot.players[0].sourcePistolPose!.body.parameters.move_x=999;snapshot.events.find(e=>e.sourcePistolShot)!.sourcePistolShot!.offset.x=999;
 expect(p.sourceGlock!.command.clip).toBe(19);expect(record.sourceGlock!.command.clip).toBe(19);expect(p.sourceRifleHandling!.punch.angle[0]).not.toBe(999);expect(record.sourcePistolPose!.body.parameters.move_x).toBe(0);
 expect(s.events.find(e=>e.sourcePistolShot)!.sourcePistolShot!.offset.x).not.toBe(999);
});

it('emits one controlled authority sound per accepted mode switch, never from prediction',()=>{
 const s=sim(),p=s.addPlayer('p','T','amber');equip(s,p);
 const predicted=sim(),q=predicted.addPlayer('p','T','amber');Object.assign(q,structuredClone(p));predicted.time=s.time;predicted.tick=s.tick;
 const input={...EMPTY_INPUT,seq:81,slot:1 as const,aim:true};predicted.predictSourceCommand(q,input);
 command(s,p,81,{aim:true});for(let seq=82;seq<95;seq++)command(s,p,seq);
 const sounds=s.events.filter(e=>e.type==='weaponSound');expect(sounds).toHaveLength(1);
 expect(sounds[0]).toMatchObject({by:p.id,seq:81,weapon:'glock',sourceWeaponSound:{weapon:'glock',event:'Weapon.AutoSemiAutoSwitch'}});
 expect([sounds[0].time,sounds[0].x,sounds[0].y,sounds[0].z].every(Number.isFinite)).toBe(true);
 expect(predicted.events.filter(e=>e.type==='weaponSound')).toHaveLength(0);expect(q.sourceGlock!.command.mode).toBe(1);
 const snap=s.snapshot();snap.events.find(e=>e.type==='weaponSound')!.sourceWeaponSound!.event='mutated';
 expect(sounds[0].sourceWeaponSound!.event).toBe('Weapon.AutoSemiAutoSwitch');
});
