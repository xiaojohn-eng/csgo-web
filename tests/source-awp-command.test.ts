import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createSourceAWPCommandState,sourceAWPCommandFrame,sourceAWPDeploy,sourceAWPHolster,sourceAWPAnimationEvent,SOURCE_AWP_RELOAD_SEQUENCE_DURATION,type SourceAWPCommandState} from '../game/source-awp-command';
import {sourceAWPFov} from '../game/source-awp-fov';
const corpus=JSON.parse(readFileSync('output/tests/source-awp-command-native.json','utf8'));
const keys=Object.keys(createSourceAWPCommandState());
const state=(input:Record<string,unknown>)=>Object.fromEntries(Object.entries(input).filter(([k])=>keys.includes(k)))as Partial<SourceAWPCommandState>;
const events=(input:Record<string,unknown>[])=>input.map(e=>{const {selected,sequence,...command}=e;return command;});
function command(s:SourceAWPCommandState,context:Record<string,any>){
 if(context.operation==='deploy')return sourceAWPDeploy(s,context as {now:number});
 if(context.operation==='holster')return sourceAWPHolster(s,context as {now:number});
 return sourceAWPCommandFrame(s,{...context,reloadDuration:SOURCE_AWP_RELOAD_SEQUENCE_DURATION}as Parameters<typeof sourceAWPCommandFrame>[1]);
}
it('matches original AWP sniper branches and ordered command/FOV events at all native boundaries',()=>{
 expect(corpus.serverSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');expect(corpus.originalVtable).toBe('0x12e92f4');expect(corpus.cases).toHaveLength(3447);
 for(const [i,row]of corpus.cases.entries())expect(command(createSourceAWPCommandState(state(row.input)),row.context),`${i} ${row.label}`).toEqual({state:state(row.result.state),events:events(row.result.events),dispatch:row.result.dispatch,buttonsAfter:row.result.buttonsAfter});
});
it('matches original integer FOV smoothstep, including an interrupted transition and default sentinel',()=>{
 expect(corpus.fovCases).toHaveLength(324);
 for(const row of corpus.fovCases){const actual=sourceAWPFov(createSourceAWPCommandState(state(row.input)),row.context.now);expect(actual).toEqual({state:state(row.state),value:row.value});}
});
it('replays all 2,550 continuous command frames across zoom, fire, reload and holster through JSON snapshots',()=>{
 expect(corpus.sequences).toHaveLength(3);
 for(const chain of corpus.sequences){let current=createSourceAWPCommandState(state(corpus.cases[chain.start].input));for(const row of corpus.cases.slice(chain.start,chain.start+chain.count)){current=command(JSON.parse(JSON.stringify(current)),row.context).state;expect(current).toEqual(state(row.result.state));}}
});
it('uses only original event54 ammo stores, independent of a wall timer or reloading flag',()=>{
 expect(corpus.eventCases).toHaveLength(16);
 for(const row of corpus.eventCases)expect(sourceAWPAnimationEvent(createSourceAWPCommandState(state(row.input)),54,row.context.owner)).toEqual(state(row.result.state));
});
it('identifies the original zoom smoothing reset without clearing the separate ballistic penalty',()=>{
 expect(corpus.zoomFieldIsolation).toHaveLength(3);
 for(const row of corpus.zoomFieldIsolation){
  expect(row.result.state.ballisticPenalty).toBe(Math.fround(.37));expect(row.result.state.zoomSmoothing).toBe(0);
  const actual=command(createSourceAWPCommandState(state(row.input)),row.context);
  expect(actual.events).toContainEqual({kind:'zoom-smoothing-reset',field:'0xa8c',value:0});
  expect(actual.events.map(e=>e.kind)).not.toContain('accuracy-reset');
 }
});
