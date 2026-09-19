import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Matrix4 } from 'three';
import { accumulateSourceSequence, advanceSourceSequenceCycle, prepareSourceCharacterPose, sampleSourceAnimationFrame,
  sampleSourceCharacterPose, sampleSourceSequence, sourceCharacterBrowserBoneMatrices, sourceCharacterHitboxTransforms,
  sourceSequenceCycleRate, interpolateSourcePoseInput, type SourceCharacterPoseData, type SourceCharacterPoseInput, type SourceCharacterState } from '../game/source-character-pose';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function fixture() {
  // Two absolute frames and a one-frame delta with a distinct rotation axis.
  const values = new Float64Array([0, 0, 0, 4, 2, 6, 0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2, 1, 2, 3, Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  const bone = { name: 'root', parent: -1, position: [0, 0, 0], quaternion: [0, 0, 0, 1], flags: 0,
    alignment: [0, 0, 0, 1], inverseBindSource: identity, inverseBindGltf: identity };
  const seq = { index: 0, name: 'idle_lower', flags: 1, groupSize: [1, 1], animationIndices: [0], parameterIndices: [-1, -1], poseKeys: [], boneWeights: [1], autoLayers: [] };
  const states = Object.fromEntries(['Idle', 'Walk', 'Run', 'Crouch_Idle', 'Crouch_Walk'].map(s => [s, { lower: 0, upper: 0, shoot: 1 }])) as SourceCharacterPoseData['states'];
  states.Jump = { lower: 2, upper: 0, shoot: 1 };
  const data: SourceCharacterPoseData = { format: 'source-character-pose-v1', mainModel: 'test', animationModel: 'test', mainBones: [bone], animationBones: [bone], mainToAnimation: [0],
    renderJoints: [{ mainBone: 0, sourceName: 'root', gltfNode: 0, gltfName: 'root', skinJoint: 0 }], poseParameters: [],
    sequences: [seq, { ...seq, index: 1, name: 'delta', flags: 20, animationIndices: [1] }, { ...seq, index: 2, name: 'jump_lower', animationIndices: [0] }], descriptors: [
      { index: 0, name: 'absolute', fps: 30, frames: 2, flags: 0, delta: false, positionsOffset: 0, positionsCount: 6, quaternionsOffset: 6, quaternionsCount: 8, ikRules: 0, movements: 0 },
      { index: 1, name: 'delta', fps: 30, frames: 1, flags: 4, delta: true, positionsOffset: 14, positionsCount: 3, quaternionsOffset: 17, quaternionsCount: 4, ikRules: 0, movements: 0 }], states,
    frames: { file: 'test.bin', encoding: 'float64-little-endian', byteLength: values.byteLength, sha256: 'synthetic' }, renderGlb: { file: 'test.glb', sha256: 'synthetic' },
    rootMotionPolicy: 'preserved', viewAndHullPolicy: 'separate', inverseBindPolicy: 'original', hitboxSets: [] };
  return { data, bytes: new Uint8Array(values.buffer) };
}
const error = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.max(...Array.from(a, (v, i) => Math.abs(v - b[i])));

describe('continuous original Source pose contract', () => {
  it('interpolates unwrapped authority clocks forward and locates a later shot even if its elapsed time exceeds the old elapsed', () => {
    const a: SourceCharacterPoseInput = { state: 'Idle', cycle: .9, parameters: { body_yaw: -20 }, fireCycle: .0375, fireWeight: 1, fireTimeSeconds: .03, fireCycleRate: 1.25 };
    const b: SourceCharacterPoseInput = { ...a, cycle: 2.1, parameters: { body_yaw: 20 }, fireCycle: .1875, fireTimeSeconds: .15 };
    const before = interpolateSourcePoseInput(a, b, .1, { spanSeconds: .2 }), after = interpolateSourcePoseInput(a, b, .5, { spanSeconds: .2 });
    expect(before.fireTimeSeconds).toBeCloseTo(.05, 14); expect(after.fireTimeSeconds).toBeCloseTo(.05, 14);
    expect(after.cycle).toBeCloseTo(1.5, 14); expect(after.fireCycle).toBeCloseTo(.0625, 14); expect(after.parameters.body_yaw).toBe(0);
    const end = interpolateSourcePoseInput(a, b, 1, { spanSeconds: .2 }); expect(end).toEqual(b); expect(end.parameters).not.toBe(b.parameters);
    expect(interpolateSourcePoseInput(a, { ...b, state: 'Run' }, .99, { spanSeconds: .2 })).toEqual(a);
    const ended = interpolateSourcePoseInput({ ...a, fireTimeSeconds: .7, fireCycle: .875 }, { ...b, fireTimeSeconds: .9, fireCycle: 1, fireWeight: 0 }, .75, { spanSeconds: .2 });
    expect(ended.fireCycle).toBe(1); expect(ended.fireWeight).toBe(0);
  });
  it('interpolates encoded frames by normalized lerp, preserving source translation and cycle policy', () => {
    const { data, bytes } = fixture(), index = prepareSourceCharacterPose(data, bytes), p = sampleSourceAnimationFrame(index, 0, .25);
    expect(Array.from(p.positions)).toEqual([1, .5, 1.5]);
    const raw = [0, 0, Math.SQRT1_2 * .25, .75 + Math.SQRT1_2 * .25], norm = Math.hypot(...raw);
    expect(error(p.quaternions, raw.map(v => v / norm))).toBeLessThan(1e-15);
    expect(sampleSourceSequence(index, 0, 1.25, {})).toEqual(sampleSourceSequence(index, 0, .25, {}));
    expect(sampleSourceSequence(index, 0, -.75, {})).toEqual(sampleSourceSequence(index, 0, .25, {}));
    data.sequences[0].flags = 0; const nonloop = prepareSourceCharacterPose(data, bytes);
    expect(sampleSourceSequence(nonloop, 0, 3, {})).toEqual(sampleSourceAnimationFrame(nonloop, 0, 1));
    expect(sampleSourceSequence(nonloop, 0, -3, {})).toEqual(sampleSourceAnimationFrame(nonloop, 0, 0));
  });
  it('applies original per-bone delta weight, post multiplication and zero-weight identity', () => {
    const { data, bytes } = fixture(), index = prepareSourceCharacterPose(data, bytes), base = sampleSourceAnimationFrame(index, 0, 1);
    const post = accumulateSourceSequence(index, base, 1, .3, .5, {});
    expect(Array.from(post.positions)).toEqual([4.5, 3, 7.5]);
    const scaledSin = Math.sin(Math.PI / 8), x = Math.SQRT1_2 * scaledSin / (Math.SQRT1_2 + 2 ** -23), w = Math.cos(Math.PI / 8);
    const expected = [Math.SQRT1_2 * x, Math.SQRT1_2 * x, Math.SQRT1_2 * w, Math.SQRT1_2 * w], norm = Math.hypot(...expected);
    expect(error(post.quaternions, expected.map(v => v / norm))).toBeLessThan(1e-15);
    data.sequences[1].flags = 4; const pre = accumulateSourceSequence(prepareSourceCharacterPose(data, bytes), base, 1, .3, .5, {});
    expect(pre.quaternions[1]).toBeCloseTo(-post.quaternions[1], 14);
    expect(accumulateSourceSequence(index, base, 1, .3, 0, {})).toEqual(base);
    data.sequences[1].boneWeights = [0]; expect(accumulateSourceSequence(prepareSourceCharacterPose(data, bytes), base, 1, .3, 1, {})).toEqual(base);
  });
  it('respects absolute fixed-alignment signs without flipping original delta frames', () => {
    const { data, bytes } = fixture(); data.animationBones[0].flags = 0x100000; data.animationBones[0].alignment = [0, 0, 0, -1];
    const index = prepareSourceCharacterPose(data, bytes);
    expect(sampleSourceAnimationFrame(index, 0, .2).quaternions[3]).toBeLessThan(0);
    expect(sampleSourceAnimationFrame(index, 1, .2).quaternions[3]).toBeGreaterThan(0);
  });
  it('owns exactly an unaligned Buffer window and is unaffected by external data/byte mutations', () => {
    const { data, bytes } = fixture(), slab = Buffer.alloc(bytes.length + 13); slab.set(bytes, 3);
    const index = prepareSourceCharacterPose(data, slab.subarray(3, 3 + bytes.length)), before = sampleSourceSequence(index, 0, .4, {});
    slab.fill(0); bytes.fill(0); data.animationBones[0].position[0] = 900; data.sequences[0].animationIndices[0] = 999;
    expect(sampleSourceSequence(index, 0, .4, {})).toEqual(before);
  });
  it('converts the same Source bone matrix through actor * scale * C for rendering and future hits', () => {
    const { data, bytes } = fixture(), index = prepareSourceCharacterPose(data, bytes);
    const p = sampleSourceCharacterPose(index, { state: 'Idle', cycle: .37, parameters: {}, fireWeight: .28 });
    const actor = new Matrix4().makeRotationY(.67).setPosition(31, 4, -72);
    const C = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
    const expected = actor.clone().multiply(new Matrix4().makeScale(.0254, .0254, .0254)).multiply(C).multiply(new Matrix4().fromArray(p.sourceWorldMatrices));
    expect(error(sourceCharacterBrowserBoneMatrices(p, actor.elements), expected.elements)).toBeLessThan(1e-14);
    expect(p.positions[2]).toBeGreaterThan(0); // Source root is retained, not zeroed to actor height.
    expect(() => sourceCharacterBrowserBoneMatrices(p, identity, 0)).toThrow();
    expect(() => sourceCharacterBrowserBoneMatrices(p, identity.slice(1))).toThrow();
  });
  it('advances source clocks with original frame span and rejects invalid or unsupported data', () => {
    const { data, bytes } = fixture(), index = prepareSourceCharacterPose(data, bytes);
    expect(sourceSequenceCycleRate(index, 0, {})).toBe(30); expect(sourceSequenceCycleRate(index, 1, {})).toBe(0);
    expect(advanceSourceSequenceCycle(index, 0, .3, .04, {}).cycle).toBeCloseTo(.5, 14);
    for (const mutate of [
      (d: SourceCharacterPoseData) => { d.sequences[0].animationIndices = [999]; },
      (d: SourceCharacterPoseData) => { d.descriptors[0].positionsOffset = 1; },
      (d: SourceCharacterPoseData) => { d.mainBones[0].parent = 0; },
      (d: SourceCharacterPoseData) => { d.sequences[0].flags |= 128; },
      (d: SourceCharacterPoseData) => { d.sequences[0].autoLayers = [{ sequence_id: 1, flags: 1, start: 0, peak: 0, tail: 1, end: 1 }]; },
    ]) { const f = fixture(); mutate(f.data); expect(() => prepareSourceCharacterPose(f.data, f.bytes)).toThrow(); }
    expect(() => sampleSourceSequence(index, 0, NaN, {})).toThrow();
    expect(() => sampleSourceCharacterPose(index, { state: 'Idle', cycle: 0, parameters: { body_yaw: NaN } })).toThrow();
    expect(() => accumulateSourceSequence(index, index.rest, 1, 0, 1.1, {})).toThrow();
    expect(() => advanceSourceSequenceCycle(index, 0, 0, -1, {})).toThrow();
  });
});

const base = resolve('.reference-assets/source-exports/character-t'), dir = resolve(base, 'continuous');
const available = existsSync(resolve(dir, 'pose-data.json')) && existsSync(resolve(dir, 'interior-pose-fixtures.json'));
describe.runIf(available)('actual 71-bone Source T pose data', () => {
  const data = available ? JSON.parse(readFileSync(resolve(dir, 'pose-data.json'), 'utf8')) : null;
  const index = available ? prepareSourceCharacterPose(data, readFileSync(resolve(dir, 'frames.f64.bin'))) : null!;
  it('matches every retained independent Python world matrix in both SDK blend modes', () => {
    const samples = JSON.parse(readFileSync(resolve(base, 'combat/sampled-poses.json'), 'utf8')).samples;
    expect(samples).toHaveLength(40);
    for (const s of samples) {
      const p = sampleSourceCharacterPose(index, { state: s.state, cycle: s.cycle, parameters: s.params, fireWeight: s.fireWeight, blendMode: s.blendMode });
      index.data.mainBones.forEach((bone, i) => {
        const expected = s.boneWorldMatrices[bone.name];
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) expect(Math.abs(p.sourceWorldMatrices[i * 16 + c * 4 + r] - expected[r][c])).toBeLessThan(.0001);
      });
    }
  });
  it('matches Python arbitrary interior directions and separate lower/upper/fire clocks', () => {
    const samples = JSON.parse(readFileSync(resolve(dir, 'interior-pose-fixtures.json'), 'utf8')).samples;
    expect(samples).toHaveLength(40);
    for (const s of samples) {
      const p = sampleSourceCharacterPose(index, s.input);
      expect(error(p.animationPose.positions, s.positions)).toBeLessThan(1e-12);
      expect(error(p.animationPose.quaternions, s.quaternions)).toBeLessThan(1e-12);
    }
  });
  it('can seek deterministically to arbitrary cycles and preserves source root, bind matrices and unknown hitbox bytes', () => {
    const original = JSON.stringify(index.data.mainBones), input: SourceCharacterPoseInput = { state: 'Run', cycle: .348671,
      parameters: { move_x: -.456, move_y: .739, body_yaw: 14.37, body_pitch: -31.92 }, fireCycle: .4143, fireWeight: .48 };
    const p = sampleSourceCharacterPose(index, input); sampleSourceCharacterPose(index, { ...input, cycle: 342.481 });
    expect(sampleSourceCharacterPose(index, input)).toEqual(p); expect(JSON.stringify(index.data.mainBones)).toBe(original);
    expect(sourceCharacterHitboxTransforms(index, p)).toHaveLength(22);
    for (const h of sourceCharacterHitboxTransforms(index, p)) {
      expect(h.hitbox.sourceBytesHex).toHaveLength(136); expect(h.hitbox.extensionBytesHex).toHaveLength(64);
      expect(h.sourceBoneMatrix).toEqual(p.sourceWorldMatrices.slice(h.hitbox.bone * 16, h.hitbox.bone * 16 + 16));
    }
    expect(new Set(index.data.mainBones.filter((_, i) => index.data.mainToAnimation[i] < 0).map(b => b.name))).toEqual(new Set(['weapon_hand_L', 'weapon_hand_R']));
    expect(p.positions[2]).not.toBe(0);
  });
  it('uses all descriptor spans for run timing, with stance chosen explicitly by caller', () => {
    for (const state of Object.keys(data.states) as SourceCharacterState[]) {
      const seq = index.sequences.get(data.states[state].lower)!, params = { move_x: .23, move_y: .61 };
      const rate = sourceSequenceCycleRate(index, seq.index, params);
      expect(rate).toBeGreaterThan(0);
      const a = advanceSourceSequenceCycle(index, seq.index, .317, .1, params), b = advanceSourceSequenceCycle(index, seq.index, .317, .04, params);
      expect(advanceSourceSequenceCycle(index, seq.index, b.cycle, .06, params).cycle).toBeCloseTo(a.cycle, 14);
    }
    const run = index.sequences.get(data.states.Run.lower)!;
    expect(new Set(run.animationIndices.map(id => index.frames.get(id)!.descriptor.frames))).toEqual(new Set([20, 21]));
  });
});
