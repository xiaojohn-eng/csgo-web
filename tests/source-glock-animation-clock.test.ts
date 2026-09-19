import { readFileSync } from 'node:fs';
import { advanceSourceViewmodelAnimTimes } from '../game/source-viewmodel-animation-time';
import { describe, expect, it } from 'vitest';
import { createSourceGlockAnimationClock, restoreSourceGlockAnimationClock, resetSourceGlockAnimationClock, requestSourceGlockAnimationSequence, requestSourceGlockAnimationActivity, advanceSourceGlockAnimationClock, dispatchSourceGlockAnimationEvents, sourceGlockAnimationFrame, sourceGlockAnimationProfile, SOURCE_GLOCK_ANIMATION_MDL_SHA256, type SourceGlockAnimationClock, type SourceGlockAnimationSequence, type SourceGlockAnimationEvent } from '../game/source-glock-animation-clock';
const corpus = JSON.parse(readFileSync('output/tests/source-glock-animation-clock-native.json', 'utf8')) as {
  sourceMdlSha256: string; caseCount: number;
  initialization: { now: number; animTime: number; previousAnimTime: number }[];
  requestGuards: { input: Partial<SourceGlockAnimationClock>; sequence: SourceGlockAnimationSequence; accepted: boolean }[];
  sharedViewmodel: { weapon: string; viewmodelIndex: number; viewmodel: string }[];
  cases: { label: string; input: Partial<SourceGlockAnimationClock>; context: { now: number; reset?: SourceGlockAnimationSequence; advance?: boolean; dispatch?: boolean }; result: { state: SourceGlockAnimationClock; afterReset: SourceGlockAnimationClock; afterAdvance: SourceGlockAnimationClock; events: SourceGlockAnimationEvent[] } }[];
};
function input(row: Partial<SourceGlockAnimationClock>) { return restoreSourceGlockAnimationClock({ ...createSourceGlockAnimationClock(0), playbackRate: 1, ...row }); }
describe('original Glock viewmodel animation clock', () => {
  it('matches every original reset, clock, cursor, parity, completion and event field exactly', () => {
    expect(corpus.sourceMdlSha256).toBe(SOURCE_GLOCK_ANIMATION_MDL_SHA256);
    expect(corpus.caseCount).toBe(3292);
    for (const [i, row] of corpus.cases.entries()) {
      let state = input(row.input);
      if (row.context.reset !== undefined) state = resetSourceGlockAnimationClock(state, row.context.reset);
      expect(state, `${i} ${row.label} reset`).toEqual(row.result.afterReset);
      if (row.context.advance !== false) state = advanceSourceGlockAnimationClock(state, row.context.now);
      expect(state, `${i} ${row.label} advance`).toEqual(row.result.afterAdvance);
      const result = row.context.dispatch === false ? { state, events: [] } : dispatchSourceGlockAnimationEvents(state, row.context.now);
      expect(result, `${i} ${row.label} dispatch`).toEqual({ state: row.result.state, events: row.result.events });
    }
  });
  it('uses original constructor curtime for both anim clocks and resets playback only at selected sequence start', () => {
    for (const row of corpus.initialization) {
      const state = createSourceGlockAnimationClock(row.now);
      expect(state.animTime).toBe(row.animTime); expect(state.previousAnimTime).toBe(row.previousAnimTime);
      expect(state.playbackRate).toBe(0);
      expect(resetSourceGlockAnimationClock(state, 3).playbackRate).toBe(1);
    }
  });
  it('shares owner VM times across weapons and matches the independent time slice on every native frame', () => {
    expect(new Set(corpus.sharedViewmodel.map(x => x.weapon)).size).toBe(2);
    expect(corpus.sharedViewmodel.map(x => x.viewmodelIndex)).toEqual([0, 0]);
    expect(new Set(corpus.sharedViewmodel.map(x => x.viewmodel)).size).toBe(1);
    for (const row of corpus.cases) {
      const result = advanceSourceViewmodelAnimTimes(row.result.afterReset, row.context.now);
      expect(result.state).toEqual({ animTime: row.result.afterAdvance.animTime, previousAnimTime: row.result.afterAdvance.previousAnimTime });
    }
    let shared = { animTime: 10, previousAnimTime: 10 };
    for (let i = 1; i <= 640; i++) shared = advanceSourceViewmodelAnimTimes(shared, 10 + i / 64).state;
    const glock = requestSourceGlockAnimationSequence({ ...createSourceGlockAnimationClock(10), ...shared }, 3).state;
    const result = sourceGlockAnimationFrame(glock, 20 + 1 / 64);
    expect(result.state.cycle).toBe(Math.fround(Math.fround(1 / 64) * Math.fround(1 / sourceGlockAnimationProfile(3).duration)));
  });
  it('matches all 180 original lookat/idle guards and does not reset a missing holster sequence', () => {
    expect(corpus.requestGuards).toHaveLength(180);
    for (const row of corpus.requestGuards) expect(requestSourceGlockAnimationSequence(input(row.input), row.sequence).applied).toBe(row.accepted);
    const state = input({ sequence: 4, cycle: .5, eventCursor: .5, animTime: 10 });
    expect(requestSourceGlockAnimationActivity(state, 184)).toEqual({ state, applied: false });
    expect(requestSourceGlockAnimationActivity(state, 192).state.sequence).toBe(1);
  });
  it('preserves same-command elapsed interval through repeated sequence reset and wraps original parity at8', () => {
    const previous = input({ sequence: 1, cycle: .7, eventCursor: .7, animTime: 10, previousAnimTime: 9.9, animationParity: 7, sequenceParity: 7, resetEventsParity: 7 });
    const reset = resetSourceGlockAnimationClock(previous, 1);
    expect(reset.animTime).toBe(10); expect(reset.animationParity).toBe(0);
    expect(sourceGlockAnimationFrame(reset, 10.015625).state.cycle).toBe(Math.fround(.015625 * Math.fround(1 / sourceGlockAnimationProfile(1).duration)));
    expect(previous.cycle).toBe(Math.fround(.7));
  });
  it('fires event54 once from original accumulated cycle and can restore full JSON mid-reload without drift', () => {
    let state = resetSourceGlockAnimationClock(createSourceGlockAnimationClock(10), 4), count = 0;
    for (let i = 0; i < 180; i++) {
      const now = Math.fround(10 + i / 64);
      const original = sourceGlockAnimationFrame(state, now);
      const restored = sourceGlockAnimationFrame(restoreSourceGlockAnimationClock(JSON.parse(JSON.stringify(state))), now);
      expect(restored).toEqual(original); count += original.events.filter(x => x.recordEvent === 54).length;
      state = original.state;
    }
    expect(count).toBe(1); expect(state.cycle).toBe(1); expect(state.eventCursor).toBe(Math.fround(1.01));
  });
  it('keeps playback paused without advancing cursor, clamps long stalls and rejects unknown rigs or clocks', () => {
    const state = input({ sequence: 4, cycle: .4, eventCursor: .4, animTime: 10, previousAnimTime: 9, playbackRate: 0 });
    const paused = sourceGlockAnimationFrame(state, 20);
    expect(paused.state.cycle).toBe(state.cycle); expect(paused.state.eventCursor).toBe(state.eventCursor); expect(paused.events).toEqual([]);
    const running = { ...state, playbackRate: 1 };
    expect(advanceSourceGlockAnimationClock(running, 20).cycle).toBe(advanceSourceGlockAnimationClock(running, 10.200000762939453).cycle);
    expect(() => restoreSourceGlockAnimationClock({ ...state, sequence: 7 as SourceGlockAnimationSequence })).toThrow();
  });
});
