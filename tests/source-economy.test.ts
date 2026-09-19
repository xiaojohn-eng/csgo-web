import {afterEach,beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT,WEAPONS,type Player} from '../game/types';
import {SOURCE_DEFUSE_KIT_COST,SOURCE_OBJECTIVE_TIMERS,SOURCE_UTILITY_SHOP,sourceUtilityPurchaseAllowed,sourceWeaponTeamAllows} from '../game/source-economy';
import {SOURCE_BUY_ZONES} from '../game/source-buy-zone-data';
import {loadServerSourceMap} from '../server/source-map-data';
import {sourceSimulationFixture} from './fixtures/source-simulation-fixture';
import type {SourceScenario} from '../game/source-scenario';
import type {SourceRuleSetId} from '../game/source-gamemode';
import {SOURCE_CONSECUTIVE_LOSS_AVERSION} from '../game/source-gamemode';

const live:Simulation[]=[];
beforeAll(initPhysics);
afterEach(()=>live.splice(0).forEach(s=>s.dispose()));
function withWeapons(d:SourceScenario):SourceScenario {
 return {...d,weapons:['vandal','m4a4','glock','usp','deagle','awp'],
  defaultWeaponByTeam:{amber:'vandal',blue:'m4a4'},defaultSecondaryWeaponByTeam:{amber:'glock',blue:'usp'},rifleSeed:()=>42,pistolSeed:()=>42};
}
function sim(rules:SourceRuleSetId='competitiveShort',training=false){
 const s=new Simulation(training?'training':'demolition',false,withWeapons(sourceSimulationFixture()),rules);live.push(s);return s;
}
function actors(s:Simulation){return {t:s.addPlayer('t','T','amber'),ct:s.addPlayer('ct','CT','blue')};}
function inventory(p:Player){return {weapon:p.weapon,primary:p.primary,secondary:p.secondary,slot:p.slot,money:p.money,
 armor:p.armor,helmet:p.helmet,kit:p.defuseKit,he:p.grenades,smoke:p.smokes,flash:p.flashes};}

it('uses the native Source C4 timer contract for Dust II',()=>{
 expect(SOURCE_OBJECTIVE_TIMERS).toEqual({plant:3,defuse:10,defuseKit:5,fuse:40});
 const s=sim();const {t}=actors(s);s.phase='live';t.x=t.z=0;t.y=-3.75;
 s.bomb={planted:true,x:t.x,y:t.y,z:t.z,timer:SOURCE_OBJECTIVE_TIMERS.fuse,site:'A',carrier:null};
 expect(s.bomb.timer).toBe(40);
});

it('keeps CT defuser and objective copy aligned with the configurable interact key',()=>{
 const page=readFileSync(resolve('app/page.tsx'),'utf8');
 expect(page).toContain('const interactKey=keybindLabel(settings.keybinds.interact)');
 expect(page).toContain('持续按 {interactKey} 安放');
 expect(page).toContain('持续按住 {interactKey}');
 expect(page).not.toContain('持续按 E');
 expect(SOURCE_DEFUSE_KIT_COST).toBe(400);
 expect(SOURCE_OBJECTIVE_TIMERS.defuse).toBe(10);
 expect(SOURCE_OBJECTIVE_TIMERS.defuseKit).toBe(5);
});

it('matches the available original competitive config and item price lines',()=>{
 const cfg=readFileSync(resolve('.reference-assets/csgo-legacy/csgo/cfg/gamemode_competitive.cfg'),'utf8').split(/\r?\n/);
 for(const [line,key,value]of [[45,'mp_defuser_allocation','0'],[48,'mp_free_armor','0'],[97,'ammo_grenade_limit_flashbang','2'],
  [98,'ammo_grenade_limit_total','4'],[107,'mp_ct_default_primary','""'],[110,'mp_t_default_primary','""']]as const)
  expect(cfg[line-1].trim().split(/\s+/).slice(0,2)).toEqual([key,value]);
 const items=readFileSync(resolve('.reference-assets/csgo-legacy/csgo/scripts/items/items_game.txt'),'utf8').split(/\r?\n/);
 const expected=[['he',22455],['smoke',27482],['flash',27299]]as const;
 for(const [kind,line]of expected)expect(items[line-1].trim()).toBe(`"in game price"\t\t"${SOURCE_UTILITY_SHOP.find(row=>row.id===kind)!.cost}"`);
 expect(items[29281-1].trim()).toBe(`"in game price"\t\t"${SOURCE_DEFUSE_KIT_COST}"`);
 expect(items[29277-1].trim()).toBe('"counter-terrorists"\t\t"1"');
});

describe.each(['competitiveShort','competitive']as const)('%s Source competitive inventory',rules=>{
 it('starts both human and transferable bot seats with only their team pistol and $800',()=>{
  const s=sim(rules);s.fillBots();const first=s.players.find(p=>p.team==='amber')!;
  const human=s.transferControl(first.id,'human','Player',false);
  expect(s.players).toHaveLength(10);
  for(const p of s.players){expect(inventory(p)).toEqual({weapon:p.team==='amber'?'glock':'usp',primary:null,secondary:p.team==='amber'?'glock':'usp',slot:1,money:800,
   armor:0,helmet:false,kit:false,he:0,smoke:0,flash:0});expect([p.primaryAmmo,p.primaryReserve]).toEqual([0,0]);}
  const read=JSON.parse(JSON.stringify(s.snapshot(human.id))).players.find((p:Player)=>p.id===human.id);
  expect(read.primary).toBeNull();expect(read.weapon).toBe('glock');
 });
 it('rejects empty slot commands without holstering or manufacturing a primary',()=>{
  const s=sim(rules),{t}=actors(s);s.phase='live';
  for(let seq=1;seq<=100;seq++){s.setInput(t.id,{...EMPTY_INPUT,seq,slot:0});s.step();}
  expect([t.primary,t.weapon,t.slot,t.ammo,t.primaryAmmo]).toEqual([null,'glock',1,20,0]);
  s.setInput(t.id,{...EMPTY_INPUT,seq:101,slot:0,fire:true});s.step();
  expect(t.ammo).toBe(19);expect(s.events.some(e=>e.type==='shot'&&e.weapon==='glock')).toBe(true);
 });
 it('purchases a primary and a replacement pistol with exact balances and returns to the owned primary',()=>{
  const s=sim(rules),{t,ct}=actors(s);
  expect(s.buy(t.id,'vandal')).toBe(false);expect(t.money).toBe(800);
  t.money=4000;expect(s.buy(t.id,'vandal')).toBe(true);expect([t.primary,t.weapon,t.money]).toEqual(['vandal','vandal',1300]);
  const before=structuredClone(t);expect(s.buy(t.id,'vandal')).toBe(false);expect(t).toEqual(before);
  expect(s.buy(t.id,'deagle')).toBe(true);expect([t.primary,t.secondary,t.weapon,t.money]).toEqual(['vandal','deagle','deagle',600]);
  expect(s.buy(ct.id,'deagle')).toBe(true);expect([ct.primary,ct.weapon,ct.slot,ct.money]).toEqual([null,'deagle',1,100]);
  s.phase='live';s.setInput(t.id,{...EMPTY_INPUT,seq:1,slot:0});s.step();expect(t.weapon).toBe('vandal');
 });
 it('rejects opposite-team guns and equipment without consuming resources',()=>{
  const s=sim(rules),{t,ct}=actors(s);t.money=ct.money=16000;
  for(const [p,items]of [[t,['m4a4','usp','defuseKit']],[ct,['vandal','glock']]]as const)
   for(const item of items){const before=structuredClone(p);expect(s.buy(p.id,item)).toBe(false);expect(p).toEqual(before);}
  expect(sourceWeaponTeamAllows('amber','awp')).toBe(true);expect(sourceWeaponTeamAllows('blue','deagle')).toBe(true);
 });
 it('uses paid grenade carrying limits and refuses overspending or exceeding single/total capacities atomically',()=>{
  const s=sim(rules),{t}=actors(s);t.money=2000;
  for(const item of ['flash','flash','he','smoke'])expect(s.buy(t.id,item)).toBe(true);
  expect([t.flashes,t.grenades,t.smokes,t.money]).toEqual([2,1,1,1000]);
  for(const item of ['he','smoke','flash']){const before=structuredClone(t);expect(s.buy(t.id,item)).toBe(false);expect(t).toEqual(before);}
  t.flashes=0;t.money=199;expect(sourceUtilityPurchaseAllowed(t,'flash')).toBe(false);expect(s.buy(t.id,'flash')).toBe(false);
  t.money=1000;t.flashes=2;t.smokes=2;t.grenades=0;expect(sourceUtilityPurchaseAllowed(t,'he')).toBe(false);
 });
 it('keeps a survivor purchased equipment and clears only the deceased life on ordinary round transition',()=>{
  const s=sim(rules),{t,ct}=actors(s);t.money=ct.money=6000;
  for(const [p,weapon]of [[t,'vandal'],[ct,'m4a4']]as const){expect(s.buy(p.id,weapon)).toBe(true);expect(s.buy(p.id,'armor')).toBe(true);expect(s.buy(p.id,'flash')).toBe(true);}
  expect(s.buy(ct.id,'defuseKit')).toBe(true);ct.armor=73;t.flashes=0;
  s.phase='live';s.damage(t,ct,1000,false);s.endRound('blue','inventory lifecycle');
  const ctCash=ct.money,tCash=t.money;while(s.snapshot().phase==='ended')s.step();
  expect([ct.primary,ct.armor,ct.defuseKit,ct.flashes,ct.money]).toEqual(['m4a4',73,true,1,ctCash]);
  expect([t.primary,t.weapon,t.armor,t.defuseKit,t.grenades,t.smokes,t.flashes,t.money]).toEqual([null,'glock',0,false,0,0,0,tCash]);
 });
 it('resets halftime gear, money and losing streaks and restarts without retaining purchased protection',()=>{
  const s=sim(rules),{t,ct}=actors(s);t.money=ct.money=9000;expect(s.buy(t.id,'vandal')).toBe(true);expect(s.buy(ct.id,'m4a4')).toBe(true);
  for(const p of [t,ct]){expect(s.buy(p.id,'helmet')).toBe(true);expect(s.buy(p.id,'smoke')).toBe(true);}
  expect(s.buy(ct.id,'defuseKit')).toBe(true);
  s.round=s.format!.swapAfterRound;s.phase='ended';s.score={amber:3,blue:s.round-3};s.nextRound();
  for(const p of [t,ct])expect(inventory(p)).toEqual({weapon:p.team==='amber'?'glock':'usp',primary:null,secondary:p.team==='amber'?'glock':'usp',slot:1,money:800,
   armor:0,helmet:false,kit:false,he:0,smoke:0,flash:0});
  s.phase='live';s.endRound('blue','fresh half loss');
  const loser=s.players.find(p=>p.team==='amber')!;expect(loser.money-800).toBe(rules==='competitiveShort'?1900:1400);
  ct.armor=100;ct.helmet=true;ct.defuseKit=true;s.restart();expect([ct.armor,ct.helmet,ct.defuseKit,ct.primary,ct.money]).toEqual([0,false,false,null,800]);
 });
 it('charges bots through the same purchasing path instead of granting free replacement rifles',()=>{
  const s=sim(rules);s.fillBots();const poor=s.players[0],rich=s.players.find(p=>p.team==='blue')!;
  poor.money=500;rich.money=5000;for(const p of s.players)p.alive=false;s.nextRound();
  expect([poor.primary,poor.money,poor.armor]).toEqual([null,500,0]);
  expect([rich.primary,rich.armor,rich.defuseKit,rich.money]).toEqual(['m4a4',100,true,5000-3100-650-400]);
  expect(s.players.every(p=>p.grenades+p.smokes+p.flashes===0)).toBe(true);
 });
});

it('uses short-mode starting rung and lowers the winner one loss rung per win', () => {
 const s=sim('competitiveShort'),{t,ct}=actors(s);t.money=ct.money=0;
 expect(SOURCE_CONSECUTIVE_LOSS_AVERSION).toBe(1);
 s.phase='live';s.endRound('blue','loss one','time');
 s.phase='live';s.endRound('blue','loss two','time');
 // mp_starting_losses=2: amber loses at 1900, then 2400.
 expect(t.money).toBe(4300);expect(ct.money).toBe(6500);
 s.phase='live';s.endRound('amber','win one','time');
 s.phase='live';s.endRound('amber','win two','time');
 // Blue's counter was lowered to zero by its two wins, so both losses pay
 // the base rung (1400) while the counter rises 0 -> 1.
 expect(t.money).toBe(10800);expect(ct.money).toBe(9300);
 const rounds=s.events.filter(e=>e.type==='round'&&e.cash).map(e=>e.cash);
 expect(rounds).toEqual([
  {amber:1900,blue:3250},{amber:2400,blue:3250},
  {amber:3250,blue:1400},{amber:3250,blue:1400},
 ]);
});

it.each([false,true])('defuses at the equipped duration (kit=%s), preserving partial progress only during continuous interaction',kit=>{
 const s=sim(),{ct}=actors(s);if(kit)expect(s.buy(ct.id,'defuseKit')).toBe(true);
 s.phase='live';s.bomb={planted:true,x:ct.x,y:ct.y,z:ct.z,timer:35,site:'A',carrier:null};
 const time=kit?SOURCE_OBJECTIVE_TIMERS.defuseKit:SOURCE_OBJECTIVE_TIMERS.defuse;
 const use={...EMPTY_INPUT,use:true};s.interact(ct,use,time-.1);expect(s.phase).toBe('live');
 s.interact(ct,{...EMPTY_INPUT},.01);expect(ct.use).toBe(0);
 s.interact(ct,use,time-.1);expect(s.phase).toBe('live');s.interact(ct,use,.11);expect(s.phase).toBe('ended');expect(s.winner).toBe('blue');
});

it('keeps Source training and reduced rifle-only scenarios within their declared supported weapons',()=>{
 const s=sim('competitiveShort',true),{t}=actors(s);
 expect([t.primary,t.grenades,t.smokes,t.flashes,t.money]).toEqual(['vandal',1,1,1,16000]);expect(s.buy(t.id,'m4a4')).toBe(true);expect(s.buy(t.id,'usp')).toBe(true);
 const reduced=new Simulation('demolition',false,sourceSimulationFixture());live.push(reduced);
 const p=reduced.addPlayer('r','Rifle fixture','amber');expect(p.primary).toBe('vandal');expect(p.secondary).toBeUndefined();expect(()=>reduced.step()).not.toThrow();
 const legacy=new Simulation('training',false);live.push(legacy);const q=legacy.addPlayer('l','Legacy','amber');expect(q.primary).toBe('vandal');expect(q.grenades).toBe(1);
});

it.each(['amber','blue']as const)('the %s pistol bot releases between semi-auto shots without changing secondary attack mode',team=>{
 const s=sim();s.bots=true;
 const bot=s.addPlayer('bot','Pistol bot',team,true);s.addPlayer('target','Target',team==='amber'?'blue':'amber');s.phase='live';
 for(let i=0;i<300;i++)s.step();
 const shots=s.events.filter(e=>e.type==='shot'&&e.by===bot.id);
 expect(shots.length).toBeGreaterThanOrEqual(3);
 expect(bot.primary).toBeNull();expect(bot.weapon).toBe(team==='amber'?'glock':'usp');
 if(team==='blue')expect(bot.sourceUSP?.command.silencerAttached).toBe(true);
 else expect(bot.sourceGlock?.command.mode).toBe(0);
});

it.each(['competitiveShort','competitive']as const)('runs %s inventory transitions in original Dust II spawn/buy volumes',async rules=>{
 const map=await loadServerSourceMap(resolve('public/source/csgo-12426148/dust2/manifest.json'));
 const s=new Simulation('demolition',false,withWeapons({...map,buyZones:SOURCE_BUY_ZONES}),rules);live.push(s);
 const {t,ct}=actors(s);expect(s.canBuy(t)).toBe(true);expect(s.canBuy(ct)).toBe(true);
 expect([t.primary,ct.primary,t.weapon,ct.weapon,t.money,ct.money]).toEqual([null,null,'glock','usp',800,800]);
 expect(s.buy(t.id,'flash')).toBe(true);expect(s.buy(ct.id,'defuseKit')).toBe(true);
 const original={x:t.x,y:t.y,z:t.z};t.x=0;t.y=0;t.z=0;const before=inventory(t);expect(s.buy(t.id,'he')).toBe(false);expect(inventory(t)).toEqual(before);Object.assign(t,original);
 ct.money=4000;expect(s.buy(ct.id,'m4a4')).toBe(true);expect(ct.money).toBe(4000-WEAPONS.m4a4.cost);
 s.phase='live';s.damage(t,ct,1000,false);s.endRound('blue','original-map lifecycle');s.nextRound();
 expect([t.weapon,t.primary,t.flashes,t.grenades,ct.primary,ct.defuseKit]).toEqual(['glock',null,0,0,'m4a4',true]);
},20000);
