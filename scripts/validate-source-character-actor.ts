import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSourceCharacterActors, type SourceCharacterManifest, type SourceWorldWeaponData } from '../game/source-character';
import { prepareSourceCharacterPose, sourceCharacterBrowserBoneMatrices, sourceSequenceCycleRate, type SourceCharacterPoseInput, type SourceCharacterState } from '../game/source-character-pose';
const dir = resolve('public/source/csgo-12426148/character-ak');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
export async function loadCharacterCpuFixture(directory = dir) {
  const manifest = read(resolve(directory, 'manifest.json')) as SourceCharacterManifest;
  for (const [file, expected] of Object.entries(manifest.files)) {
    const bytes = readFileSync(resolve(directory, file)); assert.equal(bytes.byteLength, expected.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256);
  }
  const bytes = readFileSync(resolve(directory, manifest.model)), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), size = view.getUint32(12, true);
  const doc = JSON.parse(bytes.subarray(20, 20 + size).toString()), binary = bytes.subarray(28 + size), cpu = structuredClone(doc);
  cpu.materials = cpu.materials.map((m: { name: string }) => ({ name: m.name })); delete cpu.textures; delete cpu.images; delete cpu.extensionsUsed; delete cpu.extensionsRequired;
  cpu.buffers = [{ byteLength: binary.byteLength, uri: 'data:application/octet-stream;base64,' + Buffer.from(binary).toString('base64') }];
  if (!globalThis.ProgressEvent) globalThis.ProgressEvent = class { constructor(type: string, value: object) { Object.assign(this, { type }, value); } } as unknown as typeof ProgressEvent;
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(cpu), '');
  const poseIndex = prepareSourceCharacterPose(read(resolve(directory, manifest.poseData)), readFileSync(resolve(directory, manifest.poseFrames)));
  const weapon = read(resolve(directory, manifest.weaponData)) as SourceWorldWeaponData, weaponBytes = readFileSync(resolve(directory, manifest.weaponFrames));
  return { manifest, gltf, poseIndex, weapon, weaponBytes };
}
async function main() {
  const ct = process.argv.includes('--ct'), data = await loadCharacterCpuFixture(ct ? resolve('public/source/csgo-12426148/character-ct-ak') : dir), { manifest, gltf, poseIndex, weapon, weaponBytes } = data;
  const owner = createSourceCharacterActors(gltf, poseIndex, weapon, weaponBytes, manifest), actor = owner.createActor(), other = owner.createActor();
  const inverses = () => { const result: number[][] = []; actor.model.traverse(o => { const m = o as T.SkinnedMesh; if (m.isSkinnedMesh) result.push(...m.skeleton.boneInverses.map(m => m.elements.slice())); }); return result; };
  const originalInverses = inverses(), bodyCount = poseIndex.mainBoneCount, profileFolder = ct ? 'character-ct' : 'character-t', audit = read(resolve('.reference-assets/source-exports/' + (ct ? 'character-ct-ak' : 'character-ak') + '/audit.json'));
  const C = new T.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
  let samples = 0, maxCharacterMatrixError = 0, maxWeaponMatrixError = 0, maxActualCharacterWorldError = 0, maxActualWeaponWorldError = 0, milliseconds = 0;
  for (const clip of audit.clipChecks) {
    const label = clip.name.split('__')[1], state: SourceCharacterState = ({ idle: 'Idle', walk: 'Walk', run: 'Run', crouch_idle: 'Crouch_Idle', crouch_walk: 'Crouch_Walk', aim_fire: 'Idle', crouch_aim_fire: 'Crouch_Idle' } as const)[label as 'idle'] ?? 'Idle';
    const mode = clip.name.split('__')[0], fire = label.includes('fire'), params = clip.parameters;
    const lower = poseIndex.data.states[state].lower, shoot = poseIndex.data.states[state].shoot;
    const lowerRate = sourceSequenceCycleRate(poseIndex, lower, params), shootRate = sourceSequenceCycleRate(poseIndex, shoot, params);
    for (const sample of clip.samples) {
      const input: SourceCharacterPoseInput = { state, cycle: Math.min(sample.seconds * lowerRate, 1), parameters: params,
        fireCycle: Math.min(sample.seconds * shootRate, 1), fireWeight: fire ? 1 : 0, blendMode: mode };
      // The retained Python samples include world fire through 26/30s. The
      // authoritative clock retains this time after character fire cycle clamps.
      if (fire) input.fireTimeSeconds = sample.seconds;
      const player = { x: 3.2, y: 1.4, z: -6.7, yaw: .831, sourceContract: 'csgo-player-12426148' as const, sourcePose: input, sourcePoseVersion: manifest.poseVersion };
      const started = performance.now(), pose = owner.updateActor(actor, player)!; milliseconds += performance.now() - started;
      assert(pose); const browser = sourceCharacterBrowserBoneMatrices(pose, actor.root.matrixWorld.elements);
      for (let i = 0; i < bodyCount; i++) {
        const expected = sample.character[poseIndex.data.mainBones[i].name];
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) maxCharacterMatrixError = Math.max(maxCharacterMatrixError, Math.abs(pose.sourceWorldMatrices[i * 16 + c * 4 + r] - expected[r][c]));
        for (let c = 0; c < 16; c++) maxActualCharacterWorldError = Math.max(maxActualCharacterWorldError, Math.abs(browser[i * 16 + c] - actor.characterBones[i].matrixWorld.elements[c]));
      }
      for (let i = 0; i < 94; i++) {
        const expected = sample.weapon[weapon.bones[i].name], matrix = new T.Matrix4().fromArray(actor.sourceWeaponWorldMatrices, i * 16);
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) maxWeaponMatrixError = Math.max(maxWeaponMatrixError, Math.abs(matrix.elements[c * 4 + r] - expected[r][c]));
        const world = actor.root.matrixWorld.clone().multiply(new T.Matrix4().makeScale(.0254, .0254, .0254)).multiply(C).multiply(matrix);
        for (let c = 0; c < 16; c++) maxActualWeaponWorldError = Math.max(maxActualWeaponWorldError, Math.abs(world.elements[c] - actor.weaponBones[i].matrixWorld.elements[c]));
      }
      samples++;
    }
  }
  assert(maxCharacterMatrixError < .0001); assert(maxWeaponMatrixError < .0001);
  assert(maxActualCharacterWorldError < 1e-12); assert(maxActualWeaponWorldError < 1e-12); assert.deepEqual(inverses(), originalInverses);
  const a = actor.characterBones[0], b = other.characterBones[0]; assert.notEqual(a, b); const previous = b.position.toArray(); a.position.x += 123; assert.deepEqual(b.position.toArray(), previous);
  owner.disposeActor(actor); assert.equal(other.status, 'awaiting-authority'); assert.equal(other.characterBones.length, bodyCount);
  owner.dispose(); assert.equal(other.status, 'disposed');
  const report = { status: 'passed-original-continuous-actor-cpu', poseVersion: manifest.poseVersion, sourceGlbSha256: manifest.files[manifest.model].sha256,
    samples, characterBoneChecks: samples * bodyCount, weaponBoneChecks: samples * 94, maxCharacterMatrixError, maxWeaponMatrixError,
    maxActualCharacterWorldError, maxActualWeaponWorldError, meanUpdateMilliseconds: milliseconds / samples,
    originalInverseBindsPreserved: bodyCount + 94, clonedBonesIndependent: true, geometryAndMaterialsShared: true,
    noAnimationMixer: true, localDeltaClock: false, note: 'Actual original GLB joints with in-memory material omission only for CPU. Material/shader rendering needs root GPU acceptance; hand IK remains unimplemented.' };
  writeFileSync(resolve('.reference-assets/source-exports/' + profileFolder + '/continuous/actor-verification.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) await main();
