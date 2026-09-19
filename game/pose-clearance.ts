import RAPIER from '@dimforge/rapier3d-compat';
import {CHARACTER,capsuleHeight,characterReferences,type CharacterPose} from './character-contract.js';
import type {Player} from './types.js';
import {interpolateLocomotion,readLocomotion,type LocomotionPose} from './locomotion.js';
type Point={x:number;y:number;z:number};
export type ClearancePose=Pick<Player,'x'|'y'|'z'|'yaw'|'pitch'|'crouch'|'stancePhase'|'stanceRate'|'stanceTarget'>&LocomotionPose;
export type PoseResolution={status:'clear'|'corrected'|'blocked'|'unresolved';pose:ClearancePose;
  correction:Point;iterations:number;initiallyLegal:boolean;reason?:string};
const ROT={x:0,y:0,z:0,w:1},SKIN=.002,EPS=.0001,MAX_CORRECTION=.5;
export const POSE_OBSTACLE_FLAGS=RAPIER.QueryFilterFlags.ONLY_FIXED|RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
type Part={kind:'root'|'head'|'eye'|'leg'|'foot';shape:RAPIER.Shape;query:RAPIER.Shape;center:Point;
  rotation?:{x:number;y:number;z:number;w:number}};
type Contact={part:Part;collider:RAPIER.Collider;normal:Point;distance:number};
export function clearancePose(p:ClearancePose):ClearancePose {
  return {x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,crouch:p.crouch,
    stancePhase:p.stancePhase,stanceRate:p.stanceRate,stanceTarget:p.stanceTarget,
    ...readLocomotion(p),grounded:p.grounded??true};
}
function parts(p:CharacterPose):Part[]{
  const height=capsuleHeight(p),half=height/2-CHARACTER.radius,refs=characterReferences(p);
  const result:Part[]=[{kind:'root',shape:new RAPIER.Capsule(half,CHARACTER.radius),query:new RAPIER.Capsule(half,CHARACTER.radius+SKIN),
    center:{x:p.x!,y:p.y!+height/2,z:p.z!}},
    {kind:'head',shape:new RAPIER.Ball(CHARACTER.headRadius),query:new RAPIER.Ball(CHARACTER.headRadius+SKIN),center:refs.head},
    {kind:'eye',shape:new RAPIER.Ball(.015),query:new RAPIER.Ball(.015+SKIN),center:refs.eye}];
  if((p.strideWeight??0)>1e-6){
    const cos=Math.cos(p.yaw??0),sin=Math.sin(p.yaw??0);
    const world=(v:Point):Point=>({x:(p.x??0)+v.x*cos+v.z*sin,y:(p.y??0)+v.y,z:(p.z??0)-v.x*sin+v.z*cos});
    const capsule=(a:Point,b:Point,radius:number,kind:'leg'|'foot')=>{
      const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,length=Math.hypot(dx,dy,dz);
      const q={x:dz/length,y:0,z:-dx/length,w:1+dy/length},norm=Math.hypot(q.x,q.z,q.w);
      const rotation=norm>1e-8?{x:q.x/norm,y:0,z:q.z/norm,w:q.w/norm}:{x:1,y:0,z:0,w:0};
      result.push({kind,shape:new RAPIER.Capsule(length/2,radius),query:new RAPIER.Capsule(length/2,radius+SKIN),
        center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2},rotation});
    };
    for(const [side,foot] of [['left',refs.feet.left],['right',refs.feet.right]] as const){
      // Six conservative lower-limb envelopes, from the SAME target bones used
      // for authority hit volumes and C02 IK; avoid dozens of per-sphere queries.
      capsule(world(foot.hip),world(foot.knee),.16,'leg');
      capsule(world(foot.knee),world(foot.position),.16,'leg');
      const sign=side==='left'?-1:1,offset=foot.offset;
      capsule(world({x:sign*.1415+offset.x,y:.055+offset.y,z:.031+offset.z}),
        world({x:sign*.1415+offset.x,y:.055+offset.y,z:-.105+offset.z}),.101,'foot');
    }
  }
  return result;
}
const support=(part:Part,c:RAPIER.ShapeContact,p:ClearancePose,collider:RAPIER.Collider)=>{
  if(part.kind!=='root'&&part.kind!=='leg'&&part.kind!=='foot')return false;
  if(c.normal1.y>.7&&c.point1.y<=p.y+.025)return true;
  // At exact support height Rapier's GJK can reverse the contact normal (or
  // choose the cuboid bottom) at an intermediate swept X. Confirm the actual
  // horizontal top plane, so additional gait substeps cannot trap feet on it.
  const shape=collider.shape,rotation=collider.rotation();
  return shape instanceof RAPIER.Cuboid&&Math.abs(rotation.x)+Math.abs(rotation.z)<1e-6&&
    Math.abs(collider.translation().y+shape.halfExtents.y-p.y)<=.025;
};
function contacts(world:RAPIER.World,p:ClearancePose,exclude:RAPIER.Collider):Contact[]{
  const result:Contact[]=[];
  for(const part of parts(p))world.intersectionsWithShape(part.center,part.rotation??ROT,part.query,c=>{
    const hit=c.contactShape(part.shape,part.center,part.rotation??ROT,SKIN);
    if(hit&&hit.distance<SKIN-EPS&&!support(part,hit,p,c))result.push({part,collider:c,normal:hit.normal1,distance:hit.distance});
    return true;
  },POSE_OBSTACLE_FLAGS,undefined,exclude);
  return result.sort((a,b)=>a.distance-b.distance||a.collider.handle-b.collider.handle);
}
function sweepCorrection(world:RAPIER.World,p:ClearancePose,delta:Point,exclude:RAPIER.Collider,escape:Map<number,Point>):number{
  let fraction=1;
  for(const part of parts(p)){
    const hit=world.castShape(part.center,part.rotation??ROT,delta,part.shape,SKIN,1,false,POSE_OBSTACLE_FLAGS,undefined,exclude,undefined,c=>{
      const outward=escape.get(c.handle);
      if(outward&&outward.x*delta.x+outward.z*delta.z>EPS)return false;
      const initial=c.contactShape(part.shape,part.center,part.rotation??ROT,SKIN);
      if(initial&&support(part,initial,p,c))return false;
      // Moving out of an already intersected convex supporting plane is safe. Do not
      // suppress other surfaces of a concave/trimesh collider or an opposite wall.
      if(initial&&c.shape instanceof RAPIER.Cuboid&&
        initial.normal1.x*delta.x+initial.normal1.z*delta.z>EPS)return false;
      return true;
    });
    if(hit)fraction=Math.min(fraction,Math.max(0,hit.time_of_impact));
  }
  return fraction;
}
function project(world:RAPIER.World,pose:ClearancePose,exclude:RAPIER.Collider){
  const p={...pose};let iterations=0;
  // When an invalid placement straddles a thin convex wall, the root and head
  // can report opposite nearest exits. Keep the root's original exit side for
  // this correction transaction; otherwise the solver would push them apart.
  // Each other collider still participates in the correction sweep.
  const escape=new Map<number,Point>();
  for(const hit of contacts(world,p,exclude))if(hit.part.kind==='root'&&hit.distance<0&&
    hit.collider.shape instanceof RAPIER.Cuboid&&Math.hypot(hit.normal.x,hit.normal.z)>.9)
    escape.set(hit.collider.handle,hit.normal);
  for(;iterations<16;iterations++){
    const overlaps=contacts(world,p,exclude);
    if(!overlaps.length)return {pose:p,iterations,legal:true};
    const hit=overlaps[0],forced=escape.get(hit.collider.handle),normal=forced??hit.normal;
    let nx=normal.x,nz=normal.z,length2=nx*nx+nz*nz;
    let distance=forced&&forced.x*hit.normal.x+forced.z*hit.normal.z<.9?.06:SKIN-hit.distance;
    if(length2<.04){
      // Feet stay fixed. A local overhang can be escaped horizontally away from
      // the protruding head; a full roof/root penetration needs rollback/recovery.
      if(hit.part.kind==='root')break;
      const center=hit.part.kind==='leg'||hit.part.kind==='foot'?hit.part.center:characterReferences(p).head;
      nx=p.x-center.x;nz=p.z-center.z;
      const length=Math.hypot(nx,nz);if(length<.01)break;
      nx/=length;nz/=length;length2=1;distance=.025;
    }
    let dx=nx*distance/length2,dz=nz*distance/length2;
    const length=Math.hypot(dx,dz);if(length>.06){dx*=.06/length;dz*=.06/length;}
    const delta={x:dx,y:0,z:dz},fraction=sweepCorrection(world,p,delta,exclude,escape);
    if(fraction*Math.hypot(dx,dz)<1e-6)break;
    p.x+=dx*fraction;p.z+=dz*fraction;
    if(Math.hypot(p.x-pose.x,p.z-pose.z)>MAX_CORRECTION)break;
  }
  return {pose:p,iterations,legal:contacts(world,p,exclude).length===0};
}
/** Transactional, deterministic constraint solve; only the final accepted pose mutates Player.
 * No pitch clamp, character radius change, teleport through the opposite wall, or per-render clock.
 */
export function resolvePoseMotion(world:RAPIER.World,from:ClearancePose,to:ClearancePose,exclude:RAPIER.Collider):PoseResolution{
  const initiallyLegal=contacts(world,from,exclude).length===0;
  const yawDelta=Math.atan2(Math.sin(to.yaw-from.yaw),Math.cos(to.yaw-from.yaw));
  // Bounded angular/translation substeps prevent an offset head passing through a thin wall
  // with legal endpoints. Query skin exceeds the head arc chord error at 0.1 radians.
  const a=readLocomotion(from),b=readLocomotion(to),strideActive=Math.max(a.strideWeight,b.strideWeight)>.000001;
  const directionDelta=Math.atan2(a.strideX*b.strideZ-a.strideZ*b.strideX,a.strideX*b.strideX+a.strideZ*b.strideZ);
  const steps=Math.max(1,Math.ceil(Math.max(Math.abs(yawDelta)/.1,Math.abs(to.pitch-from.pitch)/.1,
    Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z)/.04,Math.abs(to.stancePhase-from.stancePhase)/.08,
    strideActive?Math.abs(b.stridePhase-a.stridePhase)/.04:0,
    Math.abs(b.strideWeight-a.strideWeight)/.08,Math.abs(b.strideSpeed-a.strideSpeed)/.4,
    strideActive?Math.abs(directionDelta)/.1:0)));
  let correction={x:0,y:0,z:0},iterations=0,accepted={...from};
  for(let i=1;i<=steps;i++){
    const t=i/steps;
    const desired={...to,x:from.x+(to.x-from.x)*t+correction.x,y:from.y+(to.y-from.y)*t,
      z:from.z+(to.z-from.z)*t+correction.z,yaw:from.yaw+yawDelta*t,pitch:from.pitch+(to.pitch-from.pitch)*t,
      stancePhase:from.stancePhase+(to.stancePhase-from.stancePhase)*t,...interpolateLocomotion(from,to,t)};
    const result=project(world,desired,exclude);iterations+=result.iterations;
    correction.x+=result.pose.x-desired.x;correction.z+=result.pose.z-desired.z;
    if(!result.legal||Math.hypot(correction.x,correction.z)>MAX_CORRECTION){
      return {status:initiallyLegal?'blocked':'unresolved',pose:{...from,
        stanceRate:Math.abs(to.stancePhase-from.stancePhase)>1e-10?0:from.stanceRate,stanceTarget:to.stanceTarget},
        correction:{x:from.x-to.x,y:from.y-to.y,z:from.z-to.z},
        iterations,initiallyLegal,reason:initiallyLegal?'Requested pose has no collision-free correction within 0.5m; retain last legal pose':
          'Initial pose is already illegal and bounded depenetration failed; placement repair required'};
    }
    accepted=result.pose;
  }
  accepted.yaw=to.yaw;
  return {status:Math.hypot(correction.x,correction.z)>EPS?'corrected':'clear',pose:accepted,correction,iterations,initiallyLegal};
}
