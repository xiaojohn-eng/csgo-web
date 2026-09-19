import {createSourceBaseGunCommandDriver} from './source-basegun-command.js';
/** App740 build 12426148 ordinary Glock command branches.
 * See docs/source-glock-command.md for native oracle adapters and exclusions.
 * This owns command/ammo clocks, not accuracy, recoil, animation or hit tracing.
 */
export const SOURCE_GLOCK_COMMAND_VERSION = 'app740-12426148-glock-command-v1' as const;
export const SOURCE_GLOCK_COMMAND_SOURCE_SHA256 = '7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386';
export const SOURCE_GLOCK_RELOAD_SEQUENCE_DURATION = Math.fround(68 / 30);
export const SOURCE_GLOCK_DRAW_SEQUENCE_DURATION = Math.fround(33 / 30);
export const SOURCE_GLOCK_BUTTONS = { attack: 1, secondary: 0x800, reload: 0x2000 } as const;
const F = Math.fround;
const ATTACK_MASK = 0x80801;

export interface SourceGlockCommandState {
  clip: number; reserve: number;
  nextPrimary: number; nextSecondary: number; ownerNextAttack: number;
  burstMode: boolean; mode: 0 | 1; burstRemaining: number; nextBurst: number;
  /** Original Player +0x2b7c latch, distinct from floating weapon recoilIndex. */
  shotsFired: number;
  lastShot: number; dryFireCount: number;
  reloading: boolean; fireOnEmpty: boolean; waitForNoAttack: boolean;
  /** Original +0xaa4; caller must not synthesize an animation event. */
  reloadVisComplete: boolean;
}
export interface SourceGlockCommandContext {
  now: number; dt: number; buttons: number;
  /** Current accepted command's ordinary prediction seed. Never derived from time. */
  commandSeed: number;
  serverSeed?: number;
  active?: boolean; owner?: boolean;
  /** Return value of original 0xbb8ef0 predicate; exact game-rule context is external. */
  rulePredicateBlock?: boolean;
  /** Original Player +0x16ab and +0x15a0 gates; do not infer their names. */
  playerBlocked?: boolean; playerBlockingField15a0?: number;
  /** Original HasWeaponFlags(2), not a new auto-reload preference. */
  noAutoReload?: boolean;
  /** Selected original ACT_VM_RELOAD SequenceDuration. Required on reload start. */
  reloadDuration: number;
}
export type SourceGlockCommandEvent =
  | { kind: 'weapon-tick'; mode: 0 | 1; reloading: boolean }
  | { kind: 'activity'; activity: 183 | 184 | 192 | 194 }
  | { kind: 'bullet'; source: 'primary' | 'queued'; mode: 0 | 1; accuracyMode: 0 | 1; recoilMode: 0 | 1; scheduledTime: number; queue: number; commandSeed: number; serverSeed?: number }
  | { kind: 'empty' }
  | { kind: 'mode-message'; message: string }
  | { kind: 'sound'; name: 'Weapon.AutoSemiAutoSwitch' };
export interface SourceGlockCommandResult {
  state: SourceGlockCommandState;
  events: SourceGlockCommandEvent[];
  dispatch: 'inactive' | 'busy' | 'post' | 'holster' | 'deploy-prefix' | 'deploy';
  buttonsAfter: number;
}
function finite(value: number, name: string) {
  if (!Number.isFinite(value) || !Number.isFinite(F(value))) throw new RangeError(`Invalid Glock ${name}`);
  return F(value);
}
function integer(value: number, name: string, maximum = 0x7fffffff) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`Invalid Glock ${name}`);
  return value;
}
function seed(value: number, name: string) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new RangeError(`Invalid Glock ${name}`);
}
export function createSourceGlockCommandState(input: Partial<SourceGlockCommandState> = {}): SourceGlockCommandState {
  const state: SourceGlockCommandState = { clip: 20, reserve: 120, nextPrimary: 0, nextSecondary: 0,
    ownerNextAttack: 0, burstMode: false, mode: 0, burstRemaining: 0, nextBurst: 0, shotsFired: 0,
    lastShot: 0, dryFireCount: 0, reloading: false, fireOnEmpty: false, waitForNoAttack: false,
    reloadVisComplete: false, ...input };
  integer(state.clip, 'clip', 20); integer(state.reserve, 'reserve'); integer(state.mode, 'mode', 1);
  integer(state.burstRemaining, 'burstRemaining', 2); integer(state.shotsFired, 'shotsFired', 0x7ffffffe);
  integer(state.dryFireCount, 'dryFireCount', 0x7ffffffe);
  for (const name of ['nextPrimary', 'nextSecondary', 'ownerNextAttack', 'nextBurst', 'lastShot'] as const) state[name] = finite(state[name], name);
  for (const name of ['burstMode', 'reloading', 'fireOnEmpty', 'waitForNoAttack', 'reloadVisComplete'] as const) {
    if (typeof state[name] !== 'boolean') throw new TypeError(`Invalid Glock ${name}`);
  }
  return state;
}

const glockCommand=createSourceBaseGunCommandDriver<SourceGlockCommandState>({
 create:createSourceGlockCommandState,maxClip:20,cycleTime:state=>state.burstMode?.5:.15,queue:state=>state.burstRemaining,
 beforeTick(state,events,bullet,now){
  // d4ac70 -> d49b70: one queued shot per PostFrame; no catch-up while loop.
  if (state.burstRemaining > 0 && now >= state.nextBurst) {
    if (state.clip === 0) { state.burstRemaining = 0; state.nextBurst = 0; }
    else {
      bullet('queued', 1, state.nextBurst);
      events.push({ kind: 'activity', activity: 192 });
      state.burstRemaining--;
      state.nextBurst = state.burstRemaining > 0 ? F(state.nextBurst + F(0.05)) : 0;
      state.shotsFired++; state.clip--;
    }
  }
 },
 beforePrimary(state,now){if(state.burstMode){state.burstRemaining=2;state.nextBurst=F(now+F(.05));}},
 secondary(state,events){
    events.push({ kind: 'mode-message', message: state.burstMode ? '#Cstrike_TitlesTXT_Switch_To_FullAuto' : '#Cstrike_TitlesTXT_Switch_To_BurstFire' });
    state.burstMode = !state.burstMode; state.mode = state.burstMode ? 1 : 0;
    events.push({ kind: 'sound', name: 'Weapon.AutoSemiAutoSwitch' });
 }
});
export function sourceGlockCommandFrame(input:Readonly<SourceGlockCommandState>,context:Readonly<SourceGlockCommandContext>):SourceGlockCommandResult{
 return glockCommand(input,context) as SourceGlockCommandResult;
}

/** Original ordinary Holster stores, given the selected ACT_VM_HOLSTER duration.
 * Pending queue fields survive Holster. Do not update an inactive weapon; the
 * next Deploy prefix clears them. No weapon-selection/deploy timer is invented.
 */
export function sourceGlockHolster(input: Readonly<SourceGlockCommandState>, context: { now: number; sequenceDuration: number; owner?: boolean }): SourceGlockCommandResult {
  const state = createSourceGlockCommandState(input), now = finite(context.now, 'now');
  if (state.reloading && !state.reloadVisComplete) state.nextPrimary = state.nextSecondary = now;
  if (context.owner === false) return { state, events: [], dispatch: 'holster', buttonsAfter: 0 };
  const duration = finite(context.sequenceDuration, 'holster duration');
  if (duration < 0) throw new RangeError('Invalid Glock holster duration');
  state.reloading = false; state.ownerNextAttack = F(now + duration);
  return { state, events: [{ kind: 'activity', activity: 184 }], dispatch: 'holster', buttonsAfter: 0 };
}
/** d4d5c0 prefix only, before base Deploy. Caller must provide separately
 * verified base Deploy clocks/animation and preserve old clock maxima afterward.
 */
export function sourceGlockBeginDeploy(input: Readonly<SourceGlockCommandState>): SourceGlockCommandResult {
  const state = createSourceGlockCommandState(input);
  state.burstRemaining = 0; state.nextBurst = 0;
  return { state, events: [], dispatch: 'deploy-prefix', buttonsAfter: 0 };
}

/** Original ordinary DefaultDeploy + CSBaseGun clock maxima, with the selected
 * ACT_VM_DRAW duration supplied by the model owner. Default non-heavy-armour
 * playbackRate=1 only. Full accuracy recovery is owned by pistol handling.
 */
export function sourceGlockDeploy(input: Readonly<SourceGlockCommandState>, context: { now: number; sequenceDuration: number; owner?: boolean }): SourceGlockCommandResult {
  const result = sourceGlockBeginDeploy(input), state = result.state;
  result.dispatch = 'deploy';
  const now = finite(context.now, 'now');
  if (context.owner === false) return result;
  const duration = finite(context.sequenceDuration, 'draw duration');
  if (duration < 0) throw new RangeError('Invalid Glock draw duration');
  state.shotsFired = 0; state.waitForNoAttack = true;
  state.ownerNextAttack = F(now + duration);
  state.nextPrimary = Math.max(state.nextPrimary, now);
  state.nextSecondary = Math.max(state.nextSecondary, now);
  result.events.push({ kind: 'activity', activity: 183 });
  return result;
}
