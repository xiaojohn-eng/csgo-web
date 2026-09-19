import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Simulation, initPhysics } from '../game/simulation';
import { CHARACTER, capsuleHeight, characterReferences } from '../game/character-contract';
import { clearancePose, resolvePoseMotion } from '../game/pose-clearance';
import { advanceLocomotion, readLocomotion } from '../game/locomotion';
import { EMPTY_INPUT, validateInput, type Player } from '../game/types';
import corner from './fixtures/locomotion-corner.json';

const games: Simulation[] = [], evidence: Record<string, unknown> = {}, ROT = { x: 0, y: 0, z: 0, w: 1 };
beforeAll(initPhysics);
afterEach(() => games.splice(0).forEach(s => s.dispose()));
afterAll(() => {
  mkdirSync('output/tests', { recursive: true });
  writeFileSync('output/tests/corner-locomotion.json', JSON.stringify(evidence, null, 2) + '\n');
});
function make() {
  const s = new Simulation('training', false); games.push(s);
  const p = s.addPlayer('corner', 'Corner', 'amber');
  return { s, p };
}
function sync(s: Simulation, p: Player) {
  s.bodies.get(p.id)!.body.setTranslation({ x: p.x, y: p.y + capsuleHeight(p) / 2, z: p.z }, true);
  s.world.step();
}

it('settles the actual training corner in the previous legal pose, then accepts the originally blocked turn', () => {
  const { s, p } = make(); Object.assign(p, corner.before, { id: p.id }); sync(s, p);
  const input = validateInput(corner.input)!; expect(input).not.toBeNull();
  const origin = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch }, phase = p.stridePhase;
  const trace: object[] = []; let settlingTicks = 0;
  for (let i = 0; i < 30; i++) {
    const weight = p.strideWeight!;
    s.move(p, { ...input, seq: i + 1 }); s.world.step();
    const resolution = s.poseResolution(p)!;
    trace.push({ tick: i + 1, x: p.x, y: p.y, z: p.z, yaw: p.yaw,
      phase: p.stridePhase, weight: p.strideWeight, resolution });
    if (i < 4) {
      settlingTicks++;
      expect({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch }).toEqual(origin);
      expect(p.stridePhase).toBe(phase); expect(p.strideWeight).toBeLessThan(weight);
      expect(p.vx).toBe(0); expect(p.vz).toBe(0);
      expect(resolution.initiallyLegal).toBe(true);
      expect(resolution.reason).toContain('stationary gait settling');
    }
    const contacts = s.poseClearance(p);
    expect(Math.max(0, ...contacts.head.map(c => c.penetration), ...contacts.eye.map(c => c.penetration))).toBeLessThan(.001);
  }
  evidence.actualCorner = { origin, phase, settlingTicks, trace };
  expect(p.yaw).toBe(corner.input.yaw);
  expect(Math.hypot(p.x - origin.x, p.z - origin.z)).toBeGreaterThan(1);
  expect(p.stridePhase).toBeGreaterThan(phase!);
});

it('retains the whole prior pose when stationary gait settling would raise the head into a low roof', () => {
  const { s, p } = make();
  s.world.createCollider(RAPIER.ColliderDesc.cuboid(12, .1, 12).setTranslation(100, -.1, 100));
  Object.assign(p, { x: 100, y: .015, z: 100, yaw: 0, pitch: 0, grounded: true,
    stridePhase: .4375, strideWeight: .4, strideSpeed: 4.8, strideX: 1, strideZ: 0 });
  // Root fits, but the requested offset-head pitch cannot fit between both walls.
  for (const z of [99.65, 100.35])
    s.world.createCollider(RAPIER.ColliderDesc.cuboid(3, 2, .025).setTranslation(100, 2, z));
  const roof = s.world.createCollider(RAPIER.ColliderDesc.cuboid(2, .1, 2).setTranslation(100, 1.9775, 100));
  sync(s, p);
  const before = clearancePose(p), collider = s.bodies.get(p.id)!.collider;
  expect(resolvePoseMotion(s.world, before, before, collider).status).toBe('clear');
  const candidate = { ...before, ...advanceLocomotion(readLocomotion(before), 0, 1 / 60, true, 0) };
  const head = characterReferences(candidate).head;
  const uncheckedPenetration = -(roof.contactShape(new RAPIER.Ball(CHARACTER.headRadius), head, ROT, 0)?.distance ?? 0);
  expect(uncheckedPenetration).toBeGreaterThan(.001);
  s.move(p, { ...EMPTY_INPUT, seq: 1, pitch: 1.5 }); s.world.step();
  const after = clearancePose(p), resolution = s.poseResolution(p)!;
  evidence.refusedHeadRise = { before, after, uncheckedPenetration, resolution, contacts: s.poseClearance(p) };
  expect(resolution.status).toBe('blocked'); expect(resolution.initiallyLegal).toBe(true);
  expect(after).toEqual(before);
  expect(p.vx).toBe(0); expect(p.vz).toBe(0);
  const contacts = s.poseClearance(p);
  expect(Math.max(0, ...contacts.head.map(c => c.penetration), ...contacts.eye.map(c => c.penetration))).toBe(0);
});
