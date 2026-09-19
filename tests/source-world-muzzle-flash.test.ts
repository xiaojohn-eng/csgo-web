import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSourceWeaponEffectMap, sourceWeaponEffects } from '../game/source-weapon-effects';
import { SOURCE_STAGED_WORLD_MUZZLE_SYSTEMS, SOURCE_WORLD_FIRE_ACTIVITY, SOURCE_WORLD_MUZZLE_ATTACHMENT, sourceWorldAwpMuzzleSeeds,
  SOURCE_WORLD_PISTOL_WEAPONS, sourceWorldMuzzleFlash, sourceWorldMuzzleFlashSeeds,
  sourceWorldMuzzleTrigger, sourceWorldRifleMuzzleSeeds } from '../game/source-world-muzzle-flash';

const MAP = 'public/source/csgo-12426148/weapon-effects/effect-map.json';
const available = existsSync(MAP);
const raw = () => JSON.parse(readFileSync(MAP, 'utf8'));
const effectsFor = (weapon: string) => sourceWeaponEffects(parseSourceWeaponEffectMap(raw()), weapon as never)!;

describe.skipIf(!available)('original per-weapon effect map', () => {
  it('parses the staged original mapping with its source receipt', () => {
    const map = parseSourceWeaponEffectMap(raw());
    expect(map.format).toBe('source-weapon-effects-v1');
    expect(map.build).toBe(12426148);
    expect(map.sourceFile).toBe('scripts/items/items_game.txt');
    expect(map.sourceFileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect([...map.weapons.keys()].sort()).toEqual(['awp', 'deagle', 'glock', 'm4a4', 'usp', 'vandal']);
  });

  it('keeps the original first- and third-person systems distinct where the original does', () => {
    // The original names one system per weapon per person; the pistol family
    // shares one, the assault rifle family shares one, and the AWP has its own.
    expect(effectsFor('vandal').muzzleFlash1st).toBe('weapon_muzzle_flash_assaultrifle');
    expect(effectsFor('vandal').muzzleFlash3rd).toBe('weapon_muzzle_flash_assaultrifle');
    expect(effectsFor('m4a4').muzzleFlash3rd).toBe('weapon_muzzle_flash_assaultrifle');
    expect(effectsFor('awp').muzzleFlash3rd).toBe('weapon_muzzle_flash_awp');
    for (const weapon of ['glock', 'usp', 'deagle']) expect(effectsFor(weapon).muzzleFlash3rd).toBe('weapon_muzzle_flash_pistol');
    // The other original effects of the same row are kept for the same reason.
    expect(effectsFor('vandal')).toMatchObject({ shell: 'weapon_shell_casing_rifle', tracer: 'weapon_tracers_assrifle', heat: 'weapon_muzzle_smoke' });
    expect(effectsFor('awp').shell).toBe('weapon_shell_casing_50cal');
    expect(effectsFor('glock').tracer).toBe('weapon_tracers_pistol');
  });

  it('rejects malformed or incomplete effect data instead of defaulting', () => {
    const good = raw() as Record<string, unknown>;
    expect(() => parseSourceWeaponEffectMap({ ...good, format: 'other' })).toThrow();
    expect(() => parseSourceWeaponEffectMap({ ...good, build: 1 })).toThrow();
    expect(() => parseSourceWeaponEffectMap({ ...good, sourceFileSha256: 'nope' })).toThrow();
    const clone = () => JSON.parse(JSON.stringify(good));
    const missing = clone();
    delete missing.weapons.glock.tracer_effect;
    expect(() => parseSourceWeaponEffectMap(missing)).toThrow();
    const empty = clone();
    empty.weapons.glock.tracer_effect = '';
    expect(() => parseSourceWeaponEffectMap(empty)).toThrow();
  });
});

describe('original third-person muzzle flash decision', () => {
  const pistol = effectsFor('glock'), awp = effectsFor('awp');
  const firing = { kind: 'fire-layer' as const, fireWeight: 1, fireCycle: .1 };

  it('starts a shot on a real transition, never on a firing level', () => {
    // Nothing fired yet.
    expect(sourceWorldMuzzleFlash({ kind: 'fire-layer' }, pistol, false, undefined).shot).toBe(false);
    // Weight rises from zero: the first shot.
    const first = sourceWorldMuzzleFlash(firing, pistol, false, { firing: false, mark: 0, shots: 0 });
    expect(first.shot).toBe(true); expect(first.reason).toBe('ok');
    expect(first.cursor.shots).toBe(1);
    // The same shot seen again is not a new one.
    const again = sourceWorldMuzzleFlash({ kind: 'fire-layer', fireWeight: 1, fireCycle: .4 }, pistol, false, first.cursor);
    expect(again.shot).toBe(false); expect(again.reason).toBe('already-counted');
    // Inside one original shot animation the cycle only advances.
    const later = sourceWorldMuzzleFlash({ kind: 'fire-layer', fireWeight: 1, fireCycle: .8 }, pistol, false, again.cursor);
    expect(later.shot).toBe(false);
    // The next original shot restarts the animation from its first frame, so the
    // cycle going backwards is the shot, however far the sampling grid skipped.
    const wrapped = sourceWorldMuzzleFlash({ kind: 'fire-layer', fireWeight: 1, fireCycle: .05 }, pistol, false, later.cursor);
    expect(wrapped.shot).toBe(true); expect(wrapped.cursor.shots).toBe(2);
    const skipped = sourceWorldMuzzleFlash({ kind: 'fire-layer', fireWeight: 1, fireCycle: .05 }, pistol, false, again.cursor);
    expect(skipped.shot).toBe(true); expect(skipped.cursor.shots).toBe(2);
  });

  it('uses each staged original system for its own family and refuses to substitute for the rest', () => {
    const decision = sourceWorldMuzzleFlash(firing, pistol, false, undefined);
    expect(decision.system).toBe('weapon_muzzle_flash_pistol');
    expect(SOURCE_STAGED_WORLD_MUZZLE_SYSTEMS).toContain(decision.system);
    // The rifle family has its own staged original system, and the pistol's graph
    // is never a stand-in for it.
    for (const weapon of ['vandal', 'm4a4'] as const) {
      const row = sourceWorldMuzzleFlash(firing, effectsFor(weapon), false, undefined);
      expect(row.shot).toBe(true); expect(row.reason).toBe('ok');
      expect(row.system).toBe('weapon_muzzle_flash_assaultrifle');
      expect(SOURCE_STAGED_WORLD_MUZZLE_SYSTEMS).toContain(row.system);
      expect(row.system).not.toBe(decision.system);
    }
    // The AWP dispatches the hunting rifle's continuous flame instead of a vent — its
    // own original chain, now staged and drawn from its own graph and textures.
    const awpRow = sourceWorldMuzzleFlash(firing, awp, false, undefined);
    expect(awpRow.shot).toBe(true); expect(awpRow.system).toBe('weapon_muzzle_flash_awp');
    expect(awpRow.reason).toBe('ok');
    expect(SOURCE_STAGED_WORLD_MUZZLE_SYSTEMS).toContain(awpRow.system);
    // Its own chain indexes the original table under its own seed, so a shot's seed is
    // pinned to the shooter and the shot number on both ends.
    expect(sourceWorldAwpMuzzleSeeds('shooter', 3)).toEqual(sourceWorldAwpMuzzleSeeds('shooter', 3));
    expect(sourceWorldAwpMuzzleSeeds('shooter', 3)).not.toEqual(sourceWorldAwpMuzzleSeeds('shooter', 4));
    expect(sourceWorldAwpMuzzleSeeds('shooter', 3)).not.toEqual(sourceWorldRifleMuzzleSeeds('shooter', 3));
    const [awpSeed] = Object.values(sourceWorldAwpMuzzleSeeds('shooter', 3));
    expect(awpSeed).toBeGreaterThanOrEqual(0); expect(awpSeed).toBeLessThanOrEqual(4095);
    // A weapon with no original row is never given someone else's effect.
    expect(sourceWorldMuzzleFlash(firing, null, false, undefined)).toMatchObject({ shot: true, system: null, reason: 'no-original-effect' });
  });

  it('treats the original world fire action as the shot for the pistol family', () => {
    // The pistol rigs publish no fire layer at all: their world fire animation is
    // driven by the authoritative action, and the original increments its
    // generation once per action.
    const action = (activity: number, generation: number, time: number) =>
      ({ kind: 'world-action' as const, activity, time, generation });
    expect(sourceWorldMuzzleFlash(action(192, 1, 5), pistol, false, undefined))
      .toMatchObject({ shot: true, system: 'weapon_muzzle_flash_pistol', reason: 'ok' });
    // A non-firing activity is not a shot even on its first frame.
    expect(sourceWorldMuzzleFlash(action(194, 2, 6), pistol, false, undefined))
      .toMatchObject({ shot: false, reason: 'no-fire' });
    // The same action seen again is not a new shot; the next action is.
    const first = sourceWorldMuzzleFlash(action(192, 1, 5), pistol, false, undefined);
    expect(sourceWorldMuzzleFlash(action(192, 1, 5), pistol, false, first.cursor).shot).toBe(false);
    const second = sourceWorldMuzzleFlash(action(192, 2, 5.4), pistol, false, first.cursor);
    expect(second.shot).toBe(true); expect(second.cursor.shots).toBe(2);
    expect(SOURCE_WORLD_FIRE_ACTIVITY).toBe(192);
  });

  it('reads each rig\'s own authoritative fire state and invents nothing without it', () => {
    // Pistol family: the world fire action of that weapon's runtime.
    expect(sourceWorldMuzzleTrigger('glock', { sourceGlock: { action: { activity: 192, time: 3, generation: 7 } } }))
      .toEqual({ kind: 'world-action', activity: 192, time: 3, generation: 7 });
    expect(sourceWorldMuzzleTrigger('usp', { sourceUSP: { action: { activity: 192, time: 4, generation: 1 } } })).toMatchObject({ activity: 192 });
    expect(sourceWorldMuzzleTrigger('deagle', { sourceDeagle: { action: { activity: 192, time: 5, generation: 2 } } })).toMatchObject({ activity: 192 });
    // Character and AWP rigs: the fire layer itself, nested under the body pose.
    expect(sourceWorldMuzzleTrigger('vandal', { sourcePose: { fireWeight: 1, fireCycle: .3 } })).toEqual({ kind: 'fire-layer', fireWeight: 1, fireCycle: .3 });
    expect(sourceWorldMuzzleTrigger('awp', { sourceAWPPose: { body: { fireWeight: 1, fireCycle: .2 } } })).toEqual({ kind: 'fire-layer', fireWeight: 1, fireCycle: .2 });
    // Nothing to read is reported as nothing, never as a shot.
    expect(sourceWorldMuzzleTrigger('glock', {})).toBeNull();
    expect(sourceWorldMuzzleTrigger('vandal', {})).toBeNull();
  });

  it('shows nothing for the suppressed original alternate field', () => {
    const decision = sourceWorldMuzzleFlash(firing, effectsFor('usp'), true, undefined);
    expect(decision).toMatchObject({ shot: true, system: null, reason: 'suppressed' });
    expect(sourceWorldMuzzleFlash(firing, effectsFor('usp'), false, undefined).system).toBe('weapon_muzzle_flash_pistol');
    expect(SOURCE_WORLD_PISTOL_WEAPONS).toEqual(['glock', 'usp', 'deagle']);
    expect(SOURCE_WORLD_MUZZLE_ATTACHMENT).toBe('muzzle_flash');
  });

  it('seeds the original random table from the shooter and its own shot number', () => {
    const a = sourceWorldMuzzleFlashSeeds('player-1', 1), b = sourceWorldMuzzleFlashSeeds('player-1', 1);
    expect(a).toEqual(b);
    const next = sourceWorldMuzzleFlashSeeds('player-1', 2), other = sourceWorldMuzzleFlashSeeds('player-2', 1);
    expect(next).not.toEqual(a); expect(other).not.toEqual(a);
    for (const seeds of [a, next, other]) for (const value of [seeds.main, seeds.core]) {
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThan(4096);
    }
    // The rifle's own original system indexes the same table, from the same shot.
    const vent = sourceWorldRifleMuzzleSeeds('player-1', 1);
    expect(vent).toEqual(sourceWorldRifleMuzzleSeeds('player-1', 1));
    expect(vent).not.toEqual(sourceWorldRifleMuzzleSeeds('player-1', 2));
    expect(vent).not.toEqual(sourceWorldRifleMuzzleSeeds('player-2', 1));
    expect(Number.isSafeInteger(vent.vent)).toBe(true);
    expect(vent.vent).toBeGreaterThanOrEqual(0); expect(vent.vent).toBeLessThan(4096);
  });
});
