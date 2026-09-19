import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {createSourceUSPCommandState,sourceUSPCommandFrame,sourceUSPAnimationEvent,SOURCE_USP_RELOAD_SEQUENCE_DURATION,type SourceUSPCommandState} from '../game/source-usp-command';
const corpus=JSON.parse(readFileSync('output/tests/source-usp-command-native.json','utf8'));
const keys=Object.keys(createSourceUSPCommandState());
const state=(input:Record<string,unknown>)=>Object.fromEntries(Object.entries(input).filter(([k])=>keys.includes(k)))as Partial<SourceUSPCommandState>;
const events=(input:Record<string,unknown>[])=>input.map(e=>{const {selected,sequence,...command}=e;return command;});
describe('original USP command through the common base gun',()=>{
 it('matches every original command field and ordered event at input, cooldown, reload, silencer and ownership boundaries',()=>{
  expect(corpus.serverSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');
  expect(corpus.cases).toHaveLength(992);
  for(const [i,row]of corpus.cases.entries()){
   const actual=sourceUSPCommandFrame(createSourceUSPCommandState(state(row.input)),{...row.context,reloadDuration:SOURCE_USP_RELOAD_SEQUENCE_DURATION});
   expect(actual,`${i}: ${row.label}`).toEqual({state:state(row.result.state),events:events(row.result.events),dispatch:row.result.dispatch,buttonsAfter:row.result.buttonsAfter});
  }
 });
 it('uses original event44/46/54 stores, including no-owner and non-reloading cases',()=>{
  expect(corpus.eventCases).toHaveLength(96);
  for(const row of corpus.eventCases)expect(sourceUSPAnimationEvent(createSourceUSPCommandState(state(row.input)),row.event,row.context.owner)).toEqual(state(row.result.state));
 });
 it('replays continuous native chains through JSON without invoking timer-based attachment changes',()=>{
  for(const chain of corpus.sequences){
   let current=createSourceUSPCommandState(state(corpus.cases[chain.start].input));
   for(const row of corpus.cases.slice(chain.start,chain.start+chain.count)){
    current=sourceUSPCommandFrame(JSON.parse(JSON.stringify(current)),{...row.context,reloadDuration:SOURCE_USP_RELOAD_SEQUENCE_DURATION}).state;
    expect(current).toEqual(state(row.result.state));
   }
  }
  const started=sourceUSPCommandFrame(createSourceUSPCommandState(),{now:10,dt:1/64,buttons:2048,commandSeed:1,reloadDuration:SOURCE_USP_RELOAD_SEQUENCE_DURATION}).state;
  const late=sourceUSPCommandFrame(started,{now:20,dt:1/64,buttons:0,commandSeed:2,reloadDuration:SOURCE_USP_RELOAD_SEQUENCE_DURATION}).state;
  expect(late.silencerAttached).toBe(true);expect(sourceUSPAnimationEvent(late,46).silencerAttached).toBe(false);
 });
});
