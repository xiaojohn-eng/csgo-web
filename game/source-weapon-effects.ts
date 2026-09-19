/** The original per-weapon effect choices.
 *
 * The original keeps them in `scripts/items/items_game.txt`, inside each weapon's
 * own `visuals` block, and it names the first-person and third-person systems
 * separately. `scripts/export-source-muzzle-flash-map.py` reads that file out of
 * the shipped game and `scripts/stage-source-weapon-effects.py` stages only the
 * weapons this build ships, so every string the client uses is traceable to the
 * original file and nothing is inferred from a weapon's name.
 */
import type { WeaponId } from './types';

export type SourceWeaponEffects = {
  /** Original `muzzle_flash_effect_1st_person` system name. */
  muzzleFlash1st: string;
  /** Original `muzzle_flash_effect_3rd_person` system name: what other players
   * see on the world weapon. */
  muzzleFlash3rd: string;
  /** Original `heat_effect` (the muzzle smoke system). */
  heat: string;
  /** Original `eject_brass_effect` (the shell casing system). */
  shell: string;
  /** Original `tracer_effect` system name. */
  tracer: string;
  /** Original `weapon_type`, as the original spells it. */
  type: string;
};
export type SourceWeaponEffectMap = { format: 'source-weapon-effects-v1'; build: number;
  sourceFile: string; sourceFileSha256: string; weapons: ReadonlyMap<string, SourceWeaponEffects> };

const FIELDS: readonly [keyof SourceWeaponEffects, string][] = [['muzzleFlash1st', 'muzzle_flash_effect_1st_person'],
  ['muzzleFlash3rd', 'muzzle_flash_effect_3rd_person'], ['heat', 'heat_effect'], ['shell', 'eject_brass_effect'],
  ['tracer', 'tracer_effect'], ['type', 'weapon_type']];
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

/** Parses and validates the staged original effect map. */
export function parseSourceWeaponEffectMap(raw: unknown): SourceWeaponEffectMap {
  check(raw && typeof raw === 'object', 'Malformed original weapon effect data');
  const data = raw as Record<string, unknown>;
  check(data.format === 'source-weapon-effects-v1', 'Unexpected original weapon effect format');
  check(data.build === 12426148, 'Unexpected original weapon effect build');
  check(typeof data.sourceFile === 'string' && /^[0-9a-f]{64}$/.test(String(data.sourceFileSha256)),
    'Original weapon effect data without its source file receipt');
  check(data.weapons && typeof data.weapons === 'object', 'Original weapon effect data without weapons');
  const weapons = new Map<string, SourceWeaponEffects>();
  for (const [weapon, row] of Object.entries(data.weapons as Record<string, unknown>)) {
    check(row && typeof row === 'object', `Original weapon effect row ${weapon} is malformed`);
    const source = row as Record<string, unknown>;
    const effects = {} as SourceWeaponEffects;
    for (const [field, key] of FIELDS) {
      check(typeof source[key] === 'string' && (source[key] as string).length > 0,
        `Original weapon effect ${weapon} is missing ${key}`);
      effects[field] = source[key] as string;
    }
    weapons.set(weapon, effects);
  }
  return { format: 'source-weapon-effects-v1', build: data.build as number, sourceFile: data.sourceFile as string,
    sourceFileSha256: data.sourceFileSha256 as string, weapons };
}

/** The original effects of one shipped weapon, or null when the original file has
 * no row for it (an absent value is never permission to substitute another). */
export function sourceWeaponEffects(map: SourceWeaponEffectMap, weapon: WeaponId): SourceWeaponEffects | null {
  return map.weapons.get(weapon) ?? null;
}

/** Loads the staged original effect map that ships beside the other original
 * data. */
export async function loadSourceWeaponEffectMap(options: { baseUrl?: string; signal?: AbortSignal } = {}): Promise<SourceWeaponEffectMap> {
  const url = new URL(options.baseUrl ?? '/source/csgo-12426148/weapon-effects/effect-map.json',
    globalThis.location?.href ?? 'http://127.0.0.1/');
  const response = await fetch(url.href, { signal: options.signal, cache: 'no-cache' });
  if (!response.ok) throw new Error(`Source weapon effect data HTTP ${response.status}`);
  return parseSourceWeaponEffectMap(await response.json());
}
