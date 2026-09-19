import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { GameAssets } from '../game/assets';
import { createFalconViewmodel, disposeFalconViewmodel } from '../game/falcon-viewmodel';
import { FalconCombatPose, sampleFalconCombatPose, SkinnedVertexFrame } from '../game/falcon-combat-pose';
import { shareEquivalentSkeletons } from '../game/share-skeleton';
import { c02Player, loadC02Geometry } from './fixtures/c02-geometry';

const skins = (root: T.Object3D) => {
  const found: T.SkinnedMesh[] = [];
  root.traverse(o => { if (o instanceof T.SkinnedMesh) found.push(o); });
  return found;
};
const skeletons = (root: T.Object3D) => new Set(skins(root).map(m => m.skeleton));
let gltf: GLTF;
beforeAll(async () => { gltf = await loadC02Geometry(); });

describe('C02 per-instance skeleton resources', () => {
  it('reclaims only redundant clone palettes and their allocated textures, retaining all source data', () => {
    const body = clone(gltf.scene), meshes = skins(body), before = new Map(meshes.map(m => [m, m.skeleton]));
    const initial = skeletons(body), original = skeletons(gltf.scene);
    expect(initial.size).toBe(28); expect(original.size).toBe(1);
    for (const skeleton of initial) skeleton.computeBoneTexture();
    const textures = new Map([...initial].map(s => [s, vi.spyOn(s.boneTexture!, 'dispose')]));
    const dispose = vi.spyOn(T.Skeleton.prototype, 'dispose');
    let owned = new Set<T.Skeleton>();
    try {
      owned = shareEquivalentSkeletons(body);
      expect(owned.size).toBe(1); expect(dispose.mock.contexts).toHaveLength(27);
      expect(new Set(dispose.mock.contexts).size).toBe(27);
      for (const skeleton of initial) {
        expect(textures.get(skeleton)).toHaveBeenCalledTimes(owned.has(skeleton) ? 0 : 1);
        expect(dispose.mock.contexts.includes(skeleton)).toBe(!owned.has(skeleton));
      }
      for (const s of original) expect(dispose.mock.contexts.includes(s)).toBe(false);
      const sources = skins(gltf.scene);
      for (let i = 0; i < meshes.length; i++) {
        expect(meshes[i].geometry).toBe(sources[i].geometry);
        expect(meshes[i].material).toBe(sources[i].material);
        expect(meshes[i].bindMatrix.elements).toEqual(sources[i].bindMatrix.elements);
        expect(meshes[i].skeleton.bones).toEqual(before.get(meshes[i])!.bones);
        meshes[i].skeleton.boneInverses.forEach((matrix, j) => expect(matrix.elements).toEqual(sources[i].skeleton.boneInverses[j].elements));
      }
      expect(shareEquivalentSkeletons(body)).toEqual(owned);
      expect(dispose.mock.contexts).toHaveLength(27);
    } finally {
      dispose.mockRestore(); for (const spy of textures.values()) spy.mockRestore();
      for (const skeleton of owned) skeleton.dispose();
    }
  });

  it('does not merge distinct bone identities or different inverse matrices even when bone names match', () => {
    const root = new T.Group(), a = new T.Bone(), b = new T.Bone(); a.name = b.name = 'same-name';
    const palettes = [new T.Skeleton([a], [new T.Matrix4()]), new T.Skeleton([b], [new T.Matrix4()]),
      new T.Skeleton([a], [new T.Matrix4().makeTranslation(.01, 0, 0)])];
    for (const skeleton of palettes) { const mesh = new T.SkinnedMesh(); mesh.skeleton = skeleton; root.add(mesh); }
    expect([...shareEquivalentSkeletons(root)]).toEqual(palettes);
    for (const skeleton of palettes) skeleton.dispose();
  });

  it('computes cloth skin matrices at most twice per bone per new pose, including its GPU palette update', () => {
    const assets = new GameAssets(); assets.models.set('falconC02', gltf);
    const p = c02Player(), root = assets.operator(p)!;
    const cloth = root.getObjectByName('FALCON_|_combat_uniform_and_boots') as T.SkinnedMesh;
    const worlds = new Set(cloth.skeleton.bones.map(b => b.matrixWorld)), inverses = new Set(cloth.skeleton.boneInverses);
    const original = T.Matrix4.prototype.multiplyMatrices;
    let products = 0;
    const multiply = vi.spyOn(T.Matrix4.prototype, 'multiplyMatrices').mockImplementation(function (this: T.Matrix4, a, b) {
      if (worlds.has(a) && inverses.has(b)) products++;
      return original.call(this, a, b);
    });
    try {
      assets.animateOperator(root, { ...p, pitch: -.8, stancePhase: .2 }, 1 / 60);
      expect(products).toBeLessThanOrEqual(2 * cloth.skeleton.bones.length);
    } finally { multiply.mockRestore(); assets.releaseActor(root); }
  });

  it('keeps one equivalent body palette plus eight private knee palettes, isolated across actors', () => {
    const assets = new GameAssets(); assets.models.set('falconC02', gltf);
    const a = assets.operator(c02Player())!, b = assets.operator(c02Player())!;
    try {
      expect(skins(a)).toHaveLength(28);
      expect(skeletons(a).size).toBe(9);
      expect(skeletons(b).size).toBe(9);
      for (const s of skeletons(a)) {
        expect(skeletons(b).has(s)).toBe(false);
        expect(skeletons(gltf.scene).has(s)).toBe(false);
      }
      expect([...skeletons(a)].filter(s => s.bones.some(bone => bone.name.startsWith('ACTION03_')))).toHaveLength(8);
    } finally { assets.releaseActor(a); assets.releaseActor(b); }
  });

  it('releases each active actor skeleton once, leaving the sibling and source resources alive', () => {
    const assets = new GameAssets(); assets.models.set('falconC02', gltf);
    const a = assets.operator(c02Player())!, b = assets.operator(c02Player())!;
    const owned = skeletons(a), untouched = new Set([...skeletons(b), ...skeletons(gltf.scene)]);
    for (const skeleton of owned) skeleton.computeBoneTexture();
    const textures = [...owned].map(s => vi.spyOn(s.boneTexture!, 'dispose'));
    const dispose = vi.spyOn(T.Skeleton.prototype, 'dispose');
    try {
      expect(assets.releaseActor(a)).toBe(true); expect(assets.releaseActor(a)).toBe(false);
      expect(dispose.mock.contexts).toHaveLength(owned.size);
      for (const s of owned) expect(dispose.mock.contexts.filter(value => value === s)).toHaveLength(1);
      for (const texture of textures) expect(texture).toHaveBeenCalledTimes(1);
      for (const s of untouched) expect(dispose.mock.contexts.includes(s)).toBe(false);
    } finally { dispose.mockRestore(); textures.forEach(spy => spy.mockRestore()); assets.releaseActor(b); }
  });

  it('shares only its own first-person palette and disposes that palette exactly once', () => {
    const root = createFalconViewmodel(gltf), other = createFalconViewmodel(gltf), owned = skeletons(root);
    const sourceGeometry = new Set(skins(gltf.scene).map(mesh => mesh.geometry));
    const cropped = new Set(skins(root).map(mesh => mesh.geometry).filter(g => !sourceGeometry.has(g)));
    const dispose = vi.spyOn(T.Skeleton.prototype, 'dispose');
    const geometryDispose = vi.spyOn(T.BufferGeometry.prototype, 'dispose');
    try {
      expect(owned.size).toBe(1);
      expect(skeletons(other).size).toBe(1);
      disposeFalconViewmodel(root); disposeFalconViewmodel(root);
      expect(dispose.mock.contexts).toEqual([...owned]);
      expect(new Set(geometryDispose.mock.contexts)).toEqual(cropped);
      expect(geometryDispose.mock.contexts).toHaveLength(cropped.size);
      for (const s of [...skeletons(other), ...skeletons(gltf.scene)]) expect(dispose.mock.contexts.includes(s)).toBe(false);
    } finally { dispose.mockRestore(); geometryDispose.mockRestore(); disposeFalconViewmodel(root); disposeFalconViewmodel(other); }
  });
});

const assertVerticesEqual = (a: T.Object3D, b: T.Object3D) => {
  const left = skins(a), right = skins(b), p = new T.Vector3(), q = new T.Vector3();
  let count = 0;
  for (let m = 0; m < left.length; m++) {
    for (let i = 0; i < left[m].geometry.getAttribute('position').count; i++) {
      left[m].getVertexPosition(i, p).applyMatrix4(left[m].matrixWorld);
      right[m].getVertexPosition(i, q).applyMatrix4(right[m].matrixWorld);
      if (!p.equals(q)) throw new Error(`Vertex changed: ${left[m].name}[${i}] ${p.toArray()} != ${q.toArray()}`);
      count++;
    }
  }
  expect(count).toBeGreaterThan(20000);
};

describe('C02 exact CPU skinning and contact', () => {
  it('preserves all skinned vertices, bind inverses, knee reports and independently animated actors', () => {
    const create = (shared: boolean) => {
      const body = clone(gltf.scene), root = new T.Group();
      root.position.set(2, 1, -3); root.rotation.y = .5; body.rotation.y = Math.PI; root.add(body);
      if (shared) shareEquivalentSkeletons(body);
      const mixer = new T.AnimationMixer(body), pose = new FalconCombatPose(body);
      const action = mixer.clipAction(gltf.animations.find(c => c.name === 'Rifle_Reload')!);
      action.play(); action.paused = true;
      return { body, root, mixer, pose, action };
    };
    const reference = create(false), cached = create(true), untouched = create(true);
    const sourceBones: number[][] = [];
    gltf.scene.traverse(o => { if (o instanceof T.Bone) sourceBones.push(o.matrixWorld.elements.slice()); });
    const sample = (actor: ReturnType<typeof create>, i: number) => {
      const yaw = .5 + i * .13, pitch = Math.sin(i) * 1.3;
      actor.root.rotation.y = yaw;
      const report = sampleFalconCombatPose(actor.pose, () => {
        actor.action.time = .12 + i * .18; actor.mixer.update(0);
        // Vary both actual leg chains independently, beyond one static authored pose.
        actor.body.getObjectByName('Bip01_L_Thigh')!.rotation.z += .015 * i;
        actor.body.getObjectByName('Bip01_R_Thigh')!.rotation.z -= .008 * i;
      }, { yaw, pitch, crouch: [0, .05, .2, .4, .7, 1, .2, 0][i] });
      actor.root.updateMatrixWorld(true);
      return report;
    };
    try {
      sample(untouched, 0);
      const otherMatrices = skins(untouched.body).map(m => m.skeleton.bones.map(b => b.matrixWorld.elements.slice()));
      for (let i = 0; i < 8; i++) {
        expect(sample(cached, i)).toEqual(sample(reference, i));
        // Use Three's original uncached getter in the reference contact solver after
        // initialization, retaining the exact same geometry, poses and ray tests.
        const frame = (reference.pose as unknown as { skinFrame: SkinnedVertexFrame }).skinFrame;
        frame.getVertexPosition = (index, target) => frame.mesh.getVertexPosition(index, target);
        assertVerticesEqual(cached.body, reference.body);
        for (const mesh of skins(cached.body)) {
          const skinFrame = new SkinnedVertexFrame(mesh), expected = new T.Vector3(), actual = new T.Vector3();
          skinFrame.begin();
          for (let j = 0; j < mesh.geometry.getAttribute('position').count; j++) {
            mesh.getVertexPosition(j, expected); skinFrame.getVertexPosition(j, actual);
            if (!actual.equals(expected)) throw new Error(`Cached CPU vertex changed: ${mesh.name}[${j}]`);
          }
        }
      }
      expect(skins(untouched.body).map(m => m.skeleton.bones.map(b => b.matrixWorld.elements.slice()))).toEqual(otherMatrices);
      const after: number[][] = [];
      gltf.scene.traverse(o => { if (o instanceof T.Bone) after.push(o.matrixWorld.elements.slice()); });
      expect(after).toEqual(sourceBones);
    } finally {
      for (const actor of [reference, cached, untouched]) {
        actor.pose.dispose(); actor.mixer.stopAllAction(); actor.mixer.uncacheRoot(actor.body);
        for (const skeleton of skeletons(actor.body)) skeleton.dispose();
      }
    }
  });

  it.each([false, true])('retains morph evaluation for relative=%s with exact double precision', relative => {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute([.1, .2, .3], 3));
    geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute([0, 1, 0, 0], 4));
    geometry.setAttribute('skinWeight', new T.Float32BufferAttribute([.4, .6, 0, 0], 4));
    geometry.morphAttributes.position = [new T.Float32BufferAttribute([.9, -.3, .4], 3)];
    geometry.morphTargetsRelative = relative;
    const mesh = new T.SkinnedMesh(geometry), bones = [new T.Bone(), new T.Bone()];
    bones[0].matrixWorld.makeRotationY(.43); bones[1].matrixWorld.makeTranslation(.123, .45, -.67);
    mesh.skeleton = new T.Skeleton(bones, [new T.Matrix4(), new T.Matrix4().makeRotationZ(.25)]);
    mesh.morphTargetInfluences![0] = .37;
    const cache = new SkinnedVertexFrame(mesh); cache.begin();
    expect(cache.getVertexPosition(0, new T.Vector3()).toArray()).toEqual(mesh.getVertexPosition(0, new T.Vector3()).toArray());
    mesh.skeleton.dispose(); geometry.dispose(); (mesh.material as T.Material).dispose();
  });
});
