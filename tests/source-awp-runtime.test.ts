import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createSourceAWPCommandState,type SourceAWPCommandState} from '../game/source-awp-command';
import {createSourceAWPRuntimeState,sourceAWPRuntimeFrame,sourceAWPRuntimeDeploy,sourceAWPRuntimeHolster,sourceAWPRuntimePostThink,type SourceAWPRuntimeState} from '../game/source-awp-runtime';
const corpus=JSON.parse(readFileSync('output/tests/source-awp-runtime-native.json','utf8'));
const keys=Object.keys(createSourceAWPCommandState());
const state=(input:Record<string,unknown>)=>Object.fromEntries(Object.entries(input).filter(([key])=>keys.includes(key)))as Partial<SourceAWPCommandState>;
const events=(input:Record<string,unknown>[])=>input.map(e=>{const {selected,sequence,shot,...command}=e;return command;});
function input(context:Record<string,any>,prediction=context.serverSeed===undefined){const {serverSeed=99,...rest}=context;return {...rest,accuracy:{grounded:true},execution:prediction?{type:'prediction'}:{type:'authority',serverSeed}}as Parameters<typeof sourceAWPRuntimeFrame>[1];}
it('matches all original AWP idle stores and ordered command events',()=>{
 expect(corpus.idleCases).toHaveLength(240);
 for(const [i,row]of corpus.idleCases.entries()){
  const initial={...createSourceAWPRuntimeState(10),command:createSourceAWPCommandState(state(row.input)),idleTime:row.input.idleTime};
  const actual=sourceAWPRuntimeFrame(initial,input(row.context));
  expect(actual.state.command,`${i} command`).toEqual(state(row.result.state));expect(actual.state.idleTime,`${i} idle`).toBe(row.result.idleTime);expect(events(actual.events),`${i} events`).toEqual(events(row.result.events));
 }
});
it('matches 3,000 original joined command, idle, VM and reload-event frames after every JSON restore',()=>{
 expect(corpus.cases).toHaveLength(3000);expect(corpus.reloadEvents).toHaveLength(4);
 let committed=0;
 for(const chain of corpus.sequences){
  let current:SourceAWPRuntimeState={...createSourceAWPRuntimeState(10),command:createSourceAWPCommandState(state(corpus.cases[chain.start].input))};
  for(const [index,row]of corpus.cases.slice(chain.start,chain.start+chain.count).entries()){
   current=JSON.parse(JSON.stringify(current));
   const command=row.context.operation==='holster'?sourceAWPRuntimeHolster(current,row.context.now):row.context.operation==='deploy'?sourceAWPRuntimeDeploy(current,row.context.now,{grounded:true}):sourceAWPRuntimeFrame(current,input(row.context));
   expect(events(command.events),`${index} command events`).toEqual(events(row.command.events));expect(command.state.command,`${index} command`).toEqual(state(row.command.state));expect(command.state.animation,`${index} animation reset`).toEqual(row.commandAnimation);
   current=command.state;
   if(row.clock){const post=sourceAWPRuntimePostThink(current,{now:row.context.now,viewmodelTime:current.animation});expect(post.animationEvents,`${index} VM events`).toEqual(row.clock.events);committed+=post.animationEvents.filter(e=>e.recordEvent===54).length;current=post.state;}
   expect(current.command,`${index} post-command`).toEqual(state(row.state));expect(current.animation,`${index} clock`).toEqual(row.animationAfter);expect(current.idleTime,`${index} idle time`).toBe(row.state.idleTime);expect(current.action??null,`${index} action identity`).toEqual(row.action);
  }
 }
 expect(committed).toBe(4);
});
it('keeps original deferred brass and unregistered marker separate from the immediate command unzoom',()=>{
 let current=createSourceAWPRuntimeState(10);
 current.command=createSourceAWPCommandState({zoomLevel:1,mode:1,scoped:true,fovTarget:40,fovStart:40});
 const fired=sourceAWPRuntimeFrame(current,input({now:10,dt:1/64,buttons:1,commandSeed:123,serverSeed:456}));
 expect(fired.events.find(e=>e.kind==='bullet')).toMatchObject({mode:1,accuracyMode:1,recoilMode:1,serverSeed:456});expect(fired.events.find(e=>e.kind==='fov')).toMatchObject({target:90,duration:Math.fround(.05)});
 current=fired.state;const cues:{tick:number;name:string;cycle:number;status:string}[]=[];
 for(let tick=0;tick<90;tick++){
  const post=sourceAWPRuntimePostThink(current,{now:Math.fround(10+tick/64),viewmodelTime:current.animation});current=post.state;
  for(const cue of post.animationCues)cues.push({tick,...cue});
  expect(post.animationEvents.some(e=>e.recordEvent===71||e.recordEvent===0)).toBe(false);
 }
 const brass=cues.filter(e=>e.name==='AE_CLIENT_EJECT_BRASS'),marker=cues.filter(e=>e.name==='AE_WPN_UNZOOM');
 expect(brass).toHaveLength(1);expect(brass[0]).toMatchObject({tick:50,cycle:Math.fround(.46),status:'client-event'});
 expect(marker).toHaveLength(1);expect(marker[0]).toMatchObject({tick:22,cycle:Math.fround(.2),status:'unregistered-marker'});expect(current.command.fovTime).toBe(10);
 const predicted=sourceAWPRuntimeFrame(createSourceAWPRuntimeState(10),input({now:10,dt:1/64,buttons:1,commandSeed:123},true));expect(predicted.events.find(e=>e.kind==='bullet')).not.toHaveProperty('serverSeed');expect(predicted.events.find(e=>e.kind==='bullet')).not.toHaveProperty('shot');
 expect(sourceAWPRuntimePostThink(current,{now:20,viewmodelTime:current.animation,active:false}).state).toBe(current);
});
