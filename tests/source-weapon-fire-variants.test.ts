import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  createSourceViewmodelAnimationDriver, sourceActivityVariants,
} from '../game/source-viewmodel-animation-clock';
import { SOURCE_WEAPON_FIRE_VARIANTS } from '../game/source-weapon-fire-variants';
import { drawSourceActivityVariant } from '../game/source-weapon-fire-draw';
import {
  SOURCE_USP_ACTIVITY_SEQUENCE, SOURCE_USP_ANIMATION_DATA, SOURCE_USP_FIRE_ACTIVITY,
  SOURCE_USP_FIRE_VARIANTS, sourceUSPAnimationClock,
} from '../game/source-usp-animation-clock';
import {
  SOURCE_DEAGLE_ACTIVITY_SEQUENCE, SOURCE_DEAGLE_ANIMATION_DATA, SOURCE_DEAGLE_FIRE_ACTIVITY,
  SOURCE_DEAGLE_FIRE_VARIANTS, sourceDeagleAnimationClock,
} from '../game/source-deagle-animation-clock';
import {
  assertSourceFireVariants, inspectSourceViewmodel, sourceViewmodelFireVariants, updateSourceViewmodel,
} from '../game/source-viewmodel';
import { M4A4_VIEWMODEL_CONTRACT } from '../game/source-m4a4-viewmodel';
import { loadSourceTViewmodel } from '../game/source-t-viewmodel';
import type { Player } from '../game/types';

type Variant = { sequence: number; weight: number };
const research = JSON.parse(readFileSync(resolve('research/source-weapon-activities.json'), 'utf8')) as
  Record<string, { fireVariants: string[]; fireWeights: number[]; fireVariantCount: number;
    fireWeightsAllEqual: boolean }>;
/** A reproducible draw, so the distribution can be asserted rather than eyeballed. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}
const sequences = (table: Record<number, readonly Variant[]>, activity: number) =>
  table[activity].map((row) => row.sequence);

describe('the fire activity draws between the sequences its own model carries', () => {
  it('takes the variants and weights from the original models', () => {
    // The table is generated from the view models, so it has to match the read that
    // produced it -- name for name and weight for weight.
    for (const weapon of ['vandal', 'm4a4', 'glock', 'usp', 'deagle', 'awp']) {
      const row = research[weapon] as { fireVariants: string[]; fireWeights: number[] };
      const table = SOURCE_WEAPON_FIRE_VARIANTS[weapon as keyof typeof SOURCE_WEAPON_FIRE_VARIANTS];
      expect(table.map((entry) => entry.name), weapon).toEqual(row.fireVariants);
      expect(table.map((entry) => entry.weight), weapon).toEqual(row.fireWeights);
    }
    // The rifles and three of the pistols carry three variants; the Glock and the AWP one.
    expect(SOURCE_WEAPON_FIRE_VARIANTS.vandal).toHaveLength(3);
    expect(SOURCE_WEAPON_FIRE_VARIANTS.m4a4).toHaveLength(3);
    expect(SOURCE_WEAPON_FIRE_VARIANTS.usp).toHaveLength(3);
    expect(SOURCE_WEAPON_FIRE_VARIANTS.deagle).toHaveLength(3);
    expect(SOURCE_WEAPON_FIRE_VARIANTS.glock).toHaveLength(1);
    expect(SOURCE_WEAPON_FIRE_VARIANTS.awp).toHaveLength(1);
    // Equal weights, which is what makes the draw uniform rather than merely weighted.
    for (const weapon of ['vandal', 'm4a4', 'usp', 'deagle'] as const)
      expect(SOURCE_WEAPON_FIRE_VARIANTS[weapon].map((entry) => entry.weight), weapon).toEqual([1, 1, 1]);
  });

  it('resolves a model name to the port\'s own sequence, and keeps the activity\'s default', () => {
    // The activity these variants belong to already had one sequence; the table's first
    // entry has to be that same sequence, or one of the two reads the model wrongly.
    expect(sequences(SOURCE_USP_FIRE_VARIANTS, SOURCE_USP_FIRE_ACTIVITY)).toEqual([3, 4, 5]);
    expect(SOURCE_USP_FIRE_VARIANTS[SOURCE_USP_FIRE_ACTIVITY][0].sequence)
      .toBe(SOURCE_USP_ACTIVITY_SEQUENCE[SOURCE_USP_FIRE_ACTIVITY]);
    expect(SOURCE_USP_ANIMATION_DATA.filter((row) => [3, 4, 5].includes(row.sequence)).map((row) => row.name))
      .toEqual(['shoot1', 'shoot2', 'shoot3']);
    expect(sequences(SOURCE_DEAGLE_FIRE_VARIANTS, SOURCE_DEAGLE_FIRE_ACTIVITY)).toEqual([1, 2, 3]);
    expect(SOURCE_DEAGLE_FIRE_VARIANTS[SOURCE_DEAGLE_FIRE_ACTIVITY][0].sequence)
      .toBe(SOURCE_DEAGLE_ACTIVITY_SEQUENCE[SOURCE_DEAGLE_FIRE_ACTIVITY]);
    expect(SOURCE_DEAGLE_ANIMATION_DATA.filter((row) => [1, 2, 3].includes(row.sequence)).map((row) => row.name))
      .toEqual(['shoot1', 'shoot2', 'shoot3']);
  });

  it('draws every variant a model carries, in the model\'s own proportions', () => {
    const clock = createSourceViewmodelAnimationDriver(SOURCE_USP_ANIMATION_DATA, SOURCE_USP_ACTIVITY_SEQUENCE,
      { inspect: 10, idle: 0, variants: SOURCE_USP_FIRE_VARIANTS, random: seeded(20260912) });
    const counts = new Map<number, number>();
    const shots = 30000;
    let state = clock.create(0);
    for (let shot = 0; shot < shots; shot++) {
      const fired = clock.requestActivity(state, SOURCE_USP_FIRE_ACTIVITY);
      expect(fired.applied, 'a shot starts a fire sequence').toBe(true);
      counts.set(fired.state.sequence, (counts.get(fired.state.sequence) ?? 0) + 1);
      state = fired.state;
    }
    // Only the model's own variants, all of them, and equal weights mean equal shares.
    expect([...counts.keys()].sort()).toEqual([3, 4, 5]);
    for (const sequence of [3, 4, 5]) {
      const share = counts.get(sequence)! / shots;
      expect(share, `sequence ${sequence} share ${share}`).toBeGreaterThan(0.31);
      expect(share, `sequence ${sequence} share ${share}`).toBeLessThan(0.36);
    }
    // The clock still resets to the drawn sequence, not just to the activity's default.
    expect(state.cycle).toBe(0);
    expect(state.playbackRate).toBe(1);
  });

  it('leaves an activity with one sequence exactly as it was', () => {
    const clock = createSourceViewmodelAnimationDriver(SOURCE_USP_ANIMATION_DATA, SOURCE_USP_ACTIVITY_SEQUENCE,
      { inspect: 10, idle: 0, variants: SOURCE_USP_FIRE_VARIANTS, random: () => 0.99 });
    const start = clock.create(0);
    // Reload is not a variant activity, so it still resolves through the activity map.
    expect(clock.requestActivity(start, 194).state.sequence).toBe(SOURCE_USP_ACTIVITY_SEQUENCE[194]);
    expect(clock.requestActivity(start, 481).state.sequence).toBe(SOURCE_USP_ACTIVITY_SEQUENCE[481]);
    // An activity this weapon does not map is still refused rather than guessed.
    expect(clock.requestActivity(start, 477)).toEqual({ state: start, applied: false });
    // Even the largest draw stays inside the table.
    const fired = clock.requestActivity(start, SOURCE_USP_FIRE_ACTIVITY);
    expect([3, 4, 5]).toContain(fired.state.sequence);
  });

  it('is wired into the shipped clocks, not only into a table', () => {
    // The clocks the game actually runs draw from the same table: over sixty shots, always
    // the same variant would mean the wiring were missing (chance of that is 3^-59).
    type ShippedClock = { create(now: number): { sequence: number };
      requestActivity(state: never, activity: number): { state: { sequence: number } } };
    for (const clock of [sourceUSPAnimationClock, sourceDeagleAnimationClock] as ShippedClock[]) {
      const seen = new Set<number>();
      let state = clock.create(0);
      for (let shot = 0; shot < 60; shot++) {
        const fired = clock.requestActivity(state as never, 192);
        seen.add(fired.state.sequence);
        state = fired.state;
      }
      expect(seen.size, 'the shipped clock draws between the model\'s variants').toBeGreaterThan(1);
    }
  });

  it('refuses a variant table that disagrees with the model or with the mapping', () => {
    expect(() => sourceActivityVariants(SOURCE_USP_ANIMATION_DATA, 192,
      [{ name: 'shoot4', weight: 1 }], SOURCE_USP_ACTIVITY_SEQUENCE))
      .toThrow('has no sequence named shoot4');
    // The first variant is the activity's default; claiming another one is a contradiction.
    expect(() => sourceActivityVariants(SOURCE_USP_ANIMATION_DATA, 192,
      [{ name: 'shoot2', weight: 1 }, { name: 'shoot3', weight: 1 }], SOURCE_USP_ACTIVITY_SEQUENCE))
      .toThrow('default differs from its variant table');
    expect(() => sourceActivityVariants(SOURCE_USP_ANIMATION_DATA, 477,
      [{ name: 'shoot1', weight: 1 }], SOURCE_USP_ACTIVITY_SEQUENCE))
      .toThrow('is not one this weapon maps');
    expect(() => sourceActivityVariants(SOURCE_USP_ANIMATION_DATA, 192,
      [{ name: 'shoot1', weight: 1.5 }], SOURCE_USP_ACTIVITY_SEQUENCE))
      .toThrow('Invalid original activity weight');
    // A table for an activity with a single sequence would be a claim the model does not
    // make, and a table whose weights sum to nothing cannot be drawn from.
    expect(() => createSourceViewmodelAnimationDriver(SOURCE_USP_ANIMATION_DATA, SOURCE_USP_ACTIVITY_SEQUENCE,
      { inspect: 10, idle: 0, variants: { 194: [{ sequence: 7, weight: 1 }] } }))
      .toThrow('only when it has several');
    expect(() => createSourceViewmodelAnimationDriver(SOURCE_USP_ANIMATION_DATA, SOURCE_USP_ACTIVITY_SEQUENCE,
      { inspect: 10, idle: 0, variants: { 192: [{ sequence: 3, weight: 0 }, { sequence: 4, weight: 0 }] } }))
      .toThrow('weights sum to nothing');
  });
});

describe('the view model a shot draws between the sequences its own model carries', () => {
  const directory = resolve('public/source/csgo-12426148/ak47-draw');
  /** The shipped T owner, over the fixture its own manifest names. */
  async function owner() {
    const buffers = new Map<string, Uint8Array>([['provenance.json', readFileSync(resolve(directory, 'provenance.json'))]]);
    const manifest = JSON.parse(Buffer.from(buffers.get('provenance.json')!).toString());
    for (const file of manifest.files as { path: string }[]) buffers.set(file.path, readFileSync(resolve(directory, file.path)));
    const bytes = buffers.get('viewmodel.glb')!;
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
    const doc = JSON.parse(Buffer.from(bytes.subarray(20, 20 + size)).toString());
    const binary = bytes.subarray(28 + size);
    doc.materials = doc.materials.map((m: { name: string }) => ({ name: m.name }));
    delete doc.images; delete doc.textures; delete doc.extensionsUsed; delete doc.extensionsRequired;
    doc.buffers = [{ byteLength: binary.byteLength, uri: 'data:application/octet-stream;base64,' + Buffer.from(binary).toString('base64') }];
    if (!globalThis.ProgressEvent) globalThis.ProgressEvent = class { constructor(type: string, data: object) { Object.assign(this, { type }, data); } } as unknown as typeof ProgressEvent;
    const textures: T.Texture[] = [];
    const parsed = await new GLTFLoader().parseAsync(JSON.stringify(doc), '');
    const parser = vi.spyOn(GLTFLoader.prototype, 'parseAsync').mockResolvedValue(parsed);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) =>
      new Response(new Blob([buffers.get(String(input).replace('/fire-variants/', ''))! as Uint8Array<ArrayBuffer>])));
    const texture = vi.spyOn(T.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => { const t = new T.Texture<HTMLImageElement>(); textures.push(t); return t; });
    try {
      const owner = await loadSourceTViewmodel({ baseUrl: '/fire-variants' });
      return { owner, restore: () => { parser.mockRestore(); fetcher.mockRestore(); texture.mockRestore(); textures.forEach((t) => t.dispose()); } };
    } catch (error) { parser.mockRestore(); fetcher.mockRestore(); texture.mockRestore(); throw error; }
  }

  it('registers every fire sequence the shipped rifle carries, and refuses a model missing one', async () => {
    const { owner: loaded, restore } = await owner();
    try {
      const model = loaded.createViewmodel();
      const variants = sourceViewmodelFireVariants(model);
      expect(variants.map((row) => row.sequence)).toEqual(SOURCE_WEAPON_FIRE_VARIANTS.vandal.map((row) => row.name));
      expect(variants.map((row) => row.weight)).toEqual(SOURCE_WEAPON_FIRE_VARIANTS.vandal.map((row) => row.weight));
      expect(variants.map((row) => row.pose)).toEqual(['fire', 'fire2', 'fire3']);
      // The clips come from the model's own names, not from a prefix the port assumes.
      expect(variants.map((row) => row.clip)).toEqual(['fire__ak47_fire1', 'fire__ak47_fire2', 'fire__ak47_fire3']);
      expect(inspectSourceViewmodel(model).clips.map((clip) => clip.name)).toContain('fire2');
      // The owner's guard is what refuses a model that lost one: the same model with the
      // second sequence named out of the table is a different set.
      expect(() => assertSourceFireVariants(model, [{ name: 'ak47_fire1', weight: 1 }], 'ak47')).toThrow('fire variant set changed');
      expect(() => assertSourceFireVariants(model, [...SOURCE_WEAPON_FIRE_VARIANTS.vandal.slice(0, 2)], 'ak47')).toThrow('fire variant set changed');
      loaded.disposeViewmodel(model);
    } finally { restore(); }
  });

  it('draws a whole shot from one variant, and over many shots from more than one', async () => {
    const { owner: loaded, restore } = await owner();
    try {
      const model = loaded.createViewmodel();
      const seen = new Set<string>();
      const shots = 80;
      let previous = 10;
      for (let shot = 0; shot < shots; shot++) {
        const poses = new Set<string>();
        for (const shotIdle of [0.05, 0.25, 0.5]) {
          updateSourceViewmodel(model, { alive: true, shotIdle } as Player, 1 / 60);
          poses.add(inspectSourceViewmodel(model).pose);
        }
        // One shot plays one variant all the way through, not a different one per frame.
        expect(poses.size, `shot ${shot} changed variant mid-shot: ${[...poses].join(',')}`).toBe(1);
        const pose = [...poses][0];
        expect(['fire', 'fire2', 'fire3']).toContain(pose);
        seen.add(pose);
        // Back above the shot clock, which is what starts the next shot.
        expect(previous).toBeGreaterThan(0.5);
        updateSourceViewmodel(model, { alive: true, shotIdle: previous } as Player, 1 / 60);
      }
      expect(seen.size, 'the shipped view model drew between its own fire sequences').toBeGreaterThan(1);
      loaded.disposeViewmodel(model);
    } finally { restore(); }
  });

  it('takes the rifles\' variants from the generated table, and leaves single-sequence weapons alone', () => {
    // Both shipped rifles name the model's own sequences in the model's own order.
    expect(M4A4_VIEWMODEL_CONTRACT.fireVariants).toEqual(SOURCE_WEAPON_FIRE_VARIANTS.m4a4);
    expect(M4A4_VIEWMODEL_CONTRACT.fireVariants!.map((row) => row.name)).toEqual(['shoot1', 'shoot2', 'shoot3']);
    expect(M4A4_VIEWMODEL_CONTRACT.clips.fire).toBe('fire__shoot1');
    // The Glock and the AWP give their fire activity one sequence, so they stay as they were.
    expect(SOURCE_WEAPON_FIRE_VARIANTS.glock).toHaveLength(1);
    expect(SOURCE_WEAPON_FIRE_VARIANTS.awp).toHaveLength(1);
  });

  it('is one draw rule, shared with the pistol clocks', () => {
    // Equal weights are one chance each, the last index covers the top of the range,
    // and the boundaries are the ones the integer draw actually reaches.
    expect(drawSourceActivityVariant([1, 1, 1], () => 0)).toBe(0);
    expect(drawSourceActivityVariant([1, 1, 1], () => 0.34)).toBe(1);
    expect(drawSourceActivityVariant([1, 1, 1], () => 0.67)).toBe(2);
    expect(drawSourceActivityVariant([1, 1, 1], () => 0.999)).toBe(2);
    expect(drawSourceActivityVariant([1, 3], () => 0.2)).toBe(0);
    expect(drawSourceActivityVariant([1, 3], () => 0.3)).toBe(1);
    expect(() => drawSourceActivityVariant([], () => 0)).toThrow('no variant to draw from');
    expect(() => drawSourceActivityVariant([0, 0], () => 0)).toThrow('sum to nothing');
    const counts = [0, 0, 0];
    const random = seeded(4242);
    for (let draw = 0; draw < 30000; draw++) counts[drawSourceActivityVariant([1, 1, 1], random)]++;
    for (const count of counts) expect(count / 30000).toBeGreaterThan(0.31);
    for (const count of counts) expect(count / 30000).toBeLessThan(0.36);
    // The clock the pistols run reports the same shares from the same weights.
    const clock = createSourceViewmodelAnimationDriver(SOURCE_USP_ANIMATION_DATA, SOURCE_USP_ACTIVITY_SEQUENCE,
      { inspect: 10, idle: 0, variants: SOURCE_USP_FIRE_VARIANTS, random: seeded(4242) });
    const state = clock.create(0);
    const sequences = [0, 0, 0, 0];
    for (let shot = 0; shot < 30000; shot++) sequences[clock.requestActivity(state, SOURCE_USP_FIRE_ACTIVITY).state.sequence - 3]++;
    // Same weights, same draw, same generator: the clock's counts are the shared rule's counts.
    expect(sequences.slice(0, 3)).toEqual(counts);
    expect(sequences[3]).toBe(0);
  });
});
