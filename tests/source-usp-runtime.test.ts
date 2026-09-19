import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createSourceUSPRuntimeState,sourceUSPRuntimeFrame,sourceUSPRuntimePostThink,sourceUSPRuntimeDeploy,sourceUSPRuntimeHolster,type SourceUSPRuntimeState} from '../game/source-usp-runtime';
import {createSourceUSPCommandState} from '../game/source-usp-command';
import {sourcePistolHandlingMode} from '../game/source-pistol-handling';
import {sourceUSPAnimationClock as clock,SOURCE_USP_ANIMATION_DATA} from '../game/source-usp-animation-clock';
const corpus=JSON.parse(readFileSync('output/tests/source-usp-command-native.json','utf8'));
const keys=Object.keys(createSourceUSPCommandState());
const project=(s:Record<string,any>)=>Object.fromEntries(Object.entries(s).filter(([k])=>keys.includes(k)));
it('keeps all 992 original command results and ordered weapon events through the handling/animation bridge',()=>{
 for(const [i,row]of corpus.cases.entries()){
  const s=createSourceUSPRuntimeState(row.context.now);s.command=createSourceUSPCommandState(project(row.input));
  s.handling=sourcePistolHandlingMode(s.handling,s.command.mode);s.idleTime=20;
  const sequence=SOURCE_USP_ANIMATION_DATA.find(x=>x.name===row.input.sequence)?.sequence??0;s.animation=clock.reset(s.animation,sequence);
  const result=sourceUSPRuntimeFrame(s,{...row.context,accuracy:{grounded:true},execution:{type:'authority',serverSeed:row.context.serverSeed}});
  expect(result.state.command,`native ${i}`).toEqual(project(row.result.state));
  expect(result.events.map(({shot,...event}:any)=>event),`events ${i}`).toEqual(row.result.events.map(({selected,sequence,...event}:any)=>event));
  expect(result.state.handling.modes['usp-s']).toBe(result.state.command.mode);
 }
});
it('predicts the same deterministic state, consumes detach once from original clock, and refills before reload gate',()=>{
 let s:SourceUSPRuntimeState=sourceUSPRuntimeDeploy(createSourceUSPRuntimeState(0),0,{grounded:true}).state;
 let detach=0,reload=0,early=false;
 for(let tick=0;tick<620;tick++){
  const now=Math.fround(tick/64),buttons=tick===80?2048:tick===410?1:tick===430?8192:0;
  const input={now,dt:1/64,buttons,commandSeed:tick,accuracy:{grounded:true}};
  const authority=sourceUSPRuntimeFrame(s,{...input,execution:{type:'authority',serverSeed:tick+10}});
  const predicted=sourceUSPRuntimeFrame(JSON.parse(JSON.stringify(s)),{...input,execution:{type:'prediction'}});
  expect(predicted.state).toEqual(authority.state);expect(predicted.events.every(e=>e.kind!=='bullet'||!e.shot)).toBe(true);
  const post=sourceUSPRuntimePostThink(authority.state,{now,viewmodelTime:{animTime:s.animation.animTime,previousAnimTime:s.animation.previousAnimTime}});
  s=post.state;detach+=post.animationEvents.filter(e=>e.recordEvent===46).length;reload+=post.animationEvents.filter(e=>e.recordEvent===54).length;
  if(s.command.clip===12&&s.command.reloading&&s.command.ownerNextAttack>now)early=true;
 }
 expect(detach).toBe(1);expect(reload).toBe(1);expect(s.command.silencerAttached).toBe(false);expect(s.command.mode).toBe(0);expect(s.command.clip).toBe(12);expect(s.command.reserve).toBe(23);expect(early).toBe(true);
});
it('holster before the original detach event and redraw cannot dispatch stale detach or reload events',()=>{
 let s:SourceUSPRuntimeState=sourceUSPRuntimeDeploy(createSourceUSPRuntimeState(0),0,{grounded:true}).state;
 for(let tick=0;tick<100;tick++){
  const now=Math.fround(tick/64),r=sourceUSPRuntimeFrame(s,{now,dt:1/64,buttons:tick===80?2048:0,commandSeed:tick,accuracy:{grounded:true},execution:{type:'prediction'}});
  s=sourceUSPRuntimePostThink(r.state,{now,viewmodelTime:{animTime:s.animation.animTime,previousAnimTime:s.animation.previousAnimTime}}).state;
 }
 s=sourceUSPRuntimeHolster(s,2).state;expect(s.command.silencerAttached).toBe(true);expect(s.command.silencerSwitchTime).toBe(2);
 s=sourceUSPRuntimeDeploy(s,10,{grounded:true}).state;
 const post=sourceUSPRuntimePostThink(s,{now:10.015625,viewmodelTime:{animTime:10,previousAnimTime:10}});
 expect(post.animationEvents.some(e=>[44,46,54].includes(e.recordEvent))).toBe(false);expect(post.state.command.silencerAttached).toBe(true);
});
