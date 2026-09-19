import { stanceBlend } from './falcon-stance.js';
import { type Point3 } from './falcon-head-reference.js';
import { falconBodyHitVolumes,falconCompleteReferences } from './falcon-body-reference.js';
import type { LocomotionPose } from './locomotion.js';
// ACTION03 161 skinned samples: head tops fit this capsule's TOTAL height with >=13.38mm margin.
// This is not a claim that the root capsule contains horizontally offset heads or all equipment.
export const CHARACTER = {
  radius: .3,
  standingHeight: 1.86,
  standingCenter: .93,
  standingHalfSegment: .63,
  crouchingHeight: 1.34,
  eyeHeight: 1.686034175,
  headHeight: 1.684237331,
  headRadius: .19,
  crouchEyeHeight: 1.141796844,
  crouchHeadHeight: 1.14,
} as const;
export type CharacterPose = { crouch: boolean; stancePhase?: number; yaw?: number; pitch?: number;
  x?: number; y?: number; z?: number } & LocomotionPose;
export function characterBlend(p: CharacterPose): number {
  return p.stancePhase === undefined ? (p.crouch ? 1 : 0) : stanceBlend(p.stancePhase);
}
export function capsuleHeight(p: CharacterPose): number {
  return CHARACTER.standingHeight + (CHARACTER.crouchingHeight - CHARACTER.standingHeight) * characterBlend(p);
}
export function characterReferences(p: CharacterPose) {
  return falconCompleteReferences({ ...p,yaw:p.yaw ?? 0,pitch:p.pitch ?? 0,blend:characterBlend(p),
    origin:{x:p.x ?? 0,y:p.y ?? 0,z:p.z ?? 0} });
}
/** Canonical camera/shoot origin. Consumers must use all XYZ, not only height. */
export function eyeOrigin(p: CharacterPose): Point3 { return characterReferences(p).eye; }
export function eyeHeight(p: CharacterPose): number { return eyeOrigin(p).y - (p.y ?? 0); }
export type HitVolume = { center: Point3; radius: number; head: boolean };
export function characterHitVolumes(p: CharacterPose): HitVolume[] {
  const input={...p,yaw:p.yaw??0,pitch:p.pitch??0,blend:characterBlend(p),
    origin:{x:p.x??0,y:p.y??0,z:p.z??0}},references=falconCompleteReferences(input);
  return [{center:references.head,radius:CHARACTER.headRadius,head:true},
    ...falconBodyHitVolumes(input,references).map(volume=>({...volume,head:false}))];
}
