import { afterEach, beforeAll, expect, it } from 'vitest';
import { Simulation, initPhysics } from '../game/simulation';
import { EMPTY_INPUT } from '../game/types';
import { sourceSimulationFixture } from './fixtures/source-simulation-fixture';

const games: Simulation[] = [];
beforeAll(initPhysics);
afterEach(() => games.splice(0).forEach(game => game.dispose()));
function setup(wall = false) {
  const fixture = sourceSimulationFixture();
  if (wall) fixture.collision.colliders[1].roles.push('bullet');
  fixture.weapons = ['vandal', 'm4a4', 'glock', 'usp', 'deagle', 'awp'];
  fixture.defaultWeaponByTeam = { amber: 'vandal', blue: 'm4a4' };
  fixture.defaultSecondaryWeaponByTeam = { amber: 'glock', blue: 'usp' };
  const game = new Simulation('demolition', false, fixture, 'competitiveShort');
  games.push(game);
  const player = game.addPlayer('picker', 'Picker', 'blue');
  game.addPlayer('enemy', 'Enemy', 'amber');
  player.money = 16000;
  return { game, player };
}
function pistol(game: Simulation, player: Simulation['players'][number], offset = .3, y = 1) {
  return game.droppedWeapons.create({ id: 'pistol', ownerId: 'other', weapon: 'deagle',
    createdAt: game.time, position: [player.x + offset, player.y + y, player.z],
    quaternion: [0, 0, 0, 1], ammo: 4, reserve: 19, sleeping: true });
}

it('consumes a drop command once even when the server reuses the last input', () => {
  const { game, player } = setup();
  game.buy(player.id, 'm4a4'); game.phase = 'live';
  game.setInput(player.id, { ...EMPTY_INPUT, seq: 1, slot: 0, drop: true });
  game.step();
  for (let tick = 0; tick < 5; tick++) game.step();
  expect(player.secondary).toBe('usp');
  expect(game.droppedWeapons.read().map(drop => drop.weapon)).toEqual(['m4a4']);
  // A different intentional request may discard the remaining sidearm.
  game.setInput(player.id, { ...EMPTY_INPUT, seq: 2, slot: 1, drop: true });
  expect(() => game.step()).not.toThrow();
  expect(game.droppedWeapons.read().map(drop => drop.weapon).sort()).toEqual(['m4a4', 'usp']);
});

it('does not alternate pistols on every server tick while E stays held', () => {
  const { game, player } = setup(); game.phase = 'live'; pistol(game, player);
  for (let seq = 1; seq <= 8; seq++) {
    game.setInput(player.id, { ...EMPTY_INPUT, seq, slot: 1, use: true });
    expect(() => game.step()).not.toThrow();
    expect(player.secondary).toBe('deagle');
  }
  expect(game.droppedWeapons.read().map(drop => drop.weapon)).toEqual(['usp']);
});

it('chooses an eligible pistol even when an unusable primary is closer', () => {
  const { game, player } = setup(); game.buy(player.id, 'm4a4');
  game.droppedWeapons.create({ id: 'blocked-primary', ownerId: 'other', weapon: 'vandal',
    createdAt: game.time, position: [player.x + .1, player.y + 1, player.z], quaternion: [0, 0, 0, 1], sleeping: true });
  pistol(game, player, .5); game.phase = 'live';
  game.interact(player, { ...EMPTY_INPUT, seq: 1, use: true }, 1 / 60);
  expect(player.secondary).toBe('deagle');
  expect(player.primary).toBe('m4a4');
});

it('does not collect a pistol on another floor or through a map wall', () => {
  const { game, player } = setup(true); game.phase = 'live';
  pistol(game, player, .2, 8);
  game.interact(player, { ...EMPTY_INPUT, seq: 1, use: true }, 1 / 60);
  expect(player.secondary).toBe('usp');
  game.droppedWeapons.remove('pistol'); player.z = -1.6;
  game.droppedWeapons.create({ id: 'behind-wall', ownerId: 'other', weapon: 'deagle',
    createdAt: game.time, position: [player.x, player.y + .5, -2.3], quaternion: [0, 0, 0, 1], sleeping: true });
  game.interact(player, { ...EMPTY_INPUT, seq: 2 }, 1 / 60);
  game.interact(player, { ...EMPTY_INPUT, seq: 3, use: true }, 1 / 60);
  expect(player.secondary).toBe('usp');
});

it('saves the held rifle clip before switching to a picked-up pistol', () => {
  const { game, player } = setup(); game.buy(player.id, 'm4a4');
  player.ammo = 7; player.reserve = 41; pistol(game, player); game.phase = 'live';
  game.interact(player, { ...EMPTY_INPUT, seq: 1, use: true }, 1 / 60);
  game.setInput(player.id, { ...EMPTY_INPUT, seq: 2, slot: 0 }); game.step();
  expect([player.ammo, player.reserve]).toEqual([7, 41]);
});

it('keeps the replaced pistol finish and remains intact if the drop cannot be created', () => {
  const { game, player } = setup(); game.phase = 'live';
  const finish = { weapon: 'usp' as const, paintKitId: 653, seed: 2, wear: .1 };
  player.sourceWeaponFinish = finish; pistol(game, player);
  const create = game.droppedWeapons.create;
  game.droppedWeapons.create = () => { throw Error('injected physics failure'); };
  expect(() => game.interact(player, { ...EMPTY_INPUT, seq: 1, use: true }, 1 / 60)).toThrow();
  expect(player.secondary).toBe('usp');
  expect(game.droppedWeapons.read().map(drop => drop.id)).toEqual(['pistol']);
  game.droppedWeapons.create = create;
  game.interact(player, { ...EMPTY_INPUT, seq: 2 }, 1 / 60);
  game.interact(player, { ...EMPTY_INPUT, seq: 3, use: true }, 1 / 60);
  expect(game.droppedWeapons.read().find(drop => drop.weapon === 'usp')?.sourceWeaponFinish).toEqual(finish);
});

it('allows weapon transfers during freeze time without starting a plant', () => {
  const { game, player } = setup(); game.buy(player.id, 'm4a4');
  game.setInput(player.id, { ...EMPTY_INPUT, seq: 1, slot: 0, drop: true }); game.step();
  expect(player.primary).toBeNull();
  expect(game.bomb.planted).toBe(false);
});

it('retains the picked USP attachment state and ammunition, including a same-type replacement', () => {
  const { game, player } = setup(); game.phase = 'live';
  game.droppedWeapons.create({ id: 'unsilenced-usp', ownerId: 'other', weapon: 'usp',
    createdAt: game.time, position: [player.x + .3, player.y + 1, player.z],
    quaternion: [0, 0, 0, 1], ammo: 3, reserve: 9, silencerVisible: false, sleeping: true });
  game.interact(player, { ...EMPTY_INPUT, seq: 1, use: true }, 1 / 60);
  expect([player.ammo, player.reserve]).toEqual([3, 9]);
  expect(player.sourceUSP?.command.silencerAttached).toBe(false);
  expect(player.sourceUSP?.command.mode).toBe(0);
  expect(game.droppedWeapons.read()[0].silencerVisible).toBe(true);
});

it('keeps AWP ammunition across pickup, holster and redeploy', () => {
  const { game, player } = setup(); game.phase = 'live';
  game.droppedWeapons.create({ id: 'awp', ownerId: 'other', weapon: 'awp',
    createdAt: game.time, position: [player.x + .3, player.y + 1, player.z],
    quaternion: [0, 0, 0, 1], ammo: 2, reserve: 7, sleeping: true });
  game.interact(player, { ...EMPTY_INPUT, seq: 1, use: true }, 1 / 60);
  expect([player.ammo, player.reserve]).toEqual([2, 7]);
  game.setInput(player.id, { ...EMPTY_INPUT, seq: 2, slot: 2 }); game.step();
  game.setInput(player.id, { ...EMPTY_INPUT, seq: 3, slot: 0 }); game.step();
  expect([player.ammo, player.reserve]).toEqual([2, 7]);
});

it('does not overwrite holstered rifle ammo when buying a pistol while holding the knife', () => {
  const { game, player } = setup(); game.buy(player.id, 'm4a4');
  player.ammo = 7; player.reserve = 41;
  game.setInput(player.id, { ...EMPTY_INPUT, seq: 1, slot: 2 }); game.step();
  expect(game.buy(player.id, 'deagle')).toBe(true);
  game.setInput(player.id, { ...EMPTY_INPUT, seq: 2, slot: 0 }); game.step();
  expect([player.ammo, player.reserve]).toEqual([7, 41]);
});

it('equips the retained primary after dropping a sidearm and preserves its magazine', () => {
  const { game, player } = setup(); game.buy(player.id, 'm4a4');
  player.ammo = 7; player.reserve = 41;
  game.setInput(player.id, { ...EMPTY_INPUT, seq: 1, slot: 1 }); game.step();
  game.setInput(player.id, { ...EMPTY_INPUT, seq: 2, slot: 1, drop: true }); game.step();
  expect(player.secondary).toBeUndefined();
  expect([player.weapon, player.slot, player.ammo, player.reserve]).toEqual(['m4a4', 0, 7, 41]);
  expect(game.droppedWeapons.read().map(drop => drop.weapon)).toEqual(['usp']);
});

it('lets a survivor who dropped every gun start the next round with the knife', () => {
  const { game, player } = setup();
  game.setInput(player.id, { ...EMPTY_INPUT, seq: 1, slot: 1, drop: true }); game.step();
  expect(player.primary).toBeNull(); expect(player.secondary).toBeUndefined();
  expect(() => game.nextRound()).not.toThrow();
  expect([player.weapon, player.slot, player.ammo, player.reserve]).toEqual(['knife', 2, 0, 0]);
});
