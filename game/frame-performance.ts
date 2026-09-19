/** rAF wall-clock intervals, independent of the simulation's clamped timestep.
 * These measure callback delivery, not GPU time. A visible document can still
 * be throttled; visibility labels must not be presented as a foreground benchmark. */
export type FrameVisibility = 'visible' | 'hidden' | 'unknown';
type IntervalVisibility = FrameVisibility | 'mixed';
type Sample = { startMs: number; endMs: number; durationMs: number; visibility: IntervalVisibility };

export type FrameTiming = {
  source: 'raf-wall-clock';
  sampleCount: number;
  capacity: number;
  discardedSamples: number;
  startMs: number | null;
  endMs: number | null;
  elapsedMs: number;
  fps: number | null;
  frameTimeMs: { last: number; min: number; mean: number; p50: number; p95: number; p99: number; max: number } | null;
  visibility: Record<IntervalVisibility, number>;
  currentVisibility: FrameVisibility;
  visibilityChanges: number;
  backgroundIncluded: boolean;
  over80ms: number;
  over250ms: number;
  invalidTimestamps: number;
  duplicateTimestamps: number;
};

export class FramePerformance {
  private samples: Sample[] = [];
  private cursor = 0;
  private totalSamples = 0;
  private previousMs: number | null = null;
  private visibility: FrameVisibility = 'unknown';
  private previousVisibility: FrameVisibility = 'unknown';
  private visibilityEpoch = 0;
  private visibilityChanges = 0;
  private previousVisibilityEpoch = 0;
  private invalidTimestamps = 0;
  private duplicateTimestamps = 0;
  private reportFrames = 0;
  private reportElapsedMs = 0;

  constructor(readonly capacity = 4096) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 65536)
      throw Error('Frame sample capacity must be an integer in 1..65536');
  }

  /** Also call on visibilitychange, so hidden->visible between two rAF callbacks
   * cannot make an entire background pause appear to be a visible interval. */
  markVisibility(visibility: FrameVisibility) {
    if (visibility !== this.visibility) {
      if (this.visibility !== 'unknown') this.visibilityChanges++;
      this.visibilityEpoch++;
    }
    this.visibility = visibility;
  }

  /** Returns the FPS of a completed >=1s wall-clock window, or null. Invalid,
   * backward and duplicate timestamps never advance the baseline or frame count. */
  record(nowMs: number, visibility: FrameVisibility = 'unknown'): number | null {
    this.markVisibility(visibility);
    if (!Number.isFinite(nowMs) || nowMs < 0 || (this.previousMs !== null && nowMs < this.previousMs)) {
      this.invalidTimestamps++;
      return null;
    }
    if (nowMs === this.previousMs) {
      this.duplicateTimestamps++;
      return null;
    }
    const previousMs = this.previousMs;
    this.previousMs = nowMs;
    const intervalVisibility = this.previousVisibilityEpoch === this.visibilityEpoch
      ? this.previousVisibility : 'mixed';
    this.previousVisibility = visibility;
    this.previousVisibilityEpoch = this.visibilityEpoch;
    if (previousMs === null) return null;
    const durationMs = nowMs - previousMs;
    this.samples[this.cursor] = { startMs: previousMs, endMs: nowMs, durationMs, visibility: intervalVisibility };
    this.cursor = (this.cursor + 1) % this.capacity;
    this.totalSamples++;
    this.reportFrames++;
    this.reportElapsedMs += durationMs;
    if (this.reportElapsedMs < 1000) return null;
    const fps = 1000 * this.reportFrames / this.reportElapsedMs;
    this.reportFrames = this.reportElapsedMs = 0;
    return fps;
  }

  /** Exact nearest-rank percentiles over the latest `capacity` complete
   * intervals. The count/duration/discarded fields expose the actual window;
   * invalid/duplicate timestamp and visibility-change counters are since reset. */
  snapshot(): FrameTiming {
    const rows = this.samples.length < this.capacity ? this.samples
      : [...this.samples.slice(this.cursor), ...this.samples.slice(0, this.cursor)];
    const times = rows.map(row => row.durationMs).sort((a, b) => a - b);
    const visibility = { visible: 0, hidden: 0, mixed: 0, unknown: 0 };
    let elapsedMs = 0, over80ms = 0, over250ms = 0;
    for (const row of rows) {
      elapsedMs += row.durationMs;
      visibility[row.visibility]++;
      if (row.durationMs > 80) over80ms++;
      if (row.durationMs > 250) over250ms++;
    }
    const n = rows.length, percentile = (q: number) => times[Math.ceil(q * n) - 1];
    return {
      source: 'raf-wall-clock', sampleCount: n, capacity: this.capacity,
      discardedSamples: this.totalSamples - n,
      startMs: rows[0]?.startMs ?? null, endMs: rows.at(-1)?.endMs ?? null, elapsedMs,
      fps: n ? n * 1000 / elapsedMs : null,
      frameTimeMs: n ? { last: rows[n - 1].durationMs, min: times[0], mean: elapsedMs / n,
        p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: times[n - 1] } : null,
      visibility, currentVisibility: this.visibility, visibilityChanges: this.visibilityChanges,
      backgroundIncluded: visibility.hidden + visibility.mixed > 0,
      over80ms, over250ms, invalidTimestamps: this.invalidTimestamps, duplicateTimestamps: this.duplicateTimestamps,
    };
  }

  /** Begin a bounded benchmark after warm-up without altering simulation time. */
  reset() {
    this.samples = [];
    this.cursor = this.totalSamples = 0;
    this.previousMs = null;
    this.visibility = this.previousVisibility = 'unknown';
    this.visibilityEpoch = this.previousVisibilityEpoch = 0;
    this.visibilityChanges = 0;
    this.invalidTimestamps = this.duplicateTimestamps = 0;
    this.reportFrames = this.reportElapsedMs = 0;
  }
}
