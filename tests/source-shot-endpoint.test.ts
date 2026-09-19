import { afterEach, beforeAll, expect, it } from 'vitest';
import { Simulation, initPhysics } from '../game/simulation';
import { EMPTY_INPUT, WEAPONS } from '../game/types';
import { sourceSimulationFixture } from './fixtures/source-simulation-fixture';

beforeAll(initPhysics);
const games: Simulation[] = [];
afterEach(() => games.splice(0).forEach(game => game.dispose()));
function shot(actorDistance?: number, wall = false) {
  const fixture = sourceSimulationFixture();
  if (wall) { fixture.collision.colliders[1].roles.push('bullet'); fixture.collision.colliders[1].source = { surface: 'concrete' }; }
  if (actorDistance !== undefined) fixture.hitboxes = {
    id: 'endpoint-hitbox-fixture', status: 'verified-bone-hitboxes',
    raycast: (_pose, _origin, _direction, maxDistance) => actorDistance < maxDistance
      ? { distance: actorDistance, head: false, group: 2 } : null,
  };
  const game = new Simulation('training', false, fixture); games.push(game);
  const shooter = game.addPlayer('shooter', 'Shooter', 'amber');
  if (actorDistance !== undefined) game.addPlayer('target', 'Target', 'blue');
  game.shoot(shooter, { ...EMPTY_INPUT, time: game.time });
  const event = game.events.findLast(event => event.type === 'shot')!;
  return { game, shooter, event };
}

it('sends the real range endpoint beyond the legacy 100 metre display cap', () => {
  const { event, shooter } = shot();
  expect(event.sourceTracer).toBeDefined();
  const [x, y, z] = event.sourceTracer!.end;
  // The original float32 direction can differ from unit length by a few ULPs.
  expect(Math.hypot(x - event.x!, y - event.y!, z - event.z!)).toBeCloseTo(WEAPONS[shooter.weapon].range, 4);
  expect(Math.hypot(event.dx!, event.dy!, event.dz!)).toBeCloseTo(100, 4);
  expect(event.impact).toBeUndefined();
  expect(JSON.parse(JSON.stringify(event)).sourceTracer.end).toEqual(event.sourceTracer!.end);
});

it('ends at the accepted actor hit even though there is no map impact', () => {
  const { event, game } = shot(5);
  const [x, y, z] = event.sourceTracer!.end;
  expect(Math.hypot(x - event.x!, y - event.y!, z - event.z!)).toBeCloseTo(5, 5);
  expect(game.events.some(event => event.type === 'hit' && event.target === 'target')).toBe(true);
  expect(event.impact).toBeUndefined();
});

it('keeps legacy non-Source shots on their existing event contract', () => {
  const game = new Simulation('training', false); games.push(game);
  const shooter = game.addPlayer('shooter', 'Shooter', 'amber');
  game.shoot(shooter, EMPTY_INPUT);
  expect(game.events.findLast(event => event.type === 'shot')?.sourceTracer).toBeUndefined();
});

it('uses the same mapped penetration path in training and competitive modes', () => {
  const { game, event } = shot(5, true);
  expect(event.sourceTracer!.end[2]).toBeCloseTo(-5, 3);
  expect(game.events.some(event => event.type === 'hit')).toBe(true);
  expect(event.impact).toBeUndefined();
});
