import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createSourceDeagleCommandState,sourceDeagleCommandFrame,sourceDeagleDeploy,sourceDeagleHolster,sourceDeagleAnimationEvent,SOURCE_DEAGLE_RELOAD_SEQUENCE_DURATION,type SourceDeagleCommandState} from '../game/source-deagle-command';
const corpus=JSON.parse(readFileSync('output/tests/source-deagle-command-native.json','utf8'));
const keys=Object.keys(createSourceDeagleCommandState());
const state=(input:Record<string,unknown>)=>Object.fromEntries(Object.entries(input).filter(([k])=>keys.includes(k)))as Partial<SourceDeagleCommandState>;
const events=(input:Record<string,unknown>[])=>input.map(e=>{const {selected,sequence,...command}=e;return command;});
it('matches 1140 original Deagle command, deployment, holster and chained frames',()=>{
 expect(corpus.serverSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');expect(corpus.originalVtable).toBe('0x12f75dc');expect(corpus.cases).toHaveLength(1140);
 for(const [i,row]of corpus.cases.entries()){
  const initial=createSourceDeagleCommandState(state(row.input));
  const actual=row.context.operation==='deploy'?sourceDeagleDeploy(initial,row.context):row.context.operation==='holster'?sourceDeagleHolster(initial,row.context):sourceDeagleCommandFrame(initial,{...row.context,reloadDuration:SOURCE_DEAGLE_RELOAD_SEQUENCE_DURATION});
  expect(actual,`${i}: ${row.label}`).toEqual({state:state(row.result.state),events:events(row.result.events),dispatch:row.result.dispatch,buttonsAfter:row.result.buttonsAfter});
 }
});
it('matches original event54 transfer independently of owner, gate and reload flags',()=>{
 expect(corpus.eventCases).toHaveLength(16);
 for(const row of corpus.eventCases)expect(sourceDeagleAnimationEvent(createSourceDeagleCommandState(state(row.input)),54,row.context.owner)).toEqual(state(row.result.state));
});
it('restores continuous native command state without timer-based reload transfer',()=>{
 let count=0;
 for(const chain of corpus.sequences){
  let current=createSourceDeagleCommandState(state(corpus.cases[chain.start].input));
  for(const row of corpus.cases.slice(chain.start,chain.start+chain.count)){
   current=sourceDeagleCommandFrame(JSON.parse(JSON.stringify(current)),{...row.context,reloadDuration:SOURCE_DEAGLE_RELOAD_SEQUENCE_DURATION}).state;
   expect(current).toEqual(state(row.result.state));count++;
  }
 }expect(count).toBe(720);
});
