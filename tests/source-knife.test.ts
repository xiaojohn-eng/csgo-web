import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EMPTY_INPUT } from '../game/types';
import { initPhysics, Simulation } from '../game/simulation';
import { sourceSimulationFixture } from './fixtures/source-simulation-fixture';

const games: Simulation[] = [];
beforeAll(initPhysics);
afterEach(() => games.splice(0).forEach(game => game.dispose()));

function game() {
  const fixture = sourceSimulationFixture();
  const simulation = new Simulation('demolition', false, {
    ...fixture,
    weapons: ['vandal', 'm4a4', 'glock', 'usp', 'deagle', 'awp'],
    defaultWeaponByTeam: { amber: 'vandal', blue: 'm4a4' },
    defaultSecondaryWeaponByTeam: { amber: 'glock', blue: 'usp' },
    rifleSeed: () => 42,
    pistolSeed: () => 42,
  }, 'competitiveShort');
  games.push(simulation);
  return simulation;
}

describe('Source knife authority', () => {
  it('equips the carried knife in slot 2 and applies a light melee hit only nearby', () => {
    const simulation = game();
    const attacker = simulation.addPlayer('t', 'T', 'amber');
    const target = simulation.addPlayer('ct', 'CT', 'blue');
    attacker.x = 0; attacker.z = 0; attacker.yaw = 0; attacker.cooldown = 0;
    target.x = 0; target.z = -1.2; target.hp = 100;
    simulation.phase = 'live';
    simulation.setInput(attacker.id, { ...EMPTY_INPUT, seq: 1, slot: 2, fire: true });
    simulation.step();
    expect(attacker.knife).toBe(true);
    expect([attacker.weapon, attacker.slot]).toEqual(['knife', 2]);
    expect(target.hp).toBe(60);
    expect(simulation.events.some(event => event.type === 'hit' && event.by === attacker.id)).toBe(true);
  });

  it('refuses a knife swing through an original wall and across storeys', () => {
    const simulation = game();
    const attacker = simulation.addPlayer('t', 'T', 'amber');
    const target = simulation.addPlayer('ct', 'CT', 'blue');
    attacker.x = 0; attacker.y = -3.75; attacker.z = 0; attacker.yaw = 0; attacker.cooldown = 0;
    // Fixture wall spans z=-2; target is on its far side but within the 2.2m XZ reach.
    target.x = 0; target.y = -3.75; target.z = -2.1; target.hp = 100;
    simulation.phase = 'live';
    simulation.setInput(attacker.id, { ...EMPTY_INPUT, seq: 1, slot: 2, fire: true });
    simulation.step();
    expect(target.hp).toBe(100);
    // A target directly above the same XZ position must not be selected as a melee hit.
    target.y = 5; target.z = -1.2; attacker.cooldown = 0;
    simulation.setInput(attacker.id, { ...EMPTY_INPUT, seq: 2, slot: 2, fire: true });
    simulation.step();
    expect(target.hp).toBe(100);
  });

  it('accepts a secondary-only heavy swing', () => {
    const simulation = game();
    const attacker = simulation.addPlayer('t', 'T', 'amber');
    const target = simulation.addPlayer('ct', 'CT', 'blue');
    attacker.x = 0; attacker.z = 0; attacker.yaw = 0; attacker.cooldown = 0;
    target.x = 0; target.z = -1.2; target.hp = 100;
    simulation.phase = 'live';
    simulation.setInput(attacker.id, { ...EMPTY_INPUT, seq: 1, slot: 2, aim: true });
    simulation.step();
    expect(target.hp).toBe(35);
    expect(simulation.events.some(event => event.type === 'hit' && event.by === attacker.id)).toBe(true);
  });

  it('enforces scalar 3D reach and selects the nearest visible enemy', () => {
    const fixture = sourceSimulationFixture();
    // Remove the fixture wall for an isolated reach/selection check.
    fixture.collision.colliders = fixture.collision.colliders.slice(0, 1);
    const simulation = new Simulation('demolition', false, { ...fixture,
      weapons: ['vandal', 'm4a4', 'glock', 'usp', 'deagle', 'awp'],
      defaultWeaponByTeam: { amber: 'vandal', blue: 'm4a4' },
      defaultSecondaryWeaponByTeam: { amber: 'glock', blue: 'usp' } }, 'competitiveShort');
    games.push(simulation);
    const attacker = simulation.addPlayer('t', 'T', 'amber');
    const far = simulation.addPlayer('far', 'Far', 'blue');
    const near = simulation.addPlayer('near', 'Near', 'blue');
    attacker.x = 0; attacker.y = -3.75; attacker.z = 0; attacker.yaw = 0; attacker.cooldown = 0;
    far.x = 0; far.y = -3.75; far.z = -1.8; far.hp = 100;
    near.x = 0; near.y = -3.75; near.z = -1.2; near.hp = 100;
    simulation.phase = 'live'; simulation.setInput(attacker.id, { ...EMPTY_INPUT, seq: 1, slot: 2, fire: true }); simulation.step();
    expect(near.hp).toBe(60); expect(far.hp).toBe(100);
    // Vertical offset keeps XZ inside reach but puts the body centre beyond 2.2m.
    near.hp = 100; far.hp = 100; far.z = -10; near.z = -2.1; near.y = -1.95; attacker.cooldown = 0;
    simulation.setInput(attacker.id, { ...EMPTY_INPUT, seq: 2, slot: 2, fire: true }); simulation.step();
    expect(near.hp).toBe(100);
  });

  it('uses the secondary button for a slower heavy hit and refuses out-of-range targets', () => {
    const simulation = game();
    const attacker = simulation.addPlayer('t', 'T', 'amber');
    const target = simulation.addPlayer('ct', 'CT', 'blue');
    attacker.x = 0; attacker.z = 0; attacker.yaw = 0; attacker.cooldown = 0;
    target.x = 0; target.z = -1.2; target.hp = 100;
    simulation.phase = 'live';
    simulation.setInput(attacker.id, { ...EMPTY_INPUT, seq: 1, slot: 2, aim: true });
    simulation.step();
    expect(target.hp).toBe(35);
    expect(attacker.cooldown).toBeCloseTo(0.9, 5);
    target.hp = 100; target.z = -3;
    attacker.cooldown = 0;
    simulation.setInput(attacker.id, { ...EMPTY_INPUT, seq: 2, slot: 2, fire: true });
    simulation.step();
    expect(target.hp).toBe(100);
  });
});
