import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as T from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Simulation, initPhysics } from '../game/simulation';
import { BOXES, SOURCE_BOXES, type Box } from '../game/map';
import { EMPTY_INPUT, type Player } from '../game/types';
import { CHARACTER, capsuleHeight, characterReferences } from '../game/character-contract';
import { falconBodyHitVolumes } from '../game/falcon-body-reference';
import { GameAssets } from '../game/assets';
import { loadC02Geometry } from './fixtures/c02-geometry';

const games: Simulation[] = [], fixtures: Box[] = [], observations: Record<string, unknown> = {};
const ROT = { x: 0, y: 0, z: 0, w: 1 };
beforeAll(initPhysics);
afterEach(() => {
  games.splice(0).forEach(s => s.dispose());
  fixtures.splice(0).forEach(box => BOXES.splice(BOXES.indexOf(box), 1));
});
afterAll(() => {
  mkdirSync('output/tests', { recursive: true });
  writeFileSync('output/tests/stair-locomotion.json', JSON.stringify(observations, null, 2) + '\n');
});
function nearbyStair() {
  // A real fixed authored tread beside the route: close enough for the fallback,
  // but not under the root, so walls/ceilings are independently testable.
  const stair: Box = { x: 100.84, y: .075, z: 100, w: .4, h: .15, d: 4, kind: 'step' };
  BOXES.push(stair); fixtures.push(stair);
  const s = new Simulation('training', false); games.push(s);
  s.world.createCollider(RAPIER.ColliderDesc.cuboid(15, .1, 15).setTranslation(100, -.1, 100));
  const p = s.addPlayer('stairs', 'Stairs', 'amber');
  Object.assign(p, { x: 100, y: .015, z: 100, yaw: 0, pitch: 0, grounded: true });
  s.world.step(); return { s, p };
}
function move(s: Simulation, p: Player, input: Partial<typeof EMPTY_INPUT> = {}) {
  s.move(p, { ...EMPTY_INPUT, seq: p.ack + 1, yaw: p.yaw, pitch: p.pitch, ...input });
  s.world.step();
}
function headEyePenetration(s: Simulation, p: Player) {
  const { head, eye } = s.poseClearance(p);
  return Math.max(0, ...head.map(v => v.penetration), ...eye.map(v => v.penetration));
}

it('holds the shared phase on M01 stairs, keeps actual C02 boots out of every riser, and smoothly resumes on the terrace', async () => {
  const s = new Simulation('training', false); games.push(s);
  const p = s.addPlayer('stairs', 'Stairs', 'amber'), first = SOURCE_BOXES.find(b => b.id === 'COL_0340')!;
  Object.assign(p, { x: first.x + first.w / 2 + .9, z: first.z, y: .05, yaw: Math.PI / 2 });
  const assets = new GameAssets(); assets.models.set('falconC02', await loadC02Geometry());
  const root = assets.operator(p)!, boots: { mesh: T.SkinnedMesh; indices: number[] }[] = [];
  root.traverse(mesh => {
    if (!(mesh instanceof T.SkinnedMesh)) return;
    const { skinIndex, skinWeight, position } = mesh.geometry.attributes, indices: number[] = [];
    for (let i = 0; i < position.count; i++) {
      let footWeight = 0;
      for (let c = 0; c < 4; c++) if (/Foot|Toe/.test(mesh.skeleton.bones[skinIndex.getComponent(i, c)].name))
        footWeight += skinWeight.getComponent(i, c);
      if (footWeight >= .5) indices.push(i);
    }
    if (indices.length) boots.push({ mesh, indices });
  });
  const obstacles = SOURCE_BOXES.filter(b => b.kind === 'step' || b.id === 'COL_0339');
  const vertices = boots.reduce((n, b) => n + b.indices.length, 0), trace: object[] = [], point = new T.Vector3();
  let neutralTicks = 0, resumedTicks = 0, maxDepth = 0, penetratingSamples = 0, entered = false;
  s.setInput(p.id, { ...EMPTY_INPUT, seq: 1, mz: -1, yaw: p.yaw });
  try {
    for (let tick = 0; tick < 125; tick++) {
      const phase = p.stridePhase ?? 0, previousWeight = p.strideWeight ?? 0;
      s.step();
      if (p.strideWeight === 0 && p.x < first.x + .8) {
        entered = true; neutralTicks++;
        expect(p.stridePhase).toBe(phase);
        expect(p.strideSpeed).toBe(0);
        // The shared angular interpolation may return cos(-PI/2), not exact 0.
        expect(p.strideX).toBeCloseTo(0, 12); expect(p.strideZ).toBeCloseTo(-1, 12);
      } else if (entered) {
        resumedTicks++;
        if (previousWeight === 0) {
          expect(p.strideWeight).toBeGreaterThan(0);
          expect(p.strideWeight).toBeLessThan(.25);
          expect(p.stridePhase).toBeGreaterThan(phase);
        }
      }
      root.position.set(p.x, p.y, p.z); root.rotation.y = p.yaw;
      assets.animateOperator(root, p, 1 / 60); root.updateMatrixWorld(true);
      for (const { mesh, indices } of boots) for (const i of indices) {
        mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
        for (const box of obstacles) {
          const depth = Math.min(box.w / 2 - Math.abs(point.x - box.x),
            box.h / 2 - Math.abs(point.y - box.y), box.d / 2 - Math.abs(point.z - box.z));
          maxDepth = Math.max(maxDepth, depth);
          if (depth > .001) penetratingSamples++;
        }
      }
      trace.push({ tick: tick + 1, x: p.x, y: p.y, stridePhase: p.stridePhase,
        strideWeight: p.strideWeight, status: s.poseResolution(p)?.status });
    }
    observations.authoredStairs = { final: { ...p }, verticesPerFrame: vertices, samples: vertices * 125,
      neutralTicks, resumedTicks, penetratingSamples, maxDepth, trace };
    expect(vertices).toBeGreaterThan(1000); expect(neutralTicks).toBeGreaterThan(70);
    expect(resumedTicks).toBeGreaterThan(10); expect(p.strideWeight).toBeGreaterThan(.95);
    expect(penetratingSamples).toBe(0); expect(maxDepth).toBeLessThan(.001);
  } finally { assets.releaseActor(root); }
});

it('continues to block an adjacent ordinary thin wall during the stair fallback', () => {
  const { s, p } = nearbyStair();
  const wall = s.world.createCollider(RAPIER.ColliderDesc.cuboid(3, 2, .025).setTranslation(100, 2, 99));
  s.world.step(); let maxPenetration = 0;
  for (let i = 0; i < 100; i++) {
    move(s, p, { mz: -1, pitch: -1.5 });
    const height = capsuleHeight(p), root = wall.contactShape(new RAPIER.Capsule(height / 2 - CHARACTER.radius, CHARACTER.radius),
      { x: p.x, y: p.y + height / 2, z: p.z }, ROT, 0);
    maxPenetration = Math.max(maxPenetration, -(root?.distance ?? 0), headEyePenetration(s, p));
    for (const foot of falconBodyHitVolumes({ ...p, blend: 0, origin: p }).filter(v => v.region === 'foot'))
      maxPenetration = Math.max(maxPenetration, -(wall.contactShape(new RAPIER.Ball(foot.radius), foot.center, ROT, 0)?.distance ?? 0));
    expect(p.strideWeight).toBe(0);
  }
  observations.adjacentWall = { final: { ...p }, maxPenetration };
  expect(p.z).toBeGreaterThan(99.3); expect(p.z).toBeLessThan(99.7);
  expect(maxPenetration).toBeLessThan(.001);
});

it('still rejects standing into a low roof beside the authored tread', () => {
  const { s, p } = nearbyStair();
  Object.assign(p, { crouch: true, stancePhase: 1, stanceTarget: true, stridePhase: .4375,
    strideWeight: 1, strideSpeed: 2.1, strideX: 0, strideZ: -1 });
  const roof = s.world.createCollider(RAPIER.ColliderDesc.cuboid(2, .1, 2).setTranslation(100, 1.55, 100));
  s.world.step(); let maxPenetration = 0, maxCapsuleTop = 0;
  for (let i = 0; i < 90; i++) {
    move(s, p, { crouch: i < 15, pitch: i < 30 ? -1.5 : 1.5 });
    const height = capsuleHeight(p), contact = roof.contactShape(new RAPIER.Capsule(height / 2 - CHARACTER.radius, CHARACTER.radius),
      { x: p.x, y: p.y + height / 2, z: p.z }, ROT, 0);
    maxPenetration = Math.max(maxPenetration, -(contact?.distance ?? 0), headEyePenetration(s, p));
    maxCapsuleTop = Math.max(maxCapsuleTop, p.y + height);
    expect(p.strideWeight).toBe(0); expect(p.stridePhase).toBe(.4375);
  }
  observations.lowRoof = { final: { ...p }, maxPenetration, maxCapsuleTop };
  expect(p.stancePhase).toBeGreaterThan(.5); expect(maxCapsuleTop).toBeLessThan(1.451);
  expect(maxPenetration).toBeLessThan(.001);
});

it('checks the head raised by neutralizing gait and corrects the entire pose away from a local overhang', () => {
  const { s, p } = nearbyStair();
  Object.assign(p, { pitch: -1.5, stridePhase: .4375, strideWeight: 1, strideSpeed: 4.8,
    strideX: Math.sqrt(3) / 2, strideZ: .5 });
  const roof = s.world.createCollider(RAPIER.ColliderDesc.cuboid(1, .1, .02).setTranslation(100, 1.75, 99.64));
  s.world.step(); const before = { ...p }, neutralHead = characterReferences({ ...p, strideWeight: 0, strideSpeed: 0 }).head;
  const uncheckedPenetration = Math.max(0, -(roof.contactShape(new RAPIER.Ball(CHARACTER.headRadius), neutralHead, ROT, 0)?.distance ?? 0));
  expect(headEyePenetration(s, p)).toBe(0); expect(uncheckedPenetration).toBeGreaterThan(.02);
  move(s, p);
  observations.raisedHead = { before, after: { ...p }, uncheckedPenetration, resolution: s.poseResolution(p),
    finalPenetration: headEyePenetration(s, p) };
  expect(p.strideWeight).toBe(0); expect(p.stridePhase).toBe(before.stridePhase);
  expect(s.poseResolution(p)?.initiallyLegal).toBe(true);
  expect(s.poseResolution(p)?.status).toBe('corrected'); expect(p.z).toBeGreaterThan(before.z + .01);
  expect(headEyePenetration(s, p)).toBeLessThan(.001);
});
