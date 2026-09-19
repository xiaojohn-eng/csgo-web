import {SOURCE_USP_ANIMATION_DATA} from './source-usp-animation-data.js';
import {createSourceViewmodelAnimationDriver,sourceActivityVariants,type SourceViewmodelAnimationClock} from './source-viewmodel-animation-clock.js';
import {SOURCE_WEAPON_FIRE_VARIANTS} from './source-weapon-fire-variants.js';
export {SOURCE_USP_ANIMATION_DATA} from './source-usp-animation-data.js';
export const SOURCE_USP_ANIMATION_CLOCK_VERSION='app740-12426148-usp-animation-clock-v1';
export const SOURCE_USP_ANIMATION_MDL_SHA256='5d61f1e7ced3107aa77f3ae3dc28e94004f880e59b6656f31c72e35a32dc3ea4';
export type SourceUSPAnimationSequence=0|1|2|3|4|5|6|7|8|9|10;
export type SourceUSPAnimationClock=SourceViewmodelAnimationClock<SourceUSPAnimationSequence>;
export const SOURCE_USP_ACTIVITY_SEQUENCE:Readonly<Record<number,SourceUSPAnimationSequence|undefined>>={185:0,220:1,221:2,192:3,195:6,194:7,481:8,183:9};
/** The original fire activity. This model carries three sequences for it, so a shot draws
 * one by the model's own weights instead of always starting the first. */
export const SOURCE_USP_FIRE_ACTIVITY=192;
export const SOURCE_USP_FIRE_VARIANTS=sourceActivityVariants<SourceUSPAnimationSequence>(SOURCE_USP_ANIMATION_DATA,SOURCE_USP_FIRE_ACTIVITY,SOURCE_WEAPON_FIRE_VARIANTS.usp,SOURCE_USP_ACTIVITY_SEQUENCE);
export const sourceUSPAnimationClock=createSourceViewmodelAnimationDriver<SourceUSPAnimationSequence>(SOURCE_USP_ANIMATION_DATA,SOURCE_USP_ACTIVITY_SEQUENCE,{inspect:10,idle:0,variants:SOURCE_USP_FIRE_VARIANTS});
