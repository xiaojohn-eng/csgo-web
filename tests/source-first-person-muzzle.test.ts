import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSourceWeaponEffectMap, sourceWeaponEffects } from '../game/source-weapon-effects';
import { SOURCE_FIRST_PERSON_AWP_SYSTEM, SOURCE_FIRST_PERSON_PISTOL_SYSTEM,
  SOURCE_FIRST_PERSON_RIFLE_SYSTEM, SOURCE_STAGED_FIRST_PERSON_MUZZLE_SYSTEMS,
  sourceFirstPersonMuzzleSystem } from '../game/source-first-person-muzzle';
import { SOURCE_AWP_MUZZLE_ROOT, SOURCE_RIFLE_MUZZLE_ROOT } from '../game/source-rifle-muzzle-particles';

const MAP = 'public/source/csgo-12426148/weapon-effects/effect-map.json';
const available = existsSync(MAP);
const map = () => parseSourceWeaponEffectMap(JSON.parse(readFileSync(MAP, 'utf8')));
const effectsFor = (weapon: string) => sourceWeaponEffects(map(), weapon as never);

describe.skipIf(!available)('which original first-person muzzle a shot draws', () => {
  it('follows the weapon\'s own first-person name, not its third-person one', () => {
    // The two original names are separate columns of the same row, and the AWP's own
    // first-person name is the one this build draws in the viewmodel scene.
    expect(effectsFor('awp')!.muzzleFlash1st).toBe(SOURCE_FIRST_PERSON_AWP_SYSTEM);
    expect(effectsFor('awp')!.muzzleFlash3rd).toBe(SOURCE_FIRST_PERSON_AWP_SYSTEM);
    for (const weapon of ['glock', 'usp', 'deagle']) {
      const effects = effectsFor(weapon)!;
      expect(effects.muzzleFlash1st).toBe(SOURCE_FIRST_PERSON_PISTOL_SYSTEM);
      expect(effects.muzzleFlash3rd).toBe(SOURCE_FIRST_PERSON_PISTOL_SYSTEM);
    }
  });

  it('maps each family to its own ported program, by the name its own row gives', () => {
    expect(sourceFirstPersonMuzzleSystem(effectsFor('awp'), 'awp'))
      .toEqual({ weapon: 'awp', system: SOURCE_FIRST_PERSON_AWP_SYSTEM, renderer: 'awp-chain' });
    for (const weapon of ['glock', 'usp', 'deagle'] as const) expect(sourceFirstPersonMuzzleSystem(effectsFor(weapon), weapon))
      .toEqual({ weapon, system: SOURCE_FIRST_PERSON_PISTOL_SYSTEM, renderer: 'pistol-field' });
    for (const weapon of ['vandal', 'm4a4'] as const) expect(sourceFirstPersonMuzzleSystem(effectsFor(weapon), weapon))
      .toEqual({ weapon, system: SOURCE_FIRST_PERSON_RIFLE_SYSTEM, renderer: 'rifle-vent' });
    // The rifle family's own first-person name is the one its third-person column also
    // gives, and it resolves to the rifle's own program, never to the pistol's.
    expect(effectsFor('vandal')!.muzzleFlash1st).toBe(SOURCE_FIRST_PERSON_RIFLE_SYSTEM);
    expect(sourceFirstPersonMuzzleSystem(effectsFor('vandal'), 'vandal')!.renderer)
      .not.toBe(sourceFirstPersonMuzzleSystem(effectsFor('glock'), 'glock')!.renderer);
  });

  it('covers every shipped weapon row, so no family silently draws nothing', () => {
    // Every weapon this build ships is in the original map, and each row's first-person
    // name is one of the three this build has staged. A row that is not covered would keep
    // the port's own placeholder, which is a real difference and would show up here.
    for (const [weapon, effects] of map().weapons) {
      expect(SOURCE_STAGED_FIRST_PERSON_MUZZLE_SYSTEMS).toContain(effects.muzzleFlash1st);
      expect(sourceFirstPersonMuzzleSystem(effects, weapon as never)).not.toBeNull();
    }
    expect([...map().weapons.keys()].sort()).toEqual(['awp', 'deagle', 'glock', 'm4a4', 'usp', 'vandal']);
  });

  it('refuses to answer without the original row instead of guessing a replacement', () => {
    expect(sourceFirstPersonMuzzleSystem(null, 'awp')).toBeNull();
    expect(sourceFirstPersonMuzzleSystem({ muzzleFlash1st: 'weapon_muzzle_flash_awp_fp' }, 'awp')).toBeNull();
    expect(sourceFirstPersonMuzzleSystem({ muzzleFlash1st: '' }, 'glock')).toBeNull();
    // A name the original does not use is what a malformed or rewritten row would produce;
    // the staged list is what decides, so a blank or unknown name can never reach a program.
    expect(SOURCE_STAGED_FIRST_PERSON_MUZZLE_SYSTEMS).not.toContain('');
    expect(SOURCE_STAGED_FIRST_PERSON_MUZZLE_SYSTEMS).toHaveLength(3);
  });

  it('reuses one staged name for the AWP\'s two instances rather than inventing a second', () => {
    // The original names one system per person, and for the AWP both names are the same
    // one. The port therefore draws the shooter's own flash from the same system the world
    // instance draws, anchored on the viewmodel's own muzzle attachment; it does not need
    // a second system name and does not borrow the rifle's.
    expect(SOURCE_AWP_MUZZLE_ROOT).toBe(SOURCE_FIRST_PERSON_AWP_SYSTEM);
    expect(SOURCE_AWP_MUZZLE_ROOT).not.toBe(SOURCE_FIRST_PERSON_RIFLE_SYSTEM);
    expect(SOURCE_RIFLE_MUZZLE_ROOT).toBe(SOURCE_FIRST_PERSON_RIFLE_SYSTEM);
  });
});
