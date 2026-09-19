import { afterEach, beforeAll, expect, it } from 'vitest';
import { Simulation, initPhysics } from '../game/simulation';
import type { SourceRuleSetId } from '../game/source-gamemode';
import type { Event } from '../game/types';

beforeAll(initPhysics);
const games: Simulation[] = [];
afterEach(() => games.splice(0).forEach(game => game.dispose()));

it.each([['competitiveShort', 16], ['competitive', 30]] as const)(
  'ends %s at its final tied round without creating an unconfigured extra round', (rules: SourceRuleSetId, rounds) => {
    const game = new Simulation('demolition', false, undefined, rules); games.push(game);
    const a = game.addPlayer('a', 'A', 'amber'), b = game.addPlayer('b', 'B', 'blue'); game.restart();
    // Play every regulation round. Alternate the winning players, following
    // their actual sides through halftime (a 15-round half has an odd length).
    for (let round = 1; round <= rounds; round++) {
      game.phase = 'live';
      game.endRound(round % 2 ? a.team : b.team, 'elimination');
      if (round < rounds) {
        expect(game.phase).toBe('ended');
        game.step(game.remaining + 0.01);
        expect(game.round).toBe(round + 1);
      }
    }
    expect(game.score).toEqual({ amber: rounds / 2, blue: rounds / 2 });
    expect(game.snapshot()).toMatchObject({ phase: 'match', winner: null, reason: '平局', round: rounds });
    expect(game.events.findLast(event => event.type === 'round')?.cash).toBeDefined();
    for (let tick = 0; tick < 240; tick++) game.step();
    game.nextRound();
    expect(game.round).toBe(rounds);
    expect(game.phase).toBe('match');
    game.restart();
    expect(game.snapshot()).toMatchObject({ phase: 'buy', round: 1, score: { amber: 0, blue: 0 } });
  },
);

it('records the killing utility even after the thrower equips another firearm', () => {
  const game = new Simulation('demolition', false); games.push(game);
  const killer = game.addPlayer('a', 'A', 'amber'), victim = game.addPlayer('b', 'B', 'blue');
  killer.weapon = 'awp'; killer.money = 0;
  game.damage(victim, killer, 500, false, undefined, 'he');
  const event = game.events.findLast(event => event.type === 'kill')!;
  expect(event.weapon).toBe('he');
  expect(killer.money).toBe(300);
  expect((JSON.parse(JSON.stringify(event)) as Event).weapon).toBe('he');
});

it('keeps firearm kills and legacy practice match termination unchanged', () => {
  const game = new Simulation('training', false); games.push(game);
  const killer = game.addPlayer('a', 'A', 'amber'), victim = game.addPlayer('b', 'B', 'blue');
  game.damage(victim, killer, 500, false);
  expect(game.events.findLast(event => event.type === 'kill')?.weapon).toBe(killer.weapon);
  game.round = 30; game.score = { amber: 3, blue: 3 }; game.phase = 'live';
  game.endRound('amber', 'practice round');
  expect(game.phase).toBe('ended');
  game.phase = 'live'; game.endRound('amber', 'practice round');
  expect(game.phase).toBe('match');
  expect(game.winner).toBe('amber');
});
