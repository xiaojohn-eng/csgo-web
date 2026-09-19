import { beforeAll, afterEach, it, expect } from 'vitest';
import { Simulation, initPhysics } from '../game/simulation';
import { EMPTY_INPUT, validateInput } from '../game/types';
import { flashExposure, smokeBlocks, smokeRadius } from '../game/tactics';
import { SOURCE_BOXES } from '../game/map';
import { eyeHeight } from '../game/character-contract';
beforeAll(initPhysics);
const games: Simulation[] = [];
afterEach(() => {
  games.forEach((s) => s.dispose());
  games.length = 0;
});
function setup() {
  const s = new Simulation('training', false);
  games.push(s);
  const p = s.addPlayer('a', 'A', 'amber');
  p.x = -20;
  p.z = 5;
  p.y = 0;
  p.yaw = p.pitch = 0;
  return { s, p };
}
function ticks(s: Simulation, n: number) {
  for (let i = 0; i < n; i++) s.step();
}
it('smoke blocks meaningful paths, expands and fades without blocking unrelated rays', () => {
  const cloud = { id: 1, x: 0, y: 1.4, z: 0, age: 1, remaining: 8 };
  expect(smokeBlocks({ x: 0, z: 5 }, { x: 0, z: -5 }, [cloud])).toBe(true);
  expect(smokeBlocks({ x: 4, z: 5 }, { x: 4, z: -5 }, [cloud])).toBe(false);
  expect(smokeBlocks({ x: 0, z: 0 }, { x: 0, z: 5 }, [cloud])).toBe(true);
  expect(smokeBlocks({ x: 0, z: 5 }, { x: 0, z: 4 }, [cloud])).toBe(false);
  expect(smokeRadius({ ...cloud, age: 0 })).toBe(0);
  expect(smokeRadius({ ...cloud, remaining: 0 })).toBe(0);
});
it('looking away reduces a flash and solid cover blocks it', () => {
  const { p } = setup();
  const source = { x: p.x, y: p.y + eyeHeight(p), z: p.z - 4 };
  const front = flashExposure(p, source);
  p.yaw = Math.PI;
  expect(front).toBeGreaterThan(0.8);
  expect(flashExposure(p, source)).toBeCloseTo(front * 0.15, 4);
  const container = SOURCE_BOXES.find(b => b.id === 'COL_1149')!;
  p.x = container.x;
  p.z = container.z + container.d / 2 + 1;
  p.yaw = 0;
  expect(flashExposure(p, { x: container.x, y: eyeHeight(p), z: container.z - container.d / 2 - 1 })).toBe(0);
});
it('authority consumes the chosen utility once, creates smoke, isolates snapshots and expires it', () => {
  const { s, p } = setup();
  s.setInput(p.id, { ...EMPTY_INPUT, seq: 1, grenade: true, utility: 'smoke' });
  ticks(s, 140);
  expect(p.smokes).toBe(0);
  expect(p.grenades).toBe(1);
  expect(p.flashes).toBe(1);
  expect(s.smokes).toHaveLength(1);
  expect(s.grenades).toHaveLength(0);
  const snapshot = s.snapshot();
  snapshot.smokes[0].remaining = 999;
  expect(s.smokes[0].remaining).toBeLessThan(16);
  ticks(s, 1000);
  expect(s.smokes).toHaveLength(0);
  expect(
    validateInput({ ...EMPTY_INPUT, seq: 2, utility: 'unlimited' }),
  ).toBeNull();
});
it('smoke hides vision while bullets can still travel through it', () => {
  const { s, p } = setup(),
    enemy = s.addPlayer('b', 'B', 'blue');
  enemy.x = p.x;
  enemy.z = p.z - 5;
  enemy.armor = 0;
  s.smokes.push({ id: 3, x: p.x, y: 1.4, z: p.z - 2.5, age: 1, remaining: 10 });
  expect(smokeBlocks(p, enemy, s.smokes)).toBe(true);
  s.shoot(p, { ...EMPTY_INPUT, seq: 1, aim: true });
  expect(enemy.hp).toBeLessThan(100);
});
it('shared collision allows climbing M01 authored stairs onto the customs terrace', () => {
  const { s, p } = setup();
  const first = SOURCE_BOXES.find(b => b.id === 'COL_0340')!,
    terrace = SOURCE_BOXES.find(b => b.id === 'COL_0339')!;
  p.x = first.x + first.w / 2 + 0.9;
  p.z = first.z;
  p.y = 0.05;
  p.yaw = Math.PI / 2;
  s.setInput(p.id, { ...EMPTY_INPUT, seq: 1, mz: -1, yaw: p.yaw });
  ticks(s, 125);
  expect(p.x).toBeGreaterThan(terrace.x - terrace.w / 2 + 0.3);
  expect(p.x).toBeLessThan(terrace.x + terrace.w / 2 - 0.3);
  expect(p.y).toBeGreaterThan(terrace.y + terrace.h / 2 - 0.05);
  expect(p.y).toBeLessThan(terrace.y + terrace.h / 2 + 0.05);
  expect(p.grounded).toBe(true);
});
