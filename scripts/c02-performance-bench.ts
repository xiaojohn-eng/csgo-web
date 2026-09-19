import { strict as assert } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import * as T from 'three';
import { GameAssets } from '../game/assets';
import type { SkinnedVertexFrame } from '../game/falcon-combat-pose';
import { c02Player, loadC02Geometry } from '../tests/fixtures/c02-geometry';

// CPU only: no renderer/browser/network/server. Both variants retain the final
// reusable patch buffers; the reference restores Three's uncached CPU skin getter.
const assets = new GameAssets(); assets.models.set('falconC02', await loadC02Geometry());
const player = c02Player();
const make = (reference: boolean) => {
  const root = assets.operator(player)!;
  if (reference) {
    const frame = (root.userData.falconC02.pose as { skinFrame: SkinnedVertexFrame }).skinFrame;
    frame.getVertexPosition = (index, target) => frame.mesh.getVertexPosition(index, target);
  }
  return root;
};
const reference = make(true), cached = make(false);
function sample(root: T.Group, i: number) {
  const p = { ...player, yaw: Math.sin(i * .03), pitch: Math.sin(i * .07) * 1.2,
    stancePhase: .5 + .5 * Math.sin(i * .04), reload: .2 + (i % 150) / 100 };
  root.rotation.y = p.yaw;
  assets.animateOperator(root, p, 1 / 60); root.updateMatrixWorld(true);
}
function measure(root: T.Group, frames: number) {
  const times: number[] = [];
  for (let i = 0; i < frames; i++) {
    const start = performance.now(); sample(root, i); times.push(performance.now() - start);
  }
  const total = times.reduce((a, b) => a + b, 0); times.sort((a, b) => a - b);
  return { frames, totalMs: total, medianMs: times[Math.floor(frames * .5)], p95Ms: times[Math.floor(frames * .95)] };
}
try {
  for (let i = 0; i < 100; i++) { sample(reference, i); sample(cached, i); }
  const rounds = [];
  for (let round = 0; round < 3; round++) {
    // Alternate timing order to limit temperature/background-load bias.
    const result = round % 2 ? { cached: measure(cached, 300), reference: measure(reference, 300) }
      : { reference: measure(reference, 300), cached: measure(cached, 300) };
    assert.deepEqual(reference.userData.poseReport, cached.userData.poseReport);
    rounds.push(result);
  }
  const meshes: T.SkinnedMesh[] = []; cached.traverse(o => { if (o instanceof T.SkinnedMesh) meshes.push(o); });
  const report = { measuredAt: new Date().toISOString(), node: process.version, platform: `${process.platform}/${process.arch}`,
    method: 'Real C02, one living GameAssets actor, original clips + current pose + world matrix updates; 100 warmup, 3x300 samples. CPU only. Uncached reference also reuses the final patch buffers.',
    activeSkeletonsPerActor: new Set(meshes.map(m => m.skeleton)).size,
    skinnedMeshesPerActor: meshes.length, vertexCount: meshes.reduce((sum, m) => sum + m.geometry.getAttribute('position').count, 0),
    exactFinalPoseReportEquality: true, rounds };
  await mkdir('output/tests', { recursive: true });
  await writeFile('output/tests/c02-performance.json', JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} finally { assets.releaseActor(reference); assets.releaseActor(cached); }
