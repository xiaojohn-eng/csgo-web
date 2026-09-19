/** The original third-person muzzle flash on a world weapon.
 *
 * The original keeps the effect choice per weapon in `items_game.txt`
 * (`muzzle_flash_effect_3rd_person`, staged as `game/source-weapon-effects.ts`)
 * and anchors it on the world weapon's own `muzzle_flash` attachment, which every
 * original world weapon this build ships already carries. The first-person path
 * is a different original system for some weapons (the SSG 08 and the Elites name
 * distinct `_FP` systems), so the two are never substituted for each other.
 *
 * This module owns the decision only: whether an authoritative pose starts a new
 * shot, and which original system (if any) that shot shows. Rendering it is the
 * caller's, using the graph of that system.
 */
import type { SourcePoseMode, SourcePoseParameters } from './source-character-pose';
import type { SourceWeaponEffects } from './source-weapon-effects';
import type { WeaponId } from './types';

/** The original player activity that plays a weapon's world fire animation. The
 * world pose drivers already drive their fire layer from it, so it is the one
 * authoritative signal every client agrees a shot happened on. */
export const SOURCE_WORLD_FIRE_ACTIVITY = 192;

/** The authoritative fire state of a rendered weapon, in either of the two forms
 * the original rigs publish: the world fire action (pistol family, whose world
 * layers are driven by the action) or the fire layer cycle (the character rigs,
 * whose fire layer carries its own cycle and weight). */
export type SourceWorldMuzzleFlashTrigger =
  | { kind: 'world-action'; activity?: number; time?: number; generation?: number }
  | { kind: 'fire-layer'; fireWeight?: number; fireCycle?: number };
/** What the caller remembers between frames for one rendered actor. */
export type SourceWorldMuzzleFlashCursor = { firing: boolean; mark: number; shots: number };
export type SourceWorldMuzzleFlashDecision = { shot: boolean; system: string | null; cursor: SourceWorldMuzzleFlashCursor;
  /** Why a firing pose showed no flash, for the audit. */
  reason: 'ok' | 'no-fire' | 'already-counted' | 'suppressed' | 'no-original-effect' | 'third-person-effect-not-staged' };

/** The original third-person muzzle systems whose graphs this build has staged and
 * ported: the pistol family's own sprite flash, the rifle family's `_vent` sprite
 * flash with its `_main` flame and `_glow`, and the AWP's own dispatcher, which
 * carries the hunting rifle's continuous flame and that flame's glow. Any other
 * original system is reported as not staged rather than replaced by a look-alike
 * effect. */
export const SOURCE_PISTOL_WORLD_MUZZLE_SYSTEM = 'weapon_muzzle_flash_pistol';
export const SOURCE_AWP_WORLD_MUZZLE_SYSTEM = 'weapon_muzzle_flash_awp';
export const SOURCE_STAGED_WORLD_MUZZLE_SYSTEMS: readonly string[] = [SOURCE_PISTOL_WORLD_MUZZLE_SYSTEM,
  'weapon_muzzle_flash_assaultrifle', SOURCE_AWP_WORLD_MUZZLE_SYSTEM];
/** Weapons whose original third-person system is the staged pistol system. */
export const SOURCE_WORLD_PISTOL_WEAPONS: readonly WeaponId[] = ['glock', 'usp', 'deagle'];

/** Reads the authoritative fire state of one rendered actor, in the form its own
 * original rig publishes. Returns null when that rig has not reported firing
 * state at all, so the caller can skip the actor instead of inventing a shot. */
export function sourceWorldMuzzleTrigger(weapon: WeaponId, state: { sourceGlock?: unknown; sourceUSP?: unknown;
  sourceDeagle?: unknown; sourceAWPPose?: unknown; sourcePose?: unknown }): SourceWorldMuzzleFlashTrigger | null {
  const action = (runtime: unknown) => {
    const found = (runtime as { action?: { activity?: number; time?: number; generation?: number } } | undefined)?.action;
    return found ? { kind: 'world-action' as const, activity: found.activity, time: found.time, generation: found.generation } : null;
  };
  if (weapon === 'glock') return action(state.sourceGlock);
  if (weapon === 'usp') return action(state.sourceUSP);
  if (weapon === 'deagle') return action(state.sourceDeagle);
  // The character and AWP rigs publish the fire layer itself.
  const layer = (runtime: unknown): SourceWorldMuzzleFlashTrigger | null => {
    if (!runtime || typeof runtime !== 'object') return null;
    const found = runtime as { fireWeight?: number; fireCycle?: number };
    return { kind: 'fire-layer', fireWeight: found.fireWeight, fireCycle: found.fireCycle };
  };
  if (weapon === 'awp') return layer((state.sourceAWPPose as { body?: unknown } | undefined)?.body);
  return layer(state.sourcePose);
}

/** Decides one frame of the world muzzle flash for one rendered actor.
 *
 * A shot is a real transition, never a level: the world fire action starts (a new
 * action, or the first frame of one), or the fire layer's cycle goes backwards
 * (each original shot animation restarts from its first frame, so it only ever
 * advances within one shot). A suppressed USP shows the original alternate field,
 * which the original leaves empty, so it shows nothing. */
export function sourceWorldMuzzleFlash(trigger: SourceWorldMuzzleFlashTrigger, effects: SourceWeaponEffects | null,
  silenced: boolean, previous: SourceWorldMuzzleFlashCursor | undefined): SourceWorldMuzzleFlashDecision {
  let firing: boolean, mark: number;
  if (trigger.kind === 'world-action') {
    firing = trigger.activity === SOURCE_WORLD_FIRE_ACTIVITY;
    // The original runtime increments the generation per action; the action's own
    // start time separates two actions when it is the only field that moved.
    mark = (trigger.generation ?? 0) * 1e6 + (trigger.time ?? 0);
  } else {
    firing = (trigger.fireWeight ?? 0) > 0;
    mark = trigger.fireCycle ?? 0;
  }
  // The first observation of an actor is remembered as not firing, so an actor
  // that appears mid-shot still shows that shot once instead of losing it.
  const cursor = previous ?? { firing: false, mark, shots: 0 };
  const next: SourceWorldMuzzleFlashCursor = { firing, mark, shots: cursor.shots };
  // A world fire action is a shot whenever a new one starts; a fire layer is a
  // shot only when its cycle goes backwards, because inside one original shot
  // animation the cycle only ever advances.
  const advanced = trigger.kind === 'world-action'
    ? Math.abs(mark - cursor.mark) > 1e-6 : mark < cursor.mark - .02;
  const started = firing && (!cursor.firing || advanced);
  if (!started) return { shot: false, system: null, cursor: next, reason: firing ? 'already-counted' : 'no-fire' };
  next.shots = cursor.shots + 1;
  if (silenced) return { shot: true, system: null, cursor: next, reason: 'suppressed' };
  if (!effects) return { shot: true, system: null, cursor: next, reason: 'no-original-effect' };
  const system = effects.muzzleFlash3rd;
  if (!SOURCE_STAGED_WORLD_MUZZLE_SYSTEMS.includes(system))
    return { shot: true, system: null, cursor: next, reason: 'third-person-effect-not-staged' };
  return { shot: true, system, cursor: next, reason: 'ok' };
}

/** The original attachment the third-person flash is anchored on. */
export const SOURCE_WORLD_MUZZLE_ATTACHMENT = 'muzzle_flash';

/** The original random table is indexed and the original leaves the seed to its
 * caller, so both clients must index the same entries for the same shot: the seed
 * is derived from the shooter's id and that shooter's own shot number, which the
 * authoritative state pins on both ends. */
function sourceWorldMuzzleSeedBase(actorId: string, shot: number): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < actorId.length; i++) { hash = (hash ^ actorId.charCodeAt(i)) >>> 0; hash = Math.imul(hash, 16777619) >>> 0; }
  return (hash ^ Math.imul(shot >>> 0, 2654435761)) >>> 0;
}

/** The original pistol flash's two systems draw from two slices of the table. */
export function sourceWorldMuzzleFlashSeeds(actorId: string, shot: number): { main: number; core: number } {
  const base = sourceWorldMuzzleSeedBase(actorId, shot);
  return { main: base & 4095, core: (base >>> 12) & 4095 };
}

/** The original rifle vent draws from the same table; a second mix keeps its
 * entries independent of the pistol's while staying pinned to the same shot. */
export function sourceWorldRifleMuzzleSeeds(actorId: string, shot: number): { vent: number } {
  const base = sourceWorldMuzzleSeedBase(actorId, shot);
  return { vent: Math.imul(base ^ (base >>> 15), 2246822519) >>> 0 & 4095 };
}

/** The AWP's own chain draws from the same original table; a third mix keeps it
 * independent of both while staying pinned to the same shot. */
export function sourceWorldAwpMuzzleSeeds(actorId: string, shot: number): { awp: number } {
  const base = sourceWorldMuzzleSeedBase(actorId, shot);
  return { awp: Math.imul(base ^ (base >>> 13), 2654435761) >>> 0 & 4095 };
}

/** Unused pose fields kept in the public signature so callers can pass a whole
 * pose without narrowing it. */
export type SourceWorldMuzzleFlashPose = { fireWeight?: number; fireCycle?: number; fireCycleRate?: number;
  fireTimeSeconds?: number; state?: string; cycle?: number; parameters?: SourcePoseParameters; blendMode?: SourcePoseMode };
