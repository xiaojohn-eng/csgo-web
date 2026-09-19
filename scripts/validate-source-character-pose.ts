import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Matrix4, type Object3D, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { accumulateSourceSequence, prepareSourceCharacterPose, sampleSourceAnimationFrame, sampleSourceCharacterPose,
  sampleSourceSequence, sourceCharacterBrowserBoneMatrices, sourceCharacterHitboxTransforms, sourceSequenceCycleRate, type SourceCharacterState, type SourcePoseMode,
  type SourcePoseParameters, type SourceCharacterPoseData } from '../game/source-character-pose';

const base = resolve('.reference-assets/source-exports/character-t'), directory = resolve(base, 'continuous');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const metadataRaw = readFileSync(resolve(directory, 'pose-data.json')), data = JSON.parse(metadataRaw.toString()) as SourceCharacterPoseData;
const bytes = readFileSync(resolve(directory, 'frames.f64.bin')), manifest = read(resolve(directory, 'manifest.json'));
const sha = (v: ArrayBufferView) => createHash('sha256').update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)).digest('hex');
assert.equal(sha(bytes), data.frames.sha256); assert.equal(sha(metadataRaw), manifest.jsonSha256);
assert.deepEqual(gunzipSync(readFileSync(resolve(directory, 'frames.f64.bin.gz'))), bytes);
const began = performance.now(), index = prepareSourceCharacterPose(data, bytes), prepareMs = performance.now() - began;
for (const record of manifest.arrays) {
  const frame = index.frames.get(record.animation)!;
  const array = record.field === 'positions' ? frame.positions : frame.quaternions;
  assert.equal(array.length, record.values); assert.equal(sha(array), record.sha256);
}
// Build only original geometry/joints in memory; texture omission avoids DOM
// image dependencies and does not modify the original GLB or its inverse binds.
const glb = readFileSync(resolve(base, data.renderGlb.file)), glbView = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
assert.equal(sha(glb), data.renderGlb.sha256); const size = glbView.getUint32(12, true);
const doc = JSON.parse(glb.subarray(20, 20 + size).toString()), binary = glb.subarray(28 + size), cpu = structuredClone(doc);
cpu.materials = (cpu.materials ?? []).map((m: { name: string }) => ({ name: m.name })); delete cpu.images; delete cpu.textures; delete cpu.extensionsRequired; delete cpu.extensionsUsed;
cpu.buffers = [{ byteLength: binary.byteLength, uri: `data:application/octet-stream;base64,${Buffer.from(binary).toString('base64')}` }];
if (!globalThis.ProgressEvent) globalThis.ProgressEvent = class { constructor(type: string, value: object) { Object.assign(this, { type }, value); } } as unknown as typeof ProgressEvent;
const gltf = await new GLTFLoader().parseAsync(JSON.stringify(cpu), ''), byNode = new Map<number, Object3D>();
for (const [object, association] of gltf.parser.associations) if (association.nodes !== undefined) byNode.set(association.nodes, object as Object3D);
const renderJoints = data.renderJoints.map((r: { gltfNode: number; mainBone: number; sourceName: string; skinJoint: number }) => {
  const object = byNode.get(r.gltfNode); assert(object); return { ...r, object };
});
const skins: SkinnedMesh[] = []; gltf.scene.traverse(o => { if ((o as SkinnedMesh).isSkinnedMesh) skins.push(o as SkinnedMesh); });
const originalInverses = skins.map(mesh => mesh.skeleton.boneInverses.map(matrix => matrix.elements.slice()));
for (const mesh of skins) for (const r of renderJoints) assert.deepEqual(mesh.skeleton.boneInverses[r.skinJoint].elements, data.mainBones[r.mainBone].inverseBindGltf);
const C = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const samples = read(resolve(base, 'combat/sampled-poses.json')).samples;
let maxPythonMatrixError = 0, maxPythonJointPositionError = 0, maxThreeMatrixError = 0, maxNormError = 0, sampleMs = 0;
const details = [];
for (const sample of samples) {
  const start = performance.now(), p = sampleSourceCharacterPose(index, { state: sample.state, parameters: sample.params,
    cycle: sample.cycle, fireCycle: sample.cycle, fireWeight: sample.fireWeight, blendMode: sample.blendMode });
  sampleMs += performance.now() - start; let error = 0;
  for (const r of renderJoints) {
    const i = r.mainBone, expected = sample.boneWorldMatrices[r.sourceName];
    for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) error = Math.max(error, Math.abs(p.sourceWorldMatrices[i * 16 + c * 4 + row] - expected[row][c]));
    const positionError = Math.hypot(...[0, 1, 2].map(axis => p.sourceWorldMatrices[i * 16 + 12 + axis] - expected[axis][3]));
    maxPythonJointPositionError = Math.max(maxPythonJointPositionError, positionError);
    r.object.position.fromArray(p.renderLocalPositions, i * 3); r.object.quaternion.fromArray(p.renderLocalQuaternions, i * 4); r.object.scale.set(1, 1, 1);
    maxNormError = Math.max(maxNormError, Math.abs(Math.hypot(...p.quaternions.subarray(i * 4, i * 4 + 4)) - 1));
  }
  maxPythonMatrixError = Math.max(maxPythonMatrixError, error); assert(error < .0001, `Python pose mismatch ${sample.state} ${sample.blendMode}: ${error}`);
  gltf.scene.updateMatrixWorld(true);
  for (const r of renderJoints) {
    const expected = C.clone().multiply(new Matrix4().fromArray(p.sourceWorldMatrices, r.mainBone * 16));
    const delta = Math.max(...expected.elements.map((v, i) => Math.abs(v - r.object.matrixWorld.elements[i])));
    maxThreeMatrixError = Math.max(maxThreeMatrixError, delta); assert(delta < .00001, JSON.stringify({ bone: r.sourceName, delta, expected: expected.elements, actual: r.object.matrixWorld.elements, parent: r.object.parent?.name, parentMatrix: r.object.parent?.matrixWorld.elements, scale: r.object.scale.toArray() }));
  }
  const hitboxes = sourceCharacterHitboxTransforms(index, p); assert.equal(hitboxes.length, 22);
  for (const h of hitboxes) assert.deepEqual(h.sourceBoneMatrix, p.sourceWorldMatrices.slice(h.hitbox.bone * 16, h.hitbox.bone * 16 + 16));
  details.push({ state: sample.state, cycle: sample.cycle, mode: sample.blendMode, parameters: sample.params, maxMatrixError: error });
}
const interior = read(resolve(directory, 'interior-pose-fixtures.json'));
let maxInteriorPositionError = 0, maxInteriorQuaternionError = 0;
for (const s of interior.samples) {
  const p = sampleSourceCharacterPose(index, s.input);
  for (let i = 0; i < s.positions.length; i++) maxInteriorPositionError = Math.max(maxInteriorPositionError, Math.abs(p.animationPose.positions[i] - s.positions[i]));
  for (let i = 0; i < s.quaternions.length; i++) maxInteriorQuaternionError = Math.max(maxInteriorQuaternionError, Math.abs(p.animationPose.quaternions[i] - s.quaternions[i]));
}
assert(maxInteriorPositionError < 1e-12 && maxInteriorQuaternionError < 1e-12);
// Independently verify the gameplay conversion against the same actual GLB
// under a translated/rotated actor and Source-to-metre parent scale.
const actor = new Matrix4().makeRotationY(.713).setPosition(7, 2, -31), actorWithScale = actor.clone().multiply(new Matrix4().makeScale(.0254, .0254, .0254));
gltf.scene.matrix.copy(actorWithScale); gltf.scene.matrixAutoUpdate = false;
const finalSample = samples.at(-1), finalPose = sampleSourceCharacterPose(index, { state: finalSample.state, cycle: finalSample.cycle,
  parameters: finalSample.params, fireWeight: finalSample.fireWeight, blendMode: finalSample.blendMode });
const browserMatrices = sourceCharacterBrowserBoneMatrices(finalPose, actor.elements); gltf.scene.updateMatrixWorld(true);
let maxActorBrowserMatrixError = 0;
for (const r of renderJoints) for (let c = 0; c < 16; c++) maxActorBrowserMatrixError = Math.max(maxActorBrowserMatrixError, Math.abs(browserMatrices[r.mainBone * 16 + c] - r.object.matrixWorld.elements[c]));
assert(maxActorBrowserMatrixError < 1e-10);
let corners = 0, maxCornerPositionError = 0, maxCornerQuaternionDotError = 0;
for (const s of data.sequences) if (s.groupSize[0] === 3 && s.groupSize[1] === 3) {
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) for (const cycle of [0, .23, .51, .97]) for (const mode of ['sdk-3way', 'sdk-bilinear'] as SourcePoseMode[]) {
    const parameters = { [data.poseParameters[s.parameterIndices[0]].name]: s.poseKeys[x], [data.poseParameters[s.parameterIndices[1]].name]: s.poseKeys[y + 3] };
    const frame = sampleSourceAnimationFrame(index, s.animationIndices[x + 3 * y], cycle), mixed = sampleSourceSequence(index, s.index, cycle, parameters, mode);
    for (let i = 0; i < frame.positions.length; i++) maxCornerPositionError = Math.max(maxCornerPositionError, Math.abs(frame.positions[i] - mixed.positions[i]));
    for (let i = 0; i < index.boneCount; i++) {
      let dot = 0; for (let axis = 0; axis < 4; axis++) dot += frame.quaternions[i * 4 + axis] * mixed.quaternions[i * 4 + axis];
      maxCornerQuaternionDotError = Math.max(maxCornerQuaternionDotError, Math.abs(1 - Math.abs(dot)));
    }
    corners++;
  }
}
assert(maxCornerPositionError < 1e-10 && maxCornerQuaternionDotError < 1e-12);
let weightZeroChecks = 0, maskedBoneChecks = 0;
for (const state of Object.keys(index.data.states) as SourceCharacterState[]) for (const cycle of [0, .23, .51, .97]) {
  const s = index.data.states[state]; if (!s) continue; const parameters: SourcePoseParameters = { move_x: .37, move_y: -.58, body_yaw: 23, body_pitch: -19 };
  let held = accumulateSourceSequence(index, index.rest, s.lower, cycle, 1, parameters);
  held = accumulateSourceSequence(index, held, s.upper, cycle, 1, parameters);
  const zero = accumulateSourceSequence(index, held, s.shoot, cycle, 0, parameters); assert.deepEqual(zero, held); weightZeroChecks++;
  const firing = accumulateSourceSequence(index, held, s.shoot, cycle, 1, parameters), mask = index.sequences.get(s.shoot)!.boneWeights;
  for (let i = 0; i < index.boneCount; i++) if (mask[i] === 0) {
    assert.deepEqual(firing.positions.subarray(i * 3, i * 3 + 3), held.positions.subarray(i * 3, i * 3 + 3));
    assert.deepEqual(firing.quaternions.subarray(i * 4, i * 4 + 4), held.quaternions.subarray(i * 4, i * 4 + 4)); maskedBoneChecks++;
  }
}
let rateCornerChecks = 0;
for (const s of index.data.sequences) if (s.groupSize[0] === 3 && s.groupSize[1] === 3) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
  const parameters = { [index.data.poseParameters[s.parameterIndices[0]].name]: s.poseKeys[x], [index.data.poseParameters[s.parameterIndices[1]].name]: s.poseKeys[y + 3] };
  const d = index.frames.get(s.animationIndices[x + y * 3])!.descriptor;
  assert.equal(sourceSequenceCycleRate(index, s.index, parameters), d.frames > 1 ? d.fps / (d.frames - 1) : 0); rateCornerChecks++;
}
for (let i = 0; i < skins.length; i++) assert.deepEqual(skins[i].skeleton.boneInverses.map(matrix => matrix.elements), originalInverses[i]);
const receipt = { status: 'passed-source-pose-conformance', dataSha256: sha(metadataRaw), frameSha256: sha(bytes),
  moduleSha256: sha(readFileSync(resolve('game/source-character-pose.ts'))), originalGlbSha256: sha(glb), prepareMs,
  storedPythonSamples: samples.length, mainBoneComparisons: samples.length * index.mainBoneCount, maxPythonMatrixError,
  maxPythonJointPositionError, maxThreeMatrixError, maxQuaternionNormError: maxNormError, meanSampleMs: sampleMs / samples.length,
  interiorPythonSamples: interior.samples.length, maxInteriorPositionError, maxInteriorQuaternionError, maxActorBrowserMatrixError,
  nineWayCornerChecks: corners, maxCornerPositionError, maxCornerQuaternionDotError, weightZeroChecks, maskedBoneChecks, rateCornerChecks,
  inverseBindMatricesPreserved: 71, hitboxesUsingSameBonePose: 22, resolvedRenderJoints: renderJoints.map(r => ({ sourceName: r.sourceName,
    mainBone: r.mainBone, gltfNode: r.gltfNode, skinJoint: r.skinJoint, actualThreeBoneName: r.object.name })), details,
  boundary: 'CPU conformance with the audited Source-frame/SDK Python sampler and actual Three joints. No CS:GO client state/IK/weapon-merge, root-motion extraction, hitbox-shape intersection or visual acceptance.' };
writeFileSync(resolve(directory, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ ...receipt, details: undefined, resolvedRenderJoints: undefined }));
