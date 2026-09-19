import {Matrix4,Quaternion,Vector3} from 'three';
import {bindSourceRagdoll,parseSourceRagdollData,sampleSourceRagdollState,type SourceRagdollIndex,type SourceRagdollState} from './source-ragdoll.js';
import type {SourceCharacterPose,SourceCharacterPoseIndex,SourceLocalPose,SourcePoseBone} from './source-character-pose.js';

/** Shared body/weapon bone-merge path for AWP, Deagle, Glock and USP corpses. */
export function applySourceCharacterRagdoll<P extends {body:SourceCharacterPose;world:SourceLocalPose;
  sourceWeaponWorldMatrices:Float64Array;weaponRenderLocalMatrices:Float64Array;magazineVisible:boolean}>(
  index:{body:SourceCharacterPoseIndex;world:{data:{bones:readonly SourcePoseBone[]}};boneMerge:ReadonlyMap<number,number>},
  ragdoll:SourceRagdollIndex,pose:P,state:SourceRagdollState):P {
  const body=sampleSourceRagdollState(ragdoll,index.body,state);
  pose.body={...pose.body,...body};pose.magazineVisible=true;
  const merged=pose.sourceWeaponWorldMatrices,rendered=pose.weaponRenderLocalMatrices;
  const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3(1,1,1),local=new Matrix4(),target=new Matrix4();
  const conversion=new Matrix4().makeRotationX(-Math.PI/2);
  for(let i=0;i<index.world.data.bones.length;i++) {
    const bone=index.world.data.bones[i],shared=index.boneMerge.get(i);
    if(shared!==undefined)target.fromArray(body.sourceWorldMatrices,shared*16);
    else {
      local.compose(position.fromArray(pose.world.positions,i*3),rotation.fromArray(pose.world.quaternions,i*4).normalize(),scale);
      target.copy(local);if(bone.parent>=0)target.premultiply(new Matrix4().fromArray(merged,bone.parent*16));
    }
    merged.set(target.elements,i*16);
    if(bone.parent<0)local.copy(target).premultiply(conversion);
    else local.copy(target).premultiply(new Matrix4().fromArray(merged,bone.parent*16).invert());
    rendered.set(local.elements,i*16);
  }
  return pose;
}

export async function loadSourceCharacterRagdoll(base:string,index:SourceCharacterPoseIndex,signal?:AbortSignal):Promise<SourceRagdollIndex> {
  const response=await fetch(base+'/../ragdoll/ragdoll-data.json',{signal,cache:'no-cache'});
  if(!response.ok)throw new Error('Original ragdoll data HTTP '+response.status);
  const data=parseSourceRagdollData(await response.json());
  const team=index.data.mainModel.includes('ctm_')?'ct':'t';
  if(data.models[team]!==index.data.mainModel.replace(/\.mdl$/,'.phy'))throw new Error('Ragdoll model identity differs');
  return bindSourceRagdoll(data,index);
}
