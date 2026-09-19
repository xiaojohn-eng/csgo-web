import { describe, expect, it } from 'vitest';
import { cycleSpectatorTarget, selectSpectatorTarget, spectatorCandidates } from '../game/spectator';
import type { Player } from '../game/types';

const player = (id: string, team: Player['team'], alive: boolean): Player => ({
  id, name: id, team, bot: id.startsWith('bot'), x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
  vy: 0, vx: 0, vz: 0, shotHeat: 0, shotIdle: 0, grounded: true, crouch: false,
  stancePhase: 0, stanceRate: 0, stanceTarget: false, hp: alive ? 100 : 0, armor: 0,
  alive, weapon: 'glock', primary: null, secondary: 'glock', slot: 1, ammo: 20,
  reserve: 120, primaryAmmo: 0, primaryReserve: 0, pistolAmmo: 20, pistolReserve: 120,
  reload: 0, cooldown: 0, kills: 0, deaths: alive ? 0 : 1, money: 800, ack: 0,
  respawn: 0, use: 0, grenades: 0, smokes: 0, flashes: 0, flash: 0, reveal: 0,
});

describe('Source spectator target selection', () => {
  it('only exposes living teammates after local death', () => {
    const players = [player('you', 'amber', false), player('mate', 'amber', true), player('enemy', 'blue', true)];
    expect(spectatorCandidates(players, 'you').map((p) => p.id)).toEqual(['mate']);
    expect(selectSpectatorTarget(players, 'you')?.id).toBe('mate');
  });

  it('returns no target while alive or when the team is eliminated', () => {
    expect(selectSpectatorTarget([player('you', 'amber', true), player('mate', 'amber', true)], 'you')).toBeNull();
    expect(selectSpectatorTarget([player('you', 'amber', false), player('mate', 'amber', false)], 'you')).toBeNull();
  });

  it('retains a valid target and cycles deterministically when requested', () => {
    const players = [player('you', 'amber', false), player('a', 'amber', true), player('b', 'amber', true), player('c', 'amber', true)];
    expect(selectSpectatorTarget(players, 'you', 'b')?.id).toBe('b');
    expect(cycleSpectatorTarget(players, 'you', 'b')?.id).toBe('c');
    expect(cycleSpectatorTarget(players, 'you', 'a', -1)?.id).toBe('c');
    expect(cycleSpectatorTarget(players, 'you', 'missing')?.id).toBe('a');
  });
});
