import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {sourceUSPAnimationClock as clock,SOURCE_USP_ANIMATION_MDL_SHA256,type SourceUSPAnimationClock} from '../game/source-usp-animation-clock';
const corpus=JSON.parse(readFileSync('output/tests/source-usp-animation-clock-native.json','utf8'));
const restore=(input:Partial<SourceUSPAnimationClock>)=>clock.restore({...clock.create(0),playbackRate:1,...input});
it('reuses the shared clock while matching every original USP model reset, advance and emitted event',()=>{
 expect(corpus.sourceMdlSha256).toBe(SOURCE_USP_ANIMATION_MDL_SHA256);expect(corpus.cases).toHaveLength(790);
 const committed=new Map<number,number>();
 for(const [i,row]of corpus.cases.entries()){
  let current=restore(row.input);
  if(row.context.reset!==undefined)current=clock.reset(current,row.context.reset);
  expect(current,`${i} reset`).toEqual(row.result.afterReset);
  current=clock.advance(current,row.context.now);expect(current,`${i} advance`).toEqual(row.result.afterAdvance);
  const result=clock.dispatch(current,row.context.now);
  expect(result,`${i} dispatch`).toEqual({state:row.result.state,events:row.result.events});
  for(const event of result.events)committed.set(event.recordEvent,(committed.get(event.recordEvent)??0)+1);
 }
 expect(committed.get(44)).toBe(1);expect(committed.get(46)).toBe(1);expect(committed.get(54)).toBe(1);
});
it('retains original lookat guard, missing silenced fire activity, and counterintuitive original draw names',()=>{
 for(const row of corpus.requestGuards)expect(clock.requestSequence(restore(row.input),row.sequence).applied).toBe(row.accepted);
 const original=restore({sequence:3,cycle:.5});expect(clock.requestActivity(original,477)).toEqual({state:original,applied:false});
 expect(clock.profile(clock.requestActivity(original,481).state.sequence).name).toBe('draw');
 expect(clock.profile(clock.requestActivity(original,183).state.sequence).name).toBe('draw_silenced');
});
