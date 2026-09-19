/** Original pistol world graph, kept separate from the frozen rifle sampler.
 * The 0/0 POSE auto-layer branch is from this App740 server's executed x86 path,
 * not the older SDK2013 branch which lacks that special case.
 */
import {prepareSourceCharacterPose,accumulateSourceSequence,sampleSourceSequence,sampleSourceCharacterPose,sourceSequenceCycleRate,type SourceCharacterPoseInput,type SourceCharacterPose,type SourceCharacterPoseData,type SourceCharacterPoseIndex,type SourcePoseBone,type SourcePoseSequence,type SourcePoseDescriptor,type SourceLocalPose,type SourcePoseMode} from './source-character-pose.js';
export type SourcePistolWorldParameters={body_yaw:number;body_pitch:number;aim_blend_stand_idle:number;aim_blend_stand_walk:number;aim_blend_stand_run:number;aim_blend_crouch_idle:number;aim_blend_crouch_walk:number};
export type SourcePistolLayer={sequence:string;cycle:number;weight:number};
export type SourcePistolWorldPoseInput={parameters:SourcePistolWorldParameters;cycle?:number;layers?:readonly SourcePistolLayer[];blendMode?:SourcePoseMode};
export type SourcePistolWorldPoseData={format:'source-pistol-world-pose-v1';weaponId:'glock'|'usp';sourceModel:string;sourceSHA256:string;bones:SourcePoseBone[];poseParameters:SourceCharacterPoseData['poseParameters'];sequences:SourcePoseSequence[];descriptors:SourcePoseDescriptor[];frames:SourceCharacterPoseData['frames']};
export type SourcePistolWorldPoseIndex={data:SourcePistolWorldPoseData;core:SourceCharacterPoseIndex;sequences:ReadonlyMap<number,SourcePoseSequence>;named:ReadonlyMap<string,SourcePoseSequence>};
const F=Math.fround,clamp=(v:number)=>Math.min(1,Math.max(0,v));
function check(v:unknown,message:string):asserts v{if(!v)throw Error(message);}
/** Actual 0xebd1cd..0xebd250 f32 ordering, checked against 660 native cases. */
export function sourcePistolPoseLayerWeight(normalizedPose:number,parameter:{start:number;end:number},layer:{peak:number;tail:number},parentWeight:number){
 check([normalizedPose,parameter.start,parameter.end,layer.peak,layer.tail,parentWeight].every(Number.isFinite)&&layer.tail!==layer.peak&&parentWeight>=0&&parentWeight<=1,'Invalid source pose layer weight');
 let value=F(F(F(parameter.end-parameter.start)*F(normalizedPose))+F(parameter.start-layer.peak));value=clamp(F(value/F(layer.tail-layer.peak)));
 const square=F(value*value);value=clamp(F(F(3*square)-F(F(value+value)*square)));return F(value*F(parentWeight));
}
export function prepareSourcePistolWorldPose(input:unknown,bytes:ArrayBuffer|Uint8Array):SourcePistolWorldPoseIndex{
 const d=structuredClone(input)as SourcePistolWorldPoseData;check(d?.format==='source-pistol-world-pose-v1'&&(d.weaponId==='glock'||d.weaponId==='usp'),'Unknown original pistol world pose format');
 check(d.sourceModel===`models/weapons/${d.weaponId==='glock'?'w_pist_glock18':'w_pist_223'}.mdl`&&d.bones.length===(d.weaponId==='glock'?93:95),'Original pistol world bone/model identity mismatch');
 const sequences=new Map(d.sequences.map(s=>[s.index,s])),named=new Map(d.sequences.map(s=>[s.name,s]));check(sequences.size===d.sequences.length&&named.size===d.sequences.length,'Duplicate original pistol sequence');
 const root=named.get('pistol_aim_t'),defaultSequence=named.get('default');check(root&&defaultSequence&&root.autoLayers.length===5&&root.boneWeights.every(w=>w===0),'Missing original pistol aim wrapper');
 for(const [i,l]of root.autoLayers.entries())check(l.flags===16448&&l.pose_id===i+2&&l.start===0&&l.end===0&&l.peak===0&&l.tail===1&&sequences.get(l.sequence_id)?.groupSize.every(v=>v===3),'Unexpected original pistol aim layer');
 for(const s of d.sequences)for(const l of s.autoLayers)check(s===root&&sequences.has(l.sequence_id),'Unknown/recursive original pistol world autolayer');
 // Separate ordinary sequence sampling from explicit graph evaluation below.
 // These internal identity mappings have no renderer/character-state meaning.
 const coreData={format:'source-character-pose-v1',mainModel:d.sourceModel,animationModel:d.sourceModel,mainBones:d.bones,animationBones:d.bones,mainToAnimation:d.bones.map((_,i)=>i),renderJoints:d.bones.map((b,i)=>({mainBone:i,sourceName:b.name,gltfNode:i,gltfName:b.name,skinJoint:i})),poseParameters:d.poseParameters,sequences:d.sequences.map(s=>({...s,autoLayers:[]})),descriptors:d.descriptors,frames:d.frames,states:Object.fromEntries((['Idle','Walk','Run','Crouch_Idle','Crouch_Walk']as const).map(s=>[s,{lower:defaultSequence.index,upper:defaultSequence.index,shoot:defaultSequence.index}]))as SourceCharacterPoseData['states'],hitboxSets:[],renderGlb:{file:'',sha256:''},rootMotionPolicy:'Original local transforms preserved',viewAndHullPolicy:'Not a player/camera contract',inverseBindPolicy:'Original world model IBM'}as SourceCharacterPoseData;
 return{data:d,core:prepareSourceCharacterPose(coreData,bytes),sequences,named};
}
/** Original ordinary action rate; pose-dependent wrapper timing is not inferred. */
export function sourcePistolWorldCycleRate(index:SourcePistolWorldPoseIndex,name:string,parameters:SourcePistolWorldParameters){const s=index.named.get(name);check(s&&s.autoLayers.length===0,'World action rate requires an original ordinary sequence');return sourceSequenceCycleRate(index.core,s.index,parameters);}
export function sourcePistolAutoLayerRequests(index:SourcePistolWorldPoseIndex,cycle:number,parentWeight:number,parameters:SourcePistolWorldParameters){
 check(Number.isFinite(cycle)&&Number.isFinite(parentWeight)&&parentWeight>=0&&parentWeight<=1,'Invalid original pistol layer clock/weight');
 return index.named.get('pistol_aim_t')!.autoLayers.map(layer=>{const p=index.data.poseParameters[layer.pose_id!],physical=parameters[p.name as keyof SourcePistolWorldParameters];check(Number.isFinite(physical)&&p.end!==p.start,'Missing/nonfinite original pistol layer pose parameter');const normalized=F(F(physical-p.start)/F(p.end-p.start));return{sequence:layer.sequence_id,cycle:F(cycle),weight:sourcePistolPoseLayerWeight(normalized,p,layer,parentWeight)};});
}
export function accumulateSourcePistolWorldSequence(index:SourcePistolWorldPoseIndex,base:SourceLocalPose,name:string|number,cycle:number,weight:number,parameters:SourcePistolWorldParameters,mode:SourcePoseMode='sdk-3way'):SourceLocalPose{
 const s=typeof name==='string'?index.named.get(name):index.sequences.get(name);check(s,'Unknown original pistol world sequence');
 let value=accumulateSourceSequence(index.core,base,s.index,cycle,weight,parameters,mode);
 if(s.name==='pistol_aim_t')for(const request of sourcePistolAutoLayerRequests(index,cycle,weight,parameters))value=accumulateSourceSequence(index.core,value,request.sequence,request.cycle,request.weight,parameters,mode);
 return value;
}
export function sourcePistolLocalMatrix(p:ArrayLike<number>,pi:number,q:ArrayLike<number>,qi:number):Float64Array{
 const inv=1/Math.hypot(q[qi],q[qi+1],q[qi+2],q[qi+3]),x=q[qi]*inv,y=q[qi+1]*inv,z=q[qi+2]*inv,w=q[qi+3]*inv;
 return new Float64Array([1-2*y*y-2*z*z,2*x*y+2*w*z,2*x*z-2*w*y,0,2*x*y-2*w*z,1-2*x*x-2*z*z,2*y*z+2*w*x,0,2*x*z+2*w*y,2*y*z-2*w*x,1-2*x*x-2*y*y,0,p[pi],p[pi+1],p[pi+2],1]);
}
export function sourcePistolMultiplyMatrix(a:ArrayLike<number>,ai:number,b:ArrayLike<number>,bi:number){const out=new Float64Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[ai+k*4+r]*b[bi+c*4+k];return out;}
export function sourcePistolWorldMatrices(bones:readonly SourcePoseBone[],pose:SourceLocalPose){const result=new Float64Array(bones.length*16);for(let i=0;i<bones.length;i++){const local=sourcePistolLocalMatrix(pose.positions,i*3,pose.quaternions,i*4);result.set(bones[i].parent<0?local:sourcePistolMultiplyMatrix(result,bones[i].parent*16,local,0),i*16);}return result;}
/** Complete original world aim wrapper plus explicitly requested overlays, in
 * supplied order. No state classification, mode timer, or root-motion removal. */
export function sampleSourcePistolWorldPose(index:SourcePistolWorldPoseIndex,input:SourcePistolWorldPoseInput){
 check(input.parameters&&['body_yaw','body_pitch','aim_blend_stand_idle','aim_blend_stand_walk','aim_blend_stand_run','aim_blend_crouch_idle','aim_blend_crouch_walk'].every(k=>Number.isFinite(input.parameters[k as keyof SourcePistolWorldParameters])),'Missing/nonfinite original pistol world parameters');const mode=input.blendMode??'sdk-3way',cycle=input.cycle??0;
 let value=sampleSourceSequence(index.core,'default',0,input.parameters,mode);value=accumulateSourcePistolWorldSequence(index,value,'pistol_aim_t',cycle,1,input.parameters,mode);
 for(const l of input.layers??[])value=accumulateSourcePistolWorldSequence(index,value,l.sequence,l.cycle,l.weight,input.parameters,mode);
 return{...value,sourceWorldMatrices:sourcePistolWorldMatrices(index.data.bones,value),autoLayers:sourcePistolAutoLayerRequests(index,cycle,1,input.parameters)};
}

export type SourcePistolCharacterPoseInput={body:SourceCharacterPoseInput;bodyLayers?:readonly SourcePistolLayer[];world:SourcePistolWorldPoseInput;silencerVisible?:boolean;magazineVisible?:boolean;
 /** Explicit gameplay clock, used by remote rendering and hitbox rewind alike.
  * It is not sampled by the original bone graph. */
 clock?:{time:number;startedAt:number;generation:number;bodyRate:number;worldRate:number}};
export type SourcePistolCharacterPoseIndex={body:SourceCharacterPoseIndex;world:SourcePistolWorldPoseIndex;team:'t'|'ct';weapon:'glock'|'usp';boneMerge:ReadonlyMap<number,number>};
export function prepareSourcePistolCharacterPose(body:SourceCharacterPoseIndex,world:SourcePistolWorldPoseIndex):SourcePistolCharacterPoseIndex{
 const team=body.data.mainModel==='models/player/tm_leet_varianta.mdl'?'t':body.data.mainModel==='models/player/ctm_idf.mdl'?'ct':undefined;
 check(team&&body.mainBoneCount===(team==='t'?71:74),'Original pistol character identity mismatch');
 for(const [state,ids]of Object.entries(body.data.states)){if(state==='Jump'||state==='Death')continue; // merged jump_lower/Death1 reuse their own full-body layers
  check(body.sequences.get(ids.upper)?.name===state+'_Upper_PISTOL'&&body.sequences.get(ids.shoot)?.name===state+'_Shoot_Pistol','Pistol body graph cannot use rifle upper/shoot');}
 const sourceNames=new Map(body.data.mainBones.map((b,i)=>[b.name,i])),merged=new Map<number,number>();world.data.bones.forEach((b,i)=>{const id=sourceNames.get(b.name);if(id!==undefined)merged.set(i,id);});
 check(merged.size===3&&[...merged.keys()].every(i=>['weapon_hand_L','weapon_hand_R','ValveBiped.weapon_bone'].includes(world.data.bones[i].name)),'Original pistol/character bone merge name set differs');
 return{body,world,team,weapon:world.data.weaponId,boneMerge:merged};
}
function rigidInverse(m:ArrayLike<number>,at:number){const out=new Float64Array([m[at],m[at+4],m[at+8],0,m[at+1],m[at+5],m[at+9],0,m[at+2],m[at+6],m[at+10],0,0,0,0,1]);for(let r=0;r<3;r++)out[12+r]=-(out[r]*m[at+12]+out[4+r]*m[at+13]+out[8+r]*m[at+14]);return out;}
const coordinateC=new Float64Array([1,0,0,0,0,0,-1,0,0,1,0,0,0,0,0,1]);
function projectBody(index:SourceCharacterPoseIndex,base:SourceCharacterPose,value:SourceLocalPose):SourceCharacterPose{
 const positions=new Float64Array(index.mainBoneCount*3),quaternions=new Float64Array(index.mainBoneCount*4);
 for(let i=0;i<index.mainBoneCount;i++){const mapped=index.data.mainToAnimation[i],bone=index.data.mainBones[i];if(mapped>=0){positions.set(value.positions.subarray(mapped*3,mapped*3+3),i*3);quaternions.set(value.quaternions.subarray(mapped*4,mapped*4+4),i*4);}else{positions.set(bone.position,i*3);const norm=Math.hypot(...bone.quaternion);quaternions.set(bone.quaternion.map(q=>q/norm),i*4);}}
 const renderLocalPositions=positions.slice(),renderLocalQuaternions=quaternions.slice(),s=Math.SQRT1_2;
 for(let i=0;i<index.mainBoneCount;i++)if(index.data.mainBones[i].parent<0){const q=i*4,x=quaternions[q],y=quaternions[q+1],z=quaternions[q+2],w=quaternions[q+3];renderLocalPositions.set([positions[i*3],positions[i*3+2],-positions[i*3+1]],i*3);renderLocalQuaternions.set([s*x-s*w,s*y+s*z,s*z-s*y,s*w+s*x],q);}
 return{...base,positions,quaternions,renderLocalPositions,renderLocalQuaternions,sourceWorldMatrices:sourcePistolWorldMatrices(index.data.mainBones,{positions,quaternions}),animationPose:value};
}
/** Character PISTOL graph and modern world graph keep separate local poses/IBM.
 * Shared-name bone merge overrides source WORLD, then reconstructs world-rig
 * locals. No bind-space offset, helper deletion, or hand IK is invented.
 */
export function sampleSourcePistolCharacterPose(index:SourcePistolCharacterPoseIndex,input:SourcePistolCharacterPoseInput){
 if(index.weapon==='usp')check(typeof input.silencerVisible==='boolean','Original USP character requires explicit silencer visibility');
 let body=sampleSourceCharacterPose(index.body,input.body),animation=body.animationPose;
 for(const l of input.bodyLayers??[]){check(['Reload_PISTOL','Silencer_Attach_Pistol','Silencer_Detach_Pistol'].includes(l.sequence),'Unsupported original pistol body action');animation=accumulateSourceSequence(index.body,animation,l.sequence,l.cycle,l.weight,input.body.parameters,input.body.blendMode);}
 if((input.bodyLayers?.length??0)>0)body=projectBody(index.body,body,animation);
 const world=sampleSourcePistolWorldPose(index.world,input.world),count=index.world.data.bones.length,merged=new Float64Array(count*16),renderLocalMatrices=new Float64Array(count*16);
 for(let i=0;i<count;i++){const bone=index.world.data.bones[i],shared=index.boneMerge.get(i),local=sourcePistolLocalMatrix(world.positions,i*3,world.quaternions,i*4);const target=shared!==undefined?body.sourceWorldMatrices.slice(shared*16,shared*16+16):bone.parent<0?local:sourcePistolMultiplyMatrix(merged,bone.parent*16,local,0);merged.set(target,i*16);renderLocalMatrices.set(bone.parent<0?sourcePistolMultiplyMatrix(coordinateC,0,target,0):sourcePistolMultiplyMatrix(rigidInverse(merged,bone.parent*16),0,target,0),i*16);}
 return{body,world,sourceWeaponWorldMatrices:merged,weaponRenderLocalMatrices:renderLocalMatrices,silencerVisible:input.silencerVisible??false,magazineVisible:input.magazineVisible??true};
}
