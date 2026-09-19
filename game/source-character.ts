import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { applySourceCharacterSurfaces, type SourceCharacterProfile } from './source-character-surfaces';
import { prepareSourceCharacterPose, sampleSourceCharacterPose, sourceSequenceCycleRate,
  type SourceCharacterPose, type SourceCharacterPoseIndex, type SourceCharacterPoseInput } from './source-character-pose';
import { bindSourceRagdoll, computeSourceRagdollRestFromDeath1, parseSourceRagdollData,
  sampleSourceRagdollPose, sampleSourceRagdollState, type SourceRagdollIndex } from './source-ragdoll';
import { sourceMagazineDropFromMesh, type SourceMagazineDropSource } from './source-magazine-drop';
import { loadSourceIKRules, type SourceIKRules } from './source-ik-rules';
import type { Player } from './types';
import { sourceSha256 } from './source-sha256';

export type SourceCharacterManifest = { format: 'source-character-stage-v1'; build: 12426148; poseVersion: string;
  characterProfile: SourceCharacterProfile; weaponId?: 'ak47' | 'm4a4'; bodyBoneCount: 71 | 74; animationBoneCount: 70 | 71;
  metersPerSourceUnit: number; actorYawOffsetRadians: number; model: string; poseData: string; poseFrames: string; weaponData: string; weaponFrames: string;
  files: Record<string, { bytes: number; sha256: string }>; characterBones: number; weaponBones: number; limitations: string[] };
type RigJoint = { bone: number; sourceName: string; gltfNode: number; skinJoint: number };
type RigMapping = { skinIndex: number; skinName: string; joints: RigJoint[] };
type WeaponBone = { name: string; parent: number; position: number[]; quaternion: number[]; inverseBindGltf: number[] };
type WeaponAnimation = { name: string; frames: number; fps: number; flags: number; sequenceFlags: number; boneWeights: number[];
  positionsOffset: number; positionsCount: number; quaternionsOffset: number; quaternionsCount: number };
export type SourceWorldWeaponData = { format: 'source-world-weapon-v1'; weaponId?: 'ak47' | 'm4a4'; sourceModel?: string; bones: WeaponBone[]; animations: WeaponAnimation[];
  frames: { byteLength: number; sha256: string }; boneMerge: { weaponBone: number; characterBone: number; name: string }[];
  rigMappings: { character: RigMapping; weapon: RigMapping };
  attachments: { name: string; parent_bone: number; matrix: number[] }[] };
export type SourceCharacterPlayer = Pick<Player, 'x' | 'y' | 'z' | 'yaw' | 'sourcePose' | 'sourcePoseVersion' | 'sourceContract'> &
  Partial<Pick<Player, 'sourceRagdoll' | 'grounded' | 'sourceGroundY'>>;
export type SourceCharacterActor = { root: T.Group; model: T.Object3D; characterBones: T.Bone[]; weaponBones: T.Bone[];
  sourceWeaponWorldMatrices: Float64Array; lastPose: SourceCharacterPose | null; status: 'awaiting-authority' | 'ready' | 'invalid-authority' | 'disposed';
  /** The world weapon's own magazine mesh, hidden while the original reload has
   * the magazine out of the weapon (AE_CL_EJECT_MAG .. AE_CL_EJECT_MAG_UNHIDE). */
  magazine: T.Mesh | null;
  /** Original magazine display state of the last sampled pose; null until the
   * first authoritative pose so a mid-reload first sight never fakes a drop. */
  magazineVisible: boolean | null;
  /** Where the original magazine prop rests: the shooter's own level, which
   * stays at their last grounded height if the reload happens mid-air. */
  magazineGroundY: number;
  magazineSeed: number;
  pendingMagazineDrop: SourceMagazineDropSource | null };
const C = new T.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1), one = new T.Vector3(1, 1, 1);
const PROFILES = {
  tm_leet_varianta: { body: 71, animation: 71, main: 'models/player/tm_leet_varianta.mdl', animationModel: 'models/player/t_animations.mdl',
    versionPrefix: 'csgo-t-ak-12426148:', glbSha256: '554a697eabab950b5dcb65bb39dbd26dd57a660554cb9a9b1074e42aacb35c0c' },
  ctm_idf: { body: 74, animation: 70, main: 'models/player/ctm_idf.mdl', animationModel: 'models/player/ct_animations.mdl',
    versionPrefix: 'csgo-ct-ak-12426148:', glbSha256: '3409f61089d364cae700ae9d0fb45b0c78523b718facd1be5c4b2fb4cb674084' },
} as const;
const M4_PROFILES = {
 tm_leet_varianta: {versionPrefix:'csgo-t-m4-12426148:',glbSha256:'74b1d0d7a0dbb6edcb726f143ca912a2f84a4bed158f1641a0e6c2fb68d15b13'},
 ctm_idf: {versionPrefix:'csgo-ct-m4-12426148:',glbSha256:'70dab80d89878cc49755eb4f9f1c835c498ee1de885c82ac9ded17a9b6f875f1'},
} as const;
function selectedProfile(manifest:SourceCharacterManifest){
 const body=PROFILES[manifest.characterProfile];check(body,'Unknown original Source character profile');
 check(manifest.weaponId===undefined||manifest.weaponId==='ak47'||manifest.weaponId==='m4a4','Unknown original Source world weapon');
 return manifest.weaponId==='m4a4'?{...body,...M4_PROFILES[manifest.characterProfile]}:body;
}
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function ownedAsset(gltf: GLTF) {
  const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>(), skeletons = new Set<T.Skeleton>();
  gltf.scene.traverse(o => { const m = o as T.SkinnedMesh; if (!m.isMesh) return; geometries.add(m.geometry);
    if (m.isSkinnedMesh) skeletons.add(m.skeleton);
    for (const material of Array.isArray(m.material) ? m.material : [m.material]) { materials.add(material); for (const value of Object.values(material)) if (value?.isTexture) textures.add(value); }
  });
  return () => { for (const v of skeletons) v.dispose(); for (const v of geometries) v.dispose(); for (const v of materials) v.dispose();
    const bitmaps = new Set<ImageBitmap>(); for (const v of textures) { v.dispose(); if (typeof ImageBitmap !== 'undefined' && v.image instanceof ImageBitmap) bitmaps.add(v.image); }
    for (const bitmap of bitmaps) bitmap.close(); gltf.scene.removeFromParent(); };
}

/** CPU-testable actor owner used by the loader. The already-loaded glTF owns
 * shared geometry/materials; each actor owns cloned skeletons and bone matrices.
 * No AnimationMixer is run; all character and weapon poses come from authority.
 */
export function createSourceCharacterActors(gltf: GLTF, poseIndex: SourceCharacterPoseIndex, weapon: SourceWorldWeaponData,
  weaponBytes: ArrayBuffer | Uint8Array, manifest: SourceCharacterManifest, ragdollIndex?: SourceRagdollIndex) {
  const profile = selectedProfile(manifest), weaponId=manifest.weaponId??'ak47';
  const bodyCount = profile.body;
  check((weapon.weaponId??'ak47')===weaponId && (weaponId!=='m4a4'||weapon.sourceModel==='models/weapons/w_rif_m4a1.mdl'), 'Original weapon identity mismatch');
  check(manifest.format === 'source-character-stage-v1' && manifest.build === 12426148 && manifest.characterBones === bodyCount && manifest.bodyBoneCount === bodyCount &&
    manifest.animationBoneCount === profile.animation && manifest.weaponBones === 94 && manifest.files[manifest.model]?.sha256 === profile.glbSha256 && manifest.poseVersion.startsWith(profile.versionPrefix) &&
    manifest.metersPerSourceUnit === .0254 && Math.abs(manifest.actorYawOffsetRadians - Math.PI / 2) < 1e-12, 'Unexpected Source actor contract');
  check(weapon.format === 'source-world-weapon-v1' && weapon.bones.length === 94 && poseIndex.mainBoneCount === bodyCount && poseIndex.boneCount === profile.animation &&
    poseIndex.data.mainModel === profile.main && poseIndex.data.animationModel === profile.animationModel, 'Unexpected original character/weapon rig');
  for(const [state,row]of Object.entries(poseIndex.data.states)){
    if(state==='Jump'||state==='Death')continue; // merged jump_lower/Death1 reuse their own full-body layers
    const suffix=weaponId==='m4a4'?'M4':'AK';
    check(poseIndex.sequences.get(row.upper)?.name===state+'_Upper_'+suffix && poseIndex.sequences.get(row.shoot)?.name===state+'_Shoot_'+suffix,'Original character animation extension mismatch');
  }
  const raw = weaponBytes instanceof Uint8Array ? Uint8Array.from(weaponBytes) : new Uint8Array(weaponBytes.slice(0));
  check(raw.byteLength === weapon.frames.byteLength && raw.byteLength % 8 === 0, 'Invalid original weapon frame byte length');
  const frames = new Float64Array(raw.buffer); check(frames.every(Number.isFinite), 'Nonfinite original weapon frame');
  const animations = new Map(weapon.animations.map(a => [a.name, a]));
  for (const name of (weaponId==='m4a4'?['default','rifle_fire']:['default', 'rifle_fire', 'rifle_fire_crouch'])) {
    const a = animations.get(name); check(a && a.frames >= 1 && a.fps === 30 && a.boneWeights.length === 94 && a.boneWeights.every(v => v >= 0 && v <= 1), 'Missing original world AK frames');
    check(a.positionsCount === a.frames * 94 * 3 && a.quaternionsCount === a.frames * 94 * 4 && a.positionsOffset >= 0 && a.quaternionsOffset >= 0 &&
      a.positionsOffset + a.positionsCount <= frames.length && a.quaternionsOffset + a.quaternionsCount <= frames.length, 'Invalid world AK frame offsets');
    check(name === 'default' ? a.flags === 0 && a.sequenceFlags === 0 : a.flags === 4 && a.sequenceFlags === 20, 'Unsupported world AK sequence flags');
  }
  const merged = new Map(weapon.boneMerge.map(m => [m.weaponBone, m.characterBone]));
  check(merged.size === 3 && new Set(weapon.boneMerge.map(m => m.name)).size === 3, 'Unexpected original AK bone merge set');
  weapon.bones.forEach((bone, i) => { check(Number.isInteger(bone.parent) && bone.parent >= -1 && bone.parent < i, 'Invalid world AK bone tree');
    const source = merged.get(i); if (source !== undefined) check(poseIndex.data.mainBones[source]?.name === bone.name, 'AK bone-merge original name differs'); });
  // Source names may be sanitized/suffixed by GLTFLoader. Persist original node
  // IDs in userData before cloning; SkeletonUtils retains this small metadata.
  const byNode = new Map<number, T.Object3D>();
  for (const [object, ref] of gltf.parser.associations) if (ref.nodes !== undefined) byNode.set(ref.nodes, object as T.Object3D);
  for (const role of ['character', 'weapon'] as const) {
    const rig = weapon.rigMappings[role], count = role === 'character' ? bodyCount : 94, ids = new Set<number>();
    check(rig.joints.length === count, 'Incomplete original render mapping');
    for (const r of rig.joints) {
      const object = byNode.get(r.gltfNode) as T.Bone | undefined, defs = role === 'character' ? poseIndex.data.mainBones : weapon.bones;
      check(object?.isBone && r.bone >= 0 && r.bone < count && !ids.has(r.bone) && defs[r.bone].name === r.sourceName, 'Invalid original glTF bone mapping');
      ids.add(r.bone); object.userData.sourceCharacterRig = role; object.userData.sourceCharacterBone = r.bone;
    }
  }
  gltf.scene.traverse(object => { const mesh = object as T.SkinnedMesh; if (!mesh.isSkinnedMesh) return;
    // Match every joint's exact original node association; mesh names and
    // GLTFLoader's sanitized joint names are not a skeleton identity.
    const matched = Object.values(weapon.rigMappings).find(r => r.joints.every(j => mesh.skeleton.bones[j.skinJoint] === byNode.get(j.gltfNode)));
    check(matched, 'Unknown original skeleton');
    const defs = matched === weapon.rigMappings.character ? poseIndex.data.mainBones : weapon.bones;
    for (const r of matched.joints) check(mesh.skeleton.boneInverses[r.skinJoint].elements.every((v, k) => v === defs[r.bone].inverseBindGltf[k]), 'Original inverse bind matrix differs');
  });
  const actors = new Set<SourceCharacterActor>(), keys = new WeakMap<SourceCharacterActor, string>(); let disposed = false;
  // Death-instant rest shared by every corpse of this pose dataset: the frozen
  // full-skeleton world pose plus the 16-part rest the simulation rebuilds from.
  const ragdollRest = ragdollIndex ? computeSourceRagdollRestFromDeath1(ragdollIndex, poseIndex) : undefined;
  const tempP = new T.Vector3(), tempQ = new T.Quaternion(), tempQ2 = new T.Quaternion(), tempScale = new T.Vector3(), local = new T.Matrix4();
  function frame(a: WeaponAnimation, seconds: number, bone: number, p: T.Vector3, q: T.Quaternion) {
    const f = Math.max(0, Math.min(a.frames - 1, seconds * a.fps)), i = Math.floor(f), j = Math.min(a.frames - 1, i + 1), t = f - i;
    const pi = a.positionsOffset + (i * 94 + bone) * 3, pj = a.positionsOffset + (j * 94 + bone) * 3;
    p.set(frames[pi] * (1 - t) + frames[pj] * t, frames[pi + 1] * (1 - t) + frames[pj + 1] * t, frames[pi + 2] * (1 - t) + frames[pj + 2] * t);
    const qi = a.quaternionsOffset + (i * 94 + bone) * 4, qj = a.quaternionsOffset + (j * 94 + bone) * 4;
    q.fromArray(frames, qi); tempQ2.fromArray(frames, qj); const sign = q.dot(tempQ2) < 0 ? -1 : 1;
    q.set(q.x * (1 - t) + tempQ2.x * t * sign, q.y * (1 - t) + tempQ2.y * t * sign,
      q.z * (1 - t) + tempQ2.z * t * sign, q.w * (1 - t) + tempQ2.w * t * sign).normalize();
  }
  function weaponPose(actor: SourceCharacterActor, sampled: Pick<SourceCharacterPose, 'sourceWorldMatrices'>, input: SourceCharacterPoseInput) {
    const worlds: T.Matrix4[] = [], dp = new T.Vector3(), dq = new T.Quaternion(), defaultFrame = animations.get('default')!;
    const stateSequences = poseIndex.data.states[input.state]; check(stateSequences, 'Unknown original character state');
    const shoot = stateSequences.shoot, rate = sourceSequenceCycleRate(poseIndex, shoot, input.parameters);
    const seconds = input.fireTimeSeconds ?? Math.max(0, (input.fireCycle ?? input.cycle) / (rate || 1));
    check(Number.isFinite(seconds) && seconds >= 0, 'Invalid authoritative world AK fire time');
    const fire = animations.get(weaponId==='ak47'&&input.state.startsWith('Crouch') ? 'rifle_fire_crouch' : 'rifle_fire')!;
    // The character shoot layer ends at .7/.8s, while the original world AK
    // continues to 26/30s. Authority's elapsed event clock preserves that tail.
    const fireWeight = input.fireTimeSeconds === undefined ? input.fireWeight ?? 0 : seconds <= (fire.frames - 1) / fire.fps ? 1 : 0;
    for (let i = 0; i < 94; i++) {
      const bone = weapon.bones[i], shared = merged.get(i); frame(defaultFrame, 0, i, tempP, tempQ);
      if (fireWeight > 0 && fire.boneWeights[i] > 0) {
        frame(fire, seconds, i, dp, dq); const w = fireWeight * fire.boneWeights[i], sine = Math.min(Math.hypot(dq.x, dq.y, dq.z), 1);
        const scaledSine = Math.sin(Math.asin(sine) * w), factor = scaledSine / (sine + 2 ** -23), sign = dq.w < 0 ? -1 : 1;
        dq.set(dq.x * factor, dq.y * factor, dq.z * factor, Math.sqrt(Math.max(0, 1 - scaledSine * scaledSine)) * sign);
        tempQ.multiply(dq).normalize(); tempP.addScaledVector(dp, w);
      }
      local.compose(tempP, tempQ, one);
      const world = shared !== undefined ? new T.Matrix4().fromArray(sampled.sourceWorldMatrices, shared * 16) :
        bone.parent < 0 ? local.clone() : worlds[bone.parent].clone().multiply(local);
      worlds.push(world); world.toArray(actor.sourceWeaponWorldMatrices, i * 16);
      // Bone merge overrides WORLD; reconstruct local relative to the original
      // weapon parent. Never bind its 94 bones into the 71-bone character skin.
      local.copy(bone.parent < 0 ? C.clone().multiply(world) : worlds[bone.parent].clone().invert().multiply(world));
      local.decompose(tempP, tempQ, tempScale); check(Math.max(Math.abs(tempScale.x - 1), Math.abs(tempScale.y - 1), Math.abs(tempScale.z - 1)) < 1e-6, 'Nonrigid original merged AK pose');
      actor.weaponBones[i].position.copy(tempP); actor.weaponBones[i].quaternion.copy(tempQ).normalize(); actor.weaponBones[i].scale.set(1, 1, 1);
    }
  }
  function createActor(): SourceCharacterActor {
    check(!disposed, 'Source actor owner disposed'); const root = new T.Group(), model = cloneSkeleton(gltf.scene), characterBones: T.Bone[] = [], weaponBones: T.Bone[] = [];
    model.scale.setScalar(manifest.metersPerSourceUnit); root.add(model); root.name = 'Source_' + manifest.characterProfile + '_' + weaponId;root.userData.sourceWeaponId=weaponId; root.visible = false;
    const magazines: T.Mesh[] = [];
    model.traverse(object => { const bone = object as T.Bone; if (bone.isBone) {
      const role = bone.userData.sourceCharacterRig, index = bone.userData.sourceCharacterBone;
      if (role === 'character') characterBones[index] = bone; else if (role === 'weapon') weaponBones[index] = bone;
    }
      const mesh = object as T.SkinnedMesh; if (mesh.isSkinnedMesh) { mesh.skeleton.boneInverses = mesh.skeleton.boneInverses.map(m => m.clone()); mesh.frustumCulled = false; }
      // The original world rifle carries its magazine as its own mesh, which the
      // reload's display events move out of the weapon and seat again.
      if ((object as T.Mesh).isMesh && /^w_rif_.+_mag$/.test(object.name)) magazines.push(object as T.Mesh);
    });
    check(characterBones.filter(Boolean).length === bodyCount && weaponBones.filter(Boolean).length === 94, 'Cloned Source bones are incomplete');
    check(magazines.length === 1, 'Original world rifle must carry exactly one magazine mesh');
    const actor: SourceCharacterActor = { root, model, characterBones, weaponBones, sourceWeaponWorldMatrices: new Float64Array(94 * 16), lastPose: null, status: 'awaiting-authority', magazine: magazines[0],
      magazineVisible: null, magazineGroundY: NaN, magazineSeed: 0, pendingMagazineDrop: null };
    actors.add(actor); return actor;
  }
  /** The original detached magazine prop: the magazine's rigid world transform,
   * the level it falls to, and the direction away from the weapon. Both clients
   * derive these from the same authoritative pose, so they drop identical props. */
  function magazineDrop(actor: SourceCharacterActor, player: SourceCharacterPlayer) {
    return actor.magazine ? sourceMagazineDropFromMesh({ key: weaponId, mesh: actor.magazine, root: actor.root,
      origin: { x: player.x, y: player.y, z: player.z }, floorY: actor.magazineGroundY, seed: actor.magazineSeed++ }) : null;
  }
  function updateActor(actor: SourceCharacterActor, player: SourceCharacterPlayer): SourceCharacterPose | null {
    check(actors.has(actor) && !disposed && actor.status !== 'disposed', 'Unknown/disposed Source actor');
    if (!player.sourcePose || player.sourcePoseVersion !== manifest.poseVersion || player.sourceContract !== 'csgo-player-12426148' || ![player.x, player.y, player.z, player.yaw].every(Number.isFinite)) {
      actor.root.visible = false; actor.status = 'invalid-authority'; actor.lastPose = null; keys.delete(actor); return null;
    }
    // The original prop rests on the surface the authority traced under the
    // shooter; a mid-air reload keeps the last grounded height instead of
    // dropping the magazine into the void.
    if (player.grounded !== false || !Number.isFinite(actor.magazineGroundY)) actor.magazineGroundY = player.sourceGroundY ?? player.y;
    let ejected = false;
    try {
      const input = player.sourcePose;
      if (player.sourceRagdoll && ragdollIndex && ragdollRest) {
        // Authoritative original VPhysics corpse: simulated part positions replace
        // the Death1 clamp; the world weapon keeps following the merged hand bones.
        const state = player.sourceRagdoll;
        check(state.positions.length === ragdollIndex.data.parts.length * 3 && state.positions.every(Number.isFinite),
          'Invalid authoritative ragdoll state');
        const key = 'ragdoll:' + JSON.stringify(state);
        if (keys.get(actor) !== key) {
          const sample = sampleSourceRagdollState(ragdollIndex,poseIndex,state);
          for (let i = 0; i < bodyCount; i++) { actor.characterBones[i].position.fromArray(sample.renderLocalPositions, i * 3);
            actor.characterBones[i].quaternion.fromArray(sample.renderLocalQuaternions, i * 4); actor.characterBones[i].scale.set(1, 1, 1); }
          weaponPose(actor, sample, input); actor.lastPose = null; keys.set(actor, key);
          // A corpse keeps its magazine seated; only a live original reload moves it.
          if (actor.magazine) actor.magazine.visible = true;
          actor.magazineVisible = true;
        }
        actor.root.position.set(player.x, player.y, player.z); actor.root.rotation.set(0, player.yaw + manifest.actorYawOffsetRadians, 0);
        actor.root.visible = true; actor.status = 'ready'; actor.root.updateMatrixWorld(true); return actor.lastPose;
      }
      const key = JSON.stringify(input);
      if (keys.get(actor) !== key) {
        const p = sampleSourceCharacterPose(poseIndex, input);
        for (let i = 0; i < bodyCount; i++) { actor.characterBones[i].position.fromArray(p.renderLocalPositions, i * 3);
          actor.characterBones[i].quaternion.fromArray(p.renderLocalQuaternions, i * 4); actor.characterBones[i].scale.set(1, 1, 1); }
        weaponPose(actor, p, input); actor.lastPose = p; keys.set(actor, key);
        // The original reload display events move the world weapon's magazine out
        // of the gun at AE_CL_EJECT_MAG and seat the fresh one at
        // AE_CL_EJECT_MAG_UNHIDE, exactly like the pistol/AWP actors.
        if (actor.magazine) actor.magazine.visible = p.magazineVisible;
        // ... and the magazine that just left the weapon becomes its own prop.
        ejected = actor.magazineVisible === true && !p.magazineVisible;
        actor.magazineVisible = p.magazineVisible;
      }
      actor.root.position.set(player.x, player.y, player.z); actor.root.rotation.set(0, player.yaw + manifest.actorYawOffsetRadians, 0);
      actor.root.visible = true; actor.status = 'ready'; actor.root.updateMatrixWorld(true);
      if (ejected) actor.pendingMagazineDrop = magazineDrop(actor, player);
      return actor.lastPose;
    } catch (error) { actor.root.visible = false; actor.status = 'invalid-authority'; actor.lastPose = null; keys.delete(actor); throw error; }
  }
  function disposeActor(actor: SourceCharacterActor) {
    if (!actors.delete(actor)) return; actor.root.removeFromParent(); actor.root.visible = false; actor.status = 'disposed'; actor.lastPose = null;
    const skeletons = new Set<T.Skeleton>(); actor.model.traverse(o => { if ((o as T.SkinnedMesh).isSkinnedMesh) skeletons.add((o as T.SkinnedMesh).skeleton); });
    for (const skeleton of skeletons) skeleton.dispose(); keys.delete(actor);
  }
  function dispose() { if (disposed) return; for (const actor of [...actors]) disposeActor(actor); disposed = true; }
  /** The original world weapon's own named attachment, in scene space: the same
   * composition the other original rigs use, over this rig's merged world weapon
   * bone matrices. An actor without a pose yet, or a rig whose original model does
   * not carry the attachment, reports null instead of an invented point — the same
   * contract the other original rigs keep, so a caller in the render loop can never
   * be thrown at by an actor that is merely not ready. */
  function attachment(actor: SourceCharacterActor, name: string) {
    check(actors.has(actor), 'Unknown Source actor attachment');
    if (actor.status !== 'ready') return null;
    const found = weapon.attachments.find(a => a.name === name);
    if (!found || found.matrix.length !== 12 || !actor.weaponBones[found.parent_bone]) return null;
    const start = found.parent_bone * 16;
    if (!actor.sourceWeaponWorldMatrices.subarray(start, start + 16).every(Number.isFinite)) return null;
    actor.root.updateWorldMatrix(true, false);
    const local = new T.Matrix4().set(...[...found.matrix.slice(0, 4), ...found.matrix.slice(4, 8), ...found.matrix.slice(8, 12), 0, 0, 0, 1] as Parameters<T.Matrix4['set']>);
    const unit = manifest.metersPerSourceUnit;
    return actor.root.matrixWorld.clone().multiply(new T.Matrix4().makeScale(unit, unit, unit)).multiply(C)
      .multiply(new T.Matrix4().fromArray(actor.sourceWeaponWorldMatrices, start)).multiply(local);
  }
  /** Hands over the original magazine prop that left the weapon on the last
   * authoritative pose, and clears it. Exactly one consumer per drop. */
  function takeMagazineDrop(actor: SourceCharacterActor) {
    check(actors.has(actor), 'Unknown Source actor magazine drop');
    const drop = actor.pendingMagazineDrop; actor.pendingMagazineDrop = null; return drop;
  }
  return { createActor, updateActor, takeMagazineDrop, attachment, disposeActor, dispose };
}

/** Local/LAN production entry. Original byte receipts are required on both
 * secure localhost and ordinary HTTP LAN origins. */
export async function loadSourceCharacter(options: { baseUrl?: string; signal?: AbortSignal; loadingManager?: T.LoadingManager;
  /** The shared original IK rule set, so several character rigs fetch it once. */
  ikRules?: SourceIKRules } = {}) {
  const base = new URL((options.baseUrl ?? '/source/csgo-12426148/character-ak/').replace(/\/?$/, '/'), globalThis.location?.href ?? 'http://127.0.0.1/').href;
  const response = await fetch(base + 'manifest.json', { signal: options.signal, cache: 'no-cache' }); check(response.ok, `Source character manifest HTTP ${response.status}`);
  const manifest = await response.json() as SourceCharacterManifest;
  check(manifest.format === 'source-character-stage-v1' && manifest.build === 12426148, 'Unexpected original character build');
  const hashVerified: Record<string, boolean> = {}, cleanup: (() => void)[] = []; let disposed = false;
  const dispose = () => { if (disposed) return; disposed = true; for (const release of cleanup.slice().reverse()) release(); };
  async function bytes(file: string) {
    const record = manifest.files[file]; check(record && Number.isSafeInteger(record.bytes) && record.bytes > 0 && /^[a-f0-9]{64}$/.test(record.sha256), 'Invalid Source character file receipt');
    const result = await fetch(new URL(file, base), { signal: options.signal, cache: 'no-cache' }); check(result.ok, `Source character ${file} HTTP ${result.status}`);
    const value = await result.arrayBuffer(); check(value.byteLength === record.bytes, `Incomplete Source character ${file}`);
    const hash = await sourceSha256(new Uint8Array(value), options.signal);
    check(hash === record.sha256, `Source character checksum differs ${file}`); hashVerified[file] = true;
    return value;
  }
  try {
    const pending = await Promise.allSettled([bytes(manifest.model).then(async b => { const gltf = await new GLTFLoader(options.loadingManager).parseAsync(b, base); cleanup.push(ownedAsset(gltf)); return gltf; }),
      bytes(manifest.poseData), bytes(manifest.poseFrames), bytes(manifest.weaponData), bytes(manifest.weaponFrames)] as const);
    for (const result of pending) if (result.status === 'rejected') throw result.reason;
    const [gltf, poseRaw, frames, weaponRaw, weaponFrames] = pending.map(r => (r as PromiseFulfilledResult<unknown>).value) as [GLTF, ArrayBuffer, ArrayBuffer, ArrayBuffer, ArrayBuffer];
    const data = JSON.parse(new TextDecoder().decode(poseRaw)), weapon = JSON.parse(new TextDecoder().decode(weaponRaw)) as SourceWorldWeaponData;
    const profile = selectedProfile(manifest), weaponId=manifest.weaponId??'ak47';
    check(manifest.poseVersion === profile.versionPrefix + manifest.files[manifest.poseData].sha256.slice(0, 16) && data.frames.sha256 === manifest.files[manifest.poseFrames].sha256 && weapon.frames.sha256 === manifest.files[manifest.weaponFrames].sha256, 'Source character files disagree on identity');
    options.signal?.throwIfAborted(); const poseIndex = prepareSourceCharacterPose(data, frames);
    // Every team shares one original ragdoll definition; the PHY model path must
    // match this profile so T corpses never render CT masses.
    const ragdollFile = new URL('../ragdoll/ragdoll-data.json', base), ragdollResponse = await fetch(ragdollFile, { signal: options.signal, cache: 'no-cache' });
    check(ragdollResponse.ok, `Source ragdoll data HTTP ${ragdollResponse.status}`);
    const ragdollData = parseSourceRagdollData(await ragdollResponse.json());
    check(ragdollData.build === 12426148 && ragdollData.models[manifest.characterProfile === 'tm_leet_varianta' ? 't' : 'ct'] === 'models/player/' + manifest.characterProfile + '.phy',
      'Source ragdoll data disagrees with this character profile');
    const ragdollIndex = bindSourceRagdoll(ragdollData, poseIndex);
    // The player animations carry their own foot IK rules (a GROUND rule per foot
    // per running variant). They are a separate original data class from the
    // frames and ship beside them; the caller that loads several original rigs
    // hands in the one shared copy, and a lone load fetches its own.
    const ikRules = options.ikRules ?? await loadSourceIKRules({ baseUrl: new URL('../ik/ik-rules.json', base).href, signal: options.signal });
    const surfaces = await applySourceCharacterSurfaces(gltf, base, manifest.characterProfile,weaponId); cleanup.push(surfaces.dispose); options.signal?.throwIfAborted();
    const owner = createSourceCharacterActors(gltf, poseIndex, weapon, weaponFrames, manifest, ragdollIndex); cleanup.push(owner.dispose);
    return { gltf, poseIndex, manifest, surfaces, hashVerified, ragdollIndex, ikRules, createActor: owner.createActor, updateActor: owner.updateActor, takeMagazineDrop: owner.takeMagazineDrop, attachment: owner.attachment, disposeActor: owner.disposeActor, dispose };
  } catch (error) { dispose(); throw error; }
}
