import {afterEach,beforeAll,expect,it} from 'vitest';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT,type Input,type Player} from '../game/types';
import {sourceSimulationFixture} from './fixtures/source-simulation-fixture';
beforeAll(initPhysics);const live:Simulation[]=[];afterEach(()=>live.splice(0).forEach(s=>s.dispose()));
function simulation(){const d=sourceSimulationFixture();d.weapons=['vandal','m4a4','glock'];d.pistolSeed=()=>42;const s=new Simulation('training',false,d);live.push(s);return s;}
function command(s:Simulation,p:Player,seq:number,input:Partial<Input>={},dt=1/60){s.setInput(p.id,{...EMPTY_INPUT,seq,slot:p.slot,...input});s.step(dt);}
it('initializes one player viewmodel clock at birth and advances it after ordinary rifle commands',()=>{
 const s=simulation();s.time=37.125;const p=s.addPlayer('p','T','amber');
 expect(p.sourceViewmodelTime).toEqual({animTime:Math.fround(s.time),previousAnimTime:Math.fround(s.time)});
 const birth=s.time;command(s,p,1);expect(p.sourceViewmodelTime).toEqual({animTime:Math.fround(s.time),previousAnimTime:Math.fround(birth)});
 const snapshot=s.snapshot(),history=s.history.at(-1)!.players[0];snapshot.players[0].sourceViewmodelTime!.animTime=-9;
 expect(p.sourceViewmodelTime!.animTime).toBe(Math.fround(s.time));expect(history.sourceViewmodelTime!.animTime).toBe(Math.fround(s.time));
 p.sourceViewmodelTime!.animTime=-8;expect(history.sourceViewmodelTime!.animTime).not.toBe(-8);
});
it('uses the same times when Glock is first deployed after a long rifle interval and rejects rebuy without resetting playback',()=>{
 const s=simulation(),p=s.addPlayer('p','T','amber');for(let seq=1;seq<=180;seq++)command(s,p,seq);
 const before=structuredClone(p.sourceViewmodelTime!);command(s,p,181,{slot:1});
 expect(p.sourceViewmodelTime).toEqual({animTime:Math.fround(s.time),previousAnimTime:before.animTime});
 expect(p.sourceGlock!.animation!.cycle).toBeGreaterThan(0);expect(p.sourceGlock!.animation!.cycle).toBeLessThan(.02);
 const times=structuredClone(p.sourceViewmodelTime!),state=structuredClone(p.sourceGlock);expect(s.buy(p.id,'glock')).toBe(false);expect(p.sourceViewmodelTime).toEqual(times);expect(p.sourceGlock).toEqual(state);
 command(s,p,182);expect(p.sourceGlock!.animation!.cycle).toBeGreaterThan(state!.animation!.cycle);expect(p.sourceGlock!.animation!.cycle).toBeLessThan(.04);
});
it.each(['buy','ended','match']as const)('advances the living owned viewmodel during %s without accepting held fire',phase=>{
 const s=simulation(),p=s.addPlayer('p','T','amber');command(s,p,1,{slot:1});for(let seq=2;seq<=80;seq++)command(s,p,seq);
 s.phase=phase;s.remaining=10;const before=structuredClone(p.sourceViewmodelTime!),ammo=p.ammo;
 command(s,p,81,{fire:true});expect(p.sourceViewmodelTime).toEqual({animTime:Math.fround(s.time),previousAnimTime:before.animTime});
 expect(p.ammo).toBe(ammo);expect(s.events.filter(e=>e.type==='shot')).toHaveLength(0);
 const deadTime=structuredClone(p.sourceViewmodelTime!);p.alive=false;p.respawn=10;command(s,p,82,{fire:true});expect(p.sourceViewmodelTime).toEqual(deadTime);
});
