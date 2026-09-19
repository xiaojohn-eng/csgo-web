import { beforeAll, afterEach, it, expect } from 'vitest';
import { Simulation, initPhysics } from '../game/simulation';
import { filterVisibility } from '../server/visibility';
import { SOURCE_BOXES, sight } from '../game/map';
beforeAll(initPhysics);
let s: Simulation;
afterEach(() => s.dispose());
function setup() {
  s = new Simulation('training', false);
  const a = s.addPlayer('a', 'A', 'amber'),
    b = s.addPlayer('b', 'B', 'blue');
  return { a, b };
}
it('standing players remain visible over a low barrier', () => {
  const { a, b } = setup();
  const crate = SOURCE_BOXES.find(box => box.id === 'COL_1158')!;
  a.x = b.x = crate.x;
  a.z = crate.z + crate.d / 2 + 1;
  b.z = crate.z - crate.d / 2 - 1;
  // Verify a real low obstruction exists, so visibility is not vacuously open ground.
  expect(sight({ ...a, y: 1 }, { ...b, y: 1 })).toBe(false);
  const snap = s.snapshot();
  filterVisibility(snap, a.id, 0);
  expect(snap.players.find((p) => p.id === b.id)?.y).toBeGreaterThan(-50);
});
it('hidden enemies do not transmit motion, but their shots retain a coarse audible source', () => {
  const { a, b } = setup();
  const container = SOURCE_BOXES.find(box => box.id === 'COL_1149')!;
  a.x = b.x = container.x;
  a.z = container.z + container.d / 2 + 1;
  b.z = container.z - container.d / 2 - 1;
  const originalZ = b.z;
  const shotX = b.x + 0.35, shotZ = b.z - 0.6;
  b.vz = 4.8;
  s.emit({
    type: 'shot',
    by: b.id,
    weapon: b.weapon,
    x: shotX,
    y: 1.5,
    z: shotZ,
    dx: 0,
    dy: 0,
    dz: 1,
  });
  const snap = s.snapshot();
  filterVisibility(snap, a.id, 0);
  const hidden = snap.players.find((p) => p.id === b.id)!;
  expect(hidden.y).toBe(-100);
  expect(hidden.vz).toBe(0);
  expect(b.z).toBe(originalZ);
  expect(b.vz).toBe(4.8);
  const shot = snap.events.at(-1)!;
  expect(shot.type).toBe('report');
  expect(shot.x).toBe(Math.round(shotX / 2) * 2);
  expect(shot.z).toBe(Math.round(shotZ / 2) * 2);
  expect(shot).not.toHaveProperty('dz');
});
it('smoke hides enemies on open ground and the event cursor removes old sounds', () => {
  const { a, b } = setup();
  a.x = b.x = -20;
  a.z = 5;
  b.z = 0;
  expect(sight({ ...a, y: 1.7 }, { ...b, y: 1.4 })).toBe(true);
  s.smokes.push({ id: 1, x: -20, y: 1.4, z: 2.5, age: 1, remaining: 12 });
  s.emit({ type: 'shot', by: b.id, weapon: b.weapon, x: b.x, y: 1.4, z: b.z });
  const snap = s.snapshot();
  filterVisibility(snap, a.id, s.eid);
  expect(snap.players.find((p) => p.id === b.id)?.y).toBe(-100);
  expect(snap.events).toHaveLength(0);
});
