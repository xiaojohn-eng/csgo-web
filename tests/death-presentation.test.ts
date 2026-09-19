import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FalconCombatPose, sampleFalconCombatPose } from '../game/falcon-combat-pose';
import { GameAssets } from '../game/assets';
import type { Player } from '../game/types';
import { bindDeathPresentation, updateDeathPresentation, unbindDeathPresentation } from '../game/death-presentation';

function actor() {
  const root = new T.Group();
  root.position.set(4, 2, -7); root.rotation.y = .71;
  const body = new T.Group(); body.rotation.y = Math.PI;
  const mesh = new T.Mesh(new T.BoxGeometry(.4, 1.8, .3), new T.MeshBasicMaterial());
  mesh.position.y = .9;
  const bone = new T.Bone(); bone.position.set(.12, .7, -.03); bone.rotation.z = .2;
  body.add(mesh, bone); root.add(body); root.updateMatrixWorld(true);
  return { root, body, mesh, bone };
}
const transform = (o: T.Object3D) => [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()];
const playerFixture = (): Player => ({ id: 'audit', name: 'Audit', team: 'amber', bot: false,
  x: 2, y: 1, z: -3, yaw: .5, pitch: .6, vy: 0, vx: 0, vz: 0, shotHeat: 0, shotIdle: 1,
  grounded: true, crouch: true, stancePhase: .7, stanceRate: 0, stanceTarget: true,
  hp: 100, armor: 0, alive: true, weapon: 'vandal', primary: 'vandal', slot: 0,
  ammo: 30, reserve: 90, primaryAmmo: 30, primaryReserve: 90, pistolAmmo: 12, pistolReserve: 48,
  reload: .8, cooldown: 0, kills: 0, deaths: 0, money: 0, ack: 0, respawn: 0, use: 0,
  grenades: 0, smokes: 0, flashes: 0, flash: 0, reveal: 0 });
const step = (body: T.Object3D, root: T.Group, frames: number, dt = .1) => {
  let result = updateDeathPresentation(body, root, false, 0);
  for (let i = 0; i < frames; i++) result = updateDeathPresentation(body, root, false, dt);
  return result;
};

async function actualC02() {
  // Read the shipped bytes. Strip only image/material I/O in memory for Node;
  // preserve all original geometry, bind matrices, weights, skeletons and animations.
  const source = readFileSync(new URL('../public/models/web-w01/falcon-combat-actions.glb', import.meta.url));
  const jsonBytes = new DataView(source.buffer, source.byteOffset, source.byteLength).getUint32(12, true);
  const json = JSON.parse(source.subarray(20, 20 + jsonBytes).toString());
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  json.materials = []; json.images = []; json.textures = [];
  const text = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
  text.copy(padded);
  const binary = source.subarray(20 + jsonBytes), header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length + binary.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const data = Buffer.concat([header, padded, binary]);
  return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
}

describe('death presentation', () => {
  it('wraps the cloned body once with identity, retaining its world pose and all authoritative transforms', () => {
    const { root, body, bone } = actor(), rootBefore = transform(root), bodyBefore = transform(body);
    const boneBefore = bone.matrixWorld.toArray();
    const wrapper = bindDeathPresentation(root, body);
    root.updateMatrixWorld(true);
    expect(body.parent).toBe(wrapper); expect(wrapper.parent).toBe(root);
    expect(bindDeathPresentation(root, body)).toBe(wrapper);
    expect(root.children).toEqual([wrapper]);
    expect(transform(root)).toEqual(rootBefore); expect(transform(body)).toEqual(bodyBefore);
    expect(bone.matrixWorld.toArray()).toEqual(boneBefore);
  });

  it('falls visibly while leaving the body import transform, bone pose, material and authority root untouched', () => {
    const { root, body, mesh, bone } = actor(), rootBefore = transform(root), bodyBefore = transform(body);
    const boneBefore = transform(bone), material = mesh.material, wrapper = bindDeathPresentation(root, body);
    const result = updateDeathPresentation(body, root, false, .1);
    expect(result.phase).toBe('falling'); expect(result.visible).toBe(true); expect(wrapper.visible).toBe(true);
    expect(wrapper.quaternion.angleTo(new T.Quaternion())).toBeGreaterThan(.1);
    expect(transform(root)).toEqual(rootBefore); expect(transform(body)).toEqual(bodyBefore);
    expect(transform(bone)).toEqual(boneBefore); expect(mesh.material).toBe(material);
  });

  it('keeps a fallen body grounded and visible before retiring it, without restarting on repeated dead updates', () => {
    const { root, body } = actor(), wrapper = bindDeathPresentation(root, body);
    const held = step(body, root, 12);
    expect(held.phase).toBe('held'); expect(held.visible).toBe(true);
    root.updateMatrixWorld(true);
    const up = new T.Vector3(0, 1, 0).transformDirection(body.matrixWorld);
    expect(Math.abs(up.y)).toBeLessThan(.1);
    expect(new T.Box3().setFromObject(wrapper, true).min.y).toBeGreaterThanOrEqual(root.position.y);
    const late = step(body, root, 30);
    expect(late.phase).toBe('hidden'); expect(late.visible).toBe(false); expect(wrapper.visible).toBe(false);
    expect(updateDeathPresentation(body, root, false, .1).phase).toBe('hidden');
  });

  it('clamps a resumed frame and ignores invalid or negative deltas', () => {
    const { root, body } = actor(); bindDeathPresentation(root, body);
    expect(updateDeathPresentation(body, root, false, 20).elapsed).toBeCloseTo(.1);
    for (const dt of [NaN, Infinity, -1])
      expect(updateDeathPresentation(body, root, false, dt).elapsed).toBeCloseTo(.1);
  });

  it('restores the exact living pose after corpse retirement and allows a later death', () => {
    const { root, body, bone } = actor(), worldBefore = bone.matrixWorld.toArray();
    const wrapper = bindDeathPresentation(root, body); step(body, root, 45);
    const alive = updateDeathPresentation(body, root, true, .05); root.updateMatrixWorld(true);
    expect(alive).toEqual({ phase: 'alive', elapsed: 0, visible: true });
    expect(wrapper.visible).toBe(true); expect(wrapper.matrix.equals(new T.Matrix4())).toBe(true);
    expect(bone.matrixWorld.toArray()).toEqual(worldBefore);
    expect(updateDeathPresentation(body, root, false, .05).elapsed).toBeCloseTo(.05);
  });

  it('holds per-actor state independently and unbinds without altering the original local body transform', () => {
    const a = actor(), b = actor(), before = transform(a.body);
    const wrapper = bindDeathPresentation(a.root, a.body); bindDeathPresentation(b.root, b.body);
    step(a.body, a.root, 20);
    expect(updateDeathPresentation(b.body, b.root, true, .1).phase).toBe('alive');
    unbindDeathPresentation(a.root); a.root.updateMatrixWorld(true);
    expect(a.body.parent).toBe(a.root); expect(wrapper.parent).toBeNull();
    expect(transform(a.body)).toEqual(before); expect(a.body.visible).toBe(true);
    expect(bindDeathPresentation(a.root, a.body)).not.toBe(wrapper);
  });

  it('carries actual C02 private knee palettes with the corpse and restores them before live pose sampling', async () => {
    const gltf = await actualC02(), root = new T.Group(), body = gltf.scene;
    root.position.set(2, 1, -3); root.rotation.y = .5; body.rotation.y = Math.PI; root.add(body);
    const pose = new FalconCombatPose(body), mixer = new T.AnimationMixer(body);
    const action = mixer.clipAction(gltf.animations.find(clip => clip.name === 'Rifle_Reload')!);
    sampleFalconCombatPose(pose, () => { action.play(); action.paused = true; action.time = 1.2; mixer.update(0); },
      { yaw: .5, pitch: .6, crouch: .7 });
    root.updateMatrixWorld(true); // Match the renderer's SkinnedMesh bind-inverse update.
    const gear = body.getObjectByName('Knee_padded_backing_L') as T.SkinnedMesh;
    const original = gear.getVertexPosition(0, new T.Vector3()).applyMatrix4(gear.matrixWorld);
    const bones = new Map<T.Object3D, number[]>();
    body.traverse(object => { if (object instanceof T.Bone) bones.set(object, transform(object)); });
    const wrapper = bindDeathPresentation(root, body), before = wrapper.matrixWorld.clone();
    step(body, root, 12);
    root.updateMatrixWorld(true);
    const expected = original.clone().applyMatrix4(wrapper.matrixWorld.clone().multiply(before.clone().invert()));
    const actual = gear.getVertexPosition(0, new T.Vector3()).applyMatrix4(gear.matrixWorld);
    expect(actual.distanceTo(expected), 'detached patella palette must follow the same corpse transform').toBeLessThan(1e-5);
    for (const [bone, value] of bones) expect(transform(bone)).toEqual(value);
    updateDeathPresentation(body, root, true, .1);
    root.updateMatrixWorld(true);
    expect(gear.getVertexPosition(0, new T.Vector3()).applyMatrix4(gear.matrixWorld).distanceTo(original)).toBeLessThan(1e-5);
    unbindDeathPresentation(root); pose.dispose();
    body.traverse(object => { if (object instanceof T.Mesh) object.geometry.dispose(); });
  });

  it.each([[.3, 0], [0, .4], [.3, .4]])('preserves actual GameAssets knee alignment when death follows movement %sm / turn %srad', async (move, turn) => {
    const assets = new GameAssets(); assets.models.set('falconC02', await actualC02());
    const player = playerFixture();
    const root = assets.operator(player)!; root.updateMatrixWorld(true);
    const body = root.getObjectByName('FalconC02Body')!, wrapper = body.parent!;
    const gear = body.getObjectByName('Knee_padded_backing_L') as T.SkinnedMesh;
    const original = gear.getVertexPosition(0, new T.Vector3()).applyMatrix4(gear.matrixWorld);
    const before = wrapper.matrixWorld.clone(), bones = new Map<T.Object3D, number[]>();
    body.traverse(object => { if (object instanceof T.Bone) bones.set(object, transform(object)); });
    player.x += move; player.yaw += turn; player.alive = false;
    root.position.set(player.x, player.y, player.z); root.rotation.y = player.yaw;
    const authority = transform(root);
    assets.updateDeath(root, player, .1); root.updateMatrixWorld(true);
    const expected = original.clone().applyMatrix4(wrapper.matrixWorld.clone().multiply(before.clone().invert()));
    const actual = gear.getVertexPosition(0, new T.Vector3()).applyMatrix4(gear.matrixWorld);
    expect(actual.distanceTo(expected), 'private palette must include the last unsampled authority movement').toBeLessThan(1e-5);
    expect(transform(root)).toEqual(authority);
    for (const [bone, value] of bones) expect(transform(bone)).toEqual(value);
    assets.dispose();
  });

  it('initializes a late-arriving dead C02 from the same authority pose as a living player before freezing', async () => {
    const assets = new GameAssets(); assets.models.set('falconC02', await actualC02());
    const player = { ...playerFixture(), stancePhase: 1, pitch: .6 };
    const living = assets.operator(player)!, late = assets.operator({ ...player, alive: false })!;
    expect(late.userData.sampledClip).toBe('Rifle_Reload');
    expect(late.userData.poseReport).toBeDefined();
    const liveHead = living.getObjectByName('Bip01_Head')!.getWorldPosition(new T.Vector3());
    const deadHead = late.getObjectByName('Bip01_Head')!.getWorldPosition(new T.Vector3());
    expect(deadHead.distanceTo(liveHead)).toBeLessThan(1e-6);
    const sampleTime = late.userData.sampledClipTime;
    assets.animateOperator(late, { ...player, alive: false, reload: 0, pitch: -1 }, .1);
    expect(late.userData.sampledClipTime).toBe(sampleTime);
    expect(late.getObjectByName('Bip01_Head')!.getWorldPosition(new T.Vector3()).distanceTo(deadHead)).toBeLessThan(1e-6);
    assets.dispose();
  });
});
