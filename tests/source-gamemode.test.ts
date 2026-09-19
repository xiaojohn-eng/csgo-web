import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Simulation, initPhysics } from '../game/simulation';
import { SOURCE_COMPETITIVE_GAMEMODE, SOURCE_COMPETITIVE_SHORT_GAMEMODE, SOURCE_DEFAULT_RULE_SET,
  SOURCE_LOSER_BONUS_RUNGS, isSourceRuleSetId, parseSourceGamemode, parseSourceShortGamemode,
  sourceBuyWindowOpen, sourceKillCash, sourceLoserBonus, sourceMatchFormat, sourceRuleSet, sourceRuleSets,
  sourceTeamWinCash, sourceFriendlyFireMultiplier } from '../game/source-gamemode';
import { requestedRuleSet } from '../server/lan';
import {SOURCE_GAMEMODE_COMPETITIVE_STAGED as receipt} from '../game/source-gamemode-competitive.js';

const SOURCE = resolve('.reference-assets/csgo-legacy/csgo/cfg/gamemode_competitive.cfg');
const SOURCE_SHORT = resolve('.reference-assets/csgo-legacy/csgo/cfg/gamemode_competitive_short.cfg');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Every staged value must really be on the line it claims, in the file it claims. */
const verifyLines = (path: string, block: { bytes: number; sha256: string; values: Record<string, { value: string; line: number }> }) => {
  const bytes = readFileSync(path);
  expect(bytes.byteLength).toBe(block.bytes);
  expect(sha256(bytes)).toBe(block.sha256);
  const lines = new TextDecoder().decode(bytes).split('\n');
  for (const [key, row] of Object.entries(block.values)) {
    const parts = (lines[row.line - 1] ?? '').trim().split(/\s+/);
    expect(`${key}@${row.line}:${parts[0]}`).toBe(`${key}@${row.line}:${key}`);
    expect(`${key}@${row.line}:${parts[1]}`).toBe(`${key}@${row.line}:${row.value}`);
  }
};
const clone = () => JSON.parse(JSON.stringify(receipt));
const game = SOURCE_COMPETITIVE_GAMEMODE;
let games: Simulation[] = [];
beforeAll(initPhysics);
afterEach(() => { games.forEach((s) => s.dispose()); games = []; });
const match = () => { const s = new Simulation('demolition', false); games.push(s); return s; };

it.each(['competitiveShort', 'competitive'] as const)('starts the first %s round with the configured freeze time without restart', (ruleSet) => {
  const s = new Simulation('demolition', false, undefined, ruleSet); games.push(s);
  s.addPlayer('first', 'First', 'amber'); s.addPlayer('second', 'Second', 'blue');
  expect(s.snapshot()).toMatchObject({ phase: 'buy', remaining: 15, round: 1 });
  for (let tick = 0; tick < 720; tick++) s.step();
  expect(s.phase).toBe('buy');
  expect(s.remaining).toBeCloseTo(3, 8);
  for (let tick = 0; tick < 181 && s.phase === 'buy'; tick++) s.step();
  expect(s.snapshot()).toMatchObject({ phase: 'live', remaining: 115.2, round: 1 });
});

describe('original competitive mode data', () => {
  it('stages every value with a receipt that re-verifies against the shipped config', () => {
    verifyLines(SOURCE, receipt.base);
    verifyLines(SOURCE_SHORT, receipt.short);
    expect(Object.keys(receipt.base.values).length).toBe(receipt.keys.length);
    // The short file is an override layer: only the keys it names are staged from it.
    expect(Object.keys(receipt.short.values).sort()).toEqual(['mp_maxrounds', 'mp_starting_losses']);
  });

  it('offers both original modes to a room and refuses anything else', () => {
    expect(sourceRuleSets().map((row) => row.id)).toEqual(['competitiveShort', 'competitive']);
    expect(sourceRuleSets().map((row) => row.label)).toEqual(['短竞技', '完整竞技']);
    // The description is built from the staged numbers, so it cannot drift from them.
    expect(sourceRuleSets().map((row) => row.detail))
      .toEqual(['16 回合 · 先到 9 局 · 第 8 回合后换边', '30 回合 · 先到 16 局 · 第 15 回合后换边']);
    expect(sourceRuleSet('competitive').matchFormat.maxRounds).toBe(30);
    expect(sourceRuleSet('competitiveShort').matchFormat.maxRounds).toBe(16);
    expect(SOURCE_DEFAULT_RULE_SET).toBe('competitiveShort');
    expect(isSourceRuleSetId('competitive')).toBe(true);
    expect(isSourceRuleSetId('short')).toBe(false);
    expect(() => sourceRuleSet('short')).toThrow(/Unknown original rule set/);
    expect(() => sourceRuleSet(undefined)).toThrow(/Unknown original rule set/);
    // The room's own request is validated the same way, and defaults to the LAN mode.
    expect(requestedRuleSet({})).toBe('competitiveShort');
    expect(requestedRuleSet({ rules: 'competitive' })).toBe('competitive');
    expect(() => requestedRuleSet({ rules: 'competitiveLong' })).toThrow(/RULES_MISMATCH/);
  });

  it('derives the short mode from that same config and the match format from its own keys', () => {
    expect(SOURCE_COMPETITIVE_SHORT_GAMEMODE.mode).toBe('competitiveShort');
    expect(SOURCE_COMPETITIVE_SHORT_GAMEMODE.sourceFile).toBe('csgo/cfg/gamemode_competitive_short.cfg');
    expect(SOURCE_COMPETITIVE_SHORT_GAMEMODE.sourceSha256).toBe(receipt.short.sha256);
    // The two overridden keys keep the short file's own lines.
    expect(SOURCE_COMPETITIVE_SHORT_GAMEMODE.provenance.mp_maxrounds).toEqual({ value: '16', line: receipt.short.values.mp_maxrounds.line, file: 'gamemode_competitive_short.cfg' });
    expect(SOURCE_COMPETITIVE_SHORT_GAMEMODE.provenance.mp_starting_losses.value).toBe('2');
    // Everything the override file does not name stays the competitive value.
    expect(SOURCE_COMPETITIVE_SHORT_GAMEMODE.money).toEqual(SOURCE_COMPETITIVE_GAMEMODE.money);
    expect(SOURCE_COMPETITIVE_SHORT_GAMEMODE.timers).toEqual(SOURCE_COMPETITIVE_GAMEMODE.timers);
    expect(SOURCE_COMPETITIVE_SHORT_GAMEMODE.teamCash.loserBonus).toBe(SOURCE_COMPETITIVE_GAMEMODE.teamCash.loserBonus);
    // `mp_match_can_clinch` means a side wins by taking more than half the rounds,
    // so it never plays the ones it can no longer be caught in; `mp_halftime` swaps
    // ends once at the halfway point.
    expect(sourceMatchFormat(SOURCE_COMPETITIVE_GAMEMODE)).toEqual({ maxRounds: 30, halftime: 1, canClinch: 1, winTarget: 16, swapAfterRound: 15 });
    expect(sourceMatchFormat(SOURCE_COMPETITIVE_SHORT_GAMEMODE)).toEqual({ maxRounds: 16, halftime: 1, canClinch: 1, winTarget: 9, swapAfterRound: 8 });
    // The short mode's own `mp_starting_losses` starts its ladder one rung up.
    expect([2, 3, 4, 5, 6, 7].map((losses) => sourceLoserBonus(SOURCE_COMPETITIVE_SHORT_GAMEMODE, losses)))
      .toEqual([1900, 2400, 2900, 3400, 3400, 3400]);
    expect(() => parseSourceShortGamemode({ ...clone(), short: { ...receipt.short, source: 'other.cfg' } })).toThrow(/short gamemode source/);
    expect(() => parseSourceShortGamemode({ ...clone(), short: { ...receipt.short, values: { mp_maxrounds: receipt.short.values.mp_maxrounds } } })).toThrow(/override set/);
    expect(() => sourceMatchFormat({ ...SOURCE_COMPETITIVE_GAMEMODE, matchFormat: { maxRounds: 31, halftime: 1, canClinch: 1 } })).toThrow(/even round count/);
  });

  it('reads the original money, round timing and format', () => {
    expect(game.money).toEqual({ start: 800, max: 16000, afterRound: 0, killDefault: 300, killFactor: 1,
      teamKill: -300, bombPlanted: 300, bombDefused: 300 });
    // mp_roundtime_defuse is shipped in minutes.
    expect(game.timers).toEqual({ freezeTime: 15, buyTime: 20, roundTime: 115.2, roundEndPanel: 3 });
    expect(game.teamCash).toEqual({ elimination: 3250, terroristWinBomb: 3500, winByDefusingBomb: 3500,
      winByTimeRunningOutBomb: 3250, plantedButDefused: 800, loserBonus: 1400, loserBonusStep: 500, startingLosses: 1 });
    expect(game.matchFormat).toEqual({ maxRounds: 30, halftime: 1, canClinch: 1 });
    expect(game.friendlyFire).toEqual({ enabled: true, bullets: .33, grenade: .85, grenadeSelf: 1, other: .4, forceCamera: 1 });
    expect(sourceFriendlyFireMultiplier(game, 'bullet')).toBe(.33);
    expect(game.sourceFile).toBe('csgo/cfg/gamemode_competitive.cfg');
    // The short mode is staged as the two-key diff it actually is.
    expect(receipt.shortOverrides).toMatchObject({ mp_maxrounds: { value: '16' }, mp_starting_losses: { value: '2' } });
  });

  it('builds the loser-bonus ladder from the original bonus and step', () => {
    // A fresh team sits on the first rung, then five hundred per consecutive loss.
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((losses) => sourceLoserBonus(game, losses)))
      .toEqual([1400, 1900, 2400, 2900, 3400, 3400, 3400, 3400]);
    expect(SOURCE_LOSER_BONUS_RUNGS).toBe(5);
    expect(sourceLoserBonus(game, 0)).toBe(1400);
    expect(sourceKillCash(game)).toBe(300);
    expect(sourceTeamWinCash(game, 'elimination')).toBe(3250);
    expect(sourceTeamWinCash(game, 'detonation')).toBe(3500);
    expect(sourceTeamWinCash(game, 'defuse')).toBe(3500);
    expect(sourceTeamWinCash(game, 'time')).toBe(3250);
  });

  it('opens the shop for the whole freeze time and the original buy time into the round', () => {
    expect(sourceBuyWindowOpen(game, 'buy', 15, false)).toBe(true);
    expect(sourceBuyWindowOpen(game, 'buy', 0.05, false)).toBe(true);
    // mp_buytime is measured from the round's start, so it outlives the freeze time.
    expect(sourceBuyWindowOpen(game, 'live', game.timers.roundTime, false)).toBe(true);
    expect(sourceBuyWindowOpen(game, 'live', game.timers.roundTime - 4.99, false)).toBe(true);
    expect(sourceBuyWindowOpen(game, 'live', game.timers.roundTime - 5, false)).toBe(false);
    expect(sourceBuyWindowOpen(game, 'ended', 3, false)).toBe(false);
    expect(sourceBuyWindowOpen(game, 'match', 0, false)).toBe(false);
    expect(sourceBuyWindowOpen(game, 'live', 1, true)).toBe(true);
    expect(sourceBuyWindowOpen(game, 'ended', 1, true)).toBe(true);
  });

  it('rejects malformed staged data instead of defaulting a match rule', () => {
    expect(() => parseSourceGamemode({ ...clone(), format: 'other' })).toThrow('Unknown original gamemode data');
    expect(() => parseSourceGamemode({ ...clone(), build: 1 })).toThrow('Unknown original gamemode data');
    const missing = clone(); delete missing.base.values.mp_buytime;
    expect(() => parseSourceGamemode(missing)).toThrow(/mp_buytime/);
    const word = clone(); word.base.values.mp_maxmoney.value = 'sixteen thousand';
    expect(() => parseSourceGamemode(word)).toThrow(/integer/);
    const negative = clone(); negative.base.values.cash_team_loser_bonus.value = '-1400';
    expect(() => parseSourceGamemode(negative)).toThrow(/negative/);
    const ratio = clone(); ratio.base.values.ff_damage_reduction_bullets.value = '1.2';
    expect(() => parseSourceGamemode(ratio)).toThrow(/ratio/);
    const switchValue = clone(); switchValue.base.values.mp_friendlyfire.value = '2';
    expect(() => parseSourceGamemode(switchValue)).toThrow(/friendly-fire switch/);
    const inconsistent = clone(); inconsistent.base.values.mp_startmoney.value = '20000';
    expect(() => parseSourceGamemode(inconsistent)).toThrow(/inconsistent/);
    const short = clone(); short.shortOverrides = { mp_maxrounds: { value: '16' } };
    expect(() => parseSourceGamemode(short)).toThrow(/short mode/);
    const absent = clone(); delete absent.absent.mp_consecutive_loss_max;
    expect(() => parseSourceGamemode(absent)).toThrow(/absence record/);
  });
});

describe('the original economy drives the LAN match', () => {
  it('starts the match on the original money while practice keeps its sandbox', () => {
    const s = match(), a = s.addPlayer('a', 'A', 'amber');
    expect(a.money).toBe(800);
    s.restart();
    expect(a.money).toBe(800);
    expect(s.phase).toBe('buy');
    expect(s.remaining).toBe(15);
    const training = new Simulation('training', false); games.push(training);
    const t = training.addPlayer('t', 'T', 'amber');
    expect(t.money).toBe(16000);
    expect(training.canBuy()).toBe(true);
  });

  it('pays the original cash for how a round was won and runs the loser ladder', () => {
    const s = match(), a = s.addPlayer('a', 'A', 'amber'), b = s.addPlayer('b', 'B', 'blue');
    s.restart();
    a.money = 0; b.money = 0;
    s.phase = 'live';
    // Defenders win on the clock: original time-out cash, and the attackers take the
    // ladder's first rung — which in this mode is already one step up, because the
    // short mode's own `mp_starting_losses` is 2.
    s.endRound('blue', '成功守住目标', 'time');
    expect(a.money).toBe(1900); expect(b.money).toBe(3250);
    expect(s.remaining).toBe(3);
    s.phase = 'live';
    s.endRound('blue', '成功守住目标', 'time');
    expect(a.money).toBe(4300); expect(b.money).toBe(6500);
    s.phase = 'live';
    // Attackers win by detonation: their own cash, and the defenders' ladder
    // descends only one rung from its prior state (native aversion=1).
    s.endRound('amber', '目标装置已引爆', 'detonation');
    expect(a.money).toBe(7800); expect(b.money).toBe(7900);
    s.phase = 'live';
    s.endRound('blue', '成功守住目标', 'time');
    expect(a.money).toBe(10200); expect(b.money).toBe(11150);
    // The round panel reads the paid amounts off the same event the authority emits.
    expect([...s.events].reverse().find((e) => e.type === 'round' && e.cash)?.cash)
      .toEqual({ amber: 2400, blue: 3250 });
  });

  it('applies native loss aversion one rung per consecutive win', () => {
    const s = match(), a = s.addPlayer('a', 'A', 'amber'), b = s.addPlayer('b', 'B', 'blue');
    s.restart();
    a.money = b.money = 0;
    // Short mode starts at rung 2. Make amber lose twice (rung 4), then win
    // twice: its own ladder must descend 4 -> 3 -> 2, not jump to rung 2.
    s.phase = 'live'; s.endRound('blue', 'loss one', 'time');
    s.phase = 'live'; s.endRound('blue', 'loss two', 'time');
    const afterLosses = a.money;
    s.phase = 'live'; s.endRound('amber', 'win one', 'time');
    const firstWinBonus = [...s.events].reverse().find((e) => e.type === 'round' && e.cash)?.cash;
    expect(firstWinBonus).toEqual({ amber: 3250, blue: 1400 });
    s.phase = 'live'; s.endRound('amber', 'win two', 'time');
    const secondWinBonus = [...s.events].reverse().find((e) => e.type === 'round' && e.cash)?.cash;
    expect(secondWinBonus).toEqual({ amber: 3250, blue: 1400 });
    expect(a.money).toBe(afterLosses + 6500);
    expect(b.money).toBe(6500 + 1400 + 1400);
  });

  it('plays whichever original mode its room was created on', () => {
    const full = new Simulation('demolition', false, undefined, 'competitive');
    games.push(full);
    full.addPlayer('a', 'A', 'amber');
    expect(full.format).toEqual({ maxRounds: 30, halftime: 1, canClinch: 1, winTarget: 16, swapAfterRound: 15 });
    expect(full.snapshot().rules).toBe('competitive');
    const short = match();
    short.addPlayer('a', 'A', 'amber');
    expect(short.format?.maxRounds).toBe(16);
    expect(short.snapshot().rules).toBe('competitiveShort');
    // The practice mode has no format of its own.
    const training = new Simulation('training', false);
    games.push(training);
    training.addPlayer('t', 'T', 'amber');
    expect(training.snapshot().rules).toBeNull();
    expect(training.format).toBeNull();
  });

  it('changes ends at the original halftime and ends the match when a side cannot be caught', () => {
    const s = match();
    const a = s.addPlayer('a', 'A', 'amber'), b = s.addPlayer('b', 'B', 'blue');
    s.restart();
    expect(s.format).toEqual({ maxRounds: 16, halftime: 1, canClinch: 1, winTarget: 9, swapAfterRound: 8 });
    // Eight rounds is exactly the first half of this mode.
    for (let round = 1; round <= 8; round++) {
      s.phase = 'live';
      s.endRound('amber', '进攻方已被清除');
      expect(s.phase).toBe('ended');
      if (round < 8) s.nextRound();
    }
    expect(s.round).toBe(8);
    expect(s.score).toEqual({ amber: 8, blue: 0 });
    s.nextRound();
    expect(s.round).toBe(9);
    // A side swap cannot be inferred from the score, so it is announced — and it is
    // not a round result, so the panel shows no cash for it.
    expect(s.events.filter((e) => e.text?.includes('半场结束')).length).toBe(1);
    expect(s.events.find((e) => e.text?.includes('半场结束'))?.cash).toBeUndefined();
    // The sides change ends and take each other's kit, and the rounds they won move
    // with them rather than staying with the side label.
    expect([a.team, b.team]).toEqual(['blue', 'amber']);
    expect(s.score).toEqual({ amber: 0, blue: 8 });
    expect(s.winner).toBeNull();
    // A side that cannot be caught takes the match; the practice sandbox keeps its
    // own five-round rule because no original format applies to it.
    s.score.blue = 8;
    s.phase = 'live';
    s.endRound('blue', '进攻方已被清除');
    expect(s.score.blue).toBe(9);
    expect(s.phase).toBe('match');
    expect(s.reason).toBe('任务完成');
    const training = new Simulation('training', false); games.push(training);
    training.addPlayer('t', 'T', 'amber');
    expect(training.format).toBeNull();
    training.score.amber = 4;
    training.phase = 'live';
    training.endRound('amber', '进攻方已被清除');
    expect(training.score.amber).toBe(5);
    expect(training.phase).toBe('match');
  });

  it('pays the planted-bomb cash when the bomb is defused, and the original kill cash', () => {
    const s = match(), a = s.addPlayer('a', 'A', 'amber'), b = s.addPlayer('b', 'B', 'blue');
    s.restart();
    a.money = 0; b.money = 0;
    s.phase = 'live';
    s.endRound('blue', '目标装置已解除', 'defuse');
    // The losing attackers planted it, so they take the planted-bomb cash instead
    // of the ladder; the defusing side takes the defuse cash.
    expect(a.money).toBe(800); expect(b.money).toBe(3500);
    // The losing attackers planted it, and the round panel reports exactly that.
    expect([...s.events].reverse().find((e) => e.type === 'round' && e.cash)?.cash)
      .toEqual({ amber: 800, blue: 3500 });
    const c = match(), killer = c.addPlayer('k', 'K', 'amber'), victim = c.addPlayer('v', 'V', 'blue');
    c.restart();
    killer.money = 0;
    c.damage(victim, killer, 500, false);
    expect(victim.alive).toBe(false);
    expect(killer.kills).toBe(1);
    expect(killer.money).toBe(300);
  });

  it('pays the killing weapon\'s own original award, so an AWP kill is not a rifle kill', () => {
    const kill = (weapon: 'vandal' | 'awp' | 'he') => {
      const c = match(), killer = c.addPlayer('k', 'K', 'amber'), victim = c.addPlayer('v', 'V', 'blue');
      c.restart();
      killer.money = 0;
      // The grenade case deliberately leaves the thrower holding a rifle: the award comes
      // from what dealt the damage, not from what the killer happens to be holding.
      killer.weapon = weapon === 'he' ? 'vandal' : weapon;
      c.damage(victim, killer, 500, false, undefined, weapon);
      return killer.money;
    };
    // The shipped file's own rows: the AWP's prefab states 100, everything else this build
    // ships inherits the base 300, and the HE grenade's own chain reaches the same 300.
    expect(kill('vandal')).toBe(300);
    expect(kill('awp')).toBe(100);
    expect(kill('he')).toBe(300);
  });

  it('keeps the shop open through the freeze time and closes it on the original buy time', () => {
    const s = match(); s.addPlayer('a', 'A', 'amber');
    s.restart();
    expect(s.canBuy()).toBe(true);
    s.remaining = 0;
    s.step();
    expect(s.phase).toBe('live');
    expect(s.remaining).toBe(115.2);
    expect(s.canBuy()).toBe(true);
    s.remaining = 115.2 - 5;
    expect(s.canBuy()).toBe(false);
  });
});
