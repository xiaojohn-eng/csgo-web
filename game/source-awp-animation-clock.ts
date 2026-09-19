import {SOURCE_AWP_ANIMATION_DATA} from './source-awp-animation-data.js';
import {createSourceViewmodelAnimationDriver,type SourceViewmodelAnimationClock} from './source-viewmodel-animation-clock.js';
export {SOURCE_AWP_ANIMATION_DATA} from './source-awp-animation-data.js';
export const SOURCE_AWP_ANIMATION_CLOCK_VERSION='app740-12426148-awp-animation-clock-v1';
export const SOURCE_AWP_ANIMATION_MDL_SHA256='37e15ab1db5613843df7efaf2dc61cf3dc5dc1642a4eee74f74596c10b56e0c3';
export type SourceAWPAnimationSequence=0|1|2|3|4|5|6;
export type SourceAWPAnimationClock=SourceViewmodelAnimationClock<SourceAWPAnimationSequence>;
export const SOURCE_AWP_ACTIVITY_SEQUENCE:Readonly<Record<number,SourceAWPAnimationSequence|undefined>>={185:0,192:1,183:2,194:3};
const base=createSourceViewmodelAnimationDriver<SourceAWPAnimationSequence>(SOURCE_AWP_ANIMATION_DATA,SOURCE_AWP_ACTIVITY_SEQUENCE,{inspect:4,idle:0});
/** Original name-prefix guard includes lookat01_prepare and lookat01_loop. */
function requestSequence(input:Readonly<SourceAWPAnimationClock>,sequence:SourceAWPAnimationSequence){
 const state=base.restore(input);base.profile(sequence);
 if(state.sequence>=4&&state.cycle<Math.fround(.98)&&sequence===0)return {state,applied:false};
 return base.requestSequence(state,sequence);
}
function requestActivity(input:Readonly<SourceAWPAnimationClock>,activity:number){
 if(!Number.isInteger(activity))throw RangeError('Invalid AWP activity');
 const sequence=SOURCE_AWP_ACTIVITY_SEQUENCE[activity];
 return sequence===undefined?{state:base.restore(input),applied:false}:requestSequence(input,sequence);
}
export const sourceAWPAnimationClock={...base,requestSequence,requestActivity};
