import { expect, it } from 'vitest';
import * as T from 'three';
import { Art } from '../game/scene';

// The actor pass (`updateActors`) runs before `frame()` advances the scene clock, so
// a shot published there would be stamped one frame early. The original emits and
// samples on one clock, and the rifle original's additive flare lives only 0.015 s —
// shorter than a 60 Hz frame — so a one-frame error would expire it before the frame
// that draws it ever sampled it. These tests pin the emission to the render clock.
type MuzzleShot = { position: T.Vector3; forward: T.Vector3; up:T.Vector3; seeds: { main: number; core: number } | { vent: number } };
type Fire = { at: number; position: number[]; seeds: unknown };
/** The scene fields this step reads, so the emission can be driven without a GPU:
 * `emitWorldMuzzleShots` touches only the queue, the clock, both original renderers
 * and their burst counters. */
type Harness = {
  emitWorldMuzzleShots(): void;
  pendingWorldMuzzleShots: MuzzleShot[];
  clock: number;
  sourceWorldPistolBursts: number;
  sourceWorldRifleBursts: number;
  sourceWorldPistolParticles: { fire: (o: { position: T.Vector3 }, at: number, seeds: unknown) => void } | null;
  sourceWorldRifleParticles: { fire: (o: { position: T.Vector3 }, at: number, seeds: unknown) => void } | null;
};
const harness = (shots: MuzzleShot[], armed: { pistol?: boolean; rifle?: boolean }) => {
  const fired: { pistol: Fire[]; rifle: Fire[] } = { pistol: [], rifle: [] };
  const record = (list: Fire[]) => (o: { position: T.Vector3 }, at: number, seeds: unknown) =>
    list.push({ at, position: o.position.toArray(), seeds });
  const art = Object.assign(Object.create(Art.prototype), {
    clock: 5.5,
    pendingWorldMuzzleShots: shots,
    sourceWorldPistolBursts: 0,
    sourceWorldRifleBursts: 0,
    sourceWorldPistolParticles: armed.pistol ? { fire: record(fired.pistol) } : null,
    sourceWorldRifleParticles: armed.rifle ? { fire: record(fired.rifle) } : null,
  }) as unknown as Harness;
  return { art, fired };
};
const at = (x: number, y: number, z: number) => new T.Vector3(x, y, z);

it('stamps a published world shot with the clock the same frame samples the original at', () => {
  const rifle: MuzzleShot = { position: at(1, 2, 3), forward: at(1, 0, 0), up:at(0,1,0), seeds: { vent: 7 } };
  const pistol: MuzzleShot = { position: at(4, 5, 6), forward: at(0, 0, 1), up:at(0,1,0), seeds: { main: 11, core: 12 } };
  const { art, fired } = harness([rifle, pistol], { pistol: true, rifle: true });
  art.emitWorldMuzzleShots();
  // The same instant the frame will sample at, not the actor pass's earlier clock.
  expect(fired.rifle).toEqual([{ at: 5.5, position: [1, 2, 3], seeds: { vent: 7 } }]);
  expect(fired.pistol).toEqual([{ at: 5.5, position: [4, 5, 6], seeds: { main: 11, core: 12 } }]);
  // Each original system counts only its own bursts.
  expect(art.sourceWorldRifleBursts).toBe(1);
  expect(art.sourceWorldPistolBursts).toBe(1);
  // The queue is drained every frame: a shot is never carried into the next one.
  expect(art.pendingWorldMuzzleShots).toHaveLength(0);
  art.emitWorldMuzzleShots();
  expect(fired.rifle).toHaveLength(1);
  expect(art.sourceWorldRifleBursts).toBe(1);
});

it('drops a shot whose original renderer is not loaded instead of holding it', () => {
  const { art, fired } = harness([{ position: at(1, 1, 1), forward: at(1, 0, 0), up:at(0,1,0), seeds: { vent: 3 } }], {});
  art.emitWorldMuzzleShots();
  expect(fired.rifle).toHaveLength(0);
  expect(fired.pistol).toHaveLength(0);
  expect(art.sourceWorldRifleBursts).toBe(0);
  expect(art.pendingWorldMuzzleShots).toHaveLength(0);
});
