/** Authoritative dropped weapon rigid bodies. Original model_dropped PHY convex
 * points/masses, mapped through the already verified IVP basis. Rapier is the
 * contact solver adapter; this module never advances the shared world. */
import RAPIER from '@dimforge/rapier3d-compat';
import {Matrix4,Quaternion,Vector3} from 'three';
import {sourceRagdollRestWorldMatrices,type SourceRagdollIndex,type SourceRagdollRestTransforms} from './source-ragdoll.js';
import {sourceRagdollWorldBasis} from './source-ragdoll-rigid.js';
import type {SourceWeaponFinish} from './source-weapon-finish.js';
import original from './source-dropped-weapon-physics.json' with {type:'json'};
export const SOURCE_DROPPED_WEAPON_VERSION='csgo-dropped-weapons-12426148-v1' as const;
/** Thin original rotating convexes need authority substeps; the caller divides
 * its one shared-world tick. This module never advances any world. */
export const SOURCE_DROPPED_WEAPON_MAX_PHYSICS_STEP=1/120;
export const SOURCE_DROPPED_WEAPONS=['vandal','m4a4','awp','glock','usp','deagle']as const;
export type SourceDroppedWeaponId=(typeof SOURCE_DROPPED_WEAPONS)[number];
export type SourceDroppedWeaponPose={position:[number,number,number];quaternion:[number,number,number,number]};
export type SourceDroppedWeaponState=SourceDroppedWeaponPose&{id:string;weapon:SourceDroppedWeaponId;ownerId:string;createdAt:number;velocity:[number,number,number];angularVelocity:[number,number,number];sleeping:boolean;sourceWeaponFinish?:SourceWeaponFinish;magazineVisible:boolean;silencerVisible:boolean;
  /** Authoritative clip/reserve at the death instant. Older snapshots omit these
   * fields and are treated as a full pickup by the simulation. */
  ammo?:number;reserve?:number};
export type SourceDroppedWeaponSpawn=SourceDroppedWeaponPose&Pick<SourceDroppedWeaponState,'id'|'weapon'|'ownerId'|'createdAt'>&Partial<Pick<SourceDroppedWeaponState,'velocity'|'angularVelocity'|'sourceWeaponFinish'|'magazineVisible'|'silencerVisible'|'sleeping'|'ammo'|'reserve'>>;
const scale=original.metersPerSourceUnit;
const C=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-Math.PI/2);
export function isSourceDroppedWeapon(weapon:unknown):weapon is SourceDroppedWeaponId{return typeof weapon==='string'&&(SOURCE_DROPPED_WEAPONS as readonly string[]).includes(weapon);}
export function sourceDroppedWeaponDefinition(weapon:SourceDroppedWeaponId){const definition=original.models.find(m=>m.weapon===weapon);if(!definition)throw Error('No original dropped weapon '+weapon);return definition;}
/** The dropped models all have identity weapon_hand_R root. Convert the exact
 * death-instant original body bone to a unit-scale WebGL rigid frame; the mesh
 * and original collision vertices both apply C*.0254 inside that frame. */
export function sourceDroppedWeaponPoseFromRest(index:SourceRagdollIndex,rest:SourceRagdollRestTransforms,actor:{x:number;y:number;z:number;yaw:number}):SourceDroppedWeaponPose{
 if(!Number.isInteger(index.weaponHandBone)||index.weaponHandBone<0)throw Error('Original right weapon hand bone absent');
 const hand=new Matrix4().fromArray(sourceRagdollRestWorldMatrices(index,rest),index.weaponHandBone*16),basis=sourceRagdollWorldBasis(actor);
 const position=new Vector3().setFromMatrixPosition(hand).multiplyScalar(scale).applyQuaternion(basis).add(new Vector3(actor.x,actor.y,actor.z));
 const rotation=basis.multiply(new Quaternion().setFromRotationMatrix(hand)).multiply(C.clone().invert()).normalize();
 if(![...position.toArray(),...rotation.toArray()].every(Number.isFinite))throw Error('Invalid original weapon hand transform');
 return{position:position.toArray(),quaternion:rotation.toArray()};
}
/** Optional inherited angular momentum from two actual hand frames, in world
 * radians/second. Zero is valid when the caller lacks a preceding pose. */
export function sourceDroppedWeaponAngularVelocity(previous:SourceDroppedWeaponPose,current:SourceDroppedWeaponPose,dt:number):[number,number,number]{
 if(!Number.isFinite(dt)||dt<=0)throw Error('Invalid dropped hand interval');
 const delta=new Quaternion().fromArray(current.quaternion).multiply(new Quaternion().fromArray(previous.quaternion).invert()).normalize();
 if(delta.w<0)delta.set(-delta.x,-delta.y,-delta.z,-delta.w);const length=Math.hypot(delta.x,delta.y,delta.z);
 return length<1e-9?[0,0,0]:[delta.x,delta.y,delta.z].map(v=>v/length*2*Math.atan2(length,delta.w)/dt)as[number,number,number];
}
export function interpolateSourceDroppedWeapon(a:SourceDroppedWeaponState,b:SourceDroppedWeaponState,t:number):SourceDroppedWeaponState{
 if(a.id!==b.id||a.weapon!==b.weapon)return structuredClone(b);const f=Math.max(0,Math.min(1,t));
 return{...structuredClone(b),position:a.position.map((v,i)=>v+(b.position[i]-v)*f)as[number,number,number],quaternion:new Quaternion().fromArray(a.quaternion).slerp(new Quaternion().fromArray(b.quaternion),f).normalize().toArray()};
}
export function createSourceDroppedWeaponPhysics(world:RAPIER.World,options:{collisionGroups?:number;friction?:number;restitution?:number}={}){
 if(original.format!=='source-dropped-weapon-physics-v1'||original.build!==12426148||scale!==.0254)throw Error('Original dropped physics identity differs');
 type Entry={body:RAPIER.RigidBody;state:SourceDroppedWeaponState;radius:number;quietFor:number;quietPose?:SourceDroppedWeaponPose};
 const bodies=new Map<string,Entry>();let disposed=false;
 function readOne(entry:{body:RAPIER.RigidBody;state:SourceDroppedWeaponState}){const p=entry.body.translation(),q=entry.body.rotation(),v=entry.body.linvel(),w=entry.body.angvel();return{...structuredClone(entry.state),position:[p.x,p.y,p.z]as[number,number,number],quaternion:[q.x,q.y,q.z,q.w]as[number,number,number,number],velocity:[v.x,v.y,v.z]as[number,number,number],angularVelocity:[w.x,w.y,w.z]as[number,number,number],sleeping:entry.body.isSleeping()};}
 return{
  create(input:SourceDroppedWeaponSpawn){
   if(disposed)throw Error('Dropped weapon physics disposed');if(bodies.has(input.id))throw Error('Duplicate dropped weapon id');
   if(!input.id||!input.ownerId||!isSourceDroppedWeapon(input.weapon)||![input.createdAt,...input.position,...input.quaternion,...(input.velocity??[0,0,0]),...(input.angularVelocity??[0,0,0])].every(Number.isFinite)||input.position.length!==3||input.quaternion.length!==4||(input.velocity!==undefined&&input.velocity.length!==3)||(input.angularVelocity!==undefined&&input.angularVelocity.length!==3))throw Error('Invalid dropped weapon spawn');
   if(input.sourceWeaponFinish&&input.sourceWeaponFinish.weapon!==input.weapon)throw Error('Dropped weapon finish identity differs');
   const definition=sourceDroppedWeaponDefinition(input.weapon),q=new Quaternion().fromArray(input.quaternion);if(q.lengthSq()<.9||q.lengthSq()>1.1)throw Error('Invalid dropped weapon quaternion');q.normalize();
   const velocity=input.velocity??[0,0,0],angular=input.angularVelocity??[0,0,0];
   const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...input.position).setRotation(q).setLinvel(...velocity).setAngvel({x:angular[0],y:angular[1],z:angular[2]}).setLinearDamping(definition.damping).setAngularDamping(definition.rotdamping).setCcdEnabled(true).setAdditionalSolverIterations(4));
   try{const colliders=definition.convex.map(hull=>{
    const points=new Float32Array(hull.points.length);for(let i=0;i<hull.points.length;i+=3){points[i]=hull.points[i]*scale;points[i+1]=hull.points[i+2]*scale;points[i+2]=-hull.points[i+1]*scale;}
    const shape=RAPIER.ColliderDesc.convexHull(points);if(!shape)throw Error('Original dropped weapon convex hull invalid');
    return world.createCollider(shape.setDensity(1).setFriction(options.friction??definition.friction).setRestitution(options.restitution??definition.elasticity).setCollisionGroups(options.collisionGroups??((4<<16)|4)),body);
   });
   const volumeMass=colliders.reduce((total,c)=>total+c.mass(),0);if(volumeMass<=0)throw Error('Original dropped hull has no volume');
   for(const collider of colliders)collider.setDensity(definition.mass/volumeMass);body.recomputeMassPropertiesFromColliders();
   const state:SourceDroppedWeaponState={...structuredClone(input),velocity:[...velocity],angularVelocity:[...angular],sleeping:input.sleeping??false,magazineVisible:input.magazineVisible??true,silencerVisible:input.silencerVisible??true};const radius=Math.max(...definition.convex.flatMap(hull=>Array.from({length:hull.points.length/3},(_,i)=>Math.hypot(...hull.points.slice(i*3,i*3+3))*scale)));const entry:Entry={body,state,radius,quietFor:0};bodies.set(input.id,entry);if(input.sleeping)body.sleep();return readOne(entry);
   }catch(error){world.removeRigidBody(body);throw error;}
  },
  /** Call once after the authority finishes its shared-world physics tick.
   * Original zero damping is retained. Rapier's thin convex/trimesh contacts can
   * chatter forever at triangle seams; only a supported, bounded pose held for
   * 0.6 seconds sleeps (root stays within 3mm, the entire convex within 15mm).
   * An airborne apex or a steadily moving/rolling gun cannot qualify.
   * This is a contact-solver adapter, not a native IVP sleep-threshold claim. */
  afterStep(dt:number){
   if(disposed)throw Error('Dropped weapon physics disposed');if(!Number.isFinite(dt)||dt<=0||dt>.1)throw Error('Invalid dropped authority timestep');
   for(const entry of bodies.values()){
    if(entry.body.isSleeping()){entry.quietFor=0;entry.quietPose=undefined;continue;}
    const state=readOne(entry);let contact=false;
    if(Math.hypot(...state.velocity)<.15)for(let i=0;i<entry.body.numColliders();i++){const own=entry.body.collider(i);world.contactPairsWith(own,other=>{if(contact)return;world.contactPair(own,other,manifold=>{for(let j=0;j<manifold.numContacts();j++)if(manifold.contactDist(j)<.003)contact=true;});});}
    if(!contact){entry.quietFor=0;entry.quietPose=undefined;continue;}
    if(entry.quietPose){const distance=new Vector3().fromArray(state.position).distanceTo(new Vector3().fromArray(entry.quietPose.position)),angle=new Quaternion().fromArray(state.quaternion).angleTo(new Quaternion().fromArray(entry.quietPose.quaternion));if(distance>.003||distance+2*entry.radius*Math.sin(angle/2)>.015){entry.quietFor=0;entry.quietPose=undefined;}}
    if(!entry.quietPose)entry.quietPose={position:state.position,quaternion:state.quaternion};entry.quietFor+=dt;
    if(entry.quietFor>=.6){entry.body.sleep();entry.quietFor=0;entry.quietPose=undefined;}
   }
   return [...bodies.values()].map(readOne);
  },
  read(){if(disposed)throw Error('Dropped weapon physics disposed');return [...bodies.values()].map(readOne);},
  /** For bounded authority queries/tests, never for a rendering client. */
  body(id:string){return bodies.get(id)?.body??null;},
  remove(id:string){const entry=bodies.get(id);if(!entry)return false;world.removeRigidBody(entry.body);bodies.delete(id);return true;},
  clear(){for(const entry of bodies.values())world.removeRigidBody(entry.body);bodies.clear();},
  dispose(){if(disposed)return;for(const entry of bodies.values())world.removeRigidBody(entry.body);bodies.clear();disposed=true;},
 };
}
