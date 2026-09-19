import {beforeAll,describe,expect,it} from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as T from 'three';
import {readFileSync} from 'node:fs';
import {SOURCE_DROPPED_WEAPONS,createSourceDroppedWeaponPhysics,sourceDroppedWeaponDefinition,sourceDroppedWeaponPoseFromRest,sourceDroppedWeaponAngularVelocity,interpolateSourceDroppedWeapon} from '../game/source-dropped-weapons';
import {loadCharacterCpuFixture} from '../scripts/validate-source-character-actor';
import {createSourceCharacterActors} from '../game/source-character';
import {createSourcePoseDriver} from '../game/source-player-contract';
import {bindSourceRagdoll,createSourceRagdollPoseDriver,parseSourceRagdollData} from '../game/source-ragdoll';
import {setSourceHeldWeaponVisible} from '../game/source-dropped-weapon-renderer';

beforeAll(async()=>{await RAPIER.init();});
const pose={position:[0,2,0]as[number,number,number],quaternion:new T.Quaternion().setFromEuler(new T.Euler(.6,.8,.9)).toArray()};
const spawn=(weapon:typeof SOURCE_DROPPED_WEAPONS[number])=>({id:weapon,weapon,ownerId:'death-victim',createdAt:6,...pose,velocity:[1,.3,-.4]as[number,number,number],angularVelocity:[1.2,-.8,2]as[number,number,number]});
function lowestPoint(weapon:typeof SOURCE_DROPPED_WEAPONS[number],position:number[],quaternion:number[]){const p=new T.Vector3().fromArray(position),q=new T.Quaternion().fromArray(quaternion);let low=Infinity;for(const hull of sourceDroppedWeaponDefinition(weapon).convex)for(let i=0;i<hull.points.length;i+=3){const v=new T.Vector3(hull.points[i],hull.points[i+2],-hull.points[i+1]).multiplyScalar(.0254).applyQuaternion(q).add(p);low=Math.min(low,v.y);}return low;}

describe('original dropped weapon volumes in the shared authority world',()=>{
 it.each(SOURCE_DROPPED_WEAPONS)('%s retains the PHY mass, rotates, and rests on its full convex volume',weapon=>{
  const world=new RAPIER.World({x:0,y:-20.32,z:0});world.timestep=1/120;
  world.createCollider(RAPIER.ColliderDesc.cuboid(20,.5,20).setTranslation(0,-.5,0));
  const driver=createSourceDroppedWeaponPhysics(world),first=driver.create(spawn(weapon));
  expect(driver.body(weapon)!.mass()).toBeCloseTo(sourceDroppedWeaponDefinition(weapon).mass,4);
  expect(driver.body(weapon)!.numColliders()).toBe(sourceDroppedWeaponDefinition(weapon).convex.length);
  expect(driver.body(weapon)!.collider(0).shapeType()).toBe(RAPIER.ShapeType.ConvexPolyhedron);
  // A read must not step a shared world a second time. The immutable snapshot
  // must also survive later physics steps and callers modifying returned data.
  expect(driver.read()[0]).toEqual(first);expect(driver.read()[0]).toEqual(first);
  let state=first,minimum=Infinity,turned=0;
  for(let tick=0;tick<2400;tick++){world.step();state=driver.afterStep(world.timestep)[0];minimum=Math.min(minimum,lowestPoint(weapon,state.position,state.quaternion));turned=Math.max(turned,new T.Quaternion().fromArray(first.quaternion).angleTo(new T.Quaternion().fromArray(state.quaternion)));if(state.sleeping)break;}
  expect(turned).toBeGreaterThan(.25);expect(state.sleeping).toBe(true);
  expect(minimum).toBeGreaterThan(-.012);expect(lowestPoint(weapon,state.position,state.quaternion)).toBeGreaterThan(-.003);
  expect(lowestPoint(weapon,state.position,state.quaternion)).toBeLessThan(.012);
  expect(first.position).toEqual([0,2,0]);state.position[0]=999;expect(driver.read()[0].position[0]).not.toBe(999);
  driver.body(weapon)!.setLinvel({x:0,y:2,z:0},true);world.step();expect(driver.read()[0].sleeping).toBe(false);
  driver.dispose();driver.dispose();expect(world.bodies.len()).toBe(0);expect(world.colliders.len()).toBe(1);world.free();
 });
 it('requires real contact before adapter sleep and does not freeze airborne bodies',()=>{
  const world=new RAPIER.World({x:0,y:0,z:0}),driver=createSourceDroppedWeaponPhysics(world);world.timestep=1/120;
  driver.create({...spawn('awp'),velocity:[0,0,0],angularVelocity:[0,0,0]});driver.body('awp')!.setAngvel({x:0,y:.02,z:0},true);
  for(let i=0;i<90;i++){driver.body('awp')!.wakeUp();world.step();driver.body('awp')!.wakeUp();expect(driver.afterStep(world.timestep)[0].sleeping).toBe(false);}driver.dispose();world.free();
 });
 it('keeps six simultaneous drops independent and never removes someone else’s body',()=>{
  const world=new RAPIER.World({x:0,y:-20.32,z:0}),other=world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),driver=createSourceDroppedWeaponPhysics(world);
  for(const weapon of SOURCE_DROPPED_WEAPONS)driver.create(spawn(weapon));expect(world.bodies.len()).toBe(7);
  expect(()=>driver.create(spawn('vandal'))).toThrow('Duplicate');expect(world.bodies.len()).toBe(7);
  driver.remove('vandal');expect(driver.remove('vandal')).toBe(false);expect(driver.read()).toHaveLength(5);
  driver.clear();expect(world.bodies.len()).toBe(1);expect(other.isValid()).toBe(true);driver.dispose();world.free();
 });
 it('restores a sleeping snapshot with the exact retained pose and finish',()=>{
  const world=new RAPIER.World({x:0,y:-20.32,z:0}),driver=createSourceDroppedWeaponPhysics(world),original=driver.create({...spawn('vandal'),sleeping:true,magazineVisible:false,sourceWeaponFinish:{weapon:'vandal',paintKitId:282,seed:37,wear:.2}});driver.clear();const restored=driver.create(original);expect(restored).toEqual(original);driver.dispose();world.free();
 });
 it('interpolates real rotation and preserves the exact finish/bodygroup identity',()=>{
  const world=new RAPIER.World({x:0,y:0,z:0}),driver=createSourceDroppedWeaponPhysics(world);
  const a=driver.create({...spawn('vandal'),sourceWeaponFinish:{weapon:'vandal',paintKitId:282,seed:121,wear:.2},magazineVisible:false});
  const b={...structuredClone(a),position:[2,4,6]as[number,number,number],quaternion:a.quaternion.map(v=>-v)as[number,number,number,number]};
  const half=interpolateSourceDroppedWeapon(a,b,.5);expect(half.position).toEqual([1,3,3]);expect(half.sourceWeaponFinish).toEqual(a.sourceWeaponFinish);expect(half.magazineVisible).toBe(false);
  expect(new T.Quaternion().fromArray(half.quaternion).angleTo(new T.Quaternion().fromArray(a.quaternion))).toBeLessThan(1e-7);
  const previous={position:[0,0,0]as[number,number,number],quaternion:[0,0,0,1]as[number,number,number,number]},current={...previous,quaternion:new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),.2).toArray()};
  expect(sourceDroppedWeaponAngularVelocity(previous,current,.1)[1]).toBeCloseTo(2,10);expect(sourceDroppedWeaponAngularVelocity(previous,{...current,quaternion:current.quaternion.map(v=>-v)as[number,number,number,number]},.1)[1]).toBeCloseTo(2,10);driver.dispose();world.free();
 });
});

describe('death release from actual original GLB hand bones',()=>{
 it.each(['character-ak','character-ct-ak','character-t-m4','character-ct-m4'])('%s keeps the death model in the living weapon_hand_R frame',async folder=>{
  const fixture=await loadCharacterCpuFixture(`public/source/csgo-12426148/${folder}`),data=parseSourceRagdollData(JSON.parse(readFileSync('public/source/csgo-12426148/ragdoll/ragdoll-data.json','utf8'))),index=bindSourceRagdoll(data,fixture.poseIndex),driver=createSourceRagdollPoseDriver(createSourcePoseDriver(fixture.poseIndex,fixture.manifest.poseVersion),fixture.poseIndex,data);
  const owner=createSourceCharacterActors(fixture.gltf,fixture.poseIndex,fixture.weapon,fixture.weaponBytes,fixture.manifest,index),actor=owner.createActor(),handId=fixture.weapon.bones.findIndex(b=>b.name==='weapon_hand_R');expect(handId).toBeGreaterThan(0);
  for(const state of ['Idle','Run','Crouch_Idle']as const)for(const yaw of [-1.4,.4,2.7]){
   const player={id:'victim',x:3,y:.7,z:-8,yaw,sourceContract:'csgo-player-12426148'as const,sourcePoseVersion:fixture.manifest.poseVersion,sourcePose:{state,cycle:.45,parameters:{move_x:state==='Run'?1:0,move_y:0,body_yaw:20,body_pitch:-15},blendMode:'sdk-3way'as const}};
   owner.updateActor(actor,player);const hand=actor.weaponBones[handId].matrixWorld,pose=sourceDroppedWeaponPoseFromRest(index,driver.ragdoll!.capturePose(player),player);
   const drop=new T.Matrix4().compose(new T.Vector3().fromArray(pose.position),new T.Quaternion().fromArray(pose.quaternion),new T.Vector3(1,1,1)).multiply(new T.Matrix4().makeRotationX(-Math.PI/2)).multiply(new T.Matrix4().makeScale(.0254,.0254,.0254));
   // A root-only match is inadequate: three independent points detect both a
   // wrong handedness and double rotation/scale. Expected is the actual live
   // GLB world bone, not another call to the authoritative pose conversion.
   for(const p of [[0,0,0],[23,-1,6],[-13,2,-5]])expect(new T.Vector3().fromArray(p).applyMatrix4(drop).distanceTo(new T.Vector3().fromArray(p).applyMatrix4(hand))).toBeLessThan(1e-6);
  }
  const gunMeshes:T.SkinnedMesh[]=[],bodyMeshes:T.SkinnedMesh[]=[];actor.model.traverse(o=>{if(o instanceof T.SkinnedMesh)(o.skeleton.bones.some(b=>actor.weaponBones.includes(b))?gunMeshes:bodyMeshes).push(o);});
  expect(gunMeshes.length).toBeGreaterThan(0);expect(bodyMeshes.length).toBeGreaterThan(0);
  const worldBefore=gunMeshes.map(m=>m.matrixWorld.clone());if(actor.magazine)actor.magazine.visible=false;
  const count=setSourceHeldWeaponVisible(actor,false);actor.root.updateMatrixWorld(true);expect(count).toBe(gunMeshes.length);
  const effectiveVisible=(o:T.Object3D):boolean=>o.visible&&(!o.parent||effectiveVisible(o.parent));
  expect(gunMeshes.every(m=>!effectiveVisible(m))).toBe(true);expect(bodyMeshes.every(effectiveVisible)).toBe(true);
  gunMeshes.forEach((m,i)=>expect(m.matrixWorld.elements).toEqual(worldBefore[i].elements));setSourceHeldWeaponVisible(actor,true);
  expect(gunMeshes.filter(m=>m!==actor.magazine).every(effectiveVisible)).toBe(true);if(actor.magazine)expect(actor.magazine.visible).toBe(false);
  owner.dispose();
 });
});
