import { describe, expect, it } from 'vitest';
import { FramePerformance } from '../game/frame-performance';

describe('unclamped rAF wall-clock statistics', () => {
  it.each([30, 60, 144])('counts completed intervals at %i Hz without an extra first frame', hz => {
    const timing = new FramePerformance();
    expect(timing.record(0, 'visible')).toBeNull();
    for (let i = 1; i <= hz * 2; i++) timing.record(i * 1000 / hz, 'visible');
    const result = timing.snapshot();
    expect(result).toMatchObject({ sampleCount: hz * 2, startMs: 0, endMs: 2000, elapsedMs: 2000,
      backgroundIncluded: false, discardedSamples: 0, visibilityChanges: 0,
      visibility: { visible: hz * 2, hidden: 0, mixed: 0, unknown: 0 } });
    expect(result.fps).toBeCloseTo(hz, 10);
    expect(result.frameTimeMs!.p50).toBeCloseTo(1000 / hz, 10);
    expect(result.frameTimeMs!.p95).toBeCloseTo(1000 / hz, 10);
  });

  it('reports 5 FPS for 200ms frames, and preserves a long stall in mean, tail and maximum', () => {
    const timing = new FramePerformance();
    timing.record(1000, 'visible');
    for (const t of [1200, 1400, 1600, 1800]) expect(timing.record(t, 'visible')).toBeNull();
    expect(timing.record(2000, 'visible')).toBe(5);
    expect(timing.record(3000, 'visible')).toBe(1);
    expect(timing.snapshot()).toMatchObject({ sampleCount: 6, elapsedMs: 2000, fps: 3,
      frameTimeMs: { last: 1000, min: 200, mean: 2000 / 6, p50: 200, p95: 1000, p99: 1000, max: 1000 },
      over80ms: 6, over250ms: 1 });
  });

  it('uses nearest-rank percentiles over unequal intervals, not an average of instantaneous FPS', () => {
    const timing = new FramePerformance();
    timing.record(0);
    let now = 0;
    for (let i = 1; i <= 100; i++) timing.record(now += i);
    expect(timing.snapshot()).toMatchObject({ sampleCount: 100, elapsedMs: 5050, fps: 100000 / 5050,
      frameTimeMs: { min: 1, mean: 50.5, p50: 50, p95: 95, p99: 99, max: 100 },
      visibility: { unknown: 100 } });
  });

  it('excludes invalid/backward/duplicate time without poisoning the next interval or HUD window', () => {
    const timing = new FramePerformance();
    for (const t of [NaN, Infinity, -Infinity, -1]) timing.record(t, 'visible');
    expect(timing.snapshot()).toMatchObject({ sampleCount: 0, fps: null, frameTimeMs: null, invalidTimestamps: 4 });
    timing.record(1000, 'visible');
    timing.record(1100, 'visible');
    for (const t of [NaN, Infinity, -1, 1099]) timing.record(t, 'visible');
    timing.record(1100, 'visible');
    expect(timing.record(2000, 'visible')).toBe(2);
    expect(timing.snapshot()).toMatchObject({ sampleCount: 2, startMs: 1000, endMs: 2000,
      elapsedMs: 1000, fps: 2, invalidTimestamps: 8, duplicateTimestamps: 1,
      frameTimeMs: { min: 100, max: 900 } });
  });

  it('retains background intervals and catches hide/show transitions between callbacks', () => {
    const timing = new FramePerformance();
    timing.record(0, 'visible');
    timing.record(20, 'visible');
    timing.markVisibility('hidden');
    timing.markVisibility('visible');
    timing.record(10020, 'visible');
    timing.record(10040, 'hidden');
    timing.record(11040, 'hidden');
    timing.record(11060, 'visible');
    const result = timing.snapshot();
    expect(result).toMatchObject({ sampleCount: 5, elapsedMs: 11060, backgroundIncluded: true,
      currentVisibility: 'visible', visibilityChanges: 4, visibility: { visible: 1, mixed: 3, hidden: 1, unknown: 0 },
      frameTimeMs: { max: 10000, p95: 10000 }, over250ms: 2 });
    expect(result.fps).toBeCloseTo(5000 / 11060, 12);
  });

  it('bounds memory while exposing the exact retained window and resets for a new capture', () => {
    const timing = new FramePerformance(3);
    for (const t of [0, 10, 30, 60, 100, 150]) timing.record(t, 'visible');
    expect(timing.snapshot()).toMatchObject({ sampleCount: 3, capacity: 3, discardedSamples: 2,
      startMs: 30, endMs: 150, elapsedMs: 120, fps: 25, frameTimeMs: { min: 30, p50: 40, p95: 50 } });
    const detached = timing.snapshot();
    detached.visibility.hidden = 99;
    detached.frameTimeMs!.max = 999;
    expect(timing.snapshot().frameTimeMs!.max).toBe(50);
    expect(timing.snapshot().visibility.hidden).toBe(0);
    timing.reset();
    expect(timing.snapshot()).toMatchObject({ sampleCount: 0, fps: null, frameTimeMs: null, discardedSamples: 0 });
    timing.record(500, 'visible');
    expect(timing.record(1500, 'visible')).toBe(1);
    expect(timing.snapshot()).toMatchObject({ sampleCount: 1, startMs: 500, endMs: 1500, elapsedMs: 1000 });
  });
});
