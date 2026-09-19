/** Original Glock data applied to the shared, native-verified viewmodel clock. */
import {SOURCE_GLOCK_ANIMATION_DATA} from './source-glock-animation-data.js';
import {createSourceViewmodelAnimationDriver,type SourceViewmodelAnimationClock,type SourceViewmodelAnimationEvent} from './source-viewmodel-animation-clock.js';
export {SOURCE_GLOCK_ANIMATION_DATA} from './source-glock-animation-data.js';
export const SOURCE_GLOCK_ANIMATION_CLOCK_VERSION='app740-12426148-glock-animation-clock-v1';
export const SOURCE_GLOCK_ANIMATION_MDL_SHA256='48ab6740def0ad8d7d4a42476583a61c8aa7d9f9f784b2d2f167720f14875242';
export type SourceGlockAnimationSequence=0|1|2|3|4|5;
export type SourceGlockAnimationClock=SourceViewmodelAnimationClock<SourceGlockAnimationSequence>;
export type SourceGlockAnimationEvent=SourceViewmodelAnimationEvent;
const clock=createSourceViewmodelAnimationDriver<SourceGlockAnimationSequence>(SOURCE_GLOCK_ANIMATION_DATA,{183:3,185:0,192:1,194:4,195:2},{inspect:5,idle:0});
export const sourceGlockAnimationProfile=clock.profile,
 createSourceGlockAnimationClock=clock.create,
 restoreSourceGlockAnimationClock=clock.restore,
 resetSourceGlockAnimationClock=clock.reset,
 requestSourceGlockAnimationSequence=clock.requestSequence,
 requestSourceGlockAnimationActivity=clock.requestActivity,
 advanceSourceGlockAnimationClock=clock.advance,
 dispatchSourceGlockAnimationEvents=clock.dispatch,
 sourceGlockAnimationFrame=clock.frame;
