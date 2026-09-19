import {createSourceSampledHitboxes} from './source-hitboxes.js';
import {sampleSourceDeagleCharacterPose,type SourceDeagleCharacterPoseIndex,type SourceDeagleCharacterPoseInput} from './source-deagle-character-pose.js';
import type {SourceActorPose,SourceHitboxProvider} from './source-player-contract.js';
import type {SourceDeagleActorPose} from './source-deagle-runtime-pose.js';
export type SourceDeagleHitboxPose=SourceDeagleActorPose&{sourcePistolPose:SourceDeagleCharacterPoseInput};
/** The full renderer body layer sampler feeds the existing original rotated
 * player OBB implementation. World weapon geometry is never a player hitbox. */
export function createSourceDeagleHitboxes(index:SourceDeagleCharacterPoseIndex,poseVersion:string):SourceHitboxProvider{
 if(index.weapon!=='deagle'||index.world.data.weaponId!=='deagle')throw Error('Deagle hitboxes require the original Deagle graph');
 return createSourceSampledHitboxes(index.body,poseVersion,(pose:SourceActorPose)=>{
  const p=pose as SourceDeagleHitboxPose;
  if(p.weapon!=='deagle'||p.team!==(index.team==='t'?'amber':'blue'))throw Error('Deagle hitbox weapon/team identity mismatch');
  if(!p.sourcePistolPose)throw Error('Missing complete Deagle hitbox pose');
  return sampleSourceDeagleCharacterPose(index,p.sourcePistolPose).body.sourceWorldMatrices;
 });
}
