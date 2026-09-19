import { afterEach, beforeAll, expect, it } from 'vitest';
import { Simulation, initPhysics } from '../game/simulation';
import { EMPTY_INPUT, type Input } from '../game/types';
import { sight } from '../game/map';

beforeAll(initPhysics);
const games: Simulation[] = [];
afterEach(() => { games.splice(0).forEach(s => s.dispose()); });
function fixture() {
  const s = new Simulation('demolition', false); games.push(s);
  const a = s.addPlayer('a', 'A', 'amber'), b = s.addPlayer('b', 'B', 'blue');
  s.phase = 'live'; s.remaining = 100;
  Object.assign(a, { x: -20, y: 0.03, z: -12, grounded: true, cooldown: 0 });
  Object.assign(b, { x: -20, y: 0.03, z: -12, grounded: true, cooldown: 0 });
  return { s, a, b };
}
function plant(s: Simulation, a: Simulation['players'][number]) {
  for (let i = 0; i < 181; i++) s.interact(a, { ...EMPTY_INPUT, use: true }, 1 / 60);
}

it('plant records authoritative elevation and a nearby reachable defender can defuse', () => {
  const { s, a, b } = fixture(); a.y = b.y = 1.25;
  plant(s, a);
  expect(s.bomb).toMatchObject({ planted: true, x: -20, y: 1.25, z: -12 });
  for (let i = 0; i < 301; i++) s.interact(b, { ...EMPTY_INPUT, use: true }, 1 / 60);
  expect(s.winner).toBe('blue');
});

it.each([1.5, 10, -10])('same XZ from a different floor (%s m) cannot defuse', height => {
  const { s, a, b } = fixture(); plant(s, a); b.y = a.y + height;
  for (let i = 0; i < 301; i++) s.interact(b, { ...EMPTY_INPUT, use: true }, 1 / 60);
  expect(s.winner).toBeNull(); expect(b.use).toBe(0);
});

it('solid M01 wall COL_0331 prevents interaction even inside horizontal reach', () => {
  const { s, a, b } = fixture(); plant(s, a);
  Object.assign(s.bomb, { x: -32.45, y: 0.03, z: -7.7 });
  Object.assign(b, { x: -30.9, y: 0.03, z: -7.7 });
  expect(sight({ x: b.x, y: 1.7, z: b.z }, { x: s.bomb.x, y: 0.21, z: s.bomb.z })).toBe(false);
  for (let i = 0; i < 301; i++) s.interact(b, { ...EMPTY_INPUT, use: true }, 1 / 60);
  expect(s.winner).toBeNull(); expect(b.use).toBe(0);
});

it.each(['fire', 'grenade', 'reload'] as const)('%s cancels plant and defuse progress', action => {
  const { s, a, b } = fixture();
  const interrupted: Input = { ...EMPTY_INPUT, use: true, [action]: true };
  a.use = 2.99; s.interact(a, interrupted, 1 / 60);
  expect(s.bomb.planted).toBe(false); expect(a.use).toBe(0);
  plant(s, a);
  b.use = 4.99; s.interact(b, interrupted, 1 / 60);
  expect(s.winner).toBeNull(); expect(b.use).toBe(0);
});

it('ongoing reload and dead players cannot finish objective interactions', () => {
  const { s, a, b } = fixture();
  a.reload = 1; a.use = 2.99; s.interact(a, { ...EMPTY_INPUT, use: true }, 1 / 60);
  expect(s.bomb.planted).toBe(false); expect(a.use).toBe(0);
  a.reload = 0; plant(s, a);
  b.alive = false; b.use = 4.99; s.interact(b, { ...EMPTY_INPUT, use: true }, 1 / 60);
  expect(s.winner).toBeNull(); expect(b.use).toBe(0);
});

it('release and airborne interruption require a fresh full interaction', () => {
  const { s, a, b } = fixture(); plant(s, a);
  b.use = 4.99; b.grounded = false;
  s.interact(b, { ...EMPTY_INPUT, use: true }, 1 / 60);
  expect(b.use).toBe(0); expect(s.winner).toBeNull();
  b.grounded = true; b.use = 4.99; s.interact(b, EMPTY_INPUT, 1 / 60);
  expect(b.use).toBe(0); expect(s.winner).toBeNull();
});

it('defender bot follows the real M01 path around cover before stopping to defuse', () => {
  const { s, a, b } = fixture();
  Object.assign(a, { x: -21.2, y: 0.015, z: -12.45 }); plant(s, a); a.alive = false;
  Object.assign(b, { x: -22.8970563, y: 0.015, z: -14.1470563 });
  const first = s.botInput(b, 1 / 60);
  expect(first.use).toBe(false);
  expect(Math.hypot(first.mx, first.mz)).toBeGreaterThan(0);
  for (let i = 0; i < 700 && s.phase === 'live'; i++) {
    s.setInput(b.id, s.botInput(b, 1 / 60)); s.step();
  }
  expect(s.winner).toBe('blue'); expect(s.reason).toContain('解除');
});

it('defender bot with no ammunition can finish defusing instead of endlessly requesting reload', () => {
  const { s, a, b } = fixture(); plant(s, a); a.alive = false;
  b.ammo = b.reserve = 0;
  for (let i = 0; i < 310 && s.phase === 'live'; i++) {
    s.setInput(b.id, s.botInput(b, 1 / 60)); s.step();
  }
  expect(s.winner).toBe('blue');
});
