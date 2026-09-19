import {expect,it} from 'vitest';
import {sourceAWPWorldBrass,sourceBrassDraws} from '../game/source-world-brass';
import {sourceAWPAnimationClock} from '../game/source-awp-animation-clock';
import type {Player} from '../game/types';
it('ejects once across a skipped original AWP event cycle and rearms only for a new action',()=>{
  const event=sourceAWPAnimationClock.profile(1).events.find(e=>e.recordEvent===71&&e.type===1040)!;
  expect(event).toBeDefined();
  const p={alive:true,weapon:'awp',deaths:0,sourceAWP:{action:{generation:1},animation:{sequence:1,cycle:0}}}as Player;
  const before=sourceAWPWorldBrass(p);expect(before.fire).toBe(false);
  p.sourceAWP!.animation.cycle=event.cycle+.05;
  const crossing=sourceAWPWorldBrass(p,before.cursor);expect(crossing.fire).toBe(true);
  expect(sourceAWPWorldBrass(p,crossing.cursor).fire).toBe(false);
  p.sourceAWP!.action!.generation++;
  expect(sourceAWPWorldBrass(p,crossing.cursor).fire).toBe(true);
  p.alive=false;expect(sourceAWPWorldBrass(p,crossing.cursor).fire).toBe(false);
});
it('keeps all brass draws in the PCF unit range and deterministic across clients',()=>{
  for(let i=0;i<200;i++){
    const draws=sourceBrassDraws('remote',i);expect(draws).toEqual(sourceBrassDraws('remote',i));
    for(const d of draws){expect(d).toBeGreaterThanOrEqual(0);expect(d).toBeLessThan(1);}
  }
});
