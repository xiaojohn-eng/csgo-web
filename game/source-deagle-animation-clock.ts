import {SOURCE_DEAGLE_ANIMATION_DATA} from './source-deagle-animation-data.js';
import {createSourceViewmodelAnimationDriver,sourceActivityVariants,type SourceViewmodelAnimationClock} from './source-viewmodel-animation-clock.js';
import {SOURCE_WEAPON_FIRE_VARIANTS} from './source-weapon-fire-variants.js';
export {SOURCE_DEAGLE_ANIMATION_DATA} from './source-deagle-animation-data.js';
export const SOURCE_DEAGLE_ANIMATION_CLOCK_VERSION='app740-12426148-deagle-animation-clock-v1';
export const SOURCE_DEAGLE_ANIMATION_MDL_SHA256='0b58fdf3444f8ef1ab2718fdb60815eec07236c0708f5aa76122e4610f8512b3';
export type SourceDeagleAnimationSequence=0|1|2|3|4|5|6|7|8;
export type SourceDeagleAnimationClock=SourceViewmodelAnimationClock<SourceDeagleAnimationSequence>;
export const SOURCE_DEAGLE_ACTIVITY_SEQUENCE:Readonly<Record<number,SourceDeagleAnimationSequence|undefined>>={185:0,192:1,195:4,194:5,183:6};
/** The original fire activity. This model carries three sequences for it, so a shot draws
 * one by the model's own weights instead of always starting the first. */
export const SOURCE_DEAGLE_FIRE_ACTIVITY=192;
export const SOURCE_DEAGLE_FIRE_VARIANTS=sourceActivityVariants<SourceDeagleAnimationSequence>(SOURCE_DEAGLE_ANIMATION_DATA,SOURCE_DEAGLE_FIRE_ACTIVITY,SOURCE_WEAPON_FIRE_VARIANTS.deagle,SOURCE_DEAGLE_ACTIVITY_SEQUENCE);
export const sourceDeagleAnimationClock=createSourceViewmodelAnimationDriver<SourceDeagleAnimationSequence>(SOURCE_DEAGLE_ANIMATION_DATA,SOURCE_DEAGLE_ACTIVITY_SEQUENCE,{inspect:7,additionalInspect:[8],idle:0,variants:SOURCE_DEAGLE_FIRE_VARIANTS});
