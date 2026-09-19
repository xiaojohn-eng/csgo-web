/** The original competitive mode's economy and round timing, as build data.
 *
 * `csgo/cfg/gamemode_competitive.cfg` is the effective mode config the original
 * server applies, so the authority applies those numbers instead of local
 * defaults. `scripts/stage-source-gamemode.py` staged the keys this build uses
 * with the line each came from and the file's byte count and SHA-256; this module
 * parses and range-checks them, and refuses anything malformed.
 *
 * The original does not define every number these rules need. Those are listed in
 * `SOURCE_GAMEMODE_LIMITATIONS` and each one names what it stands in for, rather
 * than being passed off as original data.
 */
import {SOURCE_GAMEMODE_COMPETITIVE_STAGED as receipt} from './source-gamemode-competitive.js';

export const SOURCE_GAMEMODE_FORMAT = 'source-gamemode-competitive-v1';
/** The original caps consecutive losses with `mp_consecutive_loss_max`, which the
 * shipped mode configs do not define. The staged ladder therefore uses the rungs
 * the original's own bonus and step produce: 1400, 1900, 2400, 2900, 3400. */
export const SOURCE_LOSER_BONUS_RUNGS = 5;
/** Native `mp_consecutive_loss_aversion` default (1): a round win lowers the
 * winner's loss-bonus ladder by one rung, rather than resetting it outright;
 * native round-end logic clamps the counter at zero.
 * The cvar is not present in the shipped mode cfg, so this binary-observed value
 * is kept explicit and covered by the economy tests. */
export const SOURCE_CONSECUTIVE_LOSS_AVERSION = 1;
export const SOURCE_GAMEMODE_SOURCE_FILE = 'csgo/cfg/gamemode_competitive.cfg';
export const SOURCE_GAMEMODE_LIMITATIONS = [
 'The shipped mode configs state only the base kill cash; the per-weapon awards are a different shipped file. They are read from `scripts/items/items_game.txt` into `game/source-kill-award-table.ts` (see [原作击杀奖励](source-kill-awards.md)), and the config\'s `cash_player_killed_enemy_factor` scales whichever award the weapon has.',
 '`mp_consecutive_loss_max` is absent from the shipped configs; the loser-bonus ladder is capped at the five rungs its own bonus and step produce. The native binary default `mp_consecutive_loss_aversion=1` is applied: a winning team descends one loss-bonus counter per win, clamped at zero, rather than resetting immediately.',
 'The shipped configs state `cash_team_bonus_shorthanded` (1000 in competitive, 0 in the other modes) and it is staged with the rest, but it is not applied: no shipped file defines what triggers it, and this build will not invent a trigger for a cash rule. The hostage-map cash keys are not staged at all: this build plays bomb maps.',
 'Original Dust II team buy volumes and the buy-time window are enforced; the separate spawn-immunity purchase rule still needs verification.',
 'The full Source scene starts competitive players and replaces dead players with only their selected team pistol, no primary or utility. CT uses the supported USP-S loadout; the config default HKP2000 is not implemented. Knife slot/authority melee is supported with a generic fallback model; the original knife model and authored knife animation/audio are not staged. Reduced rifle-only fixtures retain their declared supported loadout.',
 'Halftime resets Source cash, equipment and loss counters; survivors retain purchased guns, armor and remaining grenades across ordinary rounds. Source use collects a reachable primary into an empty slot or replaces a sidearm; the drop key discards the held gun and both paths preserve its ammunition. These transfers also work during freeze time. An unplanted C4 drops on carrier death and can be recovered by a living T. Replacing an occupied primary without first dropping it, voluntary C4 drops, defuse-kit drops and complete death inventory drops remain outside this implementation.',
] as const;

export type SourceGamemode = {
  format: typeof SOURCE_GAMEMODE_FORMAT; build: number; mode: 'competitive' | 'competitiveShort';
  sourceFile: string; sourceSha256: string;
  money: { start: number; max: number; afterRound: number; killDefault: number; killFactor: number; teamKill: number;
    bombPlanted: number; bombDefused: number };
  /** Competitive team-damage switches and Source's damage multipliers. */
  friendlyFire: { enabled: boolean; bullets: number; grenade: number; grenadeSelf: number; other: number; forceCamera: number };
  teamCash: { elimination: number; terroristWinBomb: number; winByDefusingBomb: number; winByTimeRunningOutBomb: number;
    plantedButDefused: number; loserBonus: number; loserBonusStep: number; startingLosses: number };
  timers: { freezeTime: number; buyTime: number; roundTime: number; roundEndPanel: number };
  /** The original match-format keys. */
  matchFormat: { maxRounds: number; halftime: number; canClinch: number };
  /** Every value with the original config line it was read from. */
  provenance: Record<string, { value: string; line: number; file?: string }>;
};
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const integer = (raw: string, key: string) => {
  check(/^-?\d+$/.test(raw), `Original gamemode value is not an integer: ${key}=${raw}`);
  const value = Number(raw);
  check(Number.isSafeInteger(value), `Original gamemode integer is out of range: ${key}=${raw}`);
  return value;
};
const amount = (raw: string, key: string) => { const value = integer(raw, key); check(value >= 0, `Original gamemode amount is negative: ${key}=${raw}`); return value; };
const ratio = (raw: string, key: string) => {
  const value = Number(raw);
  check(Number.isFinite(value) && value >= 0 && value <= 1, `Original gamemode ratio is out of range: ${key}=${raw}`);
  return value;
};

/** Parses the staged original mode config. Anything missing, malformed or out of
 * range fails closed: a match rule this build cannot source is not defaulted. */
export function parseSourceGamemode(input: unknown): SourceGamemode {
  const data = input as { format?: string; build?: number; application?: number; keys?: string[];
    base?: { mode?: string; source?: string; sha256?: string; values?: Record<string, { value: string; line: number }> };
    shortOverrides?: Record<string, { value: string }>; absent?: Record<string, unknown> };
  check(data?.format === SOURCE_GAMEMODE_FORMAT && data.build === 12426148 && data.application === 740, 'Unknown original gamemode data');
  const base = data.base;
  check(base?.mode === 'competitive' && base.source === 'gamemode_competitive.cfg' && /^[a-f0-9]{64}$/.test(base.sha256 ?? ''), 'Original gamemode source differs');
  const values = base.values ?? {};
  const raw = (key: string) => { const row = values[key]; check(row && typeof row.value === 'string' && Number.isSafeInteger(row.line) && row.line > 0, 'Original gamemode key absent: ' + key); return row; };
  const text = (key: string) => raw(key).value;
  // The two keys the short config overrides are staged as the diff they are, so a
  // change in that file's contents must show up here rather than be ignored.
  check(data.shortOverrides?.mp_maxrounds?.value === '16' && data.shortOverrides?.mp_starting_losses?.value === '2'
    && Object.keys(data.shortOverrides).length === 2, 'Original short mode override set differs');
  check(Object.hasOwn(data.absent ?? {}, 'mp_consecutive_loss_max'), 'Original gamemode absence record differs');
  const killDefault = amount(text('cash_player_killed_enemy_default'), 'cash_player_killed_enemy_default');
  const killFactor = amount(text('cash_player_killed_enemy_factor'), 'cash_player_killed_enemy_factor');
  const freezeTime = amount(text('mp_freezetime'), 'mp_freezetime');
  const buyTime = amount(text('mp_buytime'), 'mp_buytime');
  const start = amount(text('mp_startmoney'), 'mp_startmoney');
  const max = amount(text('mp_maxmoney'), 'mp_maxmoney');
  const roundMinutes = Number(text('mp_roundtime_defuse'));
  check(Number.isFinite(roundMinutes) && roundMinutes > 0 && roundMinutes <= 5, 'Original gamemode round time is out of range');
  const roundTime = Math.round(roundMinutes * 60 * 1000) / 1000;
  check(start <= max && freezeTime > 0 && buyTime > 0, 'Original gamemode money or timing is inconsistent');
  const friendlyFire = integer(text('mp_friendlyfire'), 'mp_friendlyfire');
  check(friendlyFire === 0 || friendlyFire === 1, 'Original friendly-fire switch is not boolean');
  const forceCamera = integer(text('mp_forcecamera'), 'mp_forcecamera');
  check(forceCamera >= 0 && forceCamera <= 2, 'Original observer camera rule is out of range');
  return {
    format: SOURCE_GAMEMODE_FORMAT, build: 12426148, mode: 'competitive', sourceFile: `csgo/cfg/${base.source}`,
    sourceSha256: base.sha256!,
    money: { start, max, afterRound: amount(text('mp_afterroundmoney'), 'mp_afterroundmoney'), killDefault, killFactor,
      teamKill: integer(text('cash_player_killed_teammate'), 'cash_player_killed_teammate'),
      bombPlanted: amount(text('cash_player_bomb_planted'), 'cash_player_bomb_planted'),
      bombDefused: amount(text('cash_player_bomb_defused'), 'cash_player_bomb_defused') },
    friendlyFire: {
      enabled: friendlyFire === 1,
      bullets: ratio(text('ff_damage_reduction_bullets'), 'ff_damage_reduction_bullets'),
      grenade: ratio(text('ff_damage_reduction_grenade'), 'ff_damage_reduction_grenade'),
      grenadeSelf: ratio(text('ff_damage_reduction_grenade_self'), 'ff_damage_reduction_grenade_self'),
      other: ratio(text('ff_damage_reduction_other'), 'ff_damage_reduction_other'),
      forceCamera,
    },
    teamCash: {
      elimination: amount(text('cash_team_elimination_bomb_map'), 'cash_team_elimination_bomb_map'),
      terroristWinBomb: amount(text('cash_team_terrorist_win_bomb'), 'cash_team_terrorist_win_bomb'),
      winByDefusingBomb: amount(text('cash_team_win_by_defusing_bomb'), 'cash_team_win_by_defusing_bomb'),
      winByTimeRunningOutBomb: amount(text('cash_team_win_by_time_running_out_bomb'), 'cash_team_win_by_time_running_out_bomb'),
      plantedButDefused: amount(text('cash_team_planted_bomb_but_defused'), 'cash_team_planted_bomb_but_defused'),
      loserBonus: amount(text('cash_team_loser_bonus'), 'cash_team_loser_bonus'),
      loserBonusStep: amount(text('cash_team_loser_bonus_consecutive_rounds'), 'cash_team_loser_bonus_consecutive_rounds'),
      startingLosses: amount(text('mp_starting_losses'), 'mp_starting_losses') },
    timers: { freezeTime, buyTime, roundTime,
      roundEndPanel: amount(text('mp_win_panel_display_time'), 'mp_win_panel_display_time') },
    matchFormat: { maxRounds: amount(text('mp_maxrounds'), 'mp_maxrounds'), halftime: amount(text('mp_halftime'), 'mp_halftime'),
      canClinch: amount(text('mp_match_can_clinch'), 'mp_match_can_clinch') },
    provenance: Object.fromEntries(data.keys!.map((key) => [key, raw(key)])),
  };
}

export const SOURCE_COMPETITIVE_GAMEMODE = parseSourceGamemode(receipt);

type StagedValue = { value: string; line: number };
type StagedBlock = { source?: string; bytes?: number; sha256?: string; values?: Record<string, StagedValue> };

/** The original short competitive mode is not a separate mode file: its config is
 * an override layer naming only the keys it changes (`mp_maxrounds` 16 and
 * `mp_starting_losses` 2), and every other value is the competitive one. Both keys
 * keep the line and the file they were read from. */
export function parseSourceShortGamemode(input: unknown): SourceGamemode {
  const data = input as { base?: StagedBlock; short?: StagedBlock; shortOverrides?: Record<string, StagedValue> };
  const short = data.short, values = short?.values ?? {};
  check(short?.source === 'gamemode_competitive_short.cfg' && /^[a-f0-9]{64}$/.test(short.sha256 ?? '')
    && Number.isSafeInteger(short.bytes) && (short.bytes ?? 0) > 0, 'Original short gamemode source differs');
  check(Object.keys(values).length === 2 && Object.keys(data.shortOverrides ?? {}).length === 2,
    'Original short mode override set differs');
  const merged = { ...(input as Record<string, unknown>),
    base: { ...data.base, values: { ...data.base?.values, ...values } } };
  const parsed = parseSourceGamemode(merged);
  return { ...parsed, mode: 'competitiveShort', sourceSha256: short.sha256!, sourceFile: `csgo/cfg/${short.source}`,
    provenance: { ...parsed.provenance, ...Object.fromEntries(Object.entries(values)
      .map(([key, row]) => [key, { ...row, file: short.source }])) } };
}

export const SOURCE_COMPETITIVE_SHORT_GAMEMODE = parseSourceShortGamemode(receipt);

/** The two original modes a room can be played on, and the default this build's LAN
 * room uses. */
export type SourceRuleSetId = 'competitive' | 'competitiveShort';
export const SOURCE_RULE_SETS: Record<SourceRuleSetId, SourceGamemode> = {
  competitive: SOURCE_COMPETITIVE_GAMEMODE, competitiveShort: SOURCE_COMPETITIVE_SHORT_GAMEMODE };
export const SOURCE_DEFAULT_RULE_SET: SourceRuleSetId = 'competitiveShort';
export type SourceFriendlyFireKind = 'bullet' | 'grenade' | 'other';
/** Multiplier applied to damage that stays within a team. The shipped
 * competitive cfg uses these values as multipliers (0.33 bullets, 0.85 HE),
 * while `mp_friendlyfire 1` enables the path. Training has no Source rules and
 * therefore keeps its original no-team-damage sandbox. */
export function sourceFriendlyFireMultiplier(
  gamemode: SourceGamemode,
  kind: SourceFriendlyFireKind,
  self = false,
): number {
  if (!gamemode.friendlyFire.enabled) return 0;
  if (kind === 'bullet') return gamemode.friendlyFire.bullets;
  if (kind === 'grenade') return self ? gamemode.friendlyFire.grenadeSelf : gamemode.friendlyFire.grenade;
  return gamemode.friendlyFire.other;
}
/** What each mode is called and how it plays, read from the staged values so no
 * caller keeps its own copy of the numbers. */
export function sourceRuleSets(): { id: SourceRuleSetId; label: string; detail: string }[] {
  return (['competitiveShort', 'competitive'] as const).map((id) => {
    const format = sourceMatchFormat(SOURCE_RULE_SETS[id]);
    return { id, label: id === 'competitiveShort' ? '短竞技' : '完整竞技',
      detail: `${format.maxRounds} 回合 · 先到 ${format.winTarget} 局 · 第 ${format.swapAfterRound} 回合后换边` };
  });
}
export function isSourceRuleSetId(value: unknown): value is SourceRuleSetId {
  return value === 'competitive' || value === 'competitiveShort';
}
/** A rule set by id. An unknown id is refused rather than defaulted, so a peer
 * cannot join a room on rules the authority does not have. */
export function sourceRuleSet(id: unknown): SourceGamemode {
  check(isSourceRuleSetId(id), `Unknown original rule set: ${String(id)}`);
  return SOURCE_RULE_SETS[id];
}

/** The match format the original's own keys describe. */
export type SourceMatchFormat = { maxRounds: number; halftime: number; canClinch: number;
  /** The rounds a team needs to win the match. */
  winTarget: number;
  /** The round after which the two sides change ends, or 0 when halves are off. */
  swapAfterRound: number };
/** `mp_maxrounds` with `mp_match_can_clinch` means a match ends once a team has won
 * more than half the rounds, so the rounds it can no longer be caught in are never
 * played; `mp_halftime` swaps ends once, at the halfway point. */
export function sourceMatchFormat(gamemode: SourceGamemode): SourceMatchFormat {
  const { maxRounds, halftime, canClinch } = gamemode.matchFormat;
  check(maxRounds > 1 && maxRounds % 2 === 0, `Original match round count is not an even round count: ${maxRounds}`);
  return { maxRounds, halftime, canClinch, winTarget: canClinch ? Math.floor(maxRounds / 2) + 1 : maxRounds,
    swapAfterRound: halftime ? Math.floor(maxRounds / 2) : 0 };
}

/** The original bomb-map team cash for how a round was won. */
export type SourceRoundWinKind = 'elimination' | 'detonation' | 'defuse' | 'time';
export function sourceTeamWinCash(gamemode: SourceGamemode, kind: SourceRoundWinKind): number {
  const cash = gamemode.teamCash;
  if (kind === 'elimination') return cash.elimination;
  if (kind === 'detonation') return cash.terroristWinBomb;
  if (kind === 'defuse') return cash.winByDefusingBomb;
  return cash.winByTimeRunningOutBomb;
}

/** The original loser bonus for a team whose consecutive-loss counter reads
 * `consecutiveLosses`. The counter starts at `mp_starting_losses`, so the standard
 * mode (1) puts a fresh team on the ladder's first rung (1400) and the short mode
 * (2) starts it one rung up, which is that mode's own faster economy. The ladder
 * stops at the fifth rung (3400): `mp_consecutive_loss_max` is not in the shipped
 * configs, which is recorded in `SOURCE_GAMEMODE_LIMITATIONS`. */
export function sourceLoserBonus(gamemode: SourceGamemode, consecutiveLosses: number): number {
  check(Number.isFinite(consecutiveLosses), 'Invalid consecutive loss count');
  const rung = Math.max(0, Math.min(SOURCE_LOSER_BONUS_RUNGS - 1, Math.floor(consecutiveLosses) - 1));
  return gamemode.teamCash.loserBonus + rung * gamemode.teamCash.loserBonusStep;
}

/** The original kill cash for an enemy killed. The award is the weapon's own, from the
 * shipped `items_game.txt` (`game/source-kill-award-table.ts`); the shipped configs define
 * only the base default and the factor this scales it by. */
export function sourceKillCash(gamemode: SourceGamemode, award = gamemode.money.killDefault): number {
  return Math.round(award * gamemode.money.killFactor);
}

/** The original buy window: buying is allowed through the freeze time and for
 * `mp_buytime` seconds measured from the round's start, so the window runs
 * `mp_buytime - mp_freezetime` seconds into the live round. The practice mode is
 * unrestricted. */
export function sourceBuyWindowOpen(gamemode: SourceGamemode, phase: 'buy' | 'live' | 'ended' | 'match',
  remaining: number, training: boolean): boolean {
  if (training || phase === 'buy') return true;
  if (phase !== 'live' || !Number.isFinite(remaining)) return false;
  const elapsed = gamemode.timers.freezeTime + (gamemode.timers.roundTime - remaining);
  return elapsed < gamemode.timers.buyTime;
}
