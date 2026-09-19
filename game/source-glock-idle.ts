import {sourceBaseGunIdleAfterCommand} from './source-basegun-idle.js';
/** Original default Glock timeWeaponIdle/WeaponIdle supplement.
 * Apply to a frozen command result BEFORE its ordered events reach presentation.
 * This does not replace command, handling or VM clocks. See docs/source-glock-idle.md.
 */
import { sourceGlockAnimationProfile, type SourceGlockAnimationSequence } from './source-glock-animation-clock.js';
import { type SourceGlockCommandState, type SourceGlockCommandContext, type SourceGlockCommandResult, type SourceGlockCommandEvent } from './source-glock-command.js';
export type SourceGlockIdleEvent = SourceGlockCommandEvent | { kind: 'activity'; activity: 185 };
export const SOURCE_GLOCK_IDLE_VERSION = 'app740-12426148-glock-idle-v1';
export const SOURCE_GLOCK_TIME_TO_IDLE = 2;
export const SOURCE_GLOCK_IDLE_INTERVAL = 20;
const F = Math.fround;
const SEQUENCE: Partial<Record<number, SourceGlockAnimationSequence>> = { 183: 3, 185: 0, 192: 1, 194: 4, 195: 2 };
/** Default weapon-info fields E4=2 and E8=20; the original SendWeaponAnim
 * subsequently overwrites the E8 timer with the selected idle SequenceDuration.
 * Context/command result must refer to the same frame and original default MDL.
 */
export function sourceGlockIdleAfterCommand(before:Readonly<SourceGlockCommandState>,result:Readonly<SourceGlockCommandResult>,context:Readonly<SourceGlockCommandContext>,previousIdleTime:number){
 const idle=sourceBaseGunIdleAfterCommand(before,result,context,previousIdleTime,{timeToIdle:SOURCE_GLOCK_TIME_TO_IDLE,idleInterval:SOURCE_GLOCK_IDLE_INTERVAL,
  duration:activity=>{const sequence=SEQUENCE[activity];return sequence===undefined?undefined:sourceGlockAnimationProfile(sequence).duration;}});
 return {...idle,events:idle.events as SourceGlockIdleEvent[]};
}
