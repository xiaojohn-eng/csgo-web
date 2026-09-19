import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { FalconCombatPose, SkinnedVertexFrame, sampleFalconCombatPose, type CombatPoseInput } from '../game/falcon-combat-pose';
import { falconCompleteReferences } from '../game/falcon-body-reference';
import { shareEquivalentSkeletons } from '../game/share-skeleton';

export type RenderCase = CombatPoseInput & { clip: string; time: number; origin: [number, number, number] };
export const C02_EXPECTED_SHA = 'a541aeb26e0e6154830e23f2f6c3c978e54b0209f0e930564bb5f43545adfa2a';
export const RENDER_TOLERANCE = { jointMeters: .00005, segmentMeters: .000005, footRotationRadians: .00001, cachedVertexMeters: 1e-10 };

/** Node-only numerical loading: strip image/material I/O in memory, retaining every
 * original geometry, animation, skin weight, hierarchy and bind inverse from shipped bytes.
 */
export async function loadC02ForValidation(): Promise<{ gltf: GLTF; sha256: string }> {
  const source = readFileSync(new URL('../public/models/web-w01/falcon-combat-actions.glb', import.meta.url));
  const sha256 = createHash('sha256').update(source).digest('hex');
  if (sha256 !== C02_EXPECTED_SHA) throw new Error(`C02 source changed: ${sha256}`);
  const length = new DataView(source.buffer, source.byteOffset, source.byteLength).getUint32(12, true);
  const json = JSON.parse(source.subarray(20, 20 + length).toString());
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  json.materials = []; json.images = []; json.textures = [];
  const text = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32); text.copy(padded);
  const binary = source.subarray(20 + length), header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length + binary.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const data = Buffer.concat([header, padded, binary]);
  return { gltf: await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), ''), sha256 };
}

export function locomotionRenderCases(full = false): RenderCase[] {
  const clips: [string, number[]][] = [ ['Rifle_Idle', [0, 1.37, 3.999]], ['Rifle_Fire', [0, .0575, .114999]],
    ['Rifle_Reload', [0, .42, 1.05, 1.7, 2.2499]] ];
  const phases = full ? [0, .0625, .2, .32, .5, .68, .875, .99999] : [0, .32, .68, .99999];
  const directions: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0], ...full ? [[.8, -.6], [-.6, .8]] as [number, number][] : []];
  const cases: RenderCase[] = [];
  for (const [clip, times] of clips) for (const time of times) for (const crouch of [0, .5, 1])
    for (const pitch of full ? [-1.5, -.6, 0, .6, 1.5] : [-1.5, 0, 1.5])
      for (const stridePhase of phases) for (const [strideX, strideZ] of directions) {
        const i = cases.length;
        cases.push({ clip, time, crouch, pitch, stridePhase, strideX, strideZ,
          strideWeight: [0, .35, 1][(Math.floor(i / 7) + i) % 3], strideSpeed: [1.2, 2.1, 4.8][(Math.floor(i / 11) + i) % 3],
          yaw: [0, .7, Math.PI / 2, -2.1][(Math.floor(i / 5) + i) % 4], grounded: i % 7 !== 0,
          origin: i % 2 === 0 ? [0, 0, 0] : [7.25, 1.3, -9.5] });
      }
  cases.push({ clip: 'Rifle_Reload', time: 1.05, crouch: 0, pitch: -1.5, yaw: 0, origin: [0, 0, 0],
    stridePhase: .4375, strideWeight: 1, strideSpeed: 4.8, strideX: .8660254037844387, strideZ: .5, grounded: true });
  for (const [strideX, strideZ] of [[0, -1], [1, 0]]) cases.push({ clip: 'Rifle_Idle', time: 0, crouch: 0,
    pitch: 0, yaw: 0, origin: [100, .015, 100], stridePhase: 1.2934666666666519,
    strideWeight: .9990881180344454, strideSpeed: 4.791494431486713, strideX, strideZ, grounded: true });
  return cases;
}

function geometryDigest(root: T.Object3D): string {
  const hash = createHash('sha256');
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    const geometry = object.geometry;
    for (const [name, attribute] of Object.entries({ ...geometry.attributes, ...(geometry.index ? { index: geometry.index } : {}) })) {
      const a = attribute as T.BufferAttribute | T.InterleavedBufferAttribute;
      const array = 'isInterleavedBufferAttribute' in a ? a.data.array : a.array;
      hash.update(`${object.name}/${name}/${a.itemSize}/${a.count}/${a.normalized}`);
      hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    }
    for (const [name, attributes] of Object.entries(geometry.morphAttributes) as [string, T.BufferAttribute[]][]) for (const a of attributes) {
      hash.update(`${object.name}/morph/${name}`); hash.update(new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength));
    }
  });
  return hash.digest('hex');
}

const meshList = (root: T.Object3D): T.SkinnedMesh[] => { const result: T.SkinnedMesh[] = [];
  root.traverse(o => { if (o instanceof T.SkinnedMesh) result.push(o); }); return result; };
const point = (o: T.Object3D) => o.getWorldPosition(new T.Vector3());
const transform = (o: T.Object3D) => [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()];

export function createC02RenderHarness(source: GLTF) {
  const sourceDigest = geometryDigest(source.scene), body = clone(source.scene), root = new T.Group();
  const originals = meshList(body).map(mesh => ({ mesh, inverses: mesh.skeleton.boneInverses.map(m => m.clone()) }));
  shareEquivalentSkeletons(body); body.rotation.y = Math.PI; root.add(body);
  const pose = new FalconCombatPose(body), mixer = new T.AnimationMixer(body);
  const actions = new Map(source.animations.map(clip => { const action = mixer.clipAction(clip);
    action.setLoop(T.LoopOnce, 1); action.clampWhenFinished = true; return [clip.name, action] as const; }));
  const bones = (side: 'L' | 'R') => ['Thigh', 'Calf', 'Foot'].map(name => body.getObjectByName(`Bip01_${side}_${name}`)!);
  const cloth = body.getObjectByName('FALCON_|_combat_uniform_and_boots') as T.SkinnedMesh;
  const vertexFrame = new SkinnedVertexFrame(cloth);
  let current = '';

  function sample(input: RenderCase) {
    root.position.fromArray(input.origin); root.rotation.y = input.yaw;
    const authorityBefore = transform(root), inputBefore = JSON.stringify(input);
    const lengths: number[] = [], rotations: T.Quaternion[] = [];
    const report = sampleFalconCombatPose(pose, () => {
      const action = actions.get(input.clip); if (!action) throw new Error(`Missing actual clip ${input.clip}`);
      if (current !== input.clip) { mixer.stopAllAction(); action.reset().play(); current = input.clip; }
      action.paused = true; action.time = input.time; mixer.update(0); root.updateWorldMatrix(true, true);
      for (const side of ['L', 'R'] as const) { const chain = bones(side).map(point);
        lengths.push(chain[0].distanceTo(chain[1]), chain[1].distanceTo(chain[2]));
        rotations.push(bones(side)[2].getWorldQuaternion(new T.Quaternion()).normalize()); }
    }, input);
    // The renderer invokes updateMatrixWorld, including SkinnedMesh bindMatrixInverse.
    root.updateMatrixWorld(true);
    const expected = falconCompleteReferences({ ...input, blend: input.crouch,
      origin: { x: input.origin[0], y: input.origin[1], z: input.origin[2] } });
    let jointError = 0, segmentError = 0, footRotationError = 0;
    const observations: Record<string, { actual: number[]; expected: number[]; error: number }> = {};
    for (const [sideIndex, side] of (['L', 'R'] as const).entries()) {
      const target = expected.feet[side === 'L' ? 'left' : 'right'], chain = bones(side).map(point);
      for (const [joint, value] of ([['hip', target.hip], ['knee', target.knee], ['ankle', target.position]] as const).entries()) {
        const wanted = root.localToWorld(new T.Vector3(value[1].x, value[1].y, value[1].z));
        const error = chain[joint].distanceTo(wanted); jointError = Math.max(jointError, error);
        observations[`${side}/${value[0]}`] = { actual: chain[joint].toArray(), expected: wanted.toArray(), error };
      }
      segmentError = Math.max(segmentError, Math.abs(chain[0].distanceTo(chain[1]) - lengths[sideIndex * 2]),
        Math.abs(chain[1].distanceTo(chain[2]) - lengths[sideIndex * 2 + 1]));
      footRotationError = Math.max(footRotationError, bones(side)[2].getWorldQuaternion(new T.Quaternion()).normalize().angleTo(rotations[sideIndex]));
    }
    // Independent Three.js reference operation, not the optimized cache or public gait IK.
    vertexFrame.begin(); let cachedVertexError = 0;
    for (let j = 0; j < cloth.geometry.attributes.position.count; j += 997) {
      const actual = vertexFrame.getVertexPosition(j, new T.Vector3()), wanted = cloth.getVertexPosition(j, new T.Vector3());
      cachedVertexError = Math.max(cachedVertexError, actual.distanceTo(wanted));
    }
    return { jointError, segmentError, footRotationError, cachedVertexError, observations,
      authorityUnchanged: JSON.stringify(transform(root)) === JSON.stringify(authorityBefore), inputUnchanged: JSON.stringify(input) === inputBefore,
      pelvisDrop: expected.pelvisDrop, kneeContactMisses: report.kneeGear.filter(g => !g.contactFound).length,
      kneeContactClamps: report.kneeGear.filter(g => g.contactClamped).length,
      poseVector: (['L', 'R'] as const).flatMap(side => bones(side).flatMap(bone => point(bone).toArray())) };
  }

  return { sample, root, body,
    invariants() { return { sourceGeometryUnchanged: geometryDigest(source.scene) === sourceDigest,
      renderedGeometryUnchanged: geometryDigest(body) === sourceDigest,
      inverseMatricesUnchanged: originals.every(({ mesh, inverses }) => mesh.skeleton.boneInverses.length === inverses.length
        && inverses.every((matrix, i) => matrix.equals(mesh.skeleton.boneInverses[i]))) }; },
    dispose() { pose.dispose(); mixer.stopAllAction(); mixer.uncacheRoot(body);
      const skeletons = new Set(meshList(body).map(mesh => mesh.skeleton)); for (const skeleton of skeletons) skeleton.dispose(); root.remove(body); },
  };
}

export async function validateLocomotion(cases = locomotionRenderCases(true)) {
  const { gltf, sha256 } = await loadC02ForValidation(), harness = createC02RenderHarness(gltf);
  const maxima = { jointError: 0, segmentError: 0, footRotationError: 0, cachedVertexError: 0, pelvisDrop: 0 };
  const witnesses: Partial<Record<keyof typeof maxima, RenderCase>> = {};
  let failureCount = 0, kneeContactMisses = 0, kneeContactClamps = 0;
  const failures: { input: RenderCase; measurements: ReturnType<typeof harness.sample> | { error: string } }[] = [];
  const started = performance.now();
  for (const input of cases) {
    try {
      const result = harness.sample(input);
      for (const key of Object.keys(maxima) as (keyof typeof maxima)[]) if (result[key] > maxima[key]) { maxima[key] = result[key]; witnesses[key] = input; }
      kneeContactMisses += result.kneeContactMisses; kneeContactClamps += result.kneeContactClamps;
      if (result.jointError > RENDER_TOLERANCE.jointMeters || result.segmentError > RENDER_TOLERANCE.segmentMeters
        || result.footRotationError > RENDER_TOLERANCE.footRotationRadians || result.cachedVertexError > RENDER_TOLERANCE.cachedVertexMeters
        || result.kneeContactMisses !== 0 || result.kneeContactClamps !== 0
        || !result.authorityUnchanged || !result.inputUnchanged) {
        failureCount++; if (failures.length < 6) failures.push({ input, measurements: result });
      }
    } catch (error) { failureCount++; if (failures.length < 6) failures.push({ input, measurements: { error: String(error) } }); }
  }
  const invariants = harness.invariants(); harness.dispose();
  for (const mesh of meshList(gltf.scene)) { mesh.geometry.dispose(); (mesh.material as T.Material).dispose(); mesh.skeleton.dispose(); }
  return { sha256, cases: cases.length, tolerance: RENDER_TOLERANCE, maxima, witnesses, failureCount, failures,
    invariants, kneeContactMisses, kneeContactClamps, elapsedSeconds: (performance.now() - started) / 1000,
    valid: failureCount === 0 && Object.values(invariants).every(Boolean),
    scope: 'Actual GLB bone/skin numerical consumption only; not GPU, ground/obstacle clearance, limb self-collision, or original-game motion fidelity.' };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await validateLocomotion(locomotionRenderCases(!process.argv.includes('--quick')));
  console.log(JSON.stringify(result, null, 2)); if (!result.valid) process.exitCode = 1;
}
