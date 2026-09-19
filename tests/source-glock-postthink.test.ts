import {expect,it} from 'vitest';
import {createSourceGlockRuntimeState,sourceGlockRuntimeFrame,sourceGlockRuntimePostThink,sourceGlockRuntimeDeploy,sourceGlockRuntimeHolster,type SourceGlockRuntimeState} from '../game/source-glock-runtime';
import {advanceSourceViewmodelAnimTimes} from '../game/source-viewmodel-animation-time';
import {advanceSourceSoundEvents,type SourceSoundCursor} from '../game/source-sound-timeline';
const dt=1/64;
function command(s:SourceGlockRuntimeState,now:number,buttons=0,prediction=false){return sourceGlockRuntimeFrame(s,{now,dt,buttons,commandSeed:42,accuracy:{grounded:true},execution:prediction?{type:'prediction'}:{type:'authority',serverSeed:17}});}
it('applies original AE54 after busy command frames, retains the lock and serializes the event cursor exactly',()=>{
 let authority=createSourceGlockRuntimeState(10),prediction=structuredClone(authority),time={animTime:10-dt,previousAnimTime:10-2*dt};
 authority.command.clip=prediction.command.clip=16;let events=0,transferAt:number|undefined;
 for(let i=0;i<160;i++){
  const now=10+i*dt,a=command(authority,now,i===0?0x2000:0),p=command(prediction,now,i===0?0x2000:0,true);
  const after=sourceGlockRuntimePostThink(a.state,{now,viewmodelTime:time}),replayed=sourceGlockRuntimePostThink(p.state,{now,viewmodelTime:time});
  expect(replayed).toEqual(after);for(const event of after.animationEvents)if(event.recordEvent===54){
   events++;transferAt=now;expect(a.state.command.clip).toBe(16);expect(after.state.command.clip).toBe(20);expect(after.state.command.reserve).toBe(116);
   expect(after.state.command.reloading).toBe(true);expect(after.state.command.ownerNextAttack).toBe(a.state.command.ownerNextAttack);
  }
  authority=after.state;prediction=JSON.parse(JSON.stringify(replayed.state));time={animTime:after.state.animation.animTime,previousAnimTime:after.state.animation.previousAnimTime};
 }
 expect(events).toBe(1);expect(transferAt).toBeGreaterThan(10.9);expect(transferAt).toBeLessThan(11);
 expect(authority.command).toMatchObject({clip:20,reserve:116,reloading:false,reloadVisComplete:true});
});
it('uses the player shared VM times after a long rifle interval and cancels the previous reload generation',()=>{
 let s=createSourceGlockRuntimeState(1),time={animTime:1,previousAnimTime:1};s.command.clip=16;
 s=command(s,1,0x2000).state;
 for(let i=1;i<=20;i++){const now=1+i*dt,r=sourceGlockRuntimePostThink(s,{now,viewmodelTime:time});s=r.state;time={animTime:r.state.animation.animTime,previousAnimTime:r.state.animation.previousAnimTime};}
 s=sourceGlockRuntimeHolster(s,1.4).state;
 for(let i=21;i<220;i++)time=advanceSourceViewmodelAnimTimes(time,1+i*dt).state;
 const now=1+220*dt;s=sourceGlockRuntimeDeploy(s,now,{grounded:true}).state;
 const after=sourceGlockRuntimePostThink(s,{now,viewmodelTime:time});
 expect(after.state.animation.sequence).toBe(3);expect(after.state.animation.cycle).toBeLessThan(.02);
 expect(after.animationEvents.some(e=>e.recordEvent===54)).toBe(false);expect(after.state.command).toMatchObject({clip:16,reserve:120,reloading:false});
});
it('uses original half-open sound event windows with a high-water cursor during corrections',()=>{
 const list=[{time:0,event:'draw'},{time:.4,event:'slide'}];let cursor:SourceSoundCursor|undefined;
 const hear=(time:number)=>{const result=advanceSourceSoundEvents(cursor,{pose:'draw',generation:1,time},list,{sourceCycleWindow:true});cursor=result.cursor;return result.events;};
 expect(hear(0)).toEqual([]);expect(hear(.4)).toEqual(['draw']);expect(hear(.39)).toEqual([]);expect(hear(.41)).toEqual(['slide']);expect(hear(.4)).toEqual([]);expect(hear(.42)).toEqual([]);
});
