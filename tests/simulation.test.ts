import { beforeAll, afterEach, describe, it, expect } from 'vitest';
import { Simulation, initPhysics } from '../game/simulation';
import { EMPTY_INPUT, validateInput, cleanName } from '../game/types';
import { pathfind, obstructed, SOURCE_BOXES, MAP_BOUNDS, SITES, SPAWN_POSES, sight } from '../game/map';
beforeAll(initPhysics);
let games: Simulation[] = [];
afterEach(() => {
  games.forEach((s) => s.dispose());
  games = [];
});
function game(mode: 'training' | 'demolition' = 'training') {
  const s = new Simulation(mode, false);
  games.push(s);
  return s;
}
function input(seq = 1) {
  return { ...EMPTY_INPUT, seq };
}
function ticks(s: Simulation, n: number) {
  for (let i = 0; i < n; i++) s.step();
}
describe('authority input boundary', () => {
  it('rejects NaN infinity out-of-range and stale packets', () => {
    for (const v of [
      null,
      {},
      { ...input(), mx: NaN },
      { ...input(), mz: Infinity },
      { ...input(), mx: 2 },
      { ...input(), seq: 1.2 },
      { ...input(), pitch: 4 },
    ])
      expect(validateInput(v)).toBeNull();
    expect(validateInput(input(5), 5)).toBeNull();
    expect(validateInput(input(6), 5)?.seq).toBe(6);
  });
  it('does not accept client health, damage, speed or position', () => {
    const i = validateInput({
      ...input(),
      hp: 999,
      x: 300,
      damage: 999,
      speed: 20,
    });
    expect(i).not.toHaveProperty('hp');
    expect(i).not.toHaveProperty('x');
    expect(i).not.toHaveProperty('damage');
  });
  it('sanitizes player names without preserving control characters', () => {
    expect(cleanName('<b>\u0000Test')).toBe('bTest');
    expect(cleanName('a'.repeat(100)).length).toBe(16);
  });
});
describe('movement and cover', () => {
  it('moves the same distance diagonally and straight', () => {
    const s = game(),
      p = s.addPlayer('a', 'A', 'amber');
    p.x = -20;
    p.z = 27;
    s.setInput(p.id, { ...input(), mz: -1 });
    ticks(s, 60);
    const straight = 27 - p.z;
    expect(straight).toBeGreaterThan(4.3);
    expect(straight).toBeLessThan(4.9);
    const d = game(),
      q = d.addPlayer('b', 'B', 'amber');
    q.x = -20;
    q.z = 27;
    d.setInput(q.id, { ...input(2), mz: -1, mx: 1 });
    ticks(d, 60);
    expect(Math.hypot(q.x + 20, q.z - 27)).toBeCloseTo(straight, 2);
    expect(Math.hypot(q.vx, q.vz)).toBeCloseTo(4.8, 4);
  });
  it('cannot walk through containers or outside the map', () => {
    const s = game(),
      p = s.addPlayer('a', 'A', 'amber');
    const container = SOURCE_BOXES.find(b => b.id === 'COL_1149')!;
    p.x = container.x;
    p.z = container.z + container.d / 2 + 1;
    s.setInput(p.id, { ...input(), mz: -1 });
    ticks(s, 180);
    expect(p.z).toBeGreaterThan(container.z + container.d / 2 + 0.29);
    expect(p.z).toBeLessThan(container.z + container.d / 2 + 1);
    p.x = MAP_BOUNDS.maxX - 1.6;
    p.z = 27;
    s.setInput(p.id, { ...input(2), mx: 1 });
    ticks(s, 180);
    expect(p.x).toBeLessThan(MAP_BOUNDS.maxX);
  });
  it('jump returns to the ground', () => {
    const s = game(),
      p = s.addPlayer('a', 'A', 'amber');
    s.setInput(p.id, { ...input(), jump: true });
    s.step();
    s.setInput(p.id, input(2));
    ticks(s, 15);
    expect(p.y).toBeGreaterThan(0.5);
    ticks(s, 100);
    expect(p.y).toBeLessThan(0.1);
    expect(p.grounded).toBe(true);
  });
  it('pathfinding produces a walkable route around M01 obstructions', () => {
    const start = SPAWN_POSES.blue[0], goal = SITES.find(s => s.name === 'B')!;
    expect(sight({ ...start, y: 1.4 }, { ...goal, y: 1.4 })).toBe(false);
    const path = pathfind(start.x, start.z, goal.x, goal.z);
    expect(path.length).toBeGreaterThan(10);
    expect(path.every((p) => !obstructed(p.x, p.z, 0.5))).toBe(true);
    const last = path.at(-1)!;
    expect(Math.hypot(last.x - goal.x, last.z - goal.z)).toBeLessThan(0.5);
  });
});
describe('weapons and damage', () => {
  it('server enforces ammunition and fire rate', () => {
    const s = game(),
      p = s.addPlayer('a', 'A', 'amber');
    s.setInput(p.id, { ...input(), fire: true });
    ticks(s, 60);
    expect(p.ammo).toBeLessThan(30);
    expect(p.ammo).toBeGreaterThan(20);
    expect(s.events.filter((e) => e.type === 'shot').length).toBeLessThan(10);
  });
  it('reload transfers only reserve rounds after the reload duration', () => {
    const s = game(),
      p = s.addPlayer('a', 'A', 'amber');
    p.ammo = 4;
    p.reserve = 8;
    s.setInput(p.id, { ...input(), reload: true });
    ticks(s, 20);
    expect(p.ammo).toBe(4);
    ticks(s, 160);
    expect(p.ammo).toBe(12);
    expect(p.reserve).toBe(0);
  });
  it('wall prevents a hit and open line allows a headshot', () => {
    const s = game(),
      a = s.addPlayer('a', 'A', 'amber'),
      b = s.addPlayer('b', 'B', 'blue');
    const container = SOURCE_BOXES.find(b => b.id === 'COL_1149')!;
    a.x = b.x = container.x;
    a.z = container.z + container.d / 2 + 1;
    a.y = 0;
    a.yaw = a.pitch = 0;
    b.z = container.z - container.d / 2 - 1;
    b.y = 0;
    b.armor = 0;
    a.cooldown = 0;
    s.shoot(a, input());
    expect(b.hp).toBe(100);
    // M01 west route is clear; old x=-29 endpoints are inside new authored geometry.
    a.x = b.x = -20;
    a.z = 5;
    b.z = 0;
    a.shotHeat = 0;
    a.cooldown = 0;
    s.shoot(a, { ...input(), aim: true });
    expect(b.hp).toBeLessThan(100);
    expect(s.events.some(e => e.type === 'hit' && e.head)).toBe(true);
  });
  it('armour absorbs damage and kills cannot be counted twice', () => {
    const s = game(),
      a = s.addPlayer('a', 'A', 'amber'),
      b = s.addPlayer('b', 'B', 'blue');
    b.armor = 100;
    s.damage(b, a, 50, false);
    expect(b.hp).toBe(70);
    expect(b.armor).toBe(80);
    s.damage(b, a, 300, false);
    s.damage(b, a, 300, false);
    expect(a.kills).toBe(1);
    expect(b.deaths).toBe(1);
  });
  it('same-team damage is ignored', () => {
    const s = game(),
      a = s.addPlayer('a', 'A', 'amber'),
      b = s.addPlayer('b', 'B', 'amber');
    s.damage(b, a, 999, true);
    expect(b.hp).toBe(100);
  });
});
describe('match loop and economy', () => {
  it('buying obeys balance and the original round phase', () => {
    const s = game('demolition'),
      p = s.addPlayer('a', 'A', 'amber');
    // The LAN mode starts on the original `mp_startmoney`, so a full buy is out of
    // reach until the team has earned cash.
    expect(p.money).toBe(800);
    expect(s.buy(p.id, 'marshal')).toBe(false);
    p.money = 16000;
    expect(s.buy(p.id, 'marshal')).toBe(true);
    expect(p.money).toBe(12800);
    p.money = 600;
    expect(s.buy(p.id, 'armor')).toBe(false);
    // The original buy window outlives the freeze time, so the round clock closes
    // the shop rather than the phase name.
    s.phase = 'live';
    s.remaining = 115.2;
    p.money = 10000;
    expect(s.buy(p.id, 'vandal')).toBe(true);
    s.remaining = 115.2 - 5;
    expect(s.buy(p.id, 'vandal')).toBe(false);
    expect(s.buy(p.id, '__proto__')).toBe(false);
  });
  it('plant requires continuous interaction then defuse wins the round', () => {
    const s = game('demolition'),
      a = s.addPlayer('a', 'A', 'amber'),
      b = s.addPlayer('b', 'B', 'blue');
    s.phase = 'live';
    s.remaining = 100;
    const site = SITES.find(site => site.name === 'A')!;
    a.x = site.x;
    a.z = site.z;
    s.setInput(a.id, { ...input(), use: true });
    ticks(s, 100);
    expect(s.bomb.planted).toBe(false);
    s.setInput(a.id, input(2));
    ticks(s, 2);
    expect(a.use).toBe(0);
    s.setInput(a.id, { ...input(3), use: true });
    ticks(s, 185);
    expect(s.bomb.planted).toBe(true);
    b.x = s.bomb.x;
    b.z = s.bomb.z;
    s.setInput(b.id, { ...input(), use: true });
    ticks(s, 305);
    expect(s.score.blue).toBe(1);
    expect(s.reason).toContain('解除');
  });
  it('a planted bomb survives elimination of attackers', () => {
    const s = game('demolition'),
      a = s.addPlayer('a', 'A', 'amber'),
      b = s.addPlayer('b', 'B', 'blue');
    s.phase = 'live';
    s.bomb.planted = true;
    s.bomb.timer = 1;
    s.damage(a, b, 999, true);
    s.step();
    expect(s.phase).toBe('live');
    ticks(s, 65);
    expect(s.score.amber).toBe(1);
  });
  it('round timeout awards defenders and resets on next round', () => {
    const s = game('demolition');
    s.addPlayer('a', 'A', 'amber');
    s.addPlayer('b', 'B', 'blue');
    s.phase = 'live';
    s.remaining = 0.05;
    ticks(s, 5);
    expect(s.score.blue).toBe(1);
    ticks(s, 310);
    expect(s.round).toBe(2);
    expect(s.phase).toBe('buy');
  });
  it('the original clinch target finishes, then restart clears the score', () => {
    const s = game('demolition');
    s.addPlayer('a', 'A', 'amber');
    s.addPlayer('b', 'B', 'blue');
    // The LAN mode plays the original short competitive format: nine of sixteen.
    s.score.amber = 8;
    s.phase = 'live';
    s.endRound('amber', 'test');
    expect(s.phase).toBe('match');
    s.restart();
    expect(s.round).toBe(1);
    expect(s.score.amber).toBe(0);
    expect(s.phase).toBe('buy');
  });
  it('training respawns eliminated players and terminates at time limit', () => {
    const s = game(),
      a = s.addPlayer('a', 'A', 'amber'),
      b = s.addPlayer('b', 'B', 'blue');
    s.damage(b, a, 999, true);
    ticks(s, 185);
    expect(b.alive).toBe(true);
    s.remaining = 0.01;
    s.step();
    expect(s.phase).toBe('match');
  });
  it('simulation snapshot cannot mutate the authoritative match', () => {
    const s = game(),
      p = s.addPlayer('a', 'A', 'amber');
    const copy = s.snapshot();
    copy.players[0].hp = 999;
    copy.score.amber = 99;
    expect(p.hp).toBe(100);
    expect(s.score.amber).toBe(0);
  });
});
describe('projectiles and long-lived state', () => {
  it('grenade travels through physics before exploding and consumes exactly one charge', () => {
    const s = game(),
      p = s.addPlayer('a', 'A', 'amber');
    p.cooldown = 0;
    s.setInput(p.id, { ...input(), grenade: true });
    s.step();
    expect(p.grenades).toBe(0);
    expect(s.snapshot().grenades).toHaveLength(1);
    expect(s.events.some((e) => e.type === 'grenade')).toBe(false);
    const z = s.snapshot().grenades[0].z;
    ticks(s, 20);
    expect(s.snapshot().grenades[0].z).toBeLessThan(z);
    ticks(s, 100);
    expect(s.snapshot().grenades).toHaveLength(0);
    expect(s.events.filter((e) => e.type === 'grenade')).toHaveLength(1);
  });
  it('switching weapons preserves each magazine', () => {
    const s = game(),
      p = s.addPlayer('a', 'A', 'amber');
    p.ammo = 7;
    s.setInput(p.id, { ...input(), slot: 1 });
    s.step();
    expect(p.weapon).toBe('sidearm');
    expect(p.ammo).toBe(12);
    p.ammo = 3;
    s.setInput(p.id, { ...input(2), slot: 0 });
    s.step();
    expect(p.ammo).toBe(7);
    s.setInput(p.id, { ...input(3), slot: 1 });
    s.step();
    expect(p.ammo).toBe(3);
  });
  it('buy phase prevents movement and fire', () => {
    const s = game('demolition'),
      p = s.addPlayer('a', 'A', 'amber'),
      z = p.z;
    s.setInput(p.id, { ...input(), mz: -1, fire: true });
    ticks(s, 120);
    expect(Math.abs(p.z - z)).toBeLessThan(0.01);
    expect(p.ammo).toBe(30);
  });
});
