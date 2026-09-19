import {afterEach,beforeAll,expect,it} from 'vitest';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT,type Event as GameEvent} from '../game/types';
import {sourceSimulationFixture} from './fixtures/source-simulation-fixture';

beforeAll(initPhysics);
const live:Simulation[]=[];
afterEach(()=>live.splice(0).forEach(sim=>sim.dispose()));
function simulation(prediction=false){
 const source=sourceSimulationFixture();source.weapons=['vandal','m4a4','glock','usp','deagle'];
 source.defaultWeaponByTeam={amber:'vandal',blue:'m4a4'};source.defaultSecondaryWeaponByTeam={amber:'glock',blue:'usp'};
 source.pistolSeed=source.rifleSeed=prediction?()=>{throw Error('Prediction must not allocate authority entropy');}:()=>42;
 const sim=new Simulation('training',false,source);live.push(sim);return sim;
}

it('fires all 42 original Deagle rounds, then emits one authoritative empty sound while prediction emits none',()=>{
 const authority=simulation(),p=authority.addPlayer('p','Empty sound','blue');
 const prediction=simulation(true),q=prediction.addPlayer('p','Empty sound','blue');
 expect(authority.buy(p.id,'deagle')).toBe(true);expect(prediction.buy(q.id,'deagle')).toBe(true);
 expect([p.ammo,p.reserve]).toEqual([7,35]);
 let seq=0,shots=0;const observed:GameEvent[]=[];
 const step=(fire=false)=>{
  const input={...EMPTY_INPUT,slot:1 as const,seq:++seq,fire},previousEvent=authority.eid;
  authority.setInput(p.id,input);authority.step();prediction.predictSourceCommand(q,input);
  observed.push(...authority.events.filter(event=>event.id>previousEvent));
  expect(q.sourceDeagle).toEqual(p.sourceDeagle);
  expect([q.ammo,q.reserve,q.reload,q.cooldown]).toEqual([p.ammo,p.reserve,p.reload,p.cooldown]);
 };
 // Only ordinary trigger/release input is used. Auto reload transfers all five
 // reserve magazines; neither ammo nor any command clock is edited by the test.
 for(let tick=0;tick<6000&&shots<42;tick++){
  const command=p.sourceDeagle!.command;
  const fire=command.clip>0&&authority.time>=command.nextPrimary&&authority.time>=command.ownerNextAttack&&
   !command.reloading&&!command.shotsFired&&!command.waitForNoAttack;
  const clip=command.clip;step(fire);if(fire&&p.sourceDeagle!.command.clip<clip)shots++;
 }
 expect(shots).toBe(42);expect([p.ammo,p.reserve]).toEqual([0,0]);
 expect(observed.filter(event=>event.type==='shot')).toHaveLength(42);
 expect(observed.filter(event=>event.type==='weaponSound')).toHaveLength(0);
 for(let tick=0;tick<20;tick++)step();
 expect(p.sourceDeagle!.command.dryFireCount).toBe(0);
 step(true);const emptySeq=seq;
 expect(p.sourceDeagle!.command.dryFireCount).toBe(1);
 // Remain inside the original 0.2 second empty-fire gate: one accepted dry
 // command cannot be replayed as multiple audio events by subsequent ticks.
 for(let tick=0;tick<6;tick++)step(true);
 const sounds=observed.filter(event=>event.type==='weaponSound');
 expect(sounds).toHaveLength(1);
 expect(sounds[0]).toMatchObject({by:p.id,seq:emptySeq,weapon:'deagle',x:p.x,y:expect.any(Number),z:p.z,
  sourceWeaponSound:{weapon:'deagle',event:'Default.ClipEmpty_Pistol'}});
 expect(observed.filter(event=>event.type==='shot')).toHaveLength(42);
 expect(prediction.events.filter(event=>event.type==='shot'||event.type==='weaponSound')).toHaveLength(0);
 expect(q.sourceDeagle!.command.dryFireCount).toBe(1);
});
