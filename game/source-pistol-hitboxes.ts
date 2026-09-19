import {createSourceSampledHitboxes} from './source-hitboxes.js';
import {sampleSourcePistolCharacterPose,type SourcePistolCharacterPoseIndex,type SourcePistolCharacterPoseInput} from './source-pistol-character-pose.js';
import type {SourceActorPose} from './source-player-contract.js';
export type SourcePistolHitboxPose=SourceActorPose&{sourcePistolPose:SourcePistolCharacterPoseInput};
/** Separate provider until the pistol command/pose contract is enabled. Uses
 * the renderer's complete body layer sampler, never a rifle fallback. Only
 * the original player OBBs can be hit, not the attached world weapon. */
export function createSourcePistolHitboxes(index:SourcePistolCharacterPoseIndex,poseVersion:string){
  return createSourceSampledHitboxes(index.body,poseVersion,(p:SourcePistolHitboxPose)=>{
    if(!p.sourcePistolPose)throw Error('Missing complete pistol hitbox pose');
    return sampleSourcePistolCharacterPose(index,p.sourcePistolPose).body.sourceWorldMatrices;
  });
}
