import {afterEach,beforeAll,expect,it} from 'vitest';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT,WEAPONS,type Input,type Player} from '../game/types';
import {sourceSimulationFixture} from './fixtures/source-simulation-fixture';
import {loadServerSourceAWP} from '../server/source-awp-data';
import {createSourceAWPPoseDriver} from '../game/source-awp-runtime-pose';
import {createSourceAWPCharacterHitboxes} from '../game/source-awp-character-hitboxes';
import {sourcePlayerSpread} from '../game/source-player-handling';
import {sourceAWPFov} from '../game/source-awp-fov';

beforeAll(initPhysics);const live:Simulation[]=[];afterEach(()=>live.splice(0).forEach(s=>s.dispose()));
function scenario(prediction=false){const d=sourceSimulationFixture();d.weapons=['vandal','m4a4','glock','usp','deagle','awp'];d.defaultWeaponByTeam={amber:'vandal',blue:'m4a4'};d.defaultSecondaryWeaponByTeam={amber:'glock',blue:'usp'};
 d.pistolSeed=d.rifleSeed=prediction?()=>{throw Error('Prediction allocated authority seed');}:()=>42;return d;}
function sim(prediction=false){const s=new Simulation('training',false,scenario(prediction));live.push(s);return s;}
function command(s:Simulation,p:Player,seq:number,input:Partial<Input>={}){s.setInput(p.id,{...EMPTY_INPUT,seq,slot:p.slot,...input});s.step();}
function equip(s:Simulation,p:Player){p.money=10000;expect(s.buy(p.id,'awp')).toBe(true);for(let seq=1;seq<=80;seq++)command(s,p,seq);}

it('owns a priced primary, preserves its secondary and isolates ammo, snapshots and accepted shots',()=>{
 const s=sim(),p=s.addPlayer('p','CT','blue');equip(s,p);
 expect([p.weapon,p.primary,p.secondary,p.ammo,p.reserve,p.money]).toEqual(['awp','awp','usp',5,30,5250]);
 command(s,p,81,{fire:true});expect(p.ammo).toBe(4);
 const event=s.events.find(e=>e.sourceAWPShot)!;expect(event.sourceAWPShot).toMatchObject({weapon:'awp',mode:0,serverSeed:42});
 expect(event.sourcePistolShot).toBeUndefined();expect(event.sourceRifleShot).toBeUndefined();
 const snapshot=s.snapshot();snapshot.players[0].sourceAWP!.command.clip=0;snapshot.players[0].sourceAWP!.handling.punch.angle=[999,0,0];
 snapshot.events.find(e=>e.sourceAWPShot)!.sourceAWPShot!.punchAngles=[999,0,0];
 expect(p.sourceAWP!.command.clip).toBe(4);expect(s.history.at(-1)!.players[0].sourceAWP!.handling.punch.angle[0]).not.toBe(999);expect(event.sourceAWPShot!.punchAngles[0]).not.toBe(999);
 command(s,p,82,{slot:1});expect([p.weapon,p.ammo,p.reserve,p.primaryAmmo,p.primaryReserve]).toEqual(['usp',12,24,4,30]);
 const inactive=structuredClone(p.sourceAWP!.animation);for(let seq=83;seq<140;seq++)command(s,p,seq,{slot:1});expect(p.sourceAWP!.animation).toEqual(inactive);
 command(s,p,140,{slot:0});expect([p.weapon,p.ammo,p.reserve]).toEqual(['awp',4,30]);expect(p.sourceAWP!.command.ownerNextAttack).toBeGreaterThan(s.time);
 expect(s.buy(p.id,'deagle')).toBe(true);expect([p.primary,p.secondary,p.weapon,p.primaryAmmo]).toEqual(['awp','deagle','deagle',4]);
 p.money=10000;expect(s.buy(p.id,'m4a4')).toBe(true);expect(p.sourceAWP).toBeUndefined();expect(p.weapon).toBe('m4a4');
 const old=new Simulation('training',false);live.push(old);const q=old.addPlayer('l','legacy','blue');q.money=10000;expect(old.buy(q.id,'awp')).toBe(false);
});

it('matches 1500 Simulation authority/prediction commands through zoom, recoil, early ammo, landing and interrupted reload',()=>{
 const a=sim(),p=a.addPlayer('p','CT','blue');equip(a,p);const b=sim(true),q=b.addPlayer('p','CT','blue');Object.assign(q,JSON.parse(JSON.stringify(a.snapshot().players[0])));b.time=a.time;b.tick=a.tick;
 let early=false,scopedShots=0,unscopedShots=0;const shots=new Set([120,450,560,950,1300]);
 for(let seq=81;seq<=1580;seq++){
  const input={...EMPTY_INPUT,seq,slot:(seq>=690&&seq<790?1:0)as 0|1,fire:shots.has(seq),aim:seq===81||seq===400||seq===900||seq===1250,
   reload:seq===230||seq===620||seq===1100,mx:seq>=460&&seq<490?.3:0,walk:seq>=465&&seq<475,crouch:seq>=505&&seq<530,jump:seq===530};
  command(a,p,seq,input);b.predictSourceCommand(q,input);
  expect(q.sourceAWP).toEqual(p.sourceAWP);expect(q.sourceViewmodelTime).toEqual(p.sourceViewmodelTime);expect(q.sourceRifleHandling).toEqual(p.sourceRifleHandling);
  expect([q.weapon,q.ammo,q.reserve,q.primaryAmmo,q.primaryReserve,q.reload,q.cooldown,q.x,q.y,q.z]).toEqual([p.weapon,p.ammo,p.reserve,p.primaryAmmo,p.primaryReserve,p.reload,p.cooldown,p.x,p.y,p.z]);
  early||=p.sourceAWP!.command.clip===5&&p.sourceAWP!.command.reloading&&p.sourceAWP!.command.ownerNextAttack>a.time;
  if(seq%43===0)Object.assign(q,JSON.parse(JSON.stringify(q)));
 }
 for(const e of a.events)if(e.sourceAWPShot){if(e.sourceAWPShot.mode)scopedShots++;else unscopedShots++;}
 expect(early).toBe(true);expect(scopedShots).toBeGreaterThan(0);expect(unscopedShots).toBeGreaterThan(0);expect(b.events).toHaveLength(0);
});

it('uses active scope mode for movement speed, restores zoom after the bolt, and clears it on deploy',()=>{
 const s=sim(),p=s.addPlayer('p','T','amber');equip(s,p);command(s,p,81,{aim:true});
 for(let seq=82;seq<=150;seq++)command(s,p,seq,{mz:1});
 expect(Math.hypot(p.vx,p.vz)/.0254).toBeCloseTo(100,3);expect(sourceAWPFov(p.sourceAWP!.command,s.time).value).toBe(40);
 const scoped=sourcePlayerSpread(p);command(s,p,151,{fire:true});expect(p.sourceAWP!.command.mode).toBe(0);expect(p.sourceAWP!.command.resumeZoom).toBe(true);
 for(let seq=152;seq<=245;seq++)command(s,p,seq,{mz:1});expect(p.sourceAWP!.command.mode).toBe(1);
 expect(scoped).toBeGreaterThan(0);command(s,p,246,{slot:1});command(s,p,247,{slot:0});
 expect(p.sourceAWP!.command).toMatchObject({scoped:false,resumeZoom:false,zoomLevel:0,mode:0});expect(sourceAWPFov(p.sourceAWP!.command,s.time).value).toBe(90);
});

it('cancels a reload before the original event54 and keeps already committed ammo when holstered after it',()=>{
 const s=sim(),p=s.addPlayer('p','T','amber');equip(s,p);command(s,p,81,{fire:true});command(s,p,82,{reload:true});
 for(let seq=83;seq<125;seq++)command(s,p,seq);command(s,p,125,{slot:1});expect([p.primaryAmmo,p.primaryReserve]).toEqual([4,30]);
 command(s,p,126,{slot:0});for(let seq=127;seq<=205;seq++)command(s,p,seq);command(s,p,206,{reload:true});
 let seq=207;for(;seq<435&&p.sourceAWP!.command.clip===4;seq++)command(s,p,seq);
 expect(p.sourceAWP!.command.reloading).toBe(true);expect([p.ammo,p.reserve]).toEqual([5,29]);
 command(s,p,seq,{slot:1});expect([p.primaryAmmo,p.primaryReserve]).toEqual([5,29]);
 command(s,p,seq+1,{slot:0});for(let n=seq+2;n<seq+100;n++)command(s,p,n);expect([p.ammo,p.reserve]).toEqual([5,29]);
});

it('loads original T/CT authority graphs and uses their poses and hitboxes for a lethal scoped body hit',async()=>{
 const [t,ct]=await Promise.all((['t','ct']as const).map(team=>loadServerSourceAWP(`public/source/csgo-12426148/character-${team}-awp/manifest.json`,team)));
 const d=scenario();d.poseDriversByWeapon={};d.hitboxesByWeapon={};
 for(const [team,asset]of [['amber',t],['blue',ct]]as const){d.poseDriversByWeapon[team]={awp:createSourceAWPPoseDriver(asset.poseIndex,asset.poseVersion)};d.hitboxesByWeapon[team]={awp:createSourceAWPCharacterHitboxes(asset.poseIndex,asset.poseVersion)};}
 const s=new Simulation('training',false,d);live.push(s);const p=s.addPlayer('p','T','amber'),q=s.addPlayer('q','CT','blue');equip(s,p);q.money=10000;expect(s.buy(q.id,'awp')).toBe(true);
 command(s,p,81,{aim:true,yaw:Math.PI/2});for(let seq=82;seq<=210;seq++)command(s,p,seq,{yaw:Math.PI/2,pitch:-.055});
 expect(p.sourceAWPPose).toBeDefined();expect(q.sourceAWPPose).toBeDefined();expect(q.sourcePoseVersion).toBe(ct.poseVersion);
 const snapshot=s.snapshot();snapshot.players[0].sourceAWPPose!.world.cycle=.5;expect(p.sourceAWPPose!.world.cycle).toBe(0);
 q.armor=100;command(s,p,211,{fire:true,yaw:Math.PI/2,pitch:-.055});
 expect(s.events.find(e=>e.type==='hit'&&e.target===q.id)?.damage).toBeGreaterThanOrEqual(100);expect(q.alive).toBe(false);expect(p.kills).toBe(1);
 expect(p.sourceAWP!.command.clip).toBe(WEAPONS.awp.mag-1);
});
