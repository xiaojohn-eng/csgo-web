import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {createSourcePistolParticleClock} from '../game/source-pistol-particles-clock';
it('matches original complete empty-collection Simulate over zero, short, slow and split frames',()=>{
 const oracle=JSON.parse(readFileSync('.reference-assets/source-exports/pistol-particles-r2/native-scheduler.json','utf8'));
 expect(oracle.status).toBe('original-empty-collection-simulate-executed');
 for(const row of oracle.cases){const clock=createSourcePistolParticleClock(row.system);
  for(const step of row.steps){expect(clock.snapshot().gateCounter).toBe(step.gateBefore);const actual=clock.advance(step.inputDelta);
   expect(actual.before).toBe(step.before);expect(actual.time).toBe(step.after);expect(actual.gateCounter).toBe(step.gateAfter);
   if(actual.steps.length)expect(actual.steps.at(-1)).toBe(step.simulatedDelta);
  }
 }
});
it('protects short original collection time after a slow first frame without changing particle lifetimes',()=>{
 const main=createSourcePistolParticleClock('main'),core=createSourcePistolParticleClock('core');
 for(let i=0;i<3;i++){expect(main.advance(0).gateCounter).toBe(0);expect(core.advance(0).gateCounter).toBe(0);}
 expect(main.advance(.1).time).toBe(Math.fround(.0075));expect(core.advance(.1).time).toBe(Math.fround(.015));
 main.reset();expect(main.snapshot().time).toBe(0);expect(()=>main.advance(-1)).toThrow('delta');
});
