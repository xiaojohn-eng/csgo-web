import {afterEach,beforeAll,expect,it} from 'vitest';
import {filterVisibility} from '../server/visibility';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT,type Input,type Player} from '../game/types';
import {sourceSimulationFixture} from './fixtures/source-simulation-fixture';
beforeAll(initPhysics);const live:Simulation[]=[];afterEach(()=>live.splice(0).forEach(s=>s.dispose()));
function sim(prediction=false){const d=sourceSimulationFixture();d.weapons=['vandal','m4a4','glock','usp'];d.defaultWeaponByTeam={amber:'vandal',blue:'m4a4'};d.defaultSecondaryWeaponByTeam={amber:'glock',blue:'usp'};
 d.pistolSeed=d.rifleSeed=prediction?()=>{throw Error('Prediction allocated an authority seed');}:()=>42;
 const s=new Simulation('training',false,d);live.push(s);return s;}
function command(s:Simulation,p:Player,seq:number,input:Partial<Input>={}){s.setInput(p.id,{...EMPTY_INPUT,seq,slot:p.slot,...input});s.step();}
function equip(s:Simulation,p:Player){for(let seq=1;seq<=80;seq++)command(s,p,seq,{slot:1});}
it('owns a CT USP and preserves rifle ammunition while replacing either pistol',()=>{
 const s=sim(),ct=s.addPlayer('c','CT','blue'),t=s.addPlayer('t','T','amber');
 expect([ct.secondary,ct.sourceUSP?.command.clip,ct.sourceUSP?.command.silencerAttached]).toEqual(['usp',12,true]);expect(ct.sourceGlock).toBeUndefined();expect(t.secondary).toBe('glock');
 ct.ammo=17;ct.reserve=51;ct.money=600;expect(s.buy(ct.id,'glock')).toBe(true);
 expect([ct.weapon,ct.primaryAmmo,ct.primaryReserve,ct.money]).toEqual(['glock',17,51,400]);expect(ct.sourceUSP).toBeUndefined();
 expect(s.buy(ct.id,'usp')).toBe(true);expect([ct.weapon,ct.ammo,ct.reserve,ct.primaryAmmo,ct.primaryReserve,ct.money]).toEqual(['usp',12,24,17,51,200]);expect(ct.sourceGlock).toBeUndefined();
 command(s,ct,1,{slot:0});expect([ct.weapon,ct.ammo,ct.reserve]).toEqual(['m4a4',17,51]);
 ct.alive=false;s.nextRound();expect([ct.secondary,ct.sourceUSP?.command.clip,ct.sourceUSP?.command.silencerAttached]).toEqual(['usp',12,true]);
 const old=new Simulation('training',false);live.push(old);const p=old.addPlayer('p','P','blue');expect(old.buy(p.id,'usp')).toBe(false);
});
it('commits detach through the original animation event, blocks attack until its gate, then emits unsilenced bullets',()=>{
 const s=sim(),p=s.addPlayer('c','CT','blue'),listener=s.addPlayer('t','T','amber');equip(s,p);command(s,p,81,{fire:true});expect(p.ammo).toBe(11);expect(s.events.find(e=>e.sourcePistolShot)?.sourcePistolShot).toMatchObject({weapon:'usp-s',mode:1});
 for(let seq=82;seq<96;seq++)command(s,p,seq);command(s,p,96,{aim:true});expect(p.sourceUSP!.command.silencerAttached).toBe(true);const gate=p.sourceUSP!.command.silencerSwitchTime;
 let seq=97;while(p.sourceUSP!.command.silencerAttached&&seq<330)command(s,p,seq++);
 expect(p.sourceUSP!.command.silencerAttached).toBe(false);expect(p.sourceUSP!.command.mode).toBe(0);expect(s.time).toBeLessThan(gate);
 command(s,p,seq++,{fire:true});expect(p.ammo).toBe(11);while(s.time<=gate+.05)command(s,p,seq++);
 command(s,p,seq++,{fire:true});expect(p.ammo).toBe(10);expect(s.events.filter(e=>e.sourcePistolShot).at(-1)?.sourcePistolShot).toMatchObject({weapon:'usp-s',mode:0});
 const before=structuredClone(p);expect(s.buy(p.id,'usp')).toBe(false);expect(p).toEqual(before);
 const snap=s.snapshot();filterVisibility(snap,listener.id,0,{eyeOrigin:q=>s.eyeOrigin(q),sight:()=>false});
 const report=snap.events.at(-1)!;expect(report).toMatchObject({type:'report',weapon:'usp',sourcePistolSoundMode:0});
 for(const key of ['sourcePistolShot','sourceRifleShot','dx','dy','dz','seq'])expect(report).not.toHaveProperty(key);
 expect(s.events.at(-1)!.sourcePistolShot?.mode).toBe(0);
});
it('cancels an uncommitted silencer change on holster and isolates snapshot/history state',()=>{
 const s=sim(),p=s.addPlayer('c','CT','blue');equip(s,p);command(s,p,81,{aim:true});for(let seq=82;seq<100;seq++)command(s,p,seq);
 command(s,p,100,{slot:0});expect(p.sourceUSP!.command.silencerAttached).toBe(true);for(let seq=101;seq<220;seq++)command(s,p,seq);
 command(s,p,220,{slot:1});expect(p.sourceUSP!.action?.activity).toBe(481);for(let seq=221;seq<350;seq++)command(s,p,seq);expect(p.sourceUSP!.command.silencerAttached).toBe(true);
 const snap=s.snapshot();snap.players[0].sourceUSP!.command.silencerAttached=false;snap.players[0].sourceUSP!.handling.punch.angle=[999,0,0];
 expect(p.sourceUSP!.command.silencerAttached).toBe(true);expect(s.history.at(-1)!.players[0].sourceUSP!.command.silencerAttached).toBe(true);expect(p.sourceRifleHandling!.punch.angle[0]).not.toBe(999);
});
it('replays 720 USP movement, reload, silencer and slot commands with identical authority/prediction state',()=>{
 const a=sim(),p=a.addPlayer('p','CT','blue');equip(a,p);const b=sim(true),q=b.addPlayer('p','CT','blue');Object.assign(q,JSON.parse(JSON.stringify(a.snapshot('p').players[0])));b.time=a.time;b.tick=a.tick;
 for(let seq=81;seq<=800;seq++){
  const input={...EMPTY_INPUT,seq,slot:(seq>=520&&seq<560?0:1)as 0|1,fire:seq===81||seq===420||seq===480||seq===730,aim:seq===250||seq===600,reload:seq===95||seq===450,mx:seq<110?.3:0,walk:seq<100,crouch:seq>=425&&seq<445,jump:seq===500};
  command(a,p,seq,input);b.predictSourceCommand(q,input);
  expect(q.sourceUSP).toEqual(p.sourceUSP);expect(q.sourceViewmodelTime).toEqual(p.sourceViewmodelTime);expect(q.sourceRifleHandling).toEqual(p.sourceRifleHandling);
  expect([q.weapon,q.ammo,q.reserve,q.primaryAmmo,q.primaryReserve,q.reload,q.cooldown,q.x,q.y,q.z]).toEqual([p.weapon,p.ammo,p.reserve,p.primaryAmmo,p.primaryReserve,p.reload,p.cooldown,p.x,p.y,p.z]);
  if(seq%31===0)Object.assign(q,JSON.parse(JSON.stringify(q)));
 }
 expect(b.events.filter(e=>e.type==='shot')).toHaveLength(0);expect(a.events.some(e=>e.sourcePistolShot?.mode===0)).toBe(true);
});
