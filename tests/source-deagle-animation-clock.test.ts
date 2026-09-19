import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {sourceDeagleAnimationClock as clock,SOURCE_DEAGLE_ANIMATION_MDL_SHA256,type SourceDeagleAnimationClock} from '../game/source-deagle-animation-clock';
const corpus=JSON.parse(readFileSync('output/tests/source-deagle-animation-clock-native.json','utf8'));
const restore=(input:Partial<SourceDeagleAnimationClock>)=>clock.restore({...clock.create(0),playbackRate:1,...input});
it('matches 676 original Deagle clock frames and original event registration',()=>{
 expect(corpus.sourceMdlSha256).toBe(SOURCE_DEAGLE_ANIMATION_MDL_SHA256);expect(corpus.cases).toHaveLength(676);
 let reloads=0;
 for(const [i,row]of corpus.cases.entries()){
  let current=restore(row.input);if(row.context.reset!==undefined)current=clock.reset(current,row.context.reset);
  expect(current,`${i} reset`).toEqual(row.result.afterReset);
  current=clock.advance(current,row.context.now);expect(current,`${i} advance`).toEqual(row.result.afterAdvance);
  const result=clock.dispatch(current,row.context.now);expect(result,`${i} dispatch`).toEqual({state:row.result.state,events:row.result.events});
  reloads+=result.events.filter(e=>e.recordEvent===54).length;
 }expect(reloads).toBe(1);
});
it('matches 189 original sequence interrupt guards and last-round sequence',()=>{
 expect(corpus.requestGuards).toHaveLength(189);
 for(const row of corpus.requestGuards)expect(clock.requestSequence(restore(row.input),row.sequence).applied).toBe(row.accepted);
 expect(clock.profile(clock.requestActivity(restore({}),195).state.sequence).name).toBe('shoot_empty');
});
