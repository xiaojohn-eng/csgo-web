import {afterEach,beforeAll,expect,it} from 'vitest';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT,type Player,type WeaponId} from '../game/types';
import {sourcePurchasedSlot} from '../game/source-buy-confirmation';
import {sourceSimulationFixture} from './fixtures/source-simulation-fixture';

beforeAll(initPhysics);
const live:Simulation[]=[];
afterEach(()=>live.splice(0).forEach(sim=>sim.dispose()));
function simulation(){
 const source=sourceSimulationFixture();source.weapons=['vandal','m4a4','glock','usp','deagle'];
 source.defaultWeaponByTeam={amber:'vandal',blue:'m4a4'};source.defaultSecondaryWeaponByTeam={amber:'glock',blue:'usp'};
 source.pistolSeed=source.rifleSeed=()=>42;
 const sim=new Simulation('demolition',false,source);live.push(sim);return sim;
}

it('confirms Deagle from inventory when a stale slot 0 command wins the last buy tick, then equips it on the next input',()=>{
 const sim=simulation(),p=sim.addPlayer('p','Last buy tick','blue');let seq=0;
 // This case needs an actually owned primary so the stale slot can win. Supply
 // an explicit test budget, then purchase it through the normal authority path.
 p.money=5000;expect(sim.buy(p.id,'m4a4')).toBe(true);expect(p.money).toBe(1900);
 // Reach the real phase boundary by stepping; do not assign phase/time or
 // pre-fill a synthetic post-purchase snapshot.
 while(sim.phase==='buy'&&sim.remaining>1/60&&seq<2000){
  sim.setInput(p.id,{...EMPTY_INPUT,seq:++seq,slot:0});sim.step();
 }
 expect(sim.phase).toBe('buy');expect(sim.remaining).toBeGreaterThan(0);expect(sim.remaining).toBeLessThanOrEqual(1/60);
 const beforeMoney=p.money,primary={id:p.primary,ammo:p.primaryAmmo,reserve:p.primaryReserve};
 expect(sourcePurchasedSlot('deagle',p)).toBeNull();expect(sim.buy(p.id,'deagle')).toBe(true);
 expect([p.weapon,p.slot,p.money]).toEqual(['deagle',1,beforeMoney-700]);
 // The server still has the previous input until the next packet. It advances
 // before its next snapshot, so no snapshot ever exposes held=deagle here.
 sim.step();
 const own=JSON.parse(JSON.stringify(sim.snapshot(p.id).players.find(player=>player.id===p.id)))as Player;
 expect([sim.phase,own.weapon,own.slot,own.secondary]).toEqual(['live','m4a4',0,'deagle']);
 const pending:WeaponId='deagle',confirmedSlot=sourcePurchasedSlot(pending,own);
 expect(confirmedSlot).toBe(1);
 sim.setInput(p.id,{...EMPTY_INPUT,seq:++seq,slot:confirmedSlot!});sim.step();
 expect([p.weapon,p.slot,p.ammo,p.reserve]).toEqual(['deagle',1,7,35]);
 expect([p.primary,p.primaryAmmo,p.primaryReserve]).toEqual([primary.id,primary.ammo,primary.reserve]);
 expect(p.money).toBe(beforeMoney-700);
});

it('only confirms a matching owned slot and preserves inventory when purchases are unconfirmed',()=>{
 const own={primary:'m4a4',secondary:'usp'}as const,saved={...own};
 expect(sourcePurchasedSlot(null,own)).toBeNull();
 expect(sourcePurchasedSlot('deagle',own)).toBeNull();
 expect(sourcePurchasedSlot('glock',own)).toBeNull();
 expect(sourcePurchasedSlot('vandal',own)).toBeNull();
 expect(sourcePurchasedSlot('usp',own)).toBe(1);
 expect(sourcePurchasedSlot('m4a4',own)).toBe(0);
 expect(sourcePurchasedSlot('deagle',{primary:'m4a4',secondary:'deagle'})).toBe(1);
 expect(sourcePurchasedSlot('vandal',{primary:'vandal',secondary:'deagle'})).toBe(0);
 expect(sourcePurchasedSlot('deagle',{primary:'vandal'})).toBeNull();
 expect(own).toEqual(saved);
});
