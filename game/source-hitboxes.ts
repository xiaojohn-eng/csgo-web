import {sampleSourceCharacterPose,type SourceCharacterPoseIndex} from './source-character-pose.js';
import type {SourceHitboxProvider,SourceActorHit,SourceActorPose,SourcePoint} from './source-player-contract.js';

// App740 server.so 7de235...: 0xec92d0 groups; 0xec3440 radius branch;
// +0x24 angles feed AngleMatrix then bone * angle. See native CPU receipt.
const GROUP_BUCKET=[5,0,2,1,4,4,6,6,3];
/** Source QAngle (pitch, yaw, roll), columns of its original AngleMatrix. */
function angleMatrix(angles:readonly number[]){
 const [p,y,r]=angles.map(v=>v*Math.PI/180),cp=Math.cos(p),sp=Math.sin(p),cy=Math.cos(y),sy=Math.sin(y),cr=Math.cos(r),sr=Math.sin(r);
 return [cp*cy,cp*sy,-sp,sr*sp*cy-cr*sy,sr*sp*sy+cr*cy,sr*cp,cr*sp*cy+sr*sy,cr*sp*sy-sr*cy,cr*cp];
}
/** Current tm_leet_varianta / ctm_idf metadata uses only rotated OBBs.
 * A new capsule model is rejected until its full CPU boundary corpus is added. */
export function createSourceHitboxes(index:SourceCharacterPoseIndex,poseVersion:string):SourceHitboxProvider{
 return createSourceSampledHitboxes(index,poseVersion,p=>{
  if(!p.sourcePose)throw Error('Source hitbox pose data/version mismatch');
  return sampleSourceCharacterPose(index,p.sourcePose).sourceWorldMatrices;
 });
}
/** Shared original OBB/group implementation with an explicit complete pose
 * sampler. A pistol renderer's overlays must also reach this sampler. */
export function createSourceSampledHitboxes<P extends SourceActorPose>(index:SourceCharacterPoseIndex,poseVersion:string,sample:(p:P)=>Float64Array){
 if(!poseVersion)throw Error('A verified Source pose version is required for hitboxes');
 const boxes=index.data.hitboxSets[0]?.hitboxes.map(h=>{
  const raw=Uint8Array.from(h.sourceBytesHex.match(/../g)??[],s=>parseInt(s,16));
  if(raw.byteLength!==68)throw Error('Source hitbox stride changed');
  const d=new DataView(raw.buffer),angles=[36,40,44].map(at=>d.getFloat32(at,true)),radius=d.getFloat32(48,true);
  if(!angles.every(Number.isFinite)||!Number.isFinite(radius)||radius>0)throw Error('This Source hitbox provider requires verified OBB metadata');
  if(d.getInt32(0,true)!==h.bone||d.getInt32(4,true)!==h.group||h.min.some((v,i)=>v!==d.getFloat32(8+i*4,true))||h.max.some((v,i)=>v!==d.getFloat32(20+i*4,true)))
   throw Error('Source hitbox metadata differs from original bytes');
  return {hitbox:h.index,bone:h.bone,group:h.group,min:[...h.min],max:[...h.max],rotation:angleMatrix(angles)};
 });
 if(!boxes?.length)throw Error('Original hitbox set is empty');
 return {id:`app740-rotated-obb-v1:${poseVersion}`,status:'verified-bone-hitboxes' as const,raycast(p:P,origin:SourcePoint,direction:SourcePoint,maxDistance:number){
  if(p.sourcePoseVersion!==poseVersion)throw Error('Source hitbox pose data/version mismatch');
  const values=[p.x,p.y,p.z,p.yaw,origin.x,origin.y,origin.z,direction.x,direction.y,direction.z];
  if(!values.every(Number.isFinite)||!(maxDistance>0))throw Error('Invalid Source hitbox ray');
  const length=Math.hypot(direction.x,direction.y,direction.z);
  if(Math.abs(length-1)>1e-5)throw Error('Source hitbox direction must be a unit vector');
  // Invert actor yaw+pi/2, then C and Source unit scale. The ray parameter
  // remains browser metres while local coordinates use original Source units.
  const angle=p.yaw+Math.PI/2,c=Math.cos(angle),s=Math.sin(angle),u=.0254;
  const convert=(x:number,y:number,z:number)=>[(c*x-s*z)/u,-(s*x+c*z)/u,y/u];
  const o=convert(origin.x-p.x,origin.y-p.y,origin.z-p.z),v=convert(direction.x,direction.y,direction.z);
  const sampled=sample(p);
  if(sampled.length!==index.mainBoneCount*16||!sampled.every(Number.isFinite))throw Error('Invalid complete Source hitbox bone matrices');
  const hits:(SourceActorHit|null)[]=Array(7).fill(null);
  for(const box of boxes){
   const at=box.bone*16,delta=o.map((value,i)=>value-sampled[at+12+i]);
   const localO=[0,0,0],localD=[0,0,0];
   // Inverse(bone * AngleMatrix): transpose of the two original orthonormal bases.
   for(let axis=0;axis<3;axis++)for(let k=0;k<3;k++){
    const basis=sampled[at+k]*box.rotation[axis*3]+sampled[at+4+k]*box.rotation[axis*3+1]+sampled[at+8+k]*box.rotation[axis*3+2];
    localO[axis]+=basis*delta[k];localD[axis]+=basis*v[k];
   }
   let enter=0,exit=maxDistance,miss=false;
   for(let axis=0;axis<3;axis++){
    if(Math.abs(localD[axis])<1e-12){if(localO[axis]<box.min[axis]||localO[axis]>box.max[axis])miss=true;continue;}
    const a=(box.min[axis]-localO[axis])/localD[axis],b=(box.max[axis]-localO[axis])/localD[axis];
    enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));if(enter>exit){miss=true;break;}
   }
   if(miss||enter>=maxDistance||exit<0)continue;
   const bucket=GROUP_BUCKET[box.group]??5;
   if(!hits[bucket]||enter<hits[bucket]!.distance)hits[bucket]={distance:enter,head:box.group===1,bone:box.bone,hitbox:box.hitbox,group:box.group};
  }
  // Original selection: head only if no farther than chest/stomach. Then
  // stomach, chest, gear, arms, generic, legs; closest hit within each bucket.
  const head=hits[0];if(head&&head.distance<=(hits[1]?.distance??Infinity)&&head.distance<=(hits[2]?.distance??Infinity))return head;
  return hits.slice(1).find(Boolean)??null;
 }};
}
