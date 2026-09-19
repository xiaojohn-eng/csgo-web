import {afterEach,beforeAll,expect,it} from 'vitest';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT,type Input,type Player} from '../game/types';
import {sourceSimulationFixture} from './fixtures/source-simulation-fixture';
beforeAll(initPhysics);const live:Simulation[]=[];afterEach(()=>live.splice(0).forEach(s=>s.dispose()));
function sim(prediction=false){const d=sourceSimulationFixture();d.weapons=['vandal','m4a4','glock','usp','deagle'];d.defaultWeaponByTeam={amber:'vandal',blue:'m4a4'};d.defaultSecondaryWeaponByTeam={amber:'glock',blue:'usp'};
 d.pistolSeed=d.rifleSeed=prediction?()=>{throw Error('Prediction allocated authority seed');}:()=>42;const s=new Simulation('training',false,d);live.push(s);return s;}
function command(s:Simulation,p:Player,seq:number,input:Partial<Input>={}){s.setInput(p.id,{...EMPTY_INPUT,seq,slot:p.slot,...input});s.step();}
function equip(s:Simulation,p:Player){p.money=2000;expect(s.buy(p.id,'deagle')).toBe(true);for(let seq=1;seq<=80;seq++)command(s,p,seq,{slot:1});}
it('replaces the secondary only, charges the original price once, and isolates snapshot/history state',()=>{
 const s=sim(),p=s.addPlayer('p','CT','blue');p.ammo=17;p.reserve=51;equip(s,p);
 expect([p.weapon,p.secondary,p.ammo,p.reserve,p.primaryAmmo,p.primaryReserve,p.money]).toEqual(['deagle','deagle',7,35,17,51,1300]);expect(p.sourceUSP).toBeUndefined();expect(p.sourceGlock).toBeUndefined();
 const before=structuredClone(p);expect(s.buy(p.id,'deagle')).toBe(false);expect(p).toEqual(before);
 command(s,p,81,{fire:true});expect(p.ammo).toBe(6);expect(s.events.find(e=>e.sourcePistolShot)?.sourcePistolShot).toMatchObject({weapon:'deagle',mode:0});
 const snapshot=s.snapshot();snapshot.players[0].sourceDeagle!.command.clip=0;snapshot.players[0].sourceDeagle!.handling.punch.angle=[999,0,0];
 expect(p.sourceDeagle!.command.clip).toBe(6);expect(s.history.at(-1)!.players[0].sourceDeagle!.handling.punch.angle[0]).not.toBe(999);
 command(s,p,82,{slot:0});expect([p.weapon,p.ammo,p.reserve]).toEqual(['m4a4',17,51]);command(s,p,83,{slot:1});expect([p.weapon,p.ammo,p.reserve]).toEqual(['deagle',6,35]);
 const old=new Simulation('training',false);live.push(old);const legacy=old.addPlayer('l','legacy','blue');expect(old.buy(legacy.id,'deagle')).toBe(false);
});
it('matches 720 real Simulation authority/prediction movement, recoil, reload and slot commands',()=>{
 const a=sim(),p=a.addPlayer('p','CT','blue');equip(a,p);const b=sim(true),q=b.addPlayer('p','CT','blue');Object.assign(q,JSON.parse(JSON.stringify(a.snapshot('p').players[0])));b.time=a.time;b.tick=a.tick;
 let early=false,shotCount=0;
 for(let seq=81;seq<=800;seq++){
  const input={...EMPTY_INPUT,seq,slot:(seq>=520&&seq<560?0:1)as 0|1,fire:seq===81||seq===420||seq===480||seq===730,reload:seq===95||seq===450,mx:seq<110?.3:0,walk:seq<100,crouch:seq>=425&&seq<445,jump:seq===500};
  command(a,p,seq,input);b.predictSourceCommand(q,input);
  expect(q.sourceDeagle).toEqual(p.sourceDeagle);expect(q.sourceViewmodelTime).toEqual(p.sourceViewmodelTime);expect(q.sourceRifleHandling).toEqual(p.sourceRifleHandling);
  expect([q.weapon,q.ammo,q.reserve,q.primaryAmmo,q.primaryReserve,q.reload,q.cooldown,q.x,q.y,q.z]).toEqual([p.weapon,p.ammo,p.reserve,p.primaryAmmo,p.primaryReserve,p.reload,p.cooldown,p.x,p.y,p.z]);
  early||=p.sourceDeagle!.command.clip===7&&p.sourceDeagle!.command.reloading&&p.sourceDeagle!.command.ownerNextAttack>a.time;
  if(seq===480){expect(p.sourceDeagle!.command.ownerNextAttack).toBeGreaterThan(a.time);expect(p.sourceDeagle!.command.lastShot).toBeLessThan(Math.fround(a.time));expect(p.ammo).toBe(6);}
  if(input.fire&&p.weapon==='deagle'&&p.sourceDeagle!.command.lastShot===Math.fround(a.time))shotCount++;
  if(seq%31===0)Object.assign(q,JSON.parse(JSON.stringify(q)));
 }expect(early).toBe(true);expect(shotCount).toBe(3);expect(b.events.filter(e=>e.type==='shot')).toHaveLength(0);
});
