import {interpolateSourceDeaglePose} from './source-deagle-runtime-pose.js';
import type { Player, Snapshot } from './types.js';
import {interpolateLocomotion,type LocomotionPose} from './locomotion.js';
import {interpolateSourcePoseInput} from './source-character-pose.js';
import {interpolateSourcePistolPose} from './source-pistol-runtime-pose.js';
import {interpolateSourceAWPPose} from './source-awp-runtime-pose.js';
import {interpolateSourceRagdollState} from './source-ragdoll.js';
import {interpolateSourceDroppedWeapon,type SourceDroppedWeaponState} from './source-dropped-weapons.js';

export type NetworkPose = Pick<Player, 'id' | 'x' | 'y' | 'z' | 'yaw' | 'pitch' |
  'alive' | 'crouch' | 'stancePhase' | 'stanceRate' | 'stanceTarget'> &
  Partial<Pick<Player, 'deaths' | 'team' | 'sourceContract' | 'sourcePoseVersion' | 'sourcePose' | 'sourcePistolPose' | 'sourceAWPPose' | 'sourceRagdoll'>> & LocomotionPose;
export type PoseFrame<P extends NetworkPose> = { time: number; players: readonly P[];droppedWeapons?:readonly SourceDroppedWeaponState[] };
export const REMOTE_DELAY = .1;

/** Interpolate the whole pose at one time; never blend across death, teleport or seat changes. */
export function interpolatePose<P extends NetworkPose>(a: P, b: P, t: number, span = 0): P {
  if (t >= 1) return { ...b };
  if (t <= 0 || a.id !== b.id || a.alive !== b.alive || a.deaths !== b.deaths ||
    a.team !== b.team || a.sourceContract !== b.sourceContract || a.sourcePoseVersion !== b.sourcePoseVersion ||
    Math.hypot(b.x-a.x, b.y-a.y, b.z-a.z) > 3 ||
    (b.stridePhase??0)<(a.stridePhase??0)) return { ...a };
  const mix = (x: number, y: number) => x + (y-x) * t;
  const result = { ...a, x: mix(a.x,b.x), y: mix(a.y,b.y), z: mix(a.z,b.z),
    yaw: a.yaw + Math.atan2(Math.sin(b.yaw-a.yaw), Math.cos(b.yaw-a.yaw)) * t,
    pitch: mix(a.pitch,b.pitch), stancePhase: a.sourceContract?a.stancePhase:mix(a.stancePhase,b.stancePhase),
    stanceRate: a.sourceContract?a.stanceRate:mix(a.stanceRate,b.stanceRate),
    ...(a.sourceContract?{}:interpolateLocomotion(a,b,t)) };
  if(a.sourceContract&&a.sourcePose&&b.sourcePose)
    result.sourcePose=interpolateSourcePoseInput(a.sourcePose,b.sourcePose,t,{spanSeconds:span});
  if(a.sourceContract&&a.sourcePistolPose&&b.sourcePistolPose){
    result.sourcePistolPose=(a.sourcePoseVersion?.includes('-deagle-12426148:')?interpolateSourceDeaglePose:interpolateSourcePistolPose)(a.sourcePistolPose,b.sourcePistolPose,t,span);
    result.sourcePose=result.sourcePistolPose.body;
  }
  if(a.sourceContract&&a.sourceAWPPose&&b.sourceAWPPose){
    result.sourceAWPPose=interpolateSourceAWPPose(a.sourceAWPPose,b.sourceAWPPose,t,span);result.sourcePose=result.sourceAWPPose.body;
  }
  // Corpse part positions are authoritative samples; blend linearly between
  // snapshot ticks, but a corpse that just settled stays frozen exactly.
  if(a.sourceContract&&a.sourceRagdoll&&b.sourceRagdoll&&a.sourceRagdoll.positions.length===b.sourceRagdoll.positions.length){
    result.sourceRagdoll=interpolateSourceRagdollState(a.sourceRagdoll,b.sourceRagdoll,t);
  }
  // Continuous presentation values share the same time. Starts/weapon switches are discrete.
  const aa = a as NetworkPose & Partial<Player>, bb = b as NetworkPose & Partial<Player>;
  const rr = result as NetworkPose & Partial<Player>;
  for (const key of ['vx','vy','vz','shotHeat'] as const)
    if (typeof aa[key] === 'number' && typeof bb[key] === 'number') rr[key] = mix(aa[key]!,bb[key]!);
  if (aa.weapon === bb.weapon)
    for (const key of ['reload','cooldown','respawn'] as const)
      if (typeof aa[key] === 'number' && typeof bb[key] === 'number' && bb[key]! <= aa[key]!)
        rr[key] = mix(aa[key]!,bb[key]!);
  if (aa.weapon === bb.weapon && typeof aa.shotIdle === 'number' &&
    typeof bb.shotIdle === 'number' && span > 0) {
    // shotIdle is an elapsed clock, not a blend weight. B may contain a new shot
    // even when its value exceeds A after packet loss. Recover B's latest shot time.
    const latestShot = span-bb.shotIdle, elapsed = t*span;
    rr.shotIdle = latestShot > -aa.shotIdle+1e-4 && elapsed >= latestShot-1e-8
      ? Math.max(0,elapsed-latestShot) : aa.shotIdle+elapsed;
  }
  return result;
}

/** Sorted authoritative frames. Clamp on missing data instead of inventing extrapolated targets. */
export function samplePoseFrame<P extends NetworkPose>(frames: readonly PoseFrame<P>[], requested: number):
  { time: number; players: P[];droppedWeapons:SourceDroppedWeaponState[] } | null {
  if (!frames.length) return null;
  const first = frames[0], last = frames[frames.length-1];
  const time = Math.max(first.time, Math.min(last.time, Number.isFinite(requested) ? requested : last.time));
  let lower = first, upper = first;
  for (const frame of frames) {
    upper = frame;
    if (frame.time >= time) break;
    lower = frame;
  }
  if (time === upper.time || lower === upper)
    return { time, players: upper.players.map(p => ({ ...p })),droppedWeapons:structuredClone([...(upper.droppedWeapons??[])]) };
  const next = new Map(upper.players.map(p => [p.id, p]));
  const t = (time-lower.time) / (upper.time-lower.time);
  const nextDrops=new Map((upper.droppedWeapons??[]).map(drop=>[drop.id,drop]));
  return { time,droppedWeapons:(lower.droppedWeapons??[]).map(drop=>{
    const next=nextDrops.get(drop.id);return next?interpolateSourceDroppedWeapon(drop,next,t):structuredClone(drop);
  }), players: lower.players.map(p => {
    const b = next.get(p.id); return b ? interpolatePose(p,b,t,upper.time-lower.time) : { ...p };
  }) };
}

/** Room-owned remote playback clock. Reconnection/round changes discard the old timeline. */
export class RemoteTimeline {
  private frames: PoseFrame<Player>[] = [];
  private arrivedAt = 0;
  private round: number | null = null;
  private drawnAt: number | null = null;
  reset() { this.frames = []; this.round = this.drawnAt = null; this.arrivedAt = 0; }
  push(snapshot: Snapshot, now: number) {
    const last = this.frames.at(-1);
    if (last && snapshot.time < last.time) return;
    if (this.round !== null && this.round !== snapshot.round) this.reset();
    this.round = snapshot.round;
    const frame = { time: snapshot.time, players: snapshot.players.map(p => ({ ...p })),droppedWeapons:structuredClone(snapshot.droppedWeapons??[]) };
    if (this.frames.at(-1)?.time === snapshot.time) this.frames[this.frames.length-1] = frame;
    else this.frames.push(frame);
    this.arrivedAt = now;
    while (this.frames.length > 32) this.frames.shift();
  }
  sample(now: number) {
    const latest = this.frames.at(-1);
    if (!latest) return null;
    const requested = latest.time + Math.max(0, now-this.arrivedAt)/1000 - REMOTE_DELAY;
    const frame = samplePoseFrame(this.frames, Math.max(this.drawnAt ?? -Infinity, requested));
    if (frame) this.drawnAt = frame.time;
    return frame;
  }
}
