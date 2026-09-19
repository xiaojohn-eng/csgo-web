import { afterEach, beforeAll, expect, it } from 'vitest';
import { Simulation, initPhysics } from '../game/simulation';
import { EMPTY_INPUT } from '../game/types';

beforeAll(initPhysics);
const games: Simulation[] = [];
afterEach(() => { games.splice(0).forEach(s => s.dispose()); });
function game() { const s = new Simulation('demolition', false); games.push(s); return s; }

it('control transfer preserves a dead, spent seat instead of spawning a fresh combatant', () => {
  const s = game(), p = s.addPlayer('human', 'Old', 'amber');
  Object.assign(p, { hp: 0, alive: false, money: 150, ammo: 0, reserve: 2, armor: 7,
    kills: 3, deaths: 4, primaryAmmo: 0, pistolAmmo: 5, grenades: 0, use: 2, ack: 99 });
  const physical = s.bodies.get(p.id)!;
  physical.collider.setEnabled(false);
  const location = { x: p.x, y: p.y, z: p.z };
  s.setInput(p.id, { ...EMPTY_INPUT, seq: 99, fire: true, use: true });
  const bot = s.transferControl('human', 'bot-replacement', '替补', true);
  expect(bot).toMatchObject({ id: 'bot-replacement', bot: true, hp: 0, alive: false,
    money: 150, ammo: 0, reserve: 2, armor: 7, kills: 3, deaths: 4, primaryAmmo: 0,
    pistolAmmo: 5, grenades: 0, use: 0, ack: 0, ...location });
  expect(s.players).toHaveLength(1);
  expect(s.bodies.get(bot.id)).toBe(physical);
  expect(physical.collider.isEnabled()).toBe(false);
  expect(s.inputs.has('human')).toBe(false);
  expect(s.inputs.has(bot.id)).toBe(false);
  const human = s.transferControl(bot.id, 'new-human', 'New', false);
  expect(human).toMatchObject({ id: 'new-human', bot: false, hp: 0, alive: false,
    money: 150, ammo: 0, kills: 3, deaths: 4 });
  expect(s.bodies.get(human.id)).toBe(physical);
});

it('identity transfer keeps objective ownership, rewind targets and launched damage attribution', () => {
  const s = game(), p = s.addPlayer('old', 'Old', 'amber');
  s.addPlayer('enemy', 'Enemy', 'blue', true);
  s.phase = 'live';
  p.cooldown = 0;
  s.setInput('old', { ...EMPTY_INPUT, grenade: true });
  s.step();
  s.ai.get('enemy')!.target = 'old';
  s.transferControl('old', 'new', 'New', false);
  expect(s.bomb.carrier).toBe('new');
  expect(s.grenades[0].by).toBe('new');
  expect(s.ai.get('enemy')!.target).toBe('new');
  expect(s.history.at(-1)!.players.some(p => p.id === 'new')).toBe(true);
  expect(s.history.at(-1)!.players.some(p => p.id === 'old')).toBe(false);
  expect(s.events.some(e => e.type === 'throw' && e.by === 'new')).toBe(true);
});

it('invalid control transfer cannot overwrite another combatant or partially mutate a seat', () => {
  const s = game(); s.addPlayer('a', 'A', 'amber'); s.addPlayer('b', 'B', 'blue');
  const before = s.snapshot();
  expect(() => s.transferControl('a', 'b', 'Collision', false)).toThrow();
  expect(() => s.transferControl('missing', 'c', 'Absent', false)).toThrow();
  expect(s.snapshot()).toEqual(before);
});
