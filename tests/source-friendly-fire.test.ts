import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, Simulation } from '../game/simulation';
import { SOURCE_COMPETITIVE_GAMEMODE, sourceFriendlyFireMultiplier } from '../game/source-gamemode';
import type { SourceBulletDamageResult } from '../game/source-damage';

const bullet = (healthDamage = 100, armorDamage = 0): SourceBulletDamageResult => ({
  withinRange: true, healthDamage, healthDamageFloat: healthDamage, distanceDamage: healthDamage,
  hitgroupDamage: healthDamage, armored: armorDamage > 0, armorAfter: 100 - armorDamage,
  armorDamage, reportedArmorDamage: armorDamage,
});

describe('Source competitive friendly fire', () => {
  const games: Simulation[] = [];
  beforeAll(initPhysics);
  afterEach(() => { for (const game of games) game.dispose(); games.length = 0; });

  it('stages the competitive switches and exact shipped multipliers', () => {
    expect(SOURCE_COMPETITIVE_GAMEMODE.friendlyFire).toEqual({
      enabled: true, bullets: 0.33, grenade: 0.85, grenadeSelf: 1, other: 0.4, forceCamera: 1,
    });
    expect(sourceFriendlyFireMultiplier(SOURCE_COMPETITIVE_GAMEMODE, 'bullet')).toBe(0.33);
    expect(sourceFriendlyFireMultiplier(SOURCE_COMPETITIVE_GAMEMODE, 'grenade')).toBe(0.85);
    expect(sourceFriendlyFireMultiplier(SOURCE_COMPETITIVE_GAMEMODE, 'grenade', true)).toBe(1);
  });

  it('applies the competitive bullet multiplier to a teammate without self-hit', () => {
    const game = new Simulation('demolition', false); games.push(game);
    const shooter = game.addPlayer('shooter', 'Shooter', 'amber');
    const teammate = game.addPlayer('mate', 'Mate', 'amber');
    teammate.armor = 100;
    game.damage(teammate, shooter, 100, false, bullet(100, 20), 'vandal');
    expect(teammate.hp).toBe(67);
    expect(teammate.armor).toBe(94);
    expect(game.events.at(-1)).toMatchObject({ type: 'hit', by: shooter.id, target: teammate.id, damage: 33 });
    const before = shooter.hp;
    game.damage(shooter, shooter, 100, false, bullet(100), 'vandal');
    expect(shooter.hp).toBe(before);
  });

  it('charges the teammate-kill penalty and preserves enemy kill cash', () => {
    const game = new Simulation('demolition', false); games.push(game);
    const shooter = game.addPlayer('shooter', 'Shooter', 'amber');
    const teammate = game.addPlayer('mate', 'Mate', 'amber');
    shooter.money = 1000;
    game.damage(teammate, shooter, 400, false, undefined, 'vandal');
    expect(teammate.alive).toBe(false);
    expect(shooter.kills).toBe(0);
    expect(shooter.money).toBe(700);
    const enemy = game.addPlayer('enemy', 'Enemy', 'blue');
    enemy.hp = 1;
    shooter.money = 0;
    game.damage(enemy, shooter, 300, false, undefined, 'vandal');
    expect(enemy.alive).toBe(false);
    expect(shooter.kills).toBe(1);
    expect(shooter.money).toBe(300);
  });

  it('uses the separate HE teammate and self multipliers', () => {
    const game = new Simulation('demolition', false); games.push(game);
    const thrower = game.addPlayer('thrower', 'Thrower', 'amber');
    const teammate = game.addPlayer('mate', 'Mate', 'amber');
    game.damage(teammate, thrower, 100, false, undefined, 'he');
    expect(teammate.hp).toBe(15);
    game.damage(thrower, thrower, 100, false, undefined, 'he');
    expect(thrower.hp).toBe(0);
    expect(thrower.alive).toBe(false);
  });

  it('keeps training sandbox team damage disabled', () => {
    const game = new Simulation('training', false); games.push(game);
    const shooter = game.addPlayer('shooter', 'Shooter', 'amber');
    const teammate = game.addPlayer('mate', 'Mate', 'amber');
    game.damage(teammate, shooter, 100, false);
    expect(teammate.hp).toBe(100);
    expect(teammate.alive).toBe(true);
  });
});
