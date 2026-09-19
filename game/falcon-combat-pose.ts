import * as T from 'three';
import { falconCompleteReferences } from './falcon-body-reference.js';
import type { LocomotionPose } from './locomotion.js';

export type CombatPoseInput = { yaw: number; pitch: number; crouch: number; authoritativeCrouch?: boolean } & LocomotionPose;
const V = () => new T.Vector3();
const Q = () => new T.Quaternion();
const position = (o: T.Object3D) => o.getWorldPosition(V());
const worldQ = (o: T.Object3D) => o.getWorldQuaternion(Q());
const required = (root: T.Object3D, name: string) => {
  const o = root.getObjectByName(name); if (!o) throw new Error(`C02 node missing: ${name}`); return o;
};
function setWorldQ(o: T.Object3D, q: T.Quaternion) {
  o.quaternion.copy(o.parent ? worldQ(o.parent).invert().multiply(q) : q).normalize();
  o.updateWorldMatrix(false, true);
}
function setWorldPosition(o: T.Object3D, p: T.Vector3) {
  o.position.copy(o.parent ? o.parent.worldToLocal(p.clone()) : p);
  o.updateWorldMatrix(false, true);
}
function setWorldMatrix(o: T.Object3D, m: T.Matrix4) {
  (o.parent ? o.parent.matrixWorld.clone().invert().multiply(m) : m).decompose(o.position,o.quaternion,o.scale);
  o.updateWorldMatrix(false,true);
}
function swing(o: T.Object3D, oldDirection: T.Vector3, newDirection: T.Vector3) {
  setWorldQ(o, Q().setFromUnitVectors(oldDirection.normalize(), newDirection.normalize()).multiply(worldQ(o)));
}
export function shotDirection(yaw: number, pitch: number) {
  return new T.Vector3(-Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
}

/** Frame-local CPU skinning matrices retain Three's double precision and operation
 * order. The GPU's Float32 boneMatrices would change contact results. Refresh only
 * after the current pose is sampled; no bone transform survives into the next frame.
 */
export class SkinnedVertexFrame {
  private readonly matrices: T.Matrix4[] = [];
  private readonly base = new T.Vector4();
  private readonly weighted = new T.Vector4();
  constructor(readonly mesh: T.SkinnedMesh) {}
  begin() {
    const { bones, boneInverses } = this.mesh.skeleton;
    for (let i = 0; i < bones.length; i++) {
      (this.matrices[i] ??= new T.Matrix4()).multiplyMatrices(bones[i].matrixWorld, boneInverses[i]);
    }
  }
  getVertexPosition(index: number, target: T.Vector3): T.Vector3 {
    const mesh = this.mesh, indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
    // Preserve Mesh's original base vertex and morph-target evaluation.
    T.Mesh.prototype.getVertexPosition.call(mesh, index, target);
    this.base.set(target.x, target.y, target.z, 1).applyMatrix4(mesh.bindMatrix);
    target.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const weight = weights.getComponent(index, i);
      if (weight !== 0) target.addScaledVector(this.weighted.copy(this.base)
        .applyMatrix4(this.matrices[indices.getComponent(index, i)]), weight);
    }
    return target.applyMatrix4(mesh.bindMatrixInverse);
  }
}

/** Post-sample pose layer for the COMPLETE frozen C02 scene, already facing PI under actor yaw.
 * The caller MUST sample all original Idle/Fire/Reload tracks first on every frame.
 * Does not own the actor transform, animation time, materials, mesh data or collision.
 */
export class FalconCombatPose {
  readonly body: T.Object3D;
  readonly nodes = new Map<string,T.Object3D>();
  // C02 exact Idle0 head AABB center transformed into Bip01_Head local space.
  // Numerical and rendered tests independently measure the actual skinned head bounds.
  private cloth?:T.SkinnedMesh;
  private skinFrame?:SkinnedVertexFrame;
  private kneePatches=new Map<string,{vertices:number[];triangles:number[][];points:Map<number,T.Vector3>}>();
  private gear: {mesh:T.SkinnedMesh; original:T.Skeleton; skeleton:T.Skeleton; proxy:T.Bone; calf:T.Object3D; side:string; inverse:T.Matrix4}[] = [];
  private authored = new Map<T.Object3D, {position:T.Vector3; quaternion:T.Quaternion; scale:T.Vector3}>();
  private headReference = new T.Vector3(0.09578855026559688, -0.016479366517103525, 8.94482434493236e-9);
  constructor(body: T.Object3D) {
    this.body=body;
    for(const name of ['Bip01_Pelvis','Bip01_Spine1','Bip01_Spine2','Bip01_Head','Weapon_Root','Magazine_Root','Socket_Stock',
      ...['L','R'].flatMap(s=>['UpperArm','Forearm','Hand','Thigh','Calf','Foot'].map(n=>`Bip01_${s}_${n}`))]) this.nodes.set(name, required(body,name));
  }
  /** Gear uses private bone palettes. Vertex/index/UV/weight buffers and materials stay shared and unchanged. */
  private setupKneeGear() {
    if(this.gear.length)return;
    this.body.traverse(o=>{
      const mesh=o as T.SkinnedMesh;if(!mesh.isSkinnedMesh)return;
      const side=/Knee_(padded_backing|segmented_composite)_([LR])$/.exec(mesh.name)?.[2] ?? /Kit_.*_(L|R)_Calf$/.exec(mesh.name)?.[1];
      if(!side)return;
      const calf=this.node(`Bip01_${side}_Calf`),index=mesh.skeleton.bones.indexOf(calf as T.Bone);if(index<0)throw new Error('Gear calf absent');
      const weights=mesh.geometry.getAttribute('skinWeight'),indices=mesh.geometry.getAttribute('skinIndex');
      for(let i=0;i<weights.count;i++)for(let j=0;j<4;j++)if(weights.getComponent(i,j)>1e-6&&indices.getComponent(i,j)!==index)throw new Error('Expected frozen rigid calf gear');
      const original=mesh.skeleton,proxy=new T.Bone();proxy.name=`ACTION03_${side}_Patella`;proxy.matrixAutoUpdate=false;proxy.matrixWorldAutoUpdate=false;proxy.matrixWorld.copy(calf.matrixWorld);
      const bones=original.bones.slice();bones[index]=proxy;const skeleton=new T.Skeleton(bones,original.boneInverses.map(m=>m.clone()));mesh.skeleton=skeleton;
      this.gear.push({mesh,original,skeleton,proxy,calf,side,inverse:original.boneInverses[index].clone()});
    });
  }
  private updateKneeGear(crouch:number) {
    this.setupKneeGear();const reports=[];
    if(!this.cloth){
      this.cloth=required(this.body,'FALCON_|_combat_uniform_and_boots') as T.SkinnedMesh;
      this.skinFrame=new SkinnedVertexFrame(this.cloth);
      const geometry=this.cloth.geometry,pos=geometry.getAttribute('position'),index=geometry.index!;
      for(const side of ['L','R']){
        const triangles:number[][]=[],vertices=new Set<number>(),legBones=new Set(this.cloth.skeleton.bones.flatMap((b,i)=>b.name===`Bip01_${side}_Thigh`||b.name===`Bip01_${side}_Calf`?[i]:[]));
        for(let i=0;i<index.count;i+=3){const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)],y=ids.reduce((v,j)=>v+pos.getY(j),0)/3;
          let legWeight=0;for(const id of ids)for(let j=0;j<4;j++)if(legBones.has(geometry.getAttribute('skinIndex').getComponent(id,j)))legWeight+=geometry.getAttribute('skinWeight').getComponent(id,j);
          if(y>.32&&y<.74&&legWeight>2.4){triangles.push(ids);ids.forEach(j=>vertices.add(j));}}
        this.kneePatches.set(side,{vertices:[...vertices],triangles,points:new Map([...vertices].map(i=>[i,V()]))});
      }
    }
    // The pose pass refreshed ancestors via updateWorldMatrix, which does not
    // call SkinnedMesh's updateMatrixWorld override. Refresh its attached-mode
    // bind inverse now, as the renderer will later do, before contact sampling.
    this.cloth.updateMatrixWorld(true);
    this.cloth.skeleton.update();
    this.skinFrame!.begin();
    for(const side of ['L','R']){
      const group=this.gear.filter(g=>g.side===side),g=group.find(g=>g.mesh.name===`Knee_padded_backing_${side}`)!;
      const knee=position(g.calf),hip=position(this.node(`Bip01_${side}_Thigh`)),ankle=position(this.node(`Bip01_${side}_Foot`));
      const anterior=hip.sub(knee).normalize().add(ankle.sub(knee).normalize()).negate().normalize();
      const skin=g.calf.matrixWorld.clone().multiply(g.inverse),currentNormal=new T.Vector3(0,0,1).transformDirection(skin);
      const rotation=Q().setFromUnitVectors(currentNormal,anterior);rotation.slerp(Q(),1-.72*T.MathUtils.smoothstep(crouch,0,1));
      const correction=new T.Matrix4().makeTranslation(knee.x,knee.y,knee.z).multiply(new T.Matrix4().makeRotationFromQuaternion(rotation)).multiply(new T.Matrix4().makeTranslation(-knee.x,-knee.y,-knee.z));
      const proxyWorld=correction.multiply(g.calf.matrixWorld);
      // Rigid patella hinge plus contact along its normal. Preserve all original geometry.
      if(!g.mesh.geometry.boundingBox)g.mesh.geometry.computeBoundingBox();const center=g.mesh.geometry.boundingBox!.getCenter(V()).applyMatrix4(g.mesh.bindMatrix).applyMatrix4(g.inverse).applyMatrix4(proxyWorld);
      const normal=new T.Vector3(0,0,1).transformDirection(proxyWorld.clone().multiply(g.inverse));
      const ray=new T.Ray(center.clone().addScaledVector(normal,.20),normal.clone().negate()),patch=this.kneePatches.get(side)!;
      const vertices=patch.points;
      for(const [i,point] of vertices)this.skinFrame!.getVertexPosition(i,point).applyMatrix4(this.cloth.matrixWorld);
      let nearest=Infinity;const hit=V();
      for(const ids of patch.triangles){const result=ray.intersectTriangle(vertices.get(ids[0])!,vertices.get(ids[1])!,vertices.get(ids[2])!,false,hit);if(result)nearest=Math.min(nearest,hit.distanceTo(ray.origin));}
      const raw=Number.isFinite(nearest)?.20-nearest+.014:0;
      const distance=T.MathUtils.clamp(raw,-.08,.08)*T.MathUtils.smoothstep(crouch,0,.4),offset=normal.clone().multiplyScalar(distance);
      proxyWorld.premultiply(new T.Matrix4().makeTranslation(offset.x,offset.y,offset.z));
      for(const item of group){item.proxy.matrixWorld.copy(proxyWorld);item.skeleton.update();}
      reports.push({side,hingeDegrees:T.MathUtils.radToDeg(rotation.angleTo(Q())),contactFound:Number.isFinite(nearest),contactTranslationM:distance,contactClamped:Math.abs(raw)>.08,patchTriangles:patch.triangles.length,patchVertices:patch.vertices.length});
    }return reports;
  }
  dispose(){this.restoreSampledPose();for(const g of this.gear){g.mesh.skeleton=g.original;g.skeleton.dispose();}this.gear=[];}
  /** Call before mixer sampling, even when clip/time did not change. Three PropertyMixer
   * skips unchanged properties; without this reset a post-pose layer would accumulate. */
  restoreSampledPose() {
    for(const [o,t] of this.authored) {o.position.copy(t.position);o.quaternion.copy(t.quaternion);o.scale.copy(t.scale);}
    this.authored.clear();this.body.updateWorldMatrix(true,true);for(const g of this.gear){g.proxy.matrixWorld.copy(g.calf.matrixWorld);g.skeleton.update();}
  }
  private node(name: string) { return this.nodes.get(name)!; }
  private solveLimb(upper: T.Object3D, lower: T.Object3D, end: T.Object3D, target: T.Matrix4, pole: T.Vector3) {
    const a0=position(upper), b0=position(lower), c0=position(end), c=new T.Vector3().setFromMatrixPosition(target);
    const a=a0.distanceTo(b0), b=b0.distanceTo(c0), dir=c.clone().sub(a0), raw=dir.length();dir.normalize();
    const d=T.MathUtils.clamp(raw,Math.abs(a-b)+1e-6,a+b-1e-6);
    const along=(a*a-b*b+d*d)/(2*d),height=Math.sqrt(Math.max(0,a*a-along*along));
    pole.addScaledVector(dir,-pole.dot(dir)).normalize();
    const elbow=a0.clone().addScaledVector(dir,along).addScaledVector(pole,height);
    swing(upper,b0.clone().sub(a0),elbow.clone().sub(a0));
    const newB=position(lower),newC=position(end);
    swing(lower,newC.sub(newB),c.clone().sub(newB));
    // Rotation only: segment translations/scales are never stretched to hide unreachable targets.
    const targetQ=Q();target.decompose(V(),targetQ,V());setWorldQ(end,targetQ);
    return {reachError:Math.max(0,raw-(a+b)),endpointError:position(end).distanceTo(c),segmentLengths:[a,b]};
  }
  apply(input: CombatPoseInput) {
    const {yaw,pitch}=input,c=T.MathUtils.clamp(input.crouch,0,1),body=this.body;
    if(this.authored.size) throw new Error('Call restoreSampledPose BEFORE original mixer sampling on every frame');
    for(const o of this.nodes.values()) this.authored.set(o,{position:o.position.clone(),quaternion:o.quaternion.clone(),scale:o.scale.clone()});
    body.updateWorldMatrix(true,true);
    const yawQ=Q().setFromAxisAngle(new T.Vector3(0,1,0),yaw);
    const right=new T.Vector3(1,0,0).applyQuaternion(yawQ), forward=new T.Vector3(0,0,-1).applyQuaternion(yawQ);
    const feet=['L','R'].map(s=>this.node(`Bip01_${s}_Foot`).matrixWorld.clone());
    const weapon=this.node('Weapon_Root'),weaponBefore=weapon.matrixWorld.clone();
    const sourceStockOffset=position(this.node('Socket_Stock')).sub(position(this.node('Bip01_R_UpperArm'))).applyQuaternion(yawQ.clone().invert()).sub(new T.Vector3(.03462899109914771,.0528855544785716,-.1503882167386365));
    const handBefore=['L','R'].map(s=>this.node(`Bip01_${s}_Hand`).matrixWorld.clone());
    const head=this.node('Bip01_Head'),headQ=worldQ(head);
    const origin=body.getWorldPosition(V());
    const references=falconCompleteReferences({...input,blend:c,origin});
    for(const [i,side] of (['left','right'] as const).entries()) {
      const ankle=references.feet[side].position;
      // Targets already face gameplay -Z. Apply only actor yaw and translation,
      // never the inner GLB's PI import rotation a second time.
      feet[i].setPosition(new T.Vector3(ankle.x,ankle.y,ankle.z).applyQuaternion(yawQ).add(origin));
    }

    // Spine1 is above the thigh branches (C02 thighs are children of Spine, not Pelvis).
    const spine1=this.node('Bip01_Spine1'),spine2=this.node('Bip01_Spine2');
    setWorldQ(spine1,Q().setFromAxisAngle(new T.Vector3(0,1,0),T.MathUtils.degToRad(-35)).multiply(worldQ(spine1)));
    setWorldQ(spine2,Q().setFromAxisAngle(right,-.15*c + .30*pitch).multiply(worldQ(spine2)));
    setWorldQ(head,Q().setFromAxisAngle(right,.45*pitch).multiply(headQ));
    const pelvis=this.node('Bip01_Pelvis');
    // The common reference includes crouch, pitch and locomotion's pelvis drop.
    const shift=new T.Vector3(...references.pelvisShift).applyQuaternion(yawQ);
    setWorldPosition(pelvis,position(pelvis).add(shift));
    const legs=['L','R'].map((s,i)=>this.solveLimb(this.node(`Bip01_${s}_Thigh`),this.node(`Bip01_${s}_Calf`),this.node(`Bip01_${s}_Foot`),feet[i],forward.clone().addScaledVector(right,s==='L'?-.12:.12)));

    // Keep the stock at the right shoulder and solve the actual bore orientation.
    // Both authored wrists follow the same rigid weapon delta, including Reload grasp motion.
    const desiredQ=yawQ.clone().multiply(Q().setFromAxisAngle(new T.Vector3(1,0,0),pitch));
    const shoulder=position(this.node('Bip01_R_UpperArm'));
    const stockTarget=shoulder.clone().addScaledVector(forward,.025);stockTarget.y+=.065;
    // Retain authored translational recoil/breathing relative to the shoulder.
    const sourceIdleGunQ=new T.Quaternion(-.07898991616089106,.42101002372053287,.036833613981536784,.9028590354828532);
    const extreme=T.MathUtils.smoothstep(Math.abs(pitch),Math.PI/6,1.48);
    stockTarget.addScaledVector(right,-.13*extreme);
    if(pitch>0)stockTarget.y-=.12*extreme;
    else stockTarget.addScaledVector(forward,.29*extreme);
    stockTarget.add(sourceStockOffset.applyQuaternion(sourceIdleGunQ.invert()).applyQuaternion(desiredQ));
    const stockLocal=this.node('Socket_Stock').position.clone();
    const targetPos=stockTarget.clone().sub(stockLocal.applyQuaternion(desiredQ));
    const desiredWeapon=new T.Matrix4().compose(targetPos,desiredQ,weapon.getWorldScale(V()));
    const delta=desiredWeapon.clone().multiply(weaponBefore.clone().invert());
    const targets=handBefore.map(m=>delta.clone().multiply(m));
    setWorldMatrix(weapon,desiredWeapon);
    const arms=['L','R'].map((s,i)=>this.solveLimb(this.node(`Bip01_${s}_UpperArm`),this.node(`Bip01_${s}_Forearm`),this.node(`Bip01_${s}_Hand`),targets[i],
      right.clone().multiplyScalar(s==='L'?-1:1).add(new T.Vector3(0,-.8,0)).addScaledVector(forward,-.15)));
    body.updateWorldMatrix(true,true);
    const kneeGear=this.updateKneeGear(c);
    const reference=head.localToWorld(this.headReference.clone()),interpolatedAuthority=origin.clone().add(new T.Vector3(0,T.MathUtils.lerp(1.684237331,1.14,c),0));
    const authority=input.authoritativeCrouch===undefined?undefined:origin.clone().add(new T.Vector3(0,input.authoritativeCrouch?1.14:1.684237331,0));
    return {crouch:c,legs,arms,kneeGear,pelvisDrop:references.pelvisDrop,feet:references.feet,actorOrigin:origin.toArray(),pelvisTranslation:shift.toArray(),headReference:reference.toArray(),headOffsetFromInterpolatedAuthority:reference.clone().sub(interpolatedAuthority).toArray(),headOffsetFromBooleanAuthority:authority?reference.clone().sub(authority).toArray():undefined,
      boreDirection:new T.Vector3(0,0,-1).transformDirection(weapon.matrixWorld).toArray(),
      aimErrorDegrees:T.MathUtils.radToDeg(new T.Vector3(0,0,-1).transformDirection(weapon.matrixWorld).angleTo(shotDirection(yaw,pitch)))};
  }
}

/** Safe integration order. `sampleOriginal` must synchronously set the original clip/time and update the mixer. */
export function sampleFalconCombatPose(layer: FalconCombatPose, sampleOriginal: () => void, input: CombatPoseInput) {
  layer.restoreSampledPose(); sampleOriginal(); return layer.apply(input);
}

/** Exact critically damped blend. Use the same state/time on authority and presentation when adopting it.
 * This class never changes authoritative collision or the input pitch. */
export class FalconStanceTransition {
  private phase:number; private rate=0; readonly omega=18;
  constructor(crouched=false){this.phase=crouched?1:0;}
  get value(){return this.phase*this.phase*(3-2*this.phase);}
  get velocity(){return 6*this.phase*(1-this.phase)*this.rate;}
  snapshot(){return {phase:this.phase,rate:this.rate};}
  restore(state:{phase:number;rate:number}){if(!Number.isFinite(state.phase)||!Number.isFinite(state.rate)||state.phase<0||state.phase>1)throw new Error('Invalid stance state');this.phase=state.phase;this.rate=state.rate;}
  update(crouched:boolean,dt:number){
    if(!Number.isFinite(dt)||dt<0)throw new Error('Stance dt must be finite and nonnegative');
    const target=crouched?1:0,error=this.phase-target,temp=(this.rate+this.omega*error)*dt,decay=Math.exp(-this.omega*dt);
    this.phase=target+(error+temp)*decay;this.rate=(this.rate-this.omega*temp)*decay;
    // Cubic easing keeps knee speed continuous at an initially near-straight leg.
    return this.value;
  }
}
