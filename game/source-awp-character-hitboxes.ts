import {createSourceSampledHitboxes} from './source-hitboxes.js';
import {sampleSourceAWPCharacterPose,type SourceAWPCharacterPoseIndex,type SourceAWPCharacterPoseInput} from './source-awp-character-pose.js';
import type {SourceActorPose,SourceHitboxProvider} from './source-player-contract.js';
export type SourceAWPCharacterHitboxPose=Omit<SourceActorPose,'weapon'>&{weapon:'awp';sourceAWPPose:SourceAWPCharacterPoseInput};
/** Original player OBBs consume the same complete AWP body layers as rendering.
 * The world weapon mesh is not a player hitbox. Shared WeaponId is unchanged. */
export function createSourceAWPCharacterHitboxes(index:SourceAWPCharacterPoseIndex,poseVersion:string):SourceHitboxProvider{
 if(index.weapon!=='awp'||index.world.data.weaponId!=='awp')throw Error('AWP hitboxes require the original AWP graph');
 return createSourceSampledHitboxes(index.body,poseVersion,(pose:SourceActorPose)=>{
  const p=pose as unknown as SourceAWPCharacterHitboxPose;
  if(p.weapon!=='awp'||p.team!==(index.team==='t'?'amber':'blue'))throw Error('AWP hitbox weapon/team identity mismatch');
  if(!p.sourceAWPPose)throw Error('Missing complete AWP hitbox pose');
  return sampleSourceAWPCharacterPose(index,p.sourceAWPPose).body.sourceWorldMatrices;
 });
}
