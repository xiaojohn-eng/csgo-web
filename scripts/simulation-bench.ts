import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { Simulation, initPhysics } from '../game/simulation';
import type { Mode } from '../game/types';

// A CPU workload, not a wall-clock server loop: no sockets, browser, timers or sleeps.
const ticks = 3600, dt = 1 / 60, budgetMs = dt * 1000, seed = 69421;
const stats = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), total = values.reduce((a, b) => a + b, 0);
  const percentile = (q: number) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
  return { samples: values.length, totalMs: total, meanMs: total / values.length,
    p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: sorted.at(-1)!,
    over16_667ms: values.filter(value => value > budgetMs).length,
    meanBudgetFraction: total / values.length / budgetMs };
};
const hashes: Record<string, string> = {};
for (const path of ['game/simulation.ts', 'game/pose-clearance.ts', 'game/locomotion.ts',
  'game/character-contract.ts', 'game/falcon-body-reference.ts', 'game/pose-timeline.ts'])
  hashes[path] = createHash('sha256').update(await readFile(path)).digest('hex');
const rapier = JSON.parse(await readFile('node_modules/@dimforge/rapier3d-compat/package.json', 'utf8')).version;
await initPhysics();
// Warm the actual map / AI / movement path in a disposable world. Measured worlds
// start afresh from the same seed; setup and this warmup are outside step timings.
const warm = new Simulation('training', true); warm.rng = seed; warm.fillBots();
try { for (let i = 0; i < 180; i++) warm.step(dt); } finally { warm.dispose(); }

function measure(mode: Mode) {
  const sim = new Simulation(mode, true); sim.rng = seed; sim.fillBots();
  if (sim.players.length !== 10 || sim.players.some(player => !player.bot)) throw new Error('Expected ten real AI players');
  const times: number[] = [], phaseTimes = new Map<string, number[]>(), busyTimes: number[] = [];
  const events: Record<string, number> = {}, statusCounts: Record<string, number> = {};
  let eventCursor = 0, maxTick = 0, maximum = -Infinity, maxPhase = '', aliveMin = 10, aliveMax = 0;
  let movingPlayerTicks = 0, tenAliveLiveTicks = 0, disposedCleanly = false, failure: string | null = null;
  let finalState: Record<string, unknown> | null = null, disposalMs = 0;
  const started = performance.now();
  try {
    for (let i = 0; i < ticks; i++) {
      const phase = sim.phase, alive = sim.players.filter(player => player.alive).length;
      const moving = sim.players.filter(player => player.alive && (player.strideWeight ?? 0) > .05).length;
      aliveMin = Math.min(aliveMin, alive); aliveMax = Math.max(aliveMax, alive); movingPlayerTicks += moving;
      const begin = performance.now(); sim.step(dt); const elapsed = performance.now() - begin;
      times.push(elapsed);
      if (!phaseTimes.has(phase)) phaseTimes.set(phase, []);
      phaseTimes.get(phase)!.push(elapsed);
      if (phase === 'live' && alive === 10) tenAliveLiveTicks++;
      if (phase === 'live' && alive === 10 && moving >= 8) busyTimes.push(elapsed);
      if (elapsed > maximum) { maximum = elapsed; maxTick = i + 1; maxPhase = phase; }
      // Readback happens outside the timed step, so reporting is not charged to simulation.
      for (const event of sim.events) if (event.id > eventCursor) {
        events[event.type] = (events[event.type] ?? 0) + 1; eventCursor = Math.max(eventCursor, event.id);
      }
      for (const player of sim.players) {
        const status = sim.poseResolution(player)?.status;
        if (status) statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      }
    }
    const snapshot = sim.snapshot();
    finalState = { tick: sim.tick, simulatedSeconds: sim.time, phase: sim.phase, round: sim.round,
      score: sim.score, players: sim.players.length, bots: sim.players.filter(p => p.bot).length,
      alive: sim.players.filter(p => p.alive).length, rng: sim.rng,
      snapshotSha256: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
  } catch (error) { failure = error instanceof Error ? error.stack ?? error.message : String(error); }
  finally {
    const begin = performance.now();
    try { sim.dispose(); sim.dispose(); disposedCleanly = true; }
    catch (error) { failure = `${failure ?? ''}\nDispose: ${String(error)}`; }
    disposalMs = performance.now() - begin;
  }
  return { mode, requestedTicks: ticks, completedTicks: times.length, fixedDt: dt, seed,
    totalLoopWallMs: performance.now() - started, step: stats(times),
    byPhase: Object.fromEntries([...phaseTimes].map(([phase, values]) => [phase, stats(values)])),
    tenAliveAndAtLeastEightMovingLive: stats(busyTimes), tenAliveLiveTicks, aliveRange: [aliveMin, aliveMax],
    averageMovingPlayers: movingPlayerTicks / Math.max(1, times.length),
    worstStep: { tick: maxTick, phase: maxPhase, elapsedMs: maximum }, events,
    poseResolutionReadbacks: statusCounts, finalState, disposalMs, disposedCleanly, failure };
}

const results = [measure('training'), measure('demolition')];
const report = { measuredAt: new Date().toISOString(), node: process.version, platform: `${process.platform}/${process.arch}`,
  cpu: cpus()[0]?.model ?? 'unknown', rapier, sourceSha256: hashes, fixedStepBudgetMs: budgetMs,
  method: 'Actual complete Simulation.step on the shipped map, ten real AI players, 3600 ticks per mode at dt=1/60. Natural buy/live/ended phases retained; reporting/setup/dispose excluded from step times. Separate 180-tick actual-AI warmup world disposed first. No network, sockets, browser, wait or wall-clock pacing.',
  randomness: 'Simulation.rng explicitly set to 69421 before fillBots; shared AI uses its LCG. No Math.random calls in the inspected simulation/handling/map/tactics/locomotion paths. Floating-point/engine/platform scheduling and GC timings are not deterministic. Snapshot hashes are readback identifiers, not cross-platform determinism proof.',
  warmupDisposedCleanly: warm.disposed, results };
await mkdir('output/tests', { recursive: true });
await writeFile('output/tests/simulation-performance.json', JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (results.some(result => result.failure || !result.disposedCleanly || result.completedTicks !== ticks)) process.exitCode = 1;
