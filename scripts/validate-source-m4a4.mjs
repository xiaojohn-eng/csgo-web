/** Independently load exported GLB animation in Three.js and compare audited bones. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AnimationMixer, LoopOnce, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import validator from 'gltf-validator';

const dir = path.resolve(process.argv[2] ?? '.reference-assets/source-exports/m4a4');
const audit = JSON.parse(await fs.readFile(path.join(dir, 'audit.json'), 'utf8'));
const bytes = await fs.readFile(audit.glb.path);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), audit.glb.sha256);
const validation = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 100 });
const jsonLength = bytes.readUInt32LE(12);
const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
const binary = bytes.subarray(28 + jsonLength);
// The CPU reader preserves the GLB geometry/skin/animation bytes; material images
// are omitted only from this numeric load because Node has no ImageBitmap API.
const cpuDoc = structuredClone(doc);
cpuDoc.materials = (cpuDoc.materials ?? []).map(m => ({ name: m.name }));
delete cpuDoc.images;
delete cpuDoc.textures;
delete cpuDoc.extensionsRequired;
delete cpuDoc.extensionsUsed;
cpuDoc.buffers = [{ byteLength: binary.byteLength, uri: `data:application/octet-stream;base64,${binary.toString('base64')}` }];
globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, data) { this.type = type; Object.assign(this, data); } };
const loaded = await new GLTFLoader().parseAsync(JSON.stringify(cpuDoc), '');
const named = new Map();
const byNode = new Map();
for (const [obj, association] of loaded.parser.associations) {
  if (association.nodes !== undefined) {
    named.set(doc.nodes[association.nodes].name, obj);
    byNode.set(association.nodes, obj);
  }
}
const weaponSkin = doc.skins.find(s => s.joints.some(n => doc.nodes[n].name === (audit.selected_model.includes('/v_') ? 'v_weapon.M4A1_Parent' : 'ValveBiped.weapon_bone')));
assert(weaponSkin, 'Expected original M4A4 skin');
const weaponBones = new Map(weaponSkin.joints.map(n => [doc.nodes[n].name, byNode.get(n)]));
const armsSkin = audit.arms ? doc.skins.find(s => s.name === audit.arms.armature_name) : null;
const armsBones = new Map((armsSkin?.joints ?? []).map(n => [doc.nodes[n].name, byNode.get(n)]));
const bindVertices = new Map();
const pointKey = (x, y, z) => [x, y, z].map(v => v.toFixed(5)).join(',');
if (armsSkin) {
  loaded.scene.traverse(obj => {
    if (!obj.isSkinnedMesh || !obj.skeleton.bones.some(b => b === armsBones.get('Bip01'))) return;
    const position = obj.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const key = pointKey(position.getX(i), position.getY(i), position.getZ(i));
      if (!bindVertices.has(key)) bindVertices.set(key, []);
      bindVertices.get(key).push({ obj, index: i });
    }
  });
}
const results = {};
const point = new Vector3();
for (const [kind, check] of Object.entries(audit.clip_checks)) {
  const clip = loaded.animations.find(a => a.name === check.action_name);
  assert(clip, `Missing clip ${check.action_name}`);
  assert(Math.abs(clip.duration - check.duration_seconds) < 1e-5, `Duration mismatch ${kind}: ${clip.duration}`);
  const minimumTime = Math.min(...clip.tracks.map(t => t.times[0]));
  assert.equal(minimumTime, 0, 'GLB must start at zero without an added Blender frame');
  const mixer = new AnimationMixer(loaded.scene);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  let maximumPositionError = 0;
  let maximumArmsPositionError = 0;
  let maximumArmsVertexError = 0;
  let measuredArmsVertexSamples = 0;
  let maximumAttachmentPositionError = 0;
  let measuredBoneSamples = 0;
  for (const sample of check.samples) {
    mixer.setTime(Math.min(sample.seconds, clip.duration));
    loaded.scene.updateMatrixWorld(true);
    for (const [name, matrix] of Object.entries(sample.bone_world_matrices)) {
      const bone = weaponBones.get(name);
      assert(bone?.isBone, `Source bone absent from GLB: ${name}`);
      bone.getWorldPosition(point);
      // Blender's glTF axis conversion is (Source/Blender x, z, -y).
      const error = Math.hypot(point.x - matrix[0][3], point.y - matrix[2][3], point.z + matrix[1][3]);
      maximumPositionError = Math.max(maximumPositionError, error);
      measuredBoneSamples++;
      if (armsBones.has(name)) {
        armsBones.get(name).getWorldPosition(point);
        maximumArmsPositionError = Math.max(maximumArmsPositionError,
          Math.hypot(point.x - matrix[0][3], point.y - matrix[2][3], point.z + matrix[1][3]));
      }
    }
    for (const samples of Object.values(sample.arms_vertex_samples ?? {})) {
      for (const vertex of samples) {
        const [x, y, z] = vertex.bind_position;
        const candidates = bindVertices.get(pointKey(x, z, -y));
        assert(candidates?.length, `GLB arms bind vertex absent: ${vertex.index}`);
        let minimumError = Infinity;
        for (const { obj, index } of candidates) {
          point.fromBufferAttribute(obj.geometry.getAttribute('position'), index);
          obj.applyBoneTransform(index, point);
          obj.localToWorld(point);
          const [sx, sy, sz] = vertex.source_position;
          minimumError = Math.min(minimumError, Math.hypot(point.x - sx, point.y - sz, point.z + sy));
        }
        maximumArmsVertexError = Math.max(maximumArmsVertexError, minimumError);
        measuredArmsVertexSamples++;
      }
    }
    for (const attachment of audit.source_models[0].attachments) {
      const obj = named.get(attachment.name);
      // Older standalone proof used SourceIO constraint-only empties. Only
      // bone-parented markers are accepted for an arms-combined export.
      if (!audit.arms && !obj.parent?.isBone) continue;
      assert(obj.parent?.isBone, 'Attachment must follow its actual source bone');
      const matrix = sample.bone_world_matrices[audit.bones[attachment.parent_bone].name];
      const a = attachment.matrix;
      const expected = matrix.map(row => row[0] * a[3] + row[1] * a[7] + row[2] * a[11] + row[3]);
      obj.getWorldPosition(point);
      maximumAttachmentPositionError = Math.max(maximumAttachmentPositionError,
        Math.hypot(point.x - expected[0], point.y - expected[2], point.z + expected[1]));
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(loaded.scene);
  assert(maximumPositionError < .002, `Independent Three playback mismatch ${kind}: ${maximumPositionError}`);
  assert(maximumArmsPositionError < .002 && maximumArmsVertexError < .005,
    `Independent arms mismatch ${kind}: ${maximumArmsPositionError}/${maximumArmsVertexError}`);
  assert(maximumAttachmentPositionError < .002, `Attachment mismatch ${kind}: ${maximumAttachmentPositionError}`);
  results[kind] = { clip: clip.name, sourceFps: check.fps, duration: clip.duration,
    sourceDuration: check.duration_seconds, minimumTime, measuredBoneSamples, maximumPositionErrorSourceUnits: maximumPositionError,
    maximumArmsPositionErrorSourceUnits: maximumArmsPositionError, maximumArmsVertexErrorSourceUnits: maximumArmsVertexError,
    measuredArmsVertexSamples, maximumAttachmentPositionErrorSourceUnits: maximumAttachmentPositionError };
}
assert.equal(validation.issues.numErrors, 0, 'glTF validator reported errors');
const output = { status: 'passed', scope: 'independent Three.js CPU animation readback plus Khronos GLB validation',
  glb: audit.glb.path, sha256: audit.glb.sha256, validation: validation.issues, clips: results,
  limitations: ['Numeric loader omits material images; separate GPU material/visual review remains required.',
    'Checks validate conversion from decoded source; original client visual equivalence remains unverified.'] };
await fs.writeFile(path.join(dir, 'three-readback.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
