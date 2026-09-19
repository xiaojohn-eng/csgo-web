import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { CombatEffects, COMBAT_EFFECT_BUDGET } from '../game/combat-effects';

const meshes = (...scenes: T.Scene[]) => scenes.flatMap(scene => scene.children.filter((o): o is T.InstancedMesh => o instanceof T.InstancedMesh));
const positionAt = (mesh: T.InstancedMesh, index = 0) => {
  const matrix = new T.Matrix4(); mesh.getMatrixAt(index, matrix); return new T.Vector3().setFromMatrixPosition(matrix);
};

describe('combat effects', () => {
  it('ejects in the supplied view-space pose without moving the input or adding world-space casings', () => {
    const world = new T.Scene(), view = new T.Scene(), effects = new CombatEffects(world, view);
    const pose = new T.Matrix4().makeRotationY(.7).setPosition(.22, -.17, -.42), original = pose.toArray();
    effects.eject(pose);
    const casing = meshes(view)[0];
    expect(casing.count).toBe(1); expect(positionAt(casing).distanceTo(new T.Vector3(.22, -.17, -.42))).toBeLessThan(1e-7);
    expect(meshes(world).every(mesh => mesh.count === 0)).toBe(true); expect(pose.toArray()).toEqual(original);
    effects.update(.05);
    expect(positionAt(casing).distanceTo(new T.Vector3(.22, -.17, -.42))).toBeGreaterThan(.01);
    effects.dispose();
  });

  it('uses a fixed geometry/material set and bounded instance counts during sustained fire and explosions', () => {
    const world = new T.Scene(), view = new T.Scene(), effects = new CombatEffects(world, view);
    const pools = meshes(world, view), resources = pools.map(mesh => [mesh.geometry, mesh.material]);
    for (let i = 0; i < 500; i++) { effects.eject(new T.Matrix4()); effects.explode(new T.Vector3(i % 5, 1, 0)); }
    effects.update(.016);
    expect(meshes(world, view)).toEqual(pools); expect(pools.length).toBeLessThanOrEqual(4);
    expect(pools.map(mesh => [mesh.geometry, mesh.material])).toEqual(resources);
    expect(meshes(view)[0].count).toBe(COMBAT_EFFECT_BUDGET.casings);
    for (const mesh of pools) expect(mesh.count).toBeLessThanOrEqual(mesh.instanceMatrix.count);
    expect(meshes(world).reduce((sum, mesh) => sum + mesh.count, 0)).toBeLessThanOrEqual(
      COMBAT_EFFECT_BUDGET.smoke + COMBAT_EFFECT_BUDGET.debris + COMBAT_EFFECT_BUDGET.flashes);
    effects.dispose();
  });

  it('creates distinct flash, smoke and debris layers at the detonation position, then retires them all', () => {
    const world = new T.Scene(), view = new T.Scene(), effects = new CombatEffects(world, view);
    const position = new T.Vector3(2, 1, -3); effects.explode(position);
    const pools = meshes(world);
    expect(pools).toHaveLength(3); expect(pools.every(mesh => mesh.count > 0)).toBe(true);
    expect(position.toArray()).toEqual([2, 1, -3]);
    expect(pools.every(mesh => positionAt(mesh).distanceTo(position) < .7)).toBe(true);
    for (let i = 0; i < 200; i++) effects.update(.05);
    expect(pools.every(mesh => mesh.count === 0 && !mesh.visible)).toBe(true);
    effects.dispose();
  });

  it('limits resumed frame integration and rejects non-finite inputs without NaN instance matrices', () => {
    const world = new T.Scene(), view = new T.Scene(), effects = new CombatEffects(world, view);
    effects.eject(new T.Matrix4().setPosition(.2, -.1, -.4)); effects.explode(new T.Vector3(1, 1, 1));
    const casing = meshes(view)[0], before = positionAt(casing);
    effects.update(120);
    expect(positionAt(casing).distanceTo(before)).toBeLessThan(.25); expect(casing.count).toBe(1);
    const snapshot = [...casing.instanceMatrix.array];
    for (const dt of [NaN, Infinity, -10]) effects.update(dt);
    expect([...casing.instanceMatrix.array]).toEqual(snapshot);
    effects.explode(new T.Vector3(NaN, 1, 1)); effects.eject(new T.Matrix4().setPosition(Infinity, 0, 0));
    effects.eject(new T.Matrix4().makeScale(0, 0, 0));
    effects.explode(new T.Vector3(1e100, 1, 1)); effects.eject(new T.Matrix4().setPosition(1e100, 0, 0));
    expect(casing.count).toBe(1);
    for (const mesh of meshes(world, view)) expect([...mesh.instanceMatrix.array].every(Number.isFinite)).toBe(true);
    effects.dispose();
  });

  it('cleans only owned resources exactly once and ignores emissions after disposal', () => {
    const world = new T.Scene(), view = new T.Scene(), unrelated = new T.Group(); world.add(unrelated);
    const effects = new CombatEffects(world, view), pools = meshes(world, view), calls = new Map<object, number>();
    for (const mesh of pools) {
      const material = mesh.material as T.Material;
      for (const resource of [mesh, mesh.geometry, material]) calls.set(resource, 0);
      mesh.addEventListener('dispose', () => calls.set(mesh, calls.get(mesh)! + 1));
      mesh.geometry.addEventListener('dispose', () => calls.set(mesh.geometry, calls.get(mesh.geometry)! + 1));
      material.addEventListener('dispose', () => calls.set(material, calls.get(material)! + 1));
    }
    effects.eject(new T.Matrix4()); effects.explode(new T.Vector3()); effects.dispose(); effects.dispose();
    effects.eject(new T.Matrix4()); effects.explode(new T.Vector3()); effects.update(.016);
    expect(world.children).toEqual([unrelated]); expect(view.children).toEqual([]);
    expect([...calls.values()].every(count => count === 1)).toBe(true);
  });

  it('clears live particles without releasing cached resources and can emit again afterward', () => {
    const world = new T.Scene(), view = new T.Scene(), effects = new CombatEffects(world, view);
    const pools = meshes(world, view), resources = pools.map(mesh => [mesh.geometry, mesh.material, mesh.instanceMatrix]);
    let disposed = 0;
    for (const mesh of pools) {
      mesh.geometry.addEventListener('dispose', () => disposed++);
      (mesh.material as T.Material).addEventListener('dispose', () => disposed++);
    }
    effects.eject(new T.Matrix4()); effects.explode(new T.Vector3(2, 1, -3)); effects.update(.05);
    expect(pools.every(mesh => mesh.count > 0)).toBe(true);
    effects.clear(); effects.clear(); effects.update(.05);
    expect(pools.every(mesh => mesh.count === 0 && !mesh.visible)).toBe(true);
    expect(meshes(world, view)).toEqual(pools);
    expect(pools.map(mesh => [mesh.geometry, mesh.material, mesh.instanceMatrix])).toEqual(resources);
    expect(disposed).toBe(0);
    effects.eject(new T.Matrix4().setPosition(.1, -.1, -.3)); effects.explode(new T.Vector3());
    expect(meshes(view)[0].count).toBe(1); expect(meshes(world).every(mesh => mesh.count > 0)).toBe(true);
    effects.dispose();
  });
});
