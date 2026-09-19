import { afterEach, beforeAll, expect, it } from 'vitest';
import { initPhysics, Simulation } from '../game/simulation';
import { EMPTY_INPUT, WEAPONS, type Input, type Player } from '../game/types';
import { sourceSimulationFixture } from './fixtures/source-simulation-fixture';

/** The ejected magazine is its own prop on every client, and the surface it
 * lands on is a property of the original map, so the authority traces it while
 * the reload runs. The fixture's collision has one walkable box whose top face
 * sits at y = -4, so a traced surface is measurable without any browser. */
beforeAll(initPhysics);
const live: Simulation[] = [];
afterEach(() => live.splice(0).forEach(s => s.dispose()));
function sim() {
  const data = sourceSimulationFixture();
  data.weapons = ['vandal', 'm4a4', 'glock', 'usp'];
  data.defaultWeaponByTeam = { amber: 'vandal', blue: 'm4a4' };
  data.defaultSecondaryWeaponByTeam = { amber: 'glock', blue: 'usp' };
  const s = new Simulation('training', false, data); live.push(s); return s;
}
function command(s: Simulation, p: Player, seq: number, input: Partial<Input> = {}) {
  s.setInput(p.id, { ...EMPTY_INPUT, seq, slot: p.slot, ...input }); s.step();
}
function startReload(s: Simulation, p: Player, seq: number) {
  // Buying time is over before the original command path accepts fire/reload.
  let next = seq;
  for (; next <= seq + 90; next++) command(s, p, next);
  command(s, p, next++, { fire: true });
  expect(p.ammo).toBeLessThan(WEAPONS[p.weapon].mag);
  for (; next <= seq + 120 && p.reload === 0; next++) command(s, p, next, { reload: true });
  expect(p.reload).toBeGreaterThan(0);
  // Movement (which stamps the surface) runs before the weapon command in a
  // tick, so the field appears on the tick after the reload starts.
  command(s, p, next++, { reload: true });
  return next;
}

it('stamps the original surface under a reloading shooter and clears it again', () => {
  const s = sim(), p = s.addPlayer('p', 'CT', 'blue');
  expect(p.sourceGroundY).toBeUndefined();
  let seq = startReload(s, p, 1);
  // The fixture floor arrives from the original collision trace.
  expect(Number.isFinite(p.sourceGroundY!)).toBe(true);
  expect(p.sourceGroundY!).toBeCloseTo(-4, 4);
  expect(s.snapshot().players[0].sourceGroundY).toBe(p.sourceGroundY);
  // Lifting the shooter off that floor must not move the surface with them: the
  // value is a trace of the map, so it stays on the original box top.
  p.y += 25;
  command(s, p, seq++, { reload: true });
  expect(p.sourceGroundY!).toBeCloseTo(-4, 4);
  // Once the reload has finished the field is gone from the snapshot again.
  for (; seq <= 400; seq++) command(s, p, seq);
  expect(p.reload).toBe(0);
  expect(p.sourceGroundY).toBeUndefined();
  expect(s.snapshot().players[0].sourceGroundY).toBeUndefined();
});

it('falls back to the shooter origin when the original collision has no surface there', () => {
  const s = sim(), p = s.addPlayer('p', 'CT', 'blue');
  const seq = startReload(s, p, 1);
  // Outside the fixture level's bounds the trace legitimately finds nothing.
  p.x = 400; p.z = 400; p.y = 12;
  command(s, p, seq, { reload: true });
  expect(p.sourceGroundY).toBe(p.y);
});

it('carries no surface for a player who is not reloading', () => {
  const s = sim(), p = s.addPlayer('p', 'CT', 'blue');
  for (let seq = 1; seq <= 10; seq++) command(s, p, seq);
  expect(p.reload).toBe(0);
  expect(p.sourceGroundY).toBeUndefined();
});
