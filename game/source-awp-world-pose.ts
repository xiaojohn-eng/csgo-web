import {prepareSourceCharacterPose,sampleSourceSequence,accumulateSourceSequence,sourceSequenceCycleRate,type SourceCharacterPoseData,type SourceCharacterPoseIndex,type SourceLocalPose,type SourcePoseBone,type SourcePoseMode} from './source-character-pose.js';
export type SourceAWPWorldData={format:'source-awp-world-pose-v1';weaponId:'awp';sourceModel:string;sourceSHA256:string;bones:SourcePoseBone[];
 poseParameters:SourceCharacterPoseData['poseParameters'];sequences:SourceCharacterPoseData['sequences'];descriptors:SourceCharacterPoseData['descriptors'];frames:SourceCharacterPoseData['frames']};
export type SourceAWPWorldIndex={data:SourceAWPWorldData;core:SourceCharacterPoseIndex};
export const SOURCE_AWP_WORLD_SEQUENCES=['default','sniper_reload','sniper_reload_moving','sniper_reload_crouch','sniper_reload_crouch_moving']as const;
export type SourceAWPWorldSequence=typeof SOURCE_AWP_WORLD_SEQUENCES[number];
export type SourceAWPWorldInput={sequence?:SourceAWPWorldSequence;cycle?:number;layers?:readonly{sequence:SourceAWPWorldSequence;cycle:number;weight:number}[];blendMode?:SourcePoseMode};
export function prepareSourceAWPWorldPose(input:unknown,bytes:ArrayBuffer|Uint8Array):SourceAWPWorldIndex{
 const data=structuredClone(input)as SourceAWPWorldData;
 if(data?.format!=='source-awp-world-pose-v1'||data.weaponId!=='awp'||data.sourceModel!=='models/weapons/w_snip_awp.mdl'||data.bones.length!==94||data.sequences.length!==5||
  SOURCE_AWP_WORLD_SEQUENCES.some((name,i)=>data.sequences[i].name!==name||data.sequences[i].index!==i||data.sequences[i].animationIndices.length!==1||data.sequences[i].autoLayers.length!==0))throw Error('Original AWP world graph identity changed');
 const coreData={format:'source-character-pose-v1',mainModel:data.sourceModel,animationModel:data.sourceModel,mainBones:data.bones,animationBones:data.bones,
  mainToAnimation:data.bones.map((_,i)=>i),renderJoints:data.bones.map((b,i)=>({mainBone:i,sourceName:b.name,gltfNode:i,gltfName:b.name,skinJoint:i})),poseParameters:data.poseParameters,
  sequences:data.sequences,descriptors:data.descriptors,frames:data.frames,states:Object.fromEntries(['Idle','Walk','Run','Crouch_Idle','Crouch_Walk'].map(name=>[name,{lower:0,upper:0,shoot:0}]))as SourceCharacterPoseData['states'],
  hitboxSets:[],renderGlb:{file:'',sha256:''},rootMotionPolicy:'Preserve original local transforms',viewAndHullPolicy:'Standalone world weapon, not a player contract',inverseBindPolicy:'Original AWP IBM'}as SourceCharacterPoseData;
 return{data,core:prepareSourceCharacterPose(coreData,bytes)};
}
function localMatrix(p:ArrayLike<number>,pi:number,q:ArrayLike<number>,qi:number){
 const n=1/Math.hypot(q[qi],q[qi+1],q[qi+2],q[qi+3]),x=q[qi]*n,y=q[qi+1]*n,z=q[qi+2]*n,w=q[qi+3]*n;
 return new Float64Array([1-2*y*y-2*z*z,2*x*y+2*w*z,2*x*z-2*w*y,0,2*x*y-2*w*z,1-2*x*x-2*z*z,2*y*z+2*w*x,0,2*x*z+2*w*y,2*y*z-2*w*x,1-2*x*x-2*y*y,0,p[pi],p[pi+1],p[pi+2],1]);
}
export function sourceAWPWorldMatrices(bones:readonly SourcePoseBone[],pose:SourceLocalPose){
 const result=new Float64Array(bones.length*16);
 for(let i=0;i<bones.length;i++){
  const local=localMatrix(pose.positions,i*3,pose.quaternions,i*4),parent=bones[i].parent;
  if(parent<0)result.set(local,i*16);else for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)result[i*16+c*4+r]+=result[parent*16+k*4+r]*local[c*4+k];
 }
 return result;
}
export function sourceAWPWorldCycleRate(index:SourceAWPWorldIndex,sequence:SourceAWPWorldSequence){return sourceSequenceCycleRate(index.core,sequence,{});}
/** Explicit original ordinary sequence sampling and optional ordered overlays.
 * AWP has no pistol_aim_t graph; future player bone merge remains separate. */
export function sampleSourceAWPWorldPose(index:SourceAWPWorldIndex,input:SourceAWPWorldInput={}){
 let pose=sampleSourceSequence(index.core,input.sequence??'default',input.cycle??0,{},input.blendMode??'sdk-3way');
 for(const layer of input.layers??[])pose=accumulateSourceSequence(index.core,pose,layer.sequence,layer.cycle,layer.weight,{},input.blendMode??'sdk-3way');
 return{...pose,sourceWorldMatrices:sourceAWPWorldMatrices(index.data.bones,pose)};
}
