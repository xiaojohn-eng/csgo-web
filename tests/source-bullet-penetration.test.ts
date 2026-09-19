import { beforeAll, describe, expect, it } from 'vitest';
import { SOURCE_BULLET_PENETRATION_METRES, sourceBulletPenetrationFactor } from '../game/source-bullet-penetration';
import { EMPTY_INPUT } from '../game/types';
import { initPhysics, Simulation } from '../game/simulation';
import { sourceSimulationFixture } from './fixtures/source-simulation-fixture';

describe('Source bullet penetration', () => {
  beforeAll(initPhysics);
  it('reduces damage through thin cover and rejects over-thick cover', () => {
    const limit = SOURCE_BULLET_PENETRATION_METRES.ak47;
    expect(sourceBulletPenetrationFactor('ak47', 0)).toBe(1);
    expect(sourceBulletPenetrationFactor('ak47', limit / 2)).toBeCloseTo(.55, 6);
    expect(sourceBulletPenetrationFactor('ak47', limit)).toBe(0);
    expect(sourceBulletPenetrationFactor('ak47', limit + .01)).toBe(0);
  });

  it('keeps the pistol penetration envelope narrower than rifle cover', () => {
    expect(SOURCE_BULLET_PENETRATION_METRES['usp-s']).toBeLessThan(SOURCE_BULLET_PENETRATION_METRES.ak47);
    expect(sourceBulletPenetrationFactor('usp-s', .3)).toBe(0);
    expect(sourceBulletPenetrationFactor('usp-s', .1)).toBeGreaterThan(0);
  });

  it('walks a second mapped wall and compounds its damage attenuation', () => {
    const fixture = sourceSimulationFixture();
    fixture.collision.colliders[1].roles.push('bullet');
    fixture.collision.colliders[1].source = { surface: 'concrete', wall: 'first' };
    fixture.collision.colliders.push({ geometry: 2, translation: [0, -1, -3], rotation: [0, 0, 0, 1],
      scale: 1, roles: ['bullet'], source: { surface: 'concrete', wall: 'second' } });
    fixture.hitboxes = {
      id: 'penetration-two-wall-fixture', status: 'verified-bone-hitboxes',
      raycast: (_pose, _origin, _direction, maxDistance) => 5 < maxDistance
        ? { distance: 5, head: false, group: 2 } : null,
    };
    const game = new Simulation('demolition', false, fixture);
    const shooter = game.addPlayer('shooter', 'Shooter', 'amber');
    game.addPlayer('target', 'Target', 'blue');
    game.shoot(shooter, { ...EMPTY_INPUT, time: game.time });
    const hit = game.events.find(event => event.type === 'hit' && event.target === 'target');
    expect(hit).toBeDefined();
    // Two 0.1m solids apply both factors (one wall would deliver 29 damage).
    expect(hit?.damage).toBeLessThan(29);
    expect(hit?.damage).toBeGreaterThan(15);
    game.dispose();
  });

  it('allows four walls but stops before a fifth wall', () => {
    const make = (wallZ:number[]) => {
      const fixture = sourceSimulationFixture();
      fixture.collision.colliders[1].roles.push('bullet');
      fixture.collision.colliders[1].source = { surface: 'concrete', wall: 'first' };
      for (const z of wallZ) fixture.collision.colliders.push({ geometry: 2,
        translation: [0, -1, z], rotation: [0, 0, 0, 1], scale: 1, roles: ['bullet'], source: { surface: 'concrete', z } });
      fixture.hitboxes = { id: 'penetration-wall-budget-fixture', status: 'verified-bone-hitboxes',
        raycast: (_pose, _origin, _direction, maxDistance) => 7 < maxDistance ? { distance: 7, head: false, group: 2 } : null };
      const game = new Simulation('demolition', false, fixture);
      const shooter = game.addPlayer('shooter', 'Shooter', 'amber'); game.addPlayer('target', 'Target', 'blue');
      game.shoot(shooter, { ...EMPTY_INPUT, time: game.time }); return game;
    };
    const four = make([-3, -4, -5]);
    expect(four.events.some(event => event.type === 'hit' && event.target === 'target')).toBe(true); four.dispose();
    const five = make([-3, -4, -5, -6]);
    expect(five.events.some(event => event.type === 'hit' && event.target === 'target')).toBe(false); five.dispose();
  });

  it('applies the mapped penetration path to AWP authority shots', () => {
    const fixture = sourceSimulationFixture();
    fixture.collision.colliders[1].roles.push('bullet'); fixture.collision.colliders[1].source = { surface: 'concrete' };
    fixture.hitboxes = { id: 'awp-penetration-fixture', status: 'verified-bone-hitboxes',
      raycast: (_pose, _origin, _direction, maxDistance) => 5 < maxDistance ? { distance: 5, head: false, group: 2 } : null };
    fixture.weapons = ['vandal', 'm4a4', 'glock', 'usp', 'deagle', 'awp'];
    fixture.defaultWeaponByTeam = { amber: 'vandal', blue: 'm4a4' };
    fixture.defaultSecondaryWeaponByTeam = { amber: 'glock', blue: 'usp' };
    const game = new Simulation('training', false, fixture);
    const shooter = game.addPlayer('shooter', 'Shooter', 'amber'); game.addPlayer('target', 'Target', 'blue');
    shooter.money = 10000; expect(game.buy(shooter.id, 'awp')).toBe(true);
    for (let seq = 1; seq <= 80; seq++) { game.setInput(shooter.id, { ...EMPTY_INPUT, seq, slot: shooter.slot }); game.step(); }
    game.setInput(shooter.id, { ...EMPTY_INPUT, seq: 81, slot: shooter.slot, fire: true }); game.step();
    const hit = game.events.find(event => event.type === 'hit' && event.target === 'target');
    expect(hit?.damage).toBeGreaterThan(80); expect(hit?.damage).toBeLessThan(115); game.dispose();
  });

  it('uses the entry collider own exit when mapped solids overlap', () => {
    const fixture = sourceSimulationFixture();
    fixture.collision.colliders[1].roles.push('bullet');
    fixture.collision.colliders[1].source = { surface: 'concrete', wall: 'first' };
    fixture.collision.colliders.push({ geometry: 2, translation: [0, -1, -2.04], rotation: [0, 0, 0, 1],
      scale: 1, roles: ['bullet'], source: { surface: 'concrete', wall: 'overlap' } });
    const game = new Simulation('demolition', false, fixture);
    const level = (game as unknown as { sourceLevel: { traceBullet: Function } }).sourceLevel;
    const hit = level.traceBullet(0, -2.1244, 0, 0, 0, -1, 40, 'bullet', true);
    expect(hit?.source).toMatchObject({ wall: 'first' });
    const exit = level.traceBullet(hit.x, hit.y, hit.z - .001, 0, 0, -1, 40, 'bullet', false, hit.collider);
    expect(exit?.source).toMatchObject({ wall: 'first' });
    expect(exit?.distance).toBeCloseTo(.099, 3);
    game.dispose();
  });

  it('allows a competitive authority hit behind a thin mapped collider', () => {
    const fixture = sourceSimulationFixture();
    fixture.collision.colliders[1].roles.push('bullet');
    fixture.collision.colliders[1].source = { surface: 'concrete' };
    fixture.hitboxes = {
      id: 'penetration-hitbox-fixture', status: 'verified-bone-hitboxes',
      raycast: (_pose, _origin, _direction, maxDistance) => 5 < maxDistance
        ? { distance: 5, head: false, group: 2 } : null,
    };
    const game = new Simulation('demolition', false, fixture);
    const shooter = game.addPlayer('shooter', 'Shooter', 'amber');
    game.addPlayer('target', 'Target', 'blue');
    game.shoot(shooter, { ...EMPTY_INPUT, time: game.time });
    expect(game.events.some(event => event.type === 'hit' && event.target === 'target')).toBe(true);
    expect(game.events.findLast(event => event.type === 'shot')?.sourceTracer?.end[2]).toBeCloseTo(-5, 3);
    game.dispose();
  });
});
