import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createSourceDeagleRuntimeState,sourceDeagleRuntimeFrame,sourceDeagleRuntimePostThink,sourceDeagleRuntimeDeploy,sourceDeagleRuntimeHolster,type SourceDeagleRuntimeState} from '../game/source-deagle-runtime';
import {createSourceDeagleCommandState} from '../game/source-deagle-command';
import {sourceDeagleAnimationClock as clock,SOURCE_DEAGLE_ANIMATION_DATA} from '../game/source-deagle-animation-clock';
const corpus=JSON.parse(readFileSync('output/tests/source-deagle-command-native.json','utf8'));
const keys=Object.keys(createSourceDeagleCommandState());
const project=(s:Record<string,any>)=>Object.fromEntries(Object.entries(s).filter(([k])=>keys.includes(k)));
it('retains original Deagle command and ordered events through the handling/animation bridge',()=>{
 let count=0;
 for(const [i,row]of corpus.cases.entries()){
  if(row.context.operation)continue;
  const s=createSourceDeagleRuntimeState(row.context.now);s.command=createSourceDeagleCommandState(project(row.input));s.idleTime=20;
  const sequence=SOURCE_DEAGLE_ANIMATION_DATA.find(x=>x.name===row.input.sequence)?.sequence??0;s.animation=clock.reset(s.animation,sequence);
  const input={...row.context,accuracy:{grounded:true},execution:{type:'authority' as const,serverSeed:row.context.serverSeed}};
  const result=sourceDeagleRuntimeFrame(s,input),prediction=sourceDeagleRuntimeFrame(JSON.parse(JSON.stringify(s)),{...input,execution:{type:'prediction'}});
  expect(result.state.command,`native ${i}`).toEqual(project(row.result.state));
  expect(result.events.map(({shot,...event}:any)=>event),`events ${i}`).toEqual(row.result.events.map(({selected,sequence,...event}:any)=>event));
  expect(prediction.state).toEqual(result.state);count++;
 }expect(count).toBe(1126);
});
it('uses last-round animation and one early event54 while preserving the original reload attack gate',()=>{
 let s:SourceDeagleRuntimeState=sourceDeagleRuntimeDeploy(createSourceDeagleRuntimeState(0),0,{grounded:true}).state;
 let reload=0,early=false,lastRound=false,bullets=0;
 for(let tick=0;tick<480;tick++){
  const now=Math.fround(tick/64),buttons=[80,100,120,140,160,180,200].includes(tick)?1:tick===220?8192:0;
  const input={now,dt:1/64,buttons,commandSeed:tick,accuracy:{grounded:true}};
  const authority=sourceDeagleRuntimeFrame(s,{...input,execution:{type:'authority',serverSeed:tick+10}}),predicted=sourceDeagleRuntimeFrame(JSON.parse(JSON.stringify(s)),{...input,execution:{type:'prediction'}});
  expect(predicted.state).toEqual(authority.state);expect(predicted.events.every(e=>e.kind!=='bullet'||!e.shot)).toBe(true);
  bullets+=authority.events.filter(e=>e.kind==='bullet').length;lastRound||=authority.state.animation.sequence===4;
  const post=sourceDeagleRuntimePostThink(authority.state,{now,viewmodelTime:{animTime:s.animation.animTime,previousAnimTime:s.animation.previousAnimTime}});s=post.state;
  reload+=post.animationEvents.filter(e=>e.recordEvent===54).length;
  if(s.command.clip===7&&s.command.reloading&&s.command.ownerNextAttack>now)early=true;
 }expect(bullets).toBe(7);expect(lastRound).toBe(true);expect(reload).toBe(1);expect(early).toBe(true);expect(s.command.clip).toBe(7);expect(s.command.reserve).toBe(28);
 const holster=sourceDeagleRuntimeHolster(s,8).state,draw=sourceDeagleRuntimeDeploy(holster,10,{grounded:true}).state;
 const post=sourceDeagleRuntimePostThink(draw,{now:10.015625,viewmodelTime:{animTime:10,previousAnimTime:10}});expect(post.animationEvents.some(e=>e.recordEvent===54)).toBe(false);
});
