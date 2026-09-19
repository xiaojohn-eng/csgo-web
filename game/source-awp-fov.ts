/** Original ordinary player FOV storage and integer smoothstep (server 7cb6b0).
 * target=0 is the engine default-FOV sentinel. Default FOV is 90 in this profile.
 */
const F=Math.fround;
export interface SourceAWPFovState {fovTarget:number;fovStart:number;fovTime:number;fovDuration:number}
export function sourceAWPFov<T extends SourceAWPFovState>(input:Readonly<T>,nowValue:number):{state:T;value:number}{
 const state={...input},now=F(nowValue),target=state.fovTarget||90;
 if(![now,state.fovTime,state.fovDuration,state.fovTarget,state.fovStart].every(Number.isFinite)||state.fovDuration<0)throw RangeError('Invalid original AWP FOV');
 if(state.fovDuration===0)return {state,value:target};
 let t=F(F(now-state.fovTime)/state.fovDuration);
 if(t>=1)return {state:{...state,fovStart:target},value:target};
 t=Math.max(0,Math.min(1,t));const square=F(t*t),smooth=F(F(3*square)-F(square*F(t+t)));
 return {state,value:Math.trunc(F(F(smooth*F(target-state.fovStart))+state.fovStart))};
}
/** A request samples the old integer FOV before replacing its clock and target. */
export function sourceAWPSetFov<T extends SourceAWPFovState>(input:Readonly<T>,now:number,target:number,duration:number):T{
 const sampled=sourceAWPFov(input,now);
 return {...sampled.state,fovStart:sampled.value,fovTarget:target,fovTime:F(now),fovDuration:F(duration)};
}
