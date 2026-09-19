/** Which original first-person muzzle flash this build draws for a shot, decided by the
 * weapon's own `muzzle_flash_effect_1st_person` and by nothing else.
 *
 * `items_game.txt` names the first-person system per weapon (see
 * `source-weapon-effects.ts`), and the original is free to name a different one there than
 * for the third person. All three shipped names are staged in the viewmodel scene today:
 * the pistol family's own sprite field (`weapon_muzzle_flash_pistol`, drawn by the pistol
 * particle port), the rifle family's own chain (`weapon_muzzle_flash_assaultrifle`, its
 * `_vent` sprite flash with the `_main` flame, glow and continuous flame, drawn by the
 * rifle muzzle port) and the AWP's own chain (`weapon_muzzle_flash_awp`, the hunting
 * rifle's continuous flame and its glow, drawn by the AWP muzzle port). A name this build
 * has not staged returns null, which is not permission to draw another weapon's system or
 * to keep a look-alike in its place.
 */
import type { WeaponId } from './types';

/** The original first-person systems this build has staged, per weapon family. */
export const SOURCE_FIRST_PERSON_PISTOL_SYSTEM = 'weapon_muzzle_flash_pistol';
export const SOURCE_FIRST_PERSON_RIFLE_SYSTEM = 'weapon_muzzle_flash_assaultrifle';
export const SOURCE_FIRST_PERSON_AWP_SYSTEM = 'weapon_muzzle_flash_awp';
export const SOURCE_STAGED_FIRST_PERSON_MUZZLE_SYSTEMS: readonly string[] =
  [SOURCE_FIRST_PERSON_PISTOL_SYSTEM, SOURCE_FIRST_PERSON_RIFLE_SYSTEM, SOURCE_FIRST_PERSON_AWP_SYSTEM];

/** Which ported program draws a staged first-person system. */
export type SourceFirstPersonMuzzleRenderer = 'pistol-field' | 'rifle-vent' | 'awp-chain';
export type SourceFirstPersonMuzzle = { weapon: WeaponId; system: string;
  renderer: SourceFirstPersonMuzzleRenderer };

/** The original first-person system of one weapon, or null when the original names one this
 * build has not staged. The weapon's own name is what decides; the weapon's id is only
 * carried back out for the caller's bookkeeping. */
export function sourceFirstPersonMuzzleSystem(effects: { muzzleFlash1st: string } | null,
  weapon: WeaponId): SourceFirstPersonMuzzle | null {
  if (!effects) return null;
  const system = effects.muzzleFlash1st;
  if (system === SOURCE_FIRST_PERSON_PISTOL_SYSTEM) return { weapon, system, renderer: 'pistol-field' };
  if (system === SOURCE_FIRST_PERSON_RIFLE_SYSTEM) return { weapon, system, renderer: 'rifle-vent' };
  if (system === SOURCE_FIRST_PERSON_AWP_SYSTEM) return { weapon, system, renderer: 'awp-chain' };
  return null;
}
