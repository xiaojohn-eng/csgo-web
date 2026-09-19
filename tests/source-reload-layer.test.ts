import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { prepareSourceCharacterPose, sampleSourceCharacterPose, interpolateSourcePoseInput,
  type SourceCharacterPoseData, type SourceCharacterPoseIndex, type SourceCharacterReloadLayer, type SourcePoseParameters } from '../game/source-character-pose';
import { createSourcePoseDriver } from '../game/source-player-contract';
import type { Player } from '../game/types';

// The original world-model reload: one Reload_<weapon> wrapper whose two
// original auto-layers split the action between the upper body (legs masked
// out) and the legs plus lower spine, under one interior envelope. The T/AK
// graph is the audited research snapshot the production dataset is built from.
const folder = '.reference-assets/source-exports/character-t/continuous';
const available = fs.existsSync(`${folder}/pose-data.json`);
const test = available ? it : it.skip;
let index: SourceCharacterPoseIndex;
let data: SourceCharacterPoseData;
const id = 'csgo-t-ak-12426148:b2106b26a407d0fa';
const DT = 1 / 60;
// Reload_AK is the original 74-frame @30fps run: (74-1)/30 = the AK's own
// 73/30 reload duration, so the clock and the animation end together.
const RELOAD_SECONDS = 73 / 30;
const ENVELOPE = { peak: 0.10958904027938843, tail: 0.8904109597206116 };
const parameters: SourcePoseParameters = { move_x: 0, move_y: 0, body_yaw: 0, body_pitch: 0 };
const player = (patch: Partial<Player> = {}) => ({ x: 0, y: -3, z: 0, yaw: 0, pitch: 0, grounded: true, crouch: false,
  reload: 0, shotIdle: 10, alive: true, sourcePoseVersion: id, weapon: 'vandal', ...patch }) as Player;
const boneIndex = (pattern: RegExp) => index.data.mainBones.findIndex(b => pattern.test(b.name));
const quaternionDelta = (a: { quaternions: Float64Array }, b: { quaternions: Float64Array }, bone: number) =>
  Math.hypot(...[0, 1, 2, 3].map(k => a.quaternions[bone * 4 + k] - b.quaternions[bone * 4 + k]));
// `Player.reload` is the weapon's reload timer while the pose input's `reload`
// is the merged original reload layer, so the sample helper states the layer
// explicitly instead of spreading the timer into it.
const aimOnly = (patch: Partial<Omit<Player, 'reload'>> & { reload?: SourceCharacterReloadLayer } = {}) => sampleSourceCharacterPose(index,
  { state: 'Idle', cycle: 0, upperCycle: 0, parameters, fireCycle: 0, fireWeight: 0, blendMode: 'sdk-3way', ...patch });

beforeAll(() => {
  if (!available) return;
  data = JSON.parse(fs.readFileSync(`${folder}/pose-data.json`, 'utf8'));
  index = prepareSourceCharacterPose(data, fs.readFileSync(`${folder}/frames.f64.bin`));
});

describe('original world-model reload graph', () => {
  test('resolves the merged Reload wrapper, its length and its original envelope', () => {
    expect(index.reload).not.toBeNull();
    const graph = index.reload!;
    const wrapper = index.sequences.get(graph.sequence)!;
    expect(wrapper.name).toBe('Reload_AK');
    expect(wrapper.autoLayers).toHaveLength(2);
    expect(wrapper.boneWeights.every(w => w === 0)).toBe(true);
    expect(graph.seconds).toBeCloseTo(RELOAD_SECONDS, 6);
    expect(graph.fadeOut).toBeCloseTo(0.2, 4);
    const envelope = wrapper.autoLayers[0];
    expect([envelope.start, envelope.end]).toEqual([0, 1]);
    expect(envelope.peak).toBeCloseTo(ENVELOPE.peak, 8);
    expect(envelope.tail).toBeCloseTo(ENVELOPE.tail, 8);
    // The two layers cover the action between them: the upper body masks the
    // legs, the delta layer carries them.
    const upper = index.namedSequences.get('Reload_AK_seq')!, lower = index.namedSequences.get('Reload_AK_Inv')!;
    const legs = data.animationBones.map((b, i) => /Thigh|Calf|Foot|Toe/.test(b.name) ? i : -1).filter(i => i >= 0);
    expect(legs.length).toBeGreaterThan(0);
    for (const i of legs) { expect(upper.boneWeights[i]).toBe(0); expect(lower.boneWeights[i]).toBeGreaterThan(0); }
  });

  test('replaces the aim mid-action and returns to it at both envelope ends', () => {
    const arm = boneIndex(/UpperArm|Forearm/), leg = boneIndex(/Thigh|Calf/);
    expect(arm).toBeGreaterThanOrEqual(0);
    expect(leg).toBeGreaterThanOrEqual(0);
    const base = aimOnly();
    const at = (cycle: number) => sampleSourceCharacterPose(index,
      { state: 'Idle', cycle: 0, upperCycle: 0, parameters, fireCycle: 0, fireWeight: 0, blendMode: 'sdk-3way', reload: { cycle, weight: 1 } });
    // The original envelope starts and ends at zero, so the reload pose must
    // leave and rejoin the armed aim pose exactly, with no pop of its own.
    for (const cycle of [0, 1]) {
      const pose = at(cycle);
      expect(quaternionDelta(base, pose, arm)).toBeLessThan(1e-6);
      expect(quaternionDelta(base, pose, leg)).toBeLessThan(1e-6);
    }
    // Inside the envelope both halves move: the arms through the upper layer
    // and the legs through the original delta layer.
    const middle = at((ENVELOPE.peak + ENVELOPE.tail) / 2);
    expect(quaternionDelta(base, middle, arm)).toBeGreaterThan(0.01);
    expect(quaternionDelta(base, middle, leg)).toBeGreaterThan(1e-4);
  });

  test('leaves the aim untouched inside the original fade-in and fade-out edges', () => {
    const arm = boneIndex(/UpperArm|Forearm/);
    const base = aimOnly();
    for (const cycle of [ENVELOPE.peak / 2, (1 + ENVELOPE.tail) / 2]) {
      const pose = sampleSourceCharacterPose(index,
        { state: 'Idle', cycle: 0, upperCycle: 0, parameters, fireCycle: 0, fireWeight: 0, blendMode: 'sdk-3way', reload: { cycle, weight: 1 } });
      const baseAt = base;
      const delta = quaternionDelta(baseAt, pose, arm);
      // Halfway into either ramp the action is present but faded, never full.
      const full = quaternionDelta(base, sampleSourceCharacterPose(index,
        { state: 'Idle', cycle: 0, upperCycle: 0, parameters, fireCycle: 0, fireWeight: 0, blendMode: 'sdk-3way',
          reload: { cycle: (ENVELOPE.peak + ENVELOPE.tail) / 2, weight: 1 } }), arm);
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThan(full);
    }
  });

  test('rejects a reload wrapper that lost its original auto-layer pair', () => {
    const broken = structuredClone(data) as SourceCharacterPoseData;
    const wrapper = broken.sequences.find(s => s.name === 'Reload_AK')!;
    wrapper.autoLayers = wrapper.autoLayers.slice(0, 1);
    expect(() => prepareSourceCharacterPose(broken, fs.readFileSync(`${folder}/frames.f64.bin`))).toThrow(/Reload/);
  });

  test('rejects a reload layer on the corpse and without the merged graph', () => {
    expect(() => sampleSourceCharacterPose(index,
      { state: 'Death', cycle: 0.5, parameters: {}, fireCycle: 0, fireWeight: 0, reload: { cycle: 0.5, weight: 1 } }))
      .toThrow(/reload layer/);
  });

  test('carries the original magazine display window and moves the magazine with it', () => {
    const window = index.reload!.magazine;
    expect(window).not.toBeNull();
    // The AK's own events: AE_CL_EJECT_MAG @0.2192 and AE_CL_EJECT_MAG_UNHIDE @0.3288.
    expect(window!.hide).toBeCloseTo(0.21917808055877686, 8);
    expect(window!.show).toBeCloseTo(0.3287671208381653, 8);
    const visibleAt = (cycle: number | null) => sampleSourceCharacterPose(index,
      { state: 'Idle', cycle: 0, upperCycle: 0, parameters, fireCycle: 0, fireWeight: 0, blendMode: 'sdk-3way',
        ...(cycle === null ? {} : { reload: { cycle, weight: 1 } }) }).magazineVisible;
    // Seated before the reload and through its run-up…
    expect(visibleAt(null)).toBe(true);
    expect(visibleAt(0)).toBe(true);
    expect(visibleAt(window!.hide - 1e-4)).toBe(true);
    // …out of the weapon while the spent magazine is being swapped…
    expect(visibleAt(window!.hide)).toBe(false);
    expect(visibleAt((window!.hide + window!.show) / 2)).toBe(false);
    // …and the fresh one seated again for the rest of the run.
    expect(visibleAt(window!.show)).toBe(true);
    expect(visibleAt(1)).toBe(true);
    // The corpse cannot carry the layer, so it always keeps its magazine seated.
    expect(sampleSourceCharacterPose(index,
      { state: 'Death', cycle: 0.5, parameters: {}, fireCycle: 0, fireWeight: 0 }).magazineVisible).toBe(true);
  });
});

describe('authoritative reload playback through the shared body driver', () => {
  test('arms the reload on the authoritative timer and lands it exactly at the commit', () => {
    const driver = createSourcePoseDriver(index, id);
    const idle = player();
    let previous = idle, pose = driver.advance(previous, idle, DT);
    expect(pose.state).toBe('Idle');
    expect(pose.reload).toBeUndefined();

    // The authority starts the reload: the layer appears at the animation's
    // entry and its cycle is the weapon's own declining timer.
    const reloading = player({ reload: RELOAD_SECONDS, sourcePose: pose });
    previous = reloading; pose = driver.advance(previous, reloading, DT);
    expect(pose.reload).toBeDefined();
    expect(pose.reload!.weight).toBe(1);
    expect(pose.reload!.cycle).toBeCloseTo(0, 6);

    const midway = player({ reload: RELOAD_SECONDS / 2, sourcePose: pose });
    previous = midway; pose = driver.advance(previous, midway, DT);
    expect(pose.reload!.cycle).toBeCloseTo(0.5, 2);

    const committing = player({ reload: RELOAD_SECONDS / 100, sourcePose: pose });
    previous = committing; pose = driver.advance(previous, committing, DT);
    expect(pose.reload!.cycle).toBeGreaterThan(0.98);

    // The magazine commits: the timer reads zero and the layer is gone, with no
    // fade needed because the original envelope already returned to the aim.
    const committed = player({ reload: 0, sourcePose: pose });
    previous = committed; pose = driver.advance(previous, committed, DT);
    expect(pose.reload).toBeUndefined();
  });

  test('fades an interrupted reload out instead of snapping back to the aim', () => {
    const driver = createSourcePoseDriver(index, id);
    const idle = player();
    let previous = idle, pose = driver.advance(previous, idle, DT);
    const reloading = player({ reload: RELOAD_SECONDS / 2, sourcePose: pose });
    previous = reloading; pose = driver.advance(previous, reloading, DT);
    expect(pose.reload!.weight).toBe(1);
    // A weapon switch aborts the reload: the timer is cleared but the armed pose
    // fades at the original fade time.
    const interrupted = player({ reload: 0, sourcePose: pose, weapon: 'm4a4' });
    previous = interrupted; pose = driver.advance(previous, interrupted, DT);
    expect(pose.reload).toBeDefined();
    expect(pose.reload!.weight).toBeLessThan(1);
    const afterOneFade = Math.ceil(0.2 / DT) + 2;
    for (let i = 0; i < afterOneFade; i++) { previous = player({ reload: 0, sourcePose: pose }); pose = driver.advance(previous, previous, DT); }
    expect(pose.reload).toBeUndefined();
  });

  test('drops the reload from the authoritative corpse', () => {
    const driver = createSourcePoseDriver(index, id);
    const idle = player();
    let previous = idle, pose = driver.advance(previous, idle, DT);
    const reloading = player({ reload: RELOAD_SECONDS / 2, sourcePose: pose });
    pose = driver.advance(reloading, reloading, DT);
    expect(pose.reload).toBeDefined();
    const dead = player({ alive: false, reload: 0, sourcePose: pose });
    const corpse = driver.advance(dead, dead, DT);
    expect(corpse.state).toBe('Death');
    expect(corpse.reload).toBeUndefined();
  });

  test('blends one continuous reload across snapshots and cross-fades an interruption', () => {
    const base: Parameters<typeof interpolateSourcePoseInput>[0] =
      { state: 'Idle', cycle: 0, upperCycle: 0, parameters, fireCycle: 0, fireWeight: 0, blendMode: 'sdk-3way' };
    const following = { ...base, reload: { cycle: 0.6, weight: 1 } };
    const blended = interpolateSourcePoseInput({ ...base, reload: { cycle: 0.2, weight: 1 } }, following, 0.5, { spanSeconds: 0.2 });
    expect(blended.reload!.cycle).toBeCloseTo(0.4, 6);
    expect(blended.reload!.weight).toBeCloseTo(1, 6);
    const cut = interpolateSourcePoseInput({ ...base, reload: { cycle: 0.6, weight: 1 } }, base, 0.25, { spanSeconds: 0.2 });
    expect(cut.reload!.cycle).toBeCloseTo(0.6, 6);
    expect(cut.reload!.weight).toBeCloseTo(0.75, 6);
  });
});
