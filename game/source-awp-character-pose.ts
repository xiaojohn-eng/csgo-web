/** Original T/CT AWP body layers + original 94-bone world rig. */
import {sampleSourceCharacterPose,accumulateSourceSequence,sourceSequenceCycleRate,type SourceCharacterPoseInput,type SourceCharacterPose,type SourceCharacterPoseIndex,type SourceLocalPose,type SourcePoseBone,type SourcePoseSequence} from './source-character-pose.js';
import {sampleSourceAWPWorldPose,type SourceAWPWorldIndex,type SourceAWPWorldInput,type SourceAWPWorldSequence} from './source-awp-world-pose.js';
export type SourceAWPBodyLayer={sequence:'Reload_AWP';cycle:number;weight:number};
export type SourceAWPCharacterPoseInput={body:SourceCharacterPoseInput;bodyLayers?:readonly SourceAWPBodyLayer[];world:SourceAWPWorldInput;magazineVisible?:boolean;
 clock?:{time:number;startedAt:number;generation:number;bodyRate:number;worldRate:number}};
export type SourceAWPCharacterPoseIndex={body:SourceCharacterPoseIndex;world:SourceAWPWorldIndex;team:'t'|'ct';weapon:'awp';boneMerge:ReadonlyMap<number,number>};
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
type SourceAWPEvent={name:string;cycle:number;event:number;options:string;type:number};
type EventSequence=SourcePoseSequence&{events:SourceAWPEvent[]};
export function prepareSourceAWPCharacterPose(body:SourceCharacterPoseIndex,world:SourceAWPWorldIndex):SourceAWPCharacterPoseIndex{
 const data=body.data as typeof body.data&{weaponId:string;animationExtension:string};
 const team=data.mainModel==='models/player/tm_leet_varianta.mdl'?'t':data.mainModel==='models/player/ctm_idf.mdl'?'ct':undefined;
 check(team&&body.mainBoneCount===(team==='t'?71:74)&&body.boneCount===(team==='t'?71:70)&&data.weaponId==='awp'&&data.animationExtension==='awp'&&world.data.weaponId==='awp'&&world.data.bones.length===94,'Original AWP character identity mismatch');
 check(data.sequences.length===60&&data.sequences.filter((s:SourcePoseSequence)=>s.name.includes('AWP')).length===23,'Original AWP body sequence closure differs'); // 30 original + 5 Shoot_GREN1 + 25 throw variants (pin-pull prep + medium/underhand)
 for(const [state,ids]of Object.entries(data.states)as [string,{lower:number;upper:number;shoot:number}][]){
  if(state==='Jump'||state==='Death')continue; // merged jump_lower/Death1 reuse their own full-body layers
  const upper=body.sequences.get(ids.upper),shoot=body.sequences.get(ids.shoot);
  check(upper?.name===state+'_Upper_AWP'&&shoot?.name===state+'_Shoot_AWP'&&upper.autoLayers.length===2,'AWP body graph cannot use rifle/pistol layers');
  check(body.sequences.get(upper.autoLayers[0]!.sequence_id)?.name===state+'_Aim_AWP'&&body.sequences.get(upper.autoLayers[1]!.sequence_id)?.name===state+'_HandPos_AWP','Original AWP aim/hand layer order differs');
 }
 const reload=body.namedSequences.get('Reload_AWP');check(reload?.autoLayers.length===2&&body.sequences.get(reload.autoLayers[0]!.sequence_id)?.name==='Reload_AWP_seq'&&body.sequences.get(reload.autoLayers[1]!.sequence_id)?.name==='Reload_AWP_Inv','Original AWP reload layer order differs');
 const names=new Map(data.mainBones.map((b:SourcePoseBone,i:number)=>[b.name,i])),merged=new Map<number,number>();world.data.bones.forEach((b:SourcePoseBone,i:number)=>{const j=names.get(b.name);if(j!==undefined)merged.set(i,j);});
 check(merged.size===3&&[...merged.keys()].every((i:number)=>['weapon_hand_L','weapon_hand_R','ValveBiped.weapon_bone'].includes(world.data.bones[i]!.name)),'Original AWP character/world bone merge differs');
 return{body,world,team,weapon:'awp',boneMerge:merged};
}
/** Ordinary original body rates: standing shot 30/44, crouching shot 30/36.
 * Reload_AWP wrapper retains its original 30/110 duration and both autolayers. */
export function sourceAWPBodyCycleRate(index:SourceAWPCharacterPoseIndex,sequence:string,parameters:SourceCharacterPoseInput['parameters']){return sourceSequenceCycleRate(index.body,sequence,parameters);}
/** Returns raw named world events with exact original cycles; caller supplies
 * its own accepted event cursor, so this never emits audio or network effects. */
export function sourceAWPCharacterWorldEvents(index:SourceAWPCharacterPoseIndex,sequence:SourceAWPWorldSequence){
 const s=index.world.data.sequences.find((s:SourcePoseSequence)=>s.name===sequence)as EventSequence|undefined;check(s&&Array.isArray(s.events),'Original AWP event sequence absent');return s!.events.map((e:SourceAWPEvent)=>({...e}));
}
export function sourceAWPCharacterMagazineVisible(index:SourceAWPCharacterPoseIndex,sequence:SourceAWPWorldSequence,cycle:number){
 check(Number.isFinite(cycle),'Invalid AWP magazine clock');let visible=true;
 for(const e of sourceAWPCharacterWorldEvents(index,sequence))if(e.cycle<=Math.max(0,Math.min(1,cycle))){if(e.name==='AE_CL_EJECT_MAG')visible=false;else if(e.name==='AE_CL_EJECT_MAG_UNHIDE')visible=true;}
 return visible;
}
export function sourceAWPCharacterLocalMatrix(p:ArrayLike<number>,pi:number,q:ArrayLike<number>,qi:number):Float64Array{
 const inv=1/Math.hypot(q[qi],q[qi+1],q[qi+2],q[qi+3]),x=q[qi]*inv,y=q[qi+1]*inv,z=q[qi+2]*inv,w=q[qi+3]*inv;
 return new Float64Array([1-2*y*y-2*z*z,2*x*y+2*w*z,2*x*z-2*w*y,0,2*x*y-2*w*z,1-2*x*x-2*z*z,2*y*z+2*w*x,0,2*x*z+2*w*y,2*y*z-2*w*x,1-2*x*x-2*y*y,0,p[pi],p[pi+1],p[pi+2],1]);
}
export function sourceAWPCharacterMultiplyMatrix(a:ArrayLike<number>,ai:number,b:ArrayLike<number>,bi:number){const out=new Float64Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[ai+k*4+r]*b[bi+c*4+k];return out;}
export function sourceAWPCharacterWorldMatrices(bones:readonly SourcePoseBone[],pose:SourceLocalPose){const result=new Float64Array(bones.length*16);for(let i=0;i<bones.length;i++){const local=sourceAWPCharacterLocalMatrix(pose.positions,i*3,pose.quaternions,i*4);result.set(bones[i].parent<0?local:sourceAWPCharacterMultiplyMatrix(result,bones[i].parent*16,local,0),i*16);}return result;}
function rigidInverse(m:ArrayLike<number>,at:number){const out=new Float64Array([m[at],m[at+4],m[at+8],0,m[at+1],m[at+5],m[at+9],0,m[at+2],m[at+6],m[at+10],0,0,0,0,1]);for(let r=0;r<3;r++)out[12+r]=-(out[r]*m[at+12]+out[4+r]*m[at+13]+out[8+r]*m[at+14]);return out;}
const coordinateC=new Float64Array([1,0,0,0,0,0,-1,0,0,1,0,0,0,0,0,1]);
function projectBody(index:SourceCharacterPoseIndex,base:SourceCharacterPose,value:SourceLocalPose):SourceCharacterPose{
 const positions=new Float64Array(index.mainBoneCount*3),quaternions=new Float64Array(index.mainBoneCount*4);
 for(let i=0;i<index.mainBoneCount;i++){const mapped=index.data.mainToAnimation[i],bone=index.data.mainBones[i];if(mapped>=0){positions.set(value.positions.subarray(mapped*3,mapped*3+3),i*3);quaternions.set(value.quaternions.subarray(mapped*4,mapped*4+4),i*4);}else{positions.set(bone.position,i*3);const norm=Math.hypot(...bone.quaternion);quaternions.set(bone.quaternion.map((q:number)=>q/norm),i*4);}}
 const renderLocalPositions=positions.slice(),renderLocalQuaternions=quaternions.slice(),s=Math.SQRT1_2;
 for(let i=0;i<index.mainBoneCount;i++)if(index.data.mainBones[i].parent<0){const q=i*4,x=quaternions[q],y=quaternions[q+1],z=quaternions[q+2],w=quaternions[q+3];renderLocalPositions.set([positions[i*3],positions[i*3+2],-positions[i*3+1]],i*3);renderLocalQuaternions.set([s*x-s*w,s*y+s*z,s*z-s*y,s*w+s*x],q);}
 return{...base,positions,quaternions,renderLocalPositions,renderLocalQuaternions,sourceWorldMatrices:sourceAWPCharacterWorldMatrices(index.data.mainBones,{positions,quaternions}),animationPose:value};
}
/** All body layers reach rendering and hitbox callers through this one sampler.
 * World shared-name matrices are replaced after independent world sampling;
 * root motion, unrelated helper bones and original IBM remain untouched. */
export function sampleSourceAWPCharacterPose(index:SourceAWPCharacterPoseIndex,input:SourceAWPCharacterPoseInput){
 check(input.world,'Missing explicit AWP world pose');
 check(input.magazineVisible===undefined||typeof input.magazineVisible==='boolean','Invalid AWP magazine visibility');
 let body=sampleSourceCharacterPose(index.body,input.body),animation=body.animationPose;
 for(const layer of input.bodyLayers??[]){check(layer.sequence==='Reload_AWP','Unsupported original AWP body action');animation=accumulateSourceSequence(index.body,animation,layer.sequence,layer.cycle,layer.weight,input.body.parameters,input.body.blendMode);}
 if(input.bodyLayers?.length)body=projectBody(index.body,body,animation);
 const world=sampleSourceAWPWorldPose(index.world,input.world),count=index.world.data.bones.length,merged=new Float64Array(count*16),renderLocalMatrices=new Float64Array(count*16);
 for(let i=0;i<count;i++){
  const bone=index.world.data.bones[i],shared=index.boneMerge.get(i),local=sourceAWPCharacterLocalMatrix(world.positions,i*3,world.quaternions,i*4);
  const target=shared!==undefined?body.sourceWorldMatrices.slice(shared*16,shared*16+16):bone.parent<0?local:sourceAWPCharacterMultiplyMatrix(merged,bone.parent*16,local,0);
  merged.set(target,i*16);renderLocalMatrices.set(bone.parent<0?sourceAWPCharacterMultiplyMatrix(coordinateC,0,target,0):sourceAWPCharacterMultiplyMatrix(rigidInverse(merged,bone.parent*16),0,target,0),i*16);
 }
 // A layered world action needs explicit visibility arbitration. With a single
 // ordinary sequence the original event cursor is fully determined by cycle.
 check(!input.world.layers?.length||typeof input.magazineVisible==='boolean','Layered AWP world poses require explicit magazine visibility');
 const magazineVisible=input.magazineVisible??sourceAWPCharacterMagazineVisible(index,input.world.sequence??'default',input.world.cycle??0);
 return{body,world,sourceWeaponWorldMatrices:merged,weaponRenderLocalMatrices:renderLocalMatrices,magazineVisible};
}
