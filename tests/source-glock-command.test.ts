import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createSourceGlockCommandState, sourceGlockCommandFrame, sourceGlockBeginDeploy, sourceGlockHolster, sourceGlockDeploy,
  SOURCE_GLOCK_COMMAND_SOURCE_SHA256, SOURCE_GLOCK_RELOAD_SEQUENCE_DURATION,
  type SourceGlockCommandState, type SourceGlockCommandContext, type SourceGlockCommandResult,
} from '../game/source-glock-command';
const context = (input: Partial<SourceGlockCommandContext> = {}): SourceGlockCommandContext => ({ now: 10, dt: 1 / 64,
  buttons: 0, commandSeed: 100, reloadDuration: SOURCE_GLOCK_RELOAD_SEQUENCE_DURATION, ...input });
type Case = { label: string; input: Partial<SourceGlockCommandState>; context: SourceGlockCommandContext & { operation?: string; holsterDuration?: number; drawDuration?: number };
  result: SourceGlockCommandResult & { attributes: unknown[] } };
const oracle = JSON.parse(readFileSync('output/tests/source-glock-command-native.json', 'utf8')) as {
  serverSha256: string; caseCount: number; cases: Case[]; criticalExecuted: string[];
};
function evaluate(row: Case) {
  const state = createSourceGlockCommandState(row.input);
  if (row.context.operation === 'holster') return sourceGlockHolster(state, { now: row.context.now, sequenceDuration: row.context.holsterDuration ?? 0, owner: row.context.owner });
  if (row.context.operation === 'deploy-prefix') return sourceGlockBeginDeploy(state);
  if (row.context.operation === 'deploy') return sourceGlockDeploy(state, { now: row.context.now, sequenceDuration: row.context.drawDuration ?? Math.fround(33 / 30), owner: row.context.owner });
  return sourceGlockCommandFrame(state, row.context);
}
describe('original App740 ordinary Glock command', () => {
  it('matches every original i386 state, event order and f32 clock exactly', () => {
    expect(oracle.serverSha256).toBe(SOURCE_GLOCK_COMMAND_SOURCE_SHA256);
    expect(oracle.caseCount).toBe(oracle.cases.length);
    expect(oracle.caseCount).toBeGreaterThan(1000);
    for (const [i, row] of oracle.cases.entries()) {
      const { attributes: _attributes, ...native } = row.result;
      expect(evaluate(row), `${i}: ${row.label} ${JSON.stringify(row.context)}`).toEqual(native);
    }
  });
  it('retains one scheduled burst event per late frame and the current command seed', () => {
    const state = createSourceGlockCommandState({ burstMode: true, mode: 1, burstRemaining: 2, nextBurst: 9, nextPrimary: 11 });
    const result = sourceGlockCommandFrame(state, context({ commandSeed: 777, serverSeed: 99 }));
    expect(result.events.filter(x => x.kind === 'bullet')).toEqual([{ kind: 'bullet', source: 'queued', mode: 1, accuracyMode: 1, recoilMode: 1, scheduledTime: 9, queue: 2, commandSeed: 777, serverSeed: 99 }]);
    expect(result.state.nextBurst).toBe(Math.fround(9 + Math.fround(.05)));
    expect(result.state.lastShot).toBe(0);
    expect(state.burstRemaining).toBe(2);
  });
  it('keeps semi-auto latch in either mode until the original release branch', () => {
    for (const burstMode of [false, true]) {
      const state = createSourceGlockCommandState({ burstMode, mode: burstMode ? 1 : 0, shotsFired: 3 });
      const held = sourceGlockCommandFrame(state, context({ buttons: 1 }));
      expect(held.events).toEqual([{ kind: 'weapon-tick', mode: state.mode, reloading: false }]);
      const release = sourceGlockCommandFrame(held.state, context());
      expect(release.state.shotsFired).toBe(0);
      expect(sourceGlockCommandFrame(release.state, context({ buttons: 1 })).events.some(x => x.kind === 'bullet')).toBe(true);
    }
  });
  it('does not invent a primary cooldown for mode changes or last-round activity', () => {
    const mode = sourceGlockCommandFrame(createSourceGlockCommandState(), context({ buttons: 2048 }));
    expect(mode.state.nextPrimary).toBe(0);
    const shot = sourceGlockCommandFrame({ ...mode.state, clip: 1 }, context({ now: 10.01, buttons: 1 }));
    expect(shot.events.find(x => x.kind === 'activity')).toEqual({ kind: 'activity', activity: 192 });
    expect(shot.state.clip).toBe(0);
    expect(shot.state.burstRemaining).toBe(2);
  });
  it('does not process a queued shot in BusyFrame or while inactive', () => {
    const state = createSourceGlockCommandState({ ownerNextAttack: 11, burstRemaining: 2, nextBurst: 9, shotsFired: 2, waitForNoAttack: true });
    const busy = sourceGlockCommandFrame(state, context());
    expect(busy.dispatch).toBe('busy'); expect(busy.state.clip).toBe(20);
    expect(busy.state.waitForNoAttack).toBe(false); expect(busy.state.shotsFired).toBe(2);
    expect(sourceGlockCommandFrame(state, context({ active: false })).state).toEqual(state);
  });
  it('preserves queued fields on Holster and clears them at the next Deploy prefix', () => {
    const state = createSourceGlockCommandState({ reloading: true, ownerNextAttack: 20, burstRemaining: 2, nextBurst: 9 });
    const holster = sourceGlockHolster(state, { now: 10, sequenceDuration: 0 });
    expect(holster.state.burstRemaining).toBe(2); expect(holster.state.reloading).toBe(false);
    expect(holster.state.nextPrimary).toBe(10); expect(holster.state.reserve).toBe(120);
    const deploy = sourceGlockBeginDeploy(holster.state);
    expect(deploy.state.burstRemaining).toBe(0); expect(deploy.state.nextBurst).toBe(0);
    expect(deploy.state.nextPrimary).toBe(10);
  });
  it('distinguishes strict reload boundary from primary >= and uses selected SequenceDuration', () => {
    const state = createSourceGlockCommandState({ clip: 3, nextPrimary: 10 });
    expect(sourceGlockCommandFrame(state, context({ buttons: 8192 })).state.reloading).toBe(false);
    const reload = sourceGlockCommandFrame(state, context({ now: 10.01, buttons: 8192, reloadDuration: 2.5 }));
    expect(reload.state.ownerNextAttack).toBe(Math.fround(Math.fround(10.01) + 2.5));
    expect(reload.state.clip).toBe(3);
    const complete = sourceGlockCommandFrame(reload.state, context({ now: reload.state.ownerNextAttack }));
    expect(complete.state.clip).toBe(20); expect(complete.state.reserve).toBe(103);
  });
  it('uses native Deploy owner gate, preserves old gun clocks and requires trigger release', () => {
    const state = createSourceGlockCommandState({ nextPrimary: 15, nextSecondary: 16, shotsFired: 5, burstRemaining: 2, nextBurst: 9 });
    const deployed = sourceGlockDeploy(state, { now: 10, sequenceDuration: 1.1 });
    expect(deployed.state.ownerNextAttack).toBe(Math.fround(10 + Math.fround(1.1)));
    expect(deployed.state.nextPrimary).toBe(15); expect(deployed.state.nextSecondary).toBe(16);
    expect(deployed.state.shotsFired).toBe(0); expect(deployed.state.waitForNoAttack).toBe(true);
    const held = sourceGlockCommandFrame(deployed.state, context({ now: 20, buttons: 1 }));
    expect(held.events).toEqual([{ kind: 'weapon-tick', mode: 0, reloading: false }]);
    const release = sourceGlockCommandFrame(held.state, context({ now: 20 }));
    expect(sourceGlockCommandFrame(release.state, context({ now: 20, buttons: 1 })).events.some(x => x.kind === 'bullet')).toBe(true);
  });
  it('clears the old visual completion bit only on accepted reload', () => {
    const state = createSourceGlockCommandState({ clip: 3, reloadVisComplete: true });
    expect(sourceGlockCommandFrame(state, context({ buttons: 8192 })).state.reloadVisComplete).toBe(false);
    expect(sourceGlockCommandFrame({ ...state, clip: 20 }, context({ buttons: 8192 })).state.reloadVisComplete).toBe(true);
  });
  it('rejects non-finite/invalid state and unimplemented special input branches', () => {
    const state = createSourceGlockCommandState();
    for (const bad of [NaN, Infinity, -Infinity, 1e99]) expect(() => sourceGlockCommandFrame(state, context({ now: bad }))).toThrow();
    for (const buttons of [0x80000, 0x4000000, -1, .2]) expect(() => sourceGlockCommandFrame(state, context({ buttons }))).toThrow();
    expect(() => createSourceGlockCommandState({ clip: 21 })).toThrow();
    expect(() => createSourceGlockCommandState({ burstRemaining: 3 })).toThrow();
    expect(() => sourceGlockCommandFrame(state, context({ dt: -1 }))).toThrow();
  });
});
