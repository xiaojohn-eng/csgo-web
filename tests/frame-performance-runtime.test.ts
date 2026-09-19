import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Exercise the actual Game/rAF/visibility wiring without GPU, audio or a room.
vi.mock('../game/simulation', () => ({ Simulation: class {}, initPhysics: () => new Promise(() => {}) }));
vi.mock('../game/scene', () => ({ Art: class {
  ready = new Promise(() => {}); assets = {}; hit = 0; damage = 0;
  inspection = { cancel() {} };
  frame = vi.fn();
  updateSmoke() {} updateGrenades() {} updateDroppedWeapons() {} updateActors() {}
  setSourceParticleLightingWorld() { return Promise.resolve(); }
  sourceFinishStatus() { return { status: 'default' }; }
  clearEffects() {} resize() {} dispose() {}
} }));
vi.mock('../game/audio', () => ({ AudioEngine: class {
  prepare() { return Promise.resolve(); }
  dispose() {}
} }));
import { Game } from '../game/runtime';

class Surface extends EventTarget { closest() { return null; } }
class DocumentSurface extends Surface { hidden = false; pointerLockElement = null; exitPointerLock() {} }
let g: Game, doc: DocumentSurface;
beforeEach(() => {
  doc = new DocumentSurface();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', new Surface());
  vi.stubGlobal('location', { protocol: 'http:', search: '' });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  g = new Game(new Surface() as unknown as HTMLCanvasElement, vi.fn());
});
afterEach(() => { g.dispose(); vi.unstubAllGlobals(); });

it('feeds unclamped timestamps to HUD/inspection while retaining the 80ms render/simulation limit', () => {
  for (const t of [1000, 1200, 1400, 1600, 1800, 2000]) g.frame(t);
  expect(g.frameErrors).toBe(0);
  expect(g.fps).toBe(5);
  expect(g.frameTiming).toMatchObject({ sampleCount: 5, elapsedMs: 1000, fps: 5,
    frameTimeMs: { p50: 200, p95: 200, max: 200 }, over80ms: 5 });
  const calls = vi.mocked(g.art.frame).mock.calls;
  expect(calls.map(call => call[0])).toEqual([0, .08, .08, .08, .08, .08]);
});

it('does not let non-finite/negative/stale timestamps poison Game timing or inflate the next FPS window', () => {
  g.frame(1000);
  for (const t of [NaN, Infinity, -1, 999, 1000]) g.frame(t);
  g.frame(2000);
  expect(g.frameErrors).toBe(0);
  expect(g.last).toBe(2000);
  expect(Number.isFinite(g.acc)).toBe(true);
  expect(g.fps).toBe(1);
  expect(g.frameTiming).toMatchObject({ sampleCount: 1, elapsedMs: 1000,
    invalidTimestamps: 4, duplicateTimestamps: 1 });
  expect(vi.mocked(g.art.frame).mock.calls.every(call => Number.isFinite(call[0]) && call[0] >= 0 && call[0] <= .08)).toBe(true);
});

it('marks a hide/show event without background rAF callbacks and keeps the entire resumed gap', () => {
  g.frame(1000);
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
  g.frame(31000);
  expect(g.frameErrors).toBe(0);
  expect(g.frameTiming).toMatchObject({ sampleCount: 1, elapsedMs: 30000,
    backgroundIncluded: true, visibility: { mixed: 1, visible: 0, hidden: 0 }, frameTimeMs: { max: 30000 } });
  expect(g.frameTiming.fps).toBeCloseTo(1 / 30, 12);
  expect(vi.mocked(g.art.frame).mock.calls.at(-1)![0]).toBe(.08);
});
