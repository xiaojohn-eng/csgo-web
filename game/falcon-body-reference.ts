import {falconPoseReferences,type Point3,type Vec3} from './falcon-head-reference.js';
import {readLocomotion,sampleFootTargets,type LocomotionPose} from './locomotion.js';

/** Frozen C02 Idle0 calibration, meters in actor space after the original PI import rotation.
 * Pure reconstruction of the same ACTION03 pelvis translation and two-bone leg IK.
 * Current and historical CharacterPose consumers call this without a renderer or mutable cache.
 */
const add=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a:Vec3,s:number):Vec3=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const length=(a:Vec3)=>Math.hypot(...a);
const unit=(a:Vec3):Vec3=>mul(a,1/Math.max(1e-12,length(a)));
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function swingOffset(v:Vec3,from:Vec3,to:Vec3):Vec3 {
 const a=unit(from),b=unit(to),axis=cross(a,b),denominator=1+dot(a,b);
 // Legal C02 stance never approaches a 180 degree hip-to-knee reversal.
 return add(add(v,cross(axis,v)),mul(cross(axis,cross(axis,v)),1/Math.max(1e-9,denominator)));
}
function rotateAxis(v:Vec3,axis:Vec3,angle:number):Vec3 {
 const c=Math.cos(angle),s=Math.sin(angle);return add(add(mul(v,c),mul(cross(axis,v),s)),mul(axis,dot(axis,v)*(1-c)));
}
const mix=(a:Vec3,b:Vec3,t:number):Vec3=>add(mul(a,1-t),mul(b,t));
const rx=(v:Vec3,a:number):Vec3=>[v[0],v[1]*Math.cos(a)-v[2]*Math.sin(a),v[1]*Math.sin(a)+v[2]*Math.cos(a)];
const ry=(v:Vec3,a:number):Vec3=>[v[0]*Math.cos(a)+v[2]*Math.sin(a),v[1],-v[0]*Math.sin(a)+v[2]*Math.cos(a)];
const SPINE1:Vec3=[0,1.168456572,.008566562];
const SPINE2:Vec3=[0,1.321228104,.019688266];
const TWIST=-35*Math.PI/180;
const LEGS=[
 {side:'left',hip:[-.088368515,.895185168,.000000125],knee:[-.109481654,.497042600,-.016297637],ankle:[-.116968017,.101624393,.014533871]},
 {side:'right',hip:[.088368434,.895185196,-.000000146],knee:[.109481664,.497042668,-.016298106],ankle:[.116968147,.101624563,.014533522]},
] as const;
export type BodySphere={center:Point3;radius:number;region:'torso'|'pelvis'|'thigh'|'calf'|'knee'|'foot';side?:'left'|'right'};
export type BodyPose={yaw:number;pitch:number;blend:number;origin?:Point3}&LocomotionPose;
/** Complete immutable references: world head/eye/chest, actor pelvis and feet. */
export function falconCompleteReferences(input:BodyPose){
 const base=falconPoseReferences(input),state=readLocomotion(input);
 const feet=sampleFootTargets(state,{direction:{x:state.strideX,z:state.strideZ},
  crouch:Math.max(0,Math.min(1,input.blend)),grounded:input.grounded??true,
  pelvisShift:{x:base.pelvisShift[0],y:base.pelvisShift[1],z:base.pelvisShift[2]}});
 const lower=(p:Point3):Point3=>({...p,y:p.y-feet.pelvisDrop});
 return {...base,head:lower(base.head),eye:lower(base.eye),chest:lower(base.chest),
  pelvisShift:[base.pelvisShift[0],base.pelvisShift[1]-feet.pelvisDrop,base.pelvisShift[2]] as Vec3,
  pelvisDrop:feet.pelvisDrop,feet};
}
export function falconBodyReferences(input:BodyPose,references=falconCompleteReferences(input)){
 const blend=Math.max(0,Math.min(1,input.blend)),shift=references.pelvisShift;
 const spine2=add(SPINE1,ry(sub(SPINE2,SPINE1),TWIST));
 const transform=(v:Vec3,frame:'root'|'spine1'|'spine2'):Vec3=>add(shift,frame==='root'?v:frame==='spine1'?add(SPINE1,ry(sub(v,SPINE1),TWIST)):add(spine2,rx(ry(sub(v,SPINE2),TWIST),-.15*blend+.30*input.pitch)));
 const legs=LEGS.map(rest=>{const foot=references.feet[rest.side],hip:Vec3=[foot.hip.x,foot.hip.y,foot.hip.z],
  ankle:Vec3=[foot.position.x,foot.position.y,foot.position.z],knee:Vec3=[foot.knee.x,foot.knee.y,foot.knee.z];
  const rotateUpper=(v:Vec3)=>swingOffset(v,sub([...rest.knee],[...rest.hip]),sub(knee,hip));
  const upperRotatedCalf=rotateUpper(sub([...rest.ankle],[...rest.knee]));
  const rotateCalf=(v:Vec3)=>swingOffset(rotateUpper(v),upperRotatedCalf,sub(ankle,knee));
  return {side:rest.side,hip,ankle,knee,footOffset:[foot.offset.x,foot.offset.y,foot.offset.z] as Vec3,
    restKnee:[...rest.knee] as Vec3,rotateCalf,attached:(point:Vec3)=>add(hip,rotateUpper(sub(point,[...rest.hip])))};});
 const origin=input.origin??{x:0,y:0,z:0};
 const world=(v:Vec3):Point3=>{const p=ry(v,input.yaw);return {x:origin.x+p[0],y:origin.y+p[1],z:origin.z+p[2]};};
 return {legs,transform,world,feet:references.feet,references};
}

/** Bone-following sphere chains. Separate lateral pelvis/leg volumes preserve the crotch gap.
 * Radii are calibrated against original skinned clothing/equipment, not the root capsule.
 */
// Original C02 skin fit: fixed bone centers, <=40mm local growth, 2mm empty-lane margin.
// Order is the deterministic sphere construction below; see WEB-BODY05 radius-fit.json.
const CALIBRATED_RADIUS_METERS:readonly number[] = [0.148104,0.124169,0.147574,0.124198,0.098844,0.09911,0.066918,0.066918,0.0675,0.0675,0.127406,0.110744,0.174,0.181986,0.178427,0.174,0.176856,0.184317,0.185865,0.148145,0.178344,0.154396,0.181954,0.167884,0.155471,0.18339,0.146489,0.174497,0.143019,0.168985,0.13494,0.102,0.102,0.102,0.122017,0.129253,0.142228,0.12952,0.124903,0.103,0.093,0.092,0.087638,0.087706,0.086,0.088,0.088,0.088,0.078,0.078,0.078,0.106525,0.105419,0.117307,0.084,0.088,0.086,0.129931,0.143886,0.133579,0.12,0.103,0.093,0.098252,0.087638,0.087706,0.086,0.088,0.088,0.088,0.078,0.078,0.078,0.103,0.103,0.105,0.084,0.088,0.086];
export function falconBodyHitVolumes(input:BodyPose,references=falconCompleteReferences(input)):BodySphere[]{
 const {legs,transform,world}=falconBodyReferences(input,references),spheres:BodySphere[]=[];
 const put=(center:Vec3,radius:number,region:BodySphere['region'],side?:BodySphere['side'])=>spheres.push({center:world(center),radius,region,...(side?{side}:{})});
 for(const x of [-.12,.12])for(const z of [-.035,.075])put(transform([x,.895,z],'root'),.12,'pelvis');
 for(const z of [-.08,.07])put(transform([0,.88,z],'root'),.085,'pelvis');
 // The original central crotch vertices blend Pelvis and Thigh 50/50. Mirror that
 // skin relationship so their lower envelope bends without filling the leg gap.
 const crotch=add(mul(transform([0,.815,.005],'root'),.5),mul(add(legs[0].attached([0,.815,.005]),legs[1].attached([0,.815,.005])),.25));
 for(const z of [-.025,.045])put(add(crotch,[0,0,z]),.068,'pelvis');
 for(const x of [-.035,.035])put(add(crotch,[x,0,.045]),.0675,'pelvis');
 for(const x of [-.10,.10])put(transform([x,1.025,.11],'root'),.105,'pelvis');
 for(const x of [-.10,.10])put(transform([x,1.055,-.025],'root'),.174,'torso');
 for(const x of [-.10,.10])for(const z of [-.065,.045])put(transform([x,1.205,z],'spine1'),.174,'torso');
 // Rigid vest, rear webbing and front pouches are owned by Spine2, including low pouches.
 for(const [height,radius] of [[1.09,.146],[1.26,.146],[1.42,.14],[1.53,.102]])for(const x of [-.10,.10])for(const z of [-.12,.06])put(transform([x,height,z],'spine2'),radius,'torso');
 put(transform([0,1.3,-.225],'spine2'),.105,'torso');
 for(const leg of legs){
  const sign=leg.side==='left'?-1:1;
  for(const [t,r] of [[0,.115],[.25,.128],[.5,.123],[.75,.12],[1,.107]])put(mix(leg.hip,leg.knee,t),r,'thigh',leg.side);
  for(const [t,r] of [[.2,.093],[.4,.092],[.6,.09],[.8,.089],[1,.086]])put(mix(leg.knee,leg.ankle,t),r,'calf',leg.side);
  const calfDirection=unit(sub(leg.ankle,leg.knee)),back=unit(sub([0,0,1],mul(calfDirection,calfDirection[2])));
  for(const t of [.25,.5,.75])put(add(mix(leg.knee,leg.ankle,t),mul(back,.045)),.088,'calf',leg.side);
  const bend=unit(mul(add(unit(sub(leg.hip,leg.knee)),unit(sub(leg.ankle,leg.knee))),-1)),normal=unit(leg.rotateCalf([0,0,-1]));
  const blend=Math.max(0,Math.min(1,input.blend)),hingeAxis=unit(cross(normal,bend)),hingeAngle=Math.acos(Math.max(-1,Math.min(1,dot(normal,bend))))*.72*blend*blend*(3-2*blend);
  const hinge=(v:Vec3)=>rotateAxis(leg.rotateCalf(v),hingeAxis,hingeAngle),padNormal=rotateAxis(normal,hingeAxis,hingeAngle);
  const padCenter=add(add(leg.knee,hinge(sub([sign*.104,.525,-.097],leg.restKnee))),mul(padNormal,-.038*blend*blend));
  for(const t of [-.05,0,.05])put(add(padCenter,mul(hinge([0,1,0]),t)),.078,'knee',leg.side);
  for(const height of [.61,.73])put(leg.attached([sign*.18,height,.015]),.103,'thigh',leg.side);
  put(leg.attached([sign*.18,.96,.065]),.105,'thigh',leg.side);
  // Boots preserve authored rotation and follow the same authority ankle translation.
  put(add([sign*.128,.061,.031],leg.footOffset),.084,'foot',leg.side);
  put(add([sign*.145,.061,-.037],leg.footOffset),.088,'foot',leg.side);
  put(add([sign*.155,.048,-.105],leg.footOffset),.086,'foot',leg.side);
 }
 // The knees are deeper front-to-back than side-to-side. A rear sphere covers
 // the original cloth without widening the medial sphere across the leg gap.
 for(const leg of legs)put(add(leg.knee,leg.rotateCalf([0,0,.055])),.084,'calf',leg.side);
 // Actual original uniform vertices 3 / 136 / 5010 / 5064. Their 50% Pelvis and
 // Thigh weights explain the seam's non-rigid motion; small inward spheres
 // cover it while keeping the measured lower-leg channel open.
 for(const [point,left,right,radius] of [
  [[.026522043,.777291357,.100106593],0,.5,.0445],
  [[-.025557377,.780097734,.100342796],.5,0,.0445],
  [[.007927940,.769357918,.076213691],.125,.375,.049],
  [[-.007886262,.769872849,.076782262],.375,.125,.049],
 ] as [Vec3,number,number,number][]){
  const center=add(mul(transform(point,'root'),.5),add(mul(legs[0].attached(point),left),mul(legs[1].attached(point),right)));
  put(add(center,[0,.04,0]),radius,'pelvis');
 }
 for(let i=0;i<spheres.length;i++)spheres[i].radius=CALIBRATED_RADIUS_METERS[i]??spheres[i].radius;
 return spheres;
}
