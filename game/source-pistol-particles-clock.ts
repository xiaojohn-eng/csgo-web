/** Bounded port of original CParticleCollection::Simulate 0xd481a0.
 * Counter gate 0xd4828f..0xd482d8 and time splitting 0xd48340..0xd483a3
 * are executed independently in native-scheduler.json. Initialization begins
 * at collection time zero; the game trigger/render call phase is not inferred. */
export function createSourcePistolParticleClock(system:'main'|'core'){
 const f=Math.fround,tick=f(system==='main'?.0075:.015),maximumTimeStep=f(.1),minimumRenderedFrames=1;
 let time=0,gateCounter=0;
 return {
  reset(){time=0;gateCounter=0;},
  snapshot:()=>({time,gateCounter,tick,minimumRenderedFrames}),
  advance(deltaSeconds:number){
   if(!Number.isFinite(deltaSeconds)||deltaSeconds<0)throw Error('Invalid original particle simulation delta');
   const delta=f(deltaSeconds),before=time,steps:number[]=[];
   if(delta<1e-22)return {before,time,steps,gateCounter};
   let remaining=delta;
   // This counter is incremented by Simulate, not by a browser render callback.
   // Original signed comparison is >, so minimumRenderedFrames=1 gates twice.
   if(gateCounter<=minimumRenderedFrames){
    if(f(time+remaining)>tick)remaining=Math.max(tick,f(tick-time));
    gateCounter++;
   }
   remaining=Math.min(remaining,f(10*maximumTimeStep));
   while(remaining>0){const step=Math.min(remaining,maximumTimeStep);remaining=f(remaining-step);time=f(time+step);steps.push(step);}
   return {before,time,steps,gateCounter};
  },
 };
}
