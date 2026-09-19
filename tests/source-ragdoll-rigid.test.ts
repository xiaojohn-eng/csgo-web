import {beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import * as T from 'three';
import {loadCharacterCpuFixture} from '../scripts/validate-source-character-actor';
import {sourceCorpseMeshVertices,sourceCorpseEdgeStrain} from '../scripts/diagnose-source-ragdoll-rigid';
import {createSourceCharacterActors} from '../game/source-character';
import {createSourcePoseDriver} from '../game/source-player-contract';
import {bindSourceRagdoll,computeSourceRagdollRest,computeSourceRagdollRestFromDeath1,createSourceRagdollPoseDriver,
  interpolateSourceRagdollState,parseSourceRagdollData,sourceRagdollRestWorldMatrices,sourceRagdollBoneMatrices,
  sourceRagdollVelocityFromWorld,type SourceRagdollState} from '../game/source-ragdoll';
import {createSourceRigidRagdoll,sourceRagdollWorldBasis} from '../game/source-ragdoll-rigid';
import {loadServerSourceMap} from '../server/source-map-data';
import {createSourceLevel} from '../game/source-level';
import {createSourceDroppedWeaponPhysics,type SourceDroppedWeaponSpawn} from '../game/source-dropped-weapons';
import deathDropContact from './fixtures/source-death-drop-contact.json';

describe('complete rigid corpses on the original skinned character',()=>{
  let fixture:Awaited<ReturnType<typeof loadCharacterCpuFixture>>;
  const data=()=>parseSourceRagdollData(JSON.parse(readFileSync('public/source/csgo-12426148/ragdoll/ragdoll-data.json','utf8')));
  beforeAll(async()=>{await RAPIER.init();fixture=await loadCharacterCpuFixture();});
  const setup=(state:'Idle'|'Run'|'Crouch_Idle')=>{
    const index=bindSourceRagdoll(data(),fixture.poseIndex),driver=createSourceRagdollPoseDriver(createSourcePoseDriver(fixture.poseIndex,fixture.manifest.poseVersion),fixture.poseIndex,data());
    const owner=createSourceCharacterActors(fixture.gltf,fixture.poseIndex,fixture.weapon,fixture.weaponBytes,fixture.manifest,index),actor=owner.createActor();
    const player={id:'body',x:0,y:0,z:0,yaw:-Math.PI/2,sourceContract:'csgo-player-12426148'as const,sourcePoseVersion:fixture.manifest.poseVersion,
      sourcePose:{state,cycle:.45,parameters:{move_x:state==='Run'?1:0,move_y:0,body_yaw:20,body_pitch:-15},blendMode:'sdk-3way'as const}};
    owner.updateActor(actor,player);
    return{index,driver,owner,actor,player};
  };
  it.each(['Idle','Run','Crouch_Idle']as const)('%s inherits every skinned vertex from the living pose without a Death1 pop',state=>{
    const{driver,owner,actor,player}=setup(state);
    const before=sourceCorpseMeshVertices(actor.root),rest=driver.ragdoll!.capturePose(player);
    const corpse=driver.ragdoll!.beginRagdoll(player,{x:0,y:0,z:0},{x:170,y:0,z:42.5},undefined,rest);
    expect(corpse.quaternions).toHaveLength(64);expect(corpse.restPose?.positions).toHaveLength(71*3);
    owner.updateActor(actor,{...player,sourceRagdoll:corpse});const after=sourceCorpseMeshVertices(actor.root);
    let max=0;for(let m=0;m<before.length;m++)for(let v=0;v<before[m].vertices.length;v++)max=Math.max(max,before[m].vertices[v].distanceTo(after[m].vertices[v]));
    expect(before.reduce((n,m)=>n+m.vertices.length,0)).toBe(7059);
    expect(max).toBeLessThan(1e-5);
    driver.ragdoll!.endRagdoll(player);owner.dispose();
  });
  it.each(['Idle','Run','Crouch_Idle']as const)('%s preserves hip width and bounds actual triangle stretching through the fall',state=>{
    const{driver,index,owner,actor,player}=setup(state),before=sourceCorpseMeshVertices(actor.root),restPose=driver.ragdoll!.capturePose(player);
    const rest=computeSourceRagdollRest(index,sourceRagdollRestWorldMatrices(index,restPose));
    const width=Math.hypot(...[0,1,2].map(k=>rest.positions[3*3+k]-rest.positions[1*3+k]));
    let corpse=driver.ragdoll!.beginRagdoll(player,{x:0,y:0,z:0},{x:170,y:0,z:42.5},undefined,restPose),ticks=0;
    while(!corpse.settled&&ticks<600){
      corpse=driver.ragdoll!.stepRagdoll(player,1/60)!;ticks++;
      const liveWidth=Math.hypot(...[0,1,2].map(k=>corpse.positions[3*3+k]-corpse.positions[1*3+k]));
      // The old fixed evidence collapsed these two hips to 0.017 Source units.
      expect(Math.abs(liveWidth-width),`${state} tick ${ticks} hip width`).toBeLessThan(.35);
      if(ticks%10===0||corpse.settled){
        owner.updateActor(actor,{...player,sourceRagdoll:corpse});
        const strain=sourceCorpseEdgeStrain(before,sourceCorpseMeshVertices(actor.root));
        // Real GLB positions, indices, weights and inverse binds. Archived broken
        // corpse p99=5.89 and max=132; mere finite joints did not detect it.
        expect(strain.edges).toBeGreaterThan(33000);expect(strain.p99).toBeLessThan(2);
      }
    }
    expect(corpse.settled).toBe(true);expect(ticks).toBeLessThan(300);
    driver.ragdoll!.endRagdoll(player);owner.dispose();
  });
  it('preserves every vertex under a global rotation, including twist that positions cannot encode',()=>{
    const{driver,index,owner,actor,player}=setup('Run'),before=sourceCorpseMeshVertices(actor.root),restPose=driver.ragdoll!.capturePose(player);
    const rest=computeSourceRagdollRest(index,sourceRagdollRestWorldMatrices(index,restPose)),turn=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,2,3).normalize(),1.7);
    const positions:number[]=[],quaternions:number[]=[];
    for(let i=0;i<16;i++){positions.push(...new T.Vector3().fromArray(rest.positions,i*3).applyQuaternion(turn).toArray());quaternions.push(...turn.clone().multiply(new T.Quaternion().fromArray(rest.quaternions,i*4)).toArray());}
    owner.updateActor(actor,{...player,sourceRagdoll:{positions,quaternions,restPose,settled:true}});
    const after=sourceCorpseMeshVertices(actor.root),basis=sourceRagdollWorldBasis(),worldTurn=basis.clone().multiply(turn).multiply(basis.clone().invert());
    let max=0;for(let m=0;m<before.length;m++)for(let v=0;v<before[m].vertices.length;v++)max=Math.max(max,before[m].vertices[v].clone().applyQuaternion(worldTurn).distanceTo(after[m].vertices[v]));
    expect(max).toBeLessThan(1e-6);expect(sourceCorpseEdgeStrain(before,after).p99).toBeCloseTo(1,6);owner.dispose();
  });
  it('reads the shared authority world without stepping it and releases every owned rigid body',()=>{
    const{driver,owner,player}=setup('Idle'),world=new RAPIER.World({x:0,y:-20.32,z:0});
    const ground={x:0,y:0,z:0,yaw:player.yaw,metersPerSourceUnit:.0254,surfaceY:()=>0,physicsWorld:world};
    const rest=driver.ragdoll!.capturePose(player),first=driver.ragdoll!.beginRagdoll(player,{x:0,y:0,z:0},{x:100,y:0,z:0},ground,rest);
    expect(world.bodies.len()).toBe(16);expect(driver.ragdoll!.stepRagdoll(player,1/60)!.positions).toEqual(first.positions);
    world.timestep=1/60;world.step();expect(driver.ragdoll!.stepRagdoll(player,1/60)!.positions).not.toEqual(first.positions);
    driver.ragdoll!.endRagdoll(player);expect(world.bodies.len()).toBe(0);expect(world.impulseJoints.len()).toBe(0);world.free();owner.dispose();
  });
  it('resumes a settled snapshot when another contact wakes the shared world body',()=>{
    const{driver,owner,player}=setup('Idle'),world=new RAPIER.World({x:0,y:-20.32,z:0});
    world.createCollider(RAPIER.ColliderDesc.cuboid(20,.5,20).setTranslation(0,-.5,0));
    const ground={x:0,y:.05,z:0,yaw:player.yaw,metersPerSourceUnit:.0254,surfaceY:()=>0,physicsWorld:world};
    driver.ragdoll!.beginRagdoll(player,{x:0,y:0,z:0},{x:0,y:0,z:0},ground,driver.ragdoll!.capturePose(player));
    let state:SourceRagdollState|undefined;world.timestep=1/60;
    for(let i=0;i<600;i++){world.step();state=driver.ragdoll!.stepRagdoll(player,1/60)!;if(state.settled)break;}
    expect(state?.settled).toBe(true);const asleep=structuredClone(state!);
    world.bodies.forEach(body=>body.setLinvel({x:1,y:1,z:0},true));world.step();
    const awake=driver.ragdoll!.stepRagdoll(player,1/60)!;
    expect(awake.settled).toBe(false);expect(awake.positions).not.toEqual(asleep.positions);
    driver.ragdoll!.endRagdoll(player);world.free();owner.dispose();
  });

  it.each(['mixed','120','60'] as const)('settles the actual Dust II death/drop contact at %s Hz without distorting the skin',async mode=>{
    const {index,owner,actor,player}=setup('Idle');
    const map=await loadServerSourceMap('public/source/csgo-12426148/dust2/manifest.json');
    const world=new RAPIER.World({x:0,y:-20.32,z:0}),level=createSourceLevel(world,map.level,map.collision);
    world.step();const baseline=world.bodies.len(),drops=createSourceDroppedWeaponPhysics(world);
    drops.create(deathDropContact.drop as SourceDroppedWeaponSpawn);
    const ground={...deathDropContact.origin,physicsWorld:world,metersPerSourceUnit:.0254,surfaceY:level.groundHeight};
    const dx=ground.x-deathDropContact.shooter.x,dz=ground.z-deathDropContact.shooter.z,length=Math.hypot(dx,dz);
    const restPose=deathDropContact.restPose,rest=computeSourceRagdollRest(index,sourceRagdollRestWorldMatrices(index,restPose));
    const rigid=createSourceRigidRagdoll(index,rest,{x:0,y:0,z:0},sourceRagdollVelocityFromWorld(ground,{x:dx/length*260*.0254,y:65*.0254,z:dz/length*260*.0254}),ground);
    let state=rigid.read(0),tick=0;
    owner.updateActor(actor,{...player,...ground,sourceRagdoll:{...state,restPose}});
    const before=sourceCorpseMeshVertices(actor.root);
    try {
      // Match Simulation's read-before-step order and switch back to 60 Hz
      // when the original independent dropped weapon sleeps.
      for(;tick<600;tick++){
        state=rigid.read(1/60);
        const substeps=mode==='120'||mode==='mixed'&&drops.read().some(d=>!d.sleeping)?2:1;
        world.timestep=1/60/substeps;for(let j=0;j<substeps;j++)world.step();drops.afterStep(1/60);
        if(tick%15===0||state.settled){
          owner.updateActor(actor,{...player,...ground,sourceRagdoll:{...state,restPose}});
          expect(sourceCorpseEdgeStrain(before,sourceCorpseMeshVertices(actor.root)).p99).toBeLessThan(2);
        }
        if(state.settled&&drops.read()[0].sleeping)break;
      }
      expect(state.settled).toBe(true);expect(drops.read()[0].sleeping).toBe(true);expect(tick).toBeLessThan(600);
      const resting=structuredClone(state);
      for(let i=0;i<120;i++){world.step();state=rigid.read(1/60);}
      expect(state).toEqual(resting);
    }finally{rigid.dispose();drops.dispose();expect(world.bodies.len()).toBe(baseline);level.dispose();world.free();owner.dispose();}
  });
  it('does not confuse self contact or a paused airborne transform with external support',()=>{
    const {index,driver,owner,player}=setup('Idle'),world=new RAPIER.World({x:0,y:-20.32,z:0});
    const rest=computeSourceRagdollRest(index,sourceRagdollRestWorldMatrices(index,driver.ragdoll!.capturePose(player)));
    const rigid=createSourceRigidRagdoll(index,rest,{x:0,y:0,z:0},{x:0,y:0,z:0},{x:0,y:100,z:0,yaw:player.yaw,metersPerSourceUnit:.0254,physicsWorld:world,surfaceY:()=>null});
    try{
      for(let i=0;i<120;i++)expect(rigid.read(1/60).settled).toBe(false);
      for(let i=0;i<120;i++){world.step();expect(rigid.read(1/60).settled).toBe(false);}
    }finally{rigid.dispose();world.free();owner.dispose();}
  });

  it('legacy chain rotation really maps 90 and 180 degrees instead of overshooting',()=>{
    const index=bindSourceRagdoll(data(),fixture.poseIndex),{rest}=computeSourceRagdollRestFromDeath1(index,fixture.poseIndex);
    const direction=new T.Vector3().fromArray(rest.chainDirections),axis=new T.Vector3(1,2,3).cross(direction).normalize();
    for(const angle of [Math.PI/2,Math.PI]){
      const turn=new T.Quaternion().setFromAxisAngle(axis,angle),positions=rest.positions.slice();
      for(let i=0;i<16;i++)positions.set(new T.Vector3().fromArray(rest.positions,i*3).applyQuaternion(turn).toArray(),i*3);
      const matrix=sourceRagdollBoneMatrices(index,positions,rest,new Float64Array(16*16));
      const result=new T.Vector3().fromArray(rest.chainLocal).transformDirection(new T.Matrix4().fromArray(matrix));
      expect(result.distanceTo(direction.clone().applyQuaternion(turn))).toBeLessThan(1e-6);
    }
  });
  it('converts world death velocity through the actor yaw and interpolates quaternion antipodes',()=>{
    for(const yaw of [0,Math.PI/2,-.72]){
      const ground={x:0,y:0,z:0,yaw,metersPerSourceUnit:.0254,surfaceY:()=>0},world=new T.Vector3(3,2,-4);
      const local=sourceRagdollVelocityFromWorld(ground,world);
      expect(local.multiplyScalar(.0254).applyQuaternion(sourceRagdollWorldBasis(ground)).distanceTo(world)).toBeLessThan(1e-10);
    }
    const q=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),1.2).toArray();
    const a:SourceRagdollState={positions:[0,0,0],quaternions:q,settled:false,restPose:{positions:[0,0,0],quaternions:[0,0,0,1]}};
    const b={...structuredClone(a),positions:[10,2,4],quaternions:q.map(v=>-v),settled:true};
    const half=interpolateSourceRagdollState(a,b,.5);expect(half.positions).toEqual([5,1,2]);expect(half.restPose).toEqual(a.restPose);
    expect(new T.Quaternion().fromArray(half.quaternions!).angleTo(new T.Quaternion().fromArray(q))).toBeLessThan(1e-7);
    expect(half.settled).toBe(false);expect(interpolateSourceRagdollState(a,b,1).settled).toBe(true);
  });
});
