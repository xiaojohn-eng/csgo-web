import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sourcePistolCompleteReload, sourcePistolEventInCycleWindow, SOURCE_RELOAD_EVENT_SOURCE_SHA256 } from '../game/source-pistol-animation-events';
import { createSourceGlockCommandState, sourceGlockCommandFrame, sourceGlockHolster, SOURCE_GLOCK_RELOAD_SEQUENCE_DURATION, type SourceGlockCommandState } from '../game/source-glock-command';
const oracle = JSON.parse(readFileSync('output/tests/source-pistol-animation-events-native.json', 'utf8')) as {
  serverSha256: string; eventCycle: number;
  cases: { event: number; input: Partial<SourceGlockCommandState>; context: { owner: boolean }; result: { state: SourceGlockCommandState; executed: string[] } }[];
  cycleWindows: { start: number; end: number; events: { eventIndex: number; eventType: number }[] }[];
  postThinkOrder: { callbacks: { callback: string; targetAddress: string }[]; executed: string[] };
};
describe('original pistol animation reload event', () => {
  it('matches original dispatcher ammo and every retained Glock field, including no owner and nonreloading input', () => {
    expect(oracle.serverSha256).toBe(SOURCE_RELOAD_EVENT_SOURCE_SHA256);
    const rows = oracle.cases.filter(x => x.event === 54);
    expect(rows).toHaveLength(16);
    for (const row of rows) {
      expect(sourcePistolCompleteReload(createSourceGlockCommandState(row.input), { weapon: 'glock', owner: row.context.owner })).toEqual(row.result.state);
      expect(row.result.executed).toContain('0xd454bb');
    }
  });
  it('matches raw MDL original collector start-inclusive/end-exclusive windows and packed runtime id54/type1041', () => {
    for (const row of oracle.cycleWindows) {
      const reload = row.events.filter(x => x.eventIndex === 54);
      expect(sourcePistolEventInCycleWindow(oracle.eventCycle, row.start, row.end)).toBe(reload.length > 0);
      if (reload.length) expect(reload[0].eventType).toBe(1041);
    }
    expect(sourcePistolEventInCycleWindow(oracle.eventCycle, 0, oracle.eventCycle)).toBe(false);
  });
  it('retains busy/attack locks when transferred, avoids duplicate transfer at fallback, and preserves completed ammo across holster', () => {
    const ctx = { now: 10, dt: 1 / 64, buttons: 8192, commandSeed: 99, reloadDuration: SOURCE_GLOCK_RELOAD_SEQUENCE_DURATION };
    const start = sourceGlockCommandFrame(createSourceGlockCommandState({ clip: 3 }), ctx);
    const busy = sourceGlockCommandFrame(start.state, { ...ctx, now: 11, buttons: 1 });
    expect(busy.dispatch).toBe('busy'); expect(busy.state.clip).toBe(3);
    const filled = sourcePistolCompleteReload(busy.state, { weapon: 'glock' });
    expect(filled.clip).toBe(20); expect(filled.reserve).toBe(103); expect(filled.reloading).toBe(true);
    expect(filled.ownerNextAttack).toBe(start.state.ownerNextAttack);
    expect(sourceGlockCommandFrame(filled, { ...ctx, now: 11.1, buttons: 1 }).dispatch).toBe('busy');
    const done = sourceGlockCommandFrame(filled, { ...ctx, now: filled.ownerNextAttack, buttons: 0 });
    expect(done.state.clip).toBe(20); expect(done.state.reserve).toBe(103); expect(done.state.reloading).toBe(false);
    const holster = sourceGlockHolster(filled, { now: 11.2, sequenceDuration: 0 });
    expect(holster.state.clip).toBe(20); expect(holster.state.nextPrimary).toBe(filled.nextPrimary);
    expect(busy.state.clip).toBe(3);
  });
  it('retains original PostThink command-before-viewmodel-events call order and target weapon', () => {
    expect(oracle.postThinkOrder.callbacks.map(x => x.callback)).toEqual(['player-command-frame', 'player-animation-events', 'world-weapon-advance', 'world-weapon-events', 'viewmodel-advance', 'viewmodel-events-target-weapon']);
    expect(oracle.postThinkOrder.callbacks.at(-1)?.targetAddress).toBe('0x4010000');
    for (const address of ['0x7ce297', '0x7ce12b', '0x5c13a6', '0x5d33d8', '0x5d33f6']) expect(oracle.postThinkOrder.executed).toContain(address);
  });
  it('rejects malformed inventory and preserves unknown caller identity fields', () => {
    expect(() => sourcePistolCompleteReload({ clip: 21, reserve: 10, reloadVisComplete: false }, { weapon: 'glock' })).toThrow();
    expect(sourcePistolCompleteReload({ clip: 3, reserve: 24, reloadVisComplete: false, generation: 7 }, { weapon: 'usp-s' })).toEqual({ clip: 12, reserve: 15, reloadVisComplete: true, generation: 7 });
  });
});
