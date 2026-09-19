import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {sourceAWPAnimationClock as clock,SOURCE_AWP_ANIMATION_MDL_SHA256,type SourceAWPAnimationClock} from '../game/source-awp-animation-clock';
const corpus=JSON.parse(readFileSync('output/tests/source-awp-animation-clock-native.json','utf8'));
const restore=(input:Partial<SourceAWPAnimationClock>)=>clock.restore({...clock.create(0),playbackRate:1,...input});
it('matches every native AWP sequence reset, advance and authoritative event in source record order',()=>{
 expect(corpus.sourceMdlSha256).toBe(SOURCE_AWP_ANIMATION_MDL_SHA256);expect(corpus.cases).toHaveLength(551);
 const counts=new Map<number,number>();
 for(const [i,row]of corpus.cases.entries()){
  let current=restore(row.input);if(row.context.reset!==undefined)current=clock.reset(current,row.context.reset);
  expect(current,`${i} reset`).toEqual(row.result.afterReset);current=clock.advance(current,row.context.now);expect(current,`${i} advance`).toEqual(row.result.afterAdvance);
  const actual=clock.dispatch(current,row.context.now);expect(actual,`${i} dispatch`).toEqual({state:row.result.state,events:row.result.events});
  for(const event of actual.events)counts.set(event.recordEvent,(counts.get(event.recordEvent)??0)+1);
 }
 expect(counts.get(54)).toBe(1);expect(counts.has(71)).toBe(false);expect(counts.has(0)).toBe(false);
});
it('keeps exact activity/sequence identity, missing holster and inspect guards',()=>{
 for(const row of corpus.requestGuards)expect(clock.requestSequence(restore(row.input),row.sequence).applied).toBe(row.accepted);
 const old=restore({sequence:1,cycle:.5});expect(clock.requestActivity(old,184)).toEqual({state:old,applied:false});expect(clock.requestActivity(old,195)).toEqual({state:old,applied:false});
 expect(clock.profile(clock.requestActivity(old,194).state.sequence).name).toBe('awp_reload');
 expect(corpus.registrations.AE_WPN_UNZOOM.unregisteredServer).toBe(true);
});
