import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {createSourceLevel,type SourceLevelData} from '../game/source-level';
import type {SourceMapCollisionData} from '../game/source-map-collision';
import {GameAssets} from '../game/assets';
import type {Player} from '../game/types';
import { loadCharacterCpuFixture } from '../scripts/validate-source-character-actor';
import { createSourceCharacterActors, type SourceCharacterPlayer } from '../game/source-character';
import { parseSourceIKRules } from '../game/source-ik-rules';
import { prepareSourceCharacterPose, sourceSequenceBlend,
  type SourceCharacterPoseIndex } from '../game/source-character-pose';
import { applySourceFootIK, sourceBoneWorldRotation, sourceFootIKChains, sourceFootIKRule, sourceFootIKTeam,
  solveSourceFootChain, type SourceFootIKGround } from '../game/source-foot-ik';

const available = existsSync('public/source/csgo-12426148/ik/ik-rules.json');
const rules = () => parseSourceIKRules(JSON.parse(readFileSync('public/source/csgo-12426148/ik/ik-rules.json', 'utf8')));
const PARAMETERS = { move_x: 1, move_y: 0 };
/** The original right foot is planted at cycle .45 and the left foot at .95; the
 * planted foot sits under the actor's own origin (which the original model
 * stands on), so the unit's step edge is placed just beside it. */
const STEP_X = 9.95;

describe.skipIf(!available)('original player foot IK', () => {
  let fixture: Awaited<ReturnType<typeof loadCharacterCpuFixture>>;
  beforeAll(async () => { fixture = await loadCharacterCpuFixture(); });
  const index = () => fixture.poseIndex as SourceCharacterPoseIndex;
  const poseOf = (bones: readonly T.Bone[]) => bones.map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()]);
  const worstDifference = (a: number[][], b: number[][]) => Math.max(...a.map((row, i) => Math.max(...row.map((v, k) => Math.abs(v - b[i][k])))));
  const actorFor = (cycle: number) => {
    const owner = createSourceCharacterActors(fixture.gltf, fixture.poseIndex, fixture.weapon, fixture.weaponBytes, fixture.manifest);
    const actor = owner.createActor();
    const player: SourceCharacterPlayer = { x: 10, y: 2, z: -15, yaw: .2, sourceContract: 'csgo-player-12426148',
      sourcePoseVersion: fixture.manifest.poseVersion,
      sourcePose: { state: 'Run', cycle, parameters: PARAMETERS, fireWeight: 0, fireTimeSeconds: 9, fireCycle: 1 } };
    owner.updateActor(actor, player);
    actor.root.updateMatrixWorld(true);
    return { owner, actor };
  };
  const ik = (actor: { characterBones: T.Bone[] }, ground: SourceFootIKGround, cycle: number, groundNormal?: (x:number,z:number,fromY:number)=>{x:number;y:number;z:number}|null) => applySourceFootIK({
    index: index(), bones: actor.characterBones, rules: rules(), origin: { x: 10, y: 2, z: -15 },
    metersPerSourceUnit: fixture.manifest.metersPerSourceUnit, ground, groundNormal, state: 'Run', cycle, parameters: PARAMETERS });
  const stepHeight = () => 18 * fixture.manifest.metersPerSourceUnit;

  it('resolves exactly the original foot chains to this rig', () => {
    const team = sourceFootIKTeam(index()), chains = sourceFootIKChains(index(), rules(), team);
    expect(team).toBe('t');
    expect(chains.map(c => c.name)).toEqual(['rfoot', 'lfoot']);
    for (const chain of chains) {
      expect(index().data.mainBones[chain.hip].name).toMatch(/_Thigh$/);
      expect(index().data.mainBones[chain.knee].name).toMatch(/_Calf$/);
      expect(index().data.mainBones[chain.foot].name).toMatch(/_Foot$/);
    }
  });
  it('repeated authority poses do not accumulate the visual slope solve across render frames',()=>{
    const {owner,actor}=actorFor(.45);
    const player={id:'fixture',alive:true,x:10,y:2,z:-15,yaw:.2,sourceContract:'csgo-player-12426148',sourcePoseVersion:fixture.manifest.poseVersion,
      sourcePose:{state:'Run',cycle:.45,parameters:PARAMETERS,fireWeight:0,fireTimeSeconds:9,fireCycle:1}} as Player;
    const normal=new T.Vector3(.25,1,-.2).normalize();
    const assets=Object.assign(Object.create(GameAssets.prototype),{sourceAWPActors:new Map(),sourceDeagleActors:new Map(),sourcePistolActors:new Map(),
      sourceActors:new Map([[actor.root,{owner:{...owner,manifest:fixture.manifest},actor}]]),sourceFootRest:new WeakMap(),footIKRules:rules(),
      resolveGround:(x:number)=>x<STEP_X?2.1:2,resolveGroundNormal:()=>normal}) as GameAssets;
    assets.animateOperator(actor.root,player,0);const first=poseOf(actor.characterBones);
    for(let frame=0;frame<60;frame++)assets.animateOperator(actor.root,player,1/60);
    expect(worstDifference(first,poseOf(actor.characterBones))).toBe(0);
    owner.dispose();
  });

  it('blends the original per-animation ground rules by the weights the pose was built from', () => {
    const blend = sourceSequenceBlend(index(), index().data.states.Run.lower, .45, PARAMETERS);
    expect(blend.reduce((sum, b) => sum + b.weight, 0)).toBeCloseTo(1, 12);
    const names = blend.map(b => index().frames.get(b.animationIndex)!.descriptor.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.some(name => name.startsWith('a_Run'))).toBe(true);
    const team = sourceFootIKTeam(index());
    const right = sourceFootIKRule(index(), rules(), team, blend, 2, .45);
    expect(right.envelope).toBe(1);
    expect(right.height).toBeCloseTo(18, 6); expect(right.radius).toBeCloseTo(2.5, 6);
    expect(right.contact).toBeCloseTo(.45, 6);
    // The other foot is in its swing half at this cycle, and a cycle outside
    // every window has no influence at all.
    expect(sourceFootIKRule(index(), rules(), team, blend, 3, .45).envelope).toBe(0);
    expect(sourceFootIKRule(index(), rules(), team, blend, 2, .05).envelope).toBe(0);
    expect(sourceFootIKRule(index(), rules(), team, blend, 3, .95).envelope).toBe(1);
  });

  it('leaves the animation untouched on flat ground, with no surface and outside the window', () => {
    const { owner, actor } = actorFor(.45);
    const before = poseOf(actor.characterBones);
    const flat = ik(actor, () => 2, .45);
    expect(flat.chains).toHaveLength(2);
    expect(flat.applied).toBe(1); expect(flat.moved).toBe(0);
    expect(flat.chains.every(c => c.delta === 0)).toBe(true);
    expect(worstDifference(before, poseOf(actor.characterBones))).toBe(0);
    expect(ik(actor, () => null, .45).moved).toBe(0);
    // Cycle .05 is outside the original right foot window [.35, .55].
    const outside = ik(actor, (x) => (x < STEP_X ? 2.3 : 2), .05);
    expect(outside.applied).toBe(0); expect(outside.moved).toBe(0);
    expect(worstDifference(before, poseOf(actor.characterBones))).toBe(0);
    owner.dispose();
  });

  it('aligns a planted sole to the original world normal without changing bone length or the swing foot', () => {
    const {owner,actor}=actorFor(.45),chains=sourceFootIKChains(index(),rules(),sourceFootIKTeam(index())),right=chains.find(c=>c.chain===2)!,left=chains.find(c=>c.chain===3)!;
    const foot=actor.characterBones[right.foot],swing=actor.characterBones[left.foot];
    const position=foot.getWorldPosition(new T.Vector3()),before=sourceBoneWorldRotation(foot),swingBefore=sourceBoneWorldRotation(swing);
    const normal=new T.Vector3(.25,1,-.2).normalize(),result=ik(actor,()=>2,.45,()=>normal);
    expect(result.chains.find(c=>c.chain===2)!.normalAligned).toBe(true);
    expect(result.chains.find(c=>c.chain===3)!.normalAligned).toBeUndefined();
    const delta=sourceBoneWorldRotation(foot).multiply(before.clone().invert());
    expect(new T.Vector3(0,1,0).applyQuaternion(delta).distanceTo(normal)).toBeLessThan(1e-6);
    expect(foot.getWorldPosition(new T.Vector3()).distanceTo(position)).toBeLessThan(1e-9);
    expect(sourceBoneWorldRotation(swing).angleTo(swingBefore)).toBeLessThan(1e-7);
    owner.dispose();
  });
  it('preserves the flat-ground pose and refuses invalid or wall normals', () => {
    for(const normal of [{x:0,y:1,z:0},{x:1,y:0,z:0},{x:NaN,y:1,z:0}]){
      const {owner,actor}=actorFor(.45),before=poseOf(actor.characterBones),result=ik(actor,()=>2,.45,()=>normal);
      expect(result.moved).toBe(0);expect(worstDifference(before,poseOf(actor.characterBones))).toBe(0);owner.dispose();
    }
  });

  it('lifts the planted foot onto a step by the original windowed amount', () => {
    const { owner, actor } = actorFor(.95);
    const chain = sourceFootIKChains(index(), rules(), sourceFootIKTeam(index())).find(c => c.chain === 3)!;
    const before = poseOf(actor.characterBones);
    const hip = new T.Vector3().setFromMatrixPosition(actor.characterBones[chain.hip].matrixWorld);
    const knee = new T.Vector3().setFromMatrixPosition(actor.characterBones[chain.knee].matrixWorld);
    const foot = new T.Vector3().setFromMatrixPosition(actor.characterBones[chain.foot].matrixWorld);
    const upper = knee.distanceTo(hip), lower = foot.distanceTo(knee);
    const footRotation = sourceBoneWorldRotation(actor.characterBones[chain.foot]);
    const kneeRotation = sourceBoneWorldRotation(actor.characterBones[chain.knee]);
    // The actor's own column is the low floor; its planted left foot is over the
    // higher tread.
    const result = ik(actor, (x) => (x < STEP_X ? 2.3 : 2), .95);
    const measured = result.chains.find(c => c.chain === 3)!;
    expect(measured.envelope).toBe(1);
    expect(measured.delta).toBeCloseTo(.3, 9);
    expect(result.moved).toBe(1);
    actor.root.updateMatrixWorld(true);
    const hipAfter = new T.Vector3().setFromMatrixPosition(actor.characterBones[chain.hip].matrixWorld);
    const kneeAfter = new T.Vector3().setFromMatrixPosition(actor.characterBones[chain.knee].matrixWorld);
    const footAfter = new T.Vector3().setFromMatrixPosition(actor.characterBones[chain.foot].matrixWorld);
    // The hip is the chain root and stays put, the original bone lengths survive,
    // and the foot really moved up by the rule's windowed share of the step.
    expect(hipAfter.distanceTo(hip)).toBeLessThan(1e-9);
    expect(kneeAfter.distanceTo(hipAfter)).toBeCloseTo(upper, 9);
    expect(footAfter.distanceTo(kneeAfter)).toBeCloseTo(lower, 9);
    expect(footAfter.y - foot.y).toBeCloseTo(measured.delta, 6);
    expect(Math.abs(footAfter.x - foot.x) + Math.abs(footAfter.z - foot.z)).toBeLessThan(1e-6);
    // Only the leg chain moved, and the foot keeps its animated world orientation.
    const after = poseOf(actor.characterBones);
    const footRotationAfter = sourceBoneWorldRotation(actor.characterBones[chain.foot]);
    // The actor's world matrices carry the GLB's float32 bind data, so the
    // restoration is exact to float precision rather than to the bit.
    expect(footRotationAfter.angleTo(footRotation)).toBeLessThan(1e-7);
    // ... while the leg chain above it really did rotate.
    const kneeTurn = sourceBoneWorldRotation(actor.characterBones[chain.knee]).angleTo(kneeRotation);
    expect(kneeTurn + footRotationAfter.angleTo(footRotation)).toBeGreaterThan(.05);
    expect(worstDifference([after[chain.hip]], [before[chain.hip]])).toBeGreaterThan(1e-6);
    const untouched = index().data.mainBones.map((_, i) => i).filter(i => i !== chain.hip && i !== chain.knee && i !== chain.foot);
    expect(worstDifference(untouched.map(i => after[i]), untouched.map(i => before[i]))).toBe(0);
    owner.dispose();
  });

  it('never moves a foot further than the original step height, up or down', () => {
    const { owner, actor } = actorFor(.95);
    const chain = sourceFootIKChains(index(), rules(), sourceFootIKTeam(index())).find(c => c.chain === 3)!;
    const high = ik(actor, (x) => (x < STEP_X ? 40 : 2), .95);
    expect(high.chains.find(c => c.chain === 3)!.delta).toBeCloseTo(stepHeight(), 9);
    actor.root.updateMatrixWorld(true);
    const foot = new T.Vector3().setFromMatrixPosition(actor.characterBones[chain.foot].matrixWorld);
    const down = ik(actor, (x) => (x < STEP_X ? -20 : 2), .95);
    expect(down.chains.find(c => c.chain === 3)!.delta).toBeCloseTo(-stepHeight(), 9);
    actor.root.updateMatrixWorld(true);
    const dropped = new T.Vector3().setFromMatrixPosition(actor.characterBones[chain.foot].matrixWorld);
    expect(dropped.y - foot.y).toBeCloseTo(-stepHeight(), 6);
    owner.dispose();
  });

  it('resolves the same original foot chains on the pistol body rig', () => {
    // Every original weapon family shares one body rig and one rule set, so the
    // same rules must resolve on the pistol/deagle/AWP body pose data too.
    const folder = 'public/source/csgo-12426148/character-t-glock/';
    const data = JSON.parse(readFileSync(folder + 'body-pose-data.json', 'utf8'));
    const raw = readFileSync(folder + 'body-frames.f64.bin');
    const index = prepareSourceCharacterPose(data, new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
    expect(index.data.states.Run.lower).toBeDefined();
    const chains = sourceFootIKChains(index, rules(), sourceFootIKTeam(index));
    expect(chains.map(c => c.name)).toEqual(['rfoot', 'lfoot']);
    expect(chains.map(c => index.data.mainBones[c.foot].name)).toEqual(['ValveBiped.Bip01_R_Foot', 'ValveBiped.Bip01_L_Foot']);
  });


  it('removes original Dust II slope hull clearance at actual T and CT shoe vertices',async()=>{
    await RAPIER.init();
    const read=(path:string)=>JSON.parse(readFileSync('public/source/csgo-12426148/'+path,'utf8'));
    const data=read('dust2/level.json') as SourceLevelData;
    const world=new RAPIER.World({x:0,y:-data.player.gravity,z:0});
    const level=createSourceLevel(world,data,read('dust2/collision.json') as SourceMapCollisionData);world.step();
    try{for(const spec of [
      {folder:'character-ak',x:-6.35,y:1.3941250604629518,z:21.2725,yaw:1.5598542353235565,reachLimited:false},
      {folder:'character-ct-ak',x:37.465,y:2.1620472644805906,z:-67.31,yaw:-.2001902923987422,reachLimited:true},
    ]){
      const fixture=await loadCharacterCpuFixture('public/source/csgo-12426148/'+spec.folder);
      const owner=createSourceCharacterActors(fixture.gltf,fixture.poseIndex,fixture.weapon,fixture.weaponBytes,fixture.manifest),actor=owner.createActor();
      try{
        const player:SourceCharacterPlayer={...spec,sourceContract:'csgo-player-12426148',sourcePoseVersion:fixture.manifest.poseVersion,
          sourcePose:{state:'Run',cycle:.45,parameters:{move_x:1,move_y:0,body_yaw:0,body_pitch:0},fireWeight:0,fireTimeSeconds:9,fireCycle:1,blendMode:'sdk-3way'}};
        owner.updateActor(actor,player);actor.root.updateMatrixWorld(true);
        const chains=sourceFootIKChains(fixture.poseIndex,rules(),sourceFootIKTeam(fixture.poseIndex));
        const right=chains.find(c=>c.chain===2)!,before=poseOf(actor.characterBones);
        const hip=actor.characterBones[right.hip],knee=actor.characterBones[right.knee],foot=actor.characterBones[right.foot];
        const position=(b:T.Bone)=>b.getWorldPosition(new T.Vector3());
        const lengths=[position(hip).distanceTo(position(knee)),position(knee).distanceTo(position(foot))];
        const ground=(x:number,z:number,y:number)=>level.groundHeight(x,z,y);
        const normal=(x:number,z:number,y:number)=>{const h=level.traceBullet(x,y,z,0,-1,0,512,'projectile');return h?{x:h.nx,y:h.ny,z:h.nz}:null;};
        // The original collision AABB stands on a high corner of the slope;
        // the original authored foot remains close to its model origin.
        expect(spec.y-ground(spec.x,spec.z,spec.y+.25)!).toBeGreaterThan(.10);
        const vertices:{mesh:T.SkinnedMesh;index:number}[]=[];
        actor.model.traverse(object=>{const mesh=object as T.SkinnedMesh;if(!mesh.isSkinnedMesh)return;
          let visible=true;for(let node:T.Object3D|null=mesh;node;node=node.parent)visible&&=node.visible;if(!visible)return;
          const bone=mesh.skeleton.bones.indexOf(foot);if(bone<0)return;
          const indices=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
          for(let vertex=0;vertex<indices.count;vertex++){let weight=0;for(let ch=0;ch<4;ch++)if(indices.getComponent(vertex,ch)===bone)weight+=weights.getComponent(vertex,ch);
            if(weight>.5)vertices.push({mesh,index:vertex});}
        });
        expect(vertices.length).toBeGreaterThan(100);
        const minimum=(surface:boolean)=>Math.min(...vertices.map(({mesh,index})=>{
          mesh.skeleton.update();const v=mesh.getVertexPosition(index,new T.Vector3()).applyMatrix4(mesh.matrixWorld);
          return v.y-(surface?ground(v.x,v.z,v.y+.5)!:spec.y);
        }));
        expect(Math.abs(minimum(false))).toBeLessThan(.005);
        const result=applySourceFootIK({index:fixture.poseIndex,bones:actor.characterBones,rules:rules(),origin:spec,
          metersPerSourceUnit:.0254,ground,groundNormal:normal,...player.sourcePose!});
        const planted=result.chains.find(c=>c.chain===2)!;
        expect(!!planted.reachLimited).toBe(spec.reachLimited);
        expect(planted.actualDelta).toBeLessThan(-.10);
        // Actual deformed shoe geometry, not ankle-bone height or just normal.
        // CT retains the SDK reachable-target gap; no fabricated pelvis offset.
        expect(minimum(true)).toBeLessThan(.025);
        expect(minimum(true)).toBeGreaterThan(-.01);
        expect(position(hip).distanceTo(position(knee))).toBeCloseTo(lengths[0],9);
        expect(position(knee).distanceTo(position(foot))).toBeCloseTo(lengths[1],9);
        const after=poseOf(actor.characterBones),changed=new Set([right.hip,right.knee,right.foot]);
        for(let i=0;i<before.length;i++)if(!changed.has(i))expect(after[i]).toEqual(before[i]);
        expect(result.chains.find(c=>c.chain===3)!.envelope).toBe(0);
      }finally{owner.dispose();}
    }}finally{level.dispose();world.free();}
  },20000);

  it('clamps unreachable targets to the SDK reach interval without stretching bones', () => {
    // A synthetic chain exercises the SDK far clamp even on a very large drop.
    const rig = new T.Group();
    const hip = new T.Bone(); hip.position.set(0, .9, 0);
    const knee = new T.Bone(); knee.position.set(0, -.5, .25); hip.add(knee);
    const foot = new T.Bone(); foot.position.set(0, -.35, -.3); knee.add(foot);
    rig.add(hip); rig.updateMatrixWorld(true);
    const before = [hip, knee, foot].map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()]);
    const position = (bone: T.Bone) => new T.Vector3().setFromMatrixPosition(bone.matrixWorld);
    const oldHip=position(hip),oldKnee=position(knee),oldFoot=position(foot);
    const l1=oldHip.distanceTo(oldKnee),l2=oldKnee.distanceTo(oldFoot);
    const requested=oldFoot.clone().add(new T.Vector3(0,-2,0));
    const expected=requested.sub(oldHip).setLength((l1+l2)*.9998).add(oldHip);
    expect(solveSourceFootChain(hip, knee, foot, -2)).toBe(true);
    rig.updateMatrixWorld(true);
    expect(position(foot).distanceTo(expected)).toBeLessThan(1e-9);
    expect(position(knee).distanceTo(position(hip))).toBeCloseTo(l1,9);
    expect(position(foot).distanceTo(position(knee))).toBeCloseTo(l2,9);
    for(const [i,bone] of [hip,knee,foot].entries()){
      bone.position.fromArray(before[i]);bone.quaternion.fromArray(before[i],3);
    }
    rig.updateMatrixWorld(true);
    // A reachable target is solved exactly, keeping the original bone lengths.
    const upper = position(knee).distanceTo(position(hip)), lower = position(foot).distanceTo(position(knee));
    expect(solveSourceFootChain(hip, knee, foot, -.12)).toBe(true);
    rig.updateMatrixWorld(true);
    expect(position(knee).distanceTo(position(hip))).toBeCloseTo(upper, 9);
    expect(position(foot).distanceTo(position(knee))).toBeCloseTo(lower, 9);
    expect(position(foot).y).toBeCloseTo(.05 - .12, 9);
    expect(position(hip).distanceTo(new T.Vector3(0, .9, 0))).toBeLessThan(1e-9);
  });
});
