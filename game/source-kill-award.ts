/** The original cash one kill pays, read from the weapon the shipped file says it is.
 *
 * `items_game.txt` states `kill award` on a weapon or on a prefab it inherits from, and
 * the staged table carries every weapon's value with the owner and chain it resolved
 * through. This module is the only place that turns a weapon this build holds into that
 * cash: the weapon's own original row if the file defines it, otherwise the original base
 * award (`statted_item_base`, which is also what both shipped competitive configs set
 * `cash_player_killed_enemy_default` to).
 *
 * The table is validated when this module loads, so a regenerated or hand-edited table
 * that contradicts itself fails loudly at import instead of paying the wrong cash in a
 * live round.
 */
import { SOURCE_KILL_AWARD_LIMITATIONS, SOURCE_KILL_AWARD_TABLE,
  SOURCE_KILL_AWARD_DEFAULT, SOURCE_KILL_AWARD_DEFAULT_OWNER } from './source-kill-award-table.js';
import { WEAPONS, type Utility, type WeaponId } from './types.js';

export { SOURCE_KILL_AWARD_LIMITATIONS, SOURCE_KILL_AWARD_DEFAULT, SOURCE_KILL_AWARD_DEFAULT_OWNER };
/** The shape the staged table has: one award per original prefab that states one, one per
 * original weapon, and the port's own mapping onto both. */
export type SourceKillAwardRow = { award: number; owner: string };
export type SourceKillAwardTable = {
  format: string; sourceSha256: string;
  default: { owner: string; award: number };
  prefabAwards: Record<string, number>;
  weapons: Record<string, SourceKillAwardRow & { chain: readonly string[] }>;
  portWeapons: Record<string, SourceKillAwardRow & { originalWeapon: string }>;
  portUtilities: Record<string, SourceKillAwardRow & { originalWeapon: string }>;
};

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid staged kill-award table: ${message}`);
}

/** The staged table has to keep every internal relationship the export established: a
 * weapon's award is its owner's award, the chain ends at that owner, and every weapon or
 * utility this build maps is one the file actually defines. */
export function validateSourceKillAwardTable(table: SourceKillAwardTable): void {
  check(table.format === 'source-kill-award-table-v1', `format is ${table.format}`);
  check(/^[0-9a-f]{64}$/.test(table.sourceSha256), 'the source file hash is missing');
  const { owner, award } = table.default;
  check(Number.isInteger(award) && award >= 0, `the default award ${award} is not a cash amount`);
  check(table.prefabAwards[owner] === award,
    `the default owner ${owner} states ${table.prefabAwards[owner]}, not the default ${award}`);
  for (const [name, value] of Object.entries(table.prefabAwards)) {
    check(Number.isInteger(value) && value >= 0, `${name} states ${value}`);
  }
  for (const [name, row] of Object.entries(table.weapons)) {
    check(Number.isInteger(row.award) && row.award >= 0, `${name} states ${row.award}`);
    check(table.prefabAwards[row.owner] === row.award,
      `${name} says ${row.award} but its owner ${row.owner} states ${table.prefabAwards[row.owner]}`);
    check(row.chain.length > 0 && row.chain[row.chain.length - 1] === row.owner,
      `${name}'s chain ${row.chain.join(' > ')} does not end at its owner ${row.owner}`);
    check(row.chain[0] === name, `${name}'s chain does not start at the weapon itself`);
  }
  const mapped = [...Object.entries(table.portWeapons), ...Object.entries(table.portUtilities)];
  check(mapped.length > 0, 'no weapon of this build is mapped at all');
  for (const [key, row] of mapped) {
    const original = table.weapons[row.originalWeapon];
    check(original !== undefined, `${key} maps to ${row.originalWeapon}, which the file does not define`);
    check(original.award === row.award && original.owner === row.owner,
      `${key} states ${row.award} from ${row.owner} but ${row.originalWeapon} states `
      + `${original.award} from ${original.owner}`);
  }
  for (const key of Object.keys(table.portWeapons)) check(key in WEAPONS, `${key} is not a weapon of this build`);
  for (const key of Object.keys(table.portUtilities)) {
    check(key === 'he' || key === 'smoke' || key === 'flash', `${key} is not a utility of this build`);
  }
}

validateSourceKillAwardTable(SOURCE_KILL_AWARD_TABLE);

/** The original cash the weapon (or the utility) this build holds pays for one kill. A
 * weapon the shipped file does not define — this build's own placeholders — and a utility
 * that deals no damage keep the original base award rather than another class's. */
export function sourceKillAward(key: WeaponId | Utility | string): number {
  const weapons = SOURCE_KILL_AWARD_TABLE.portWeapons as Record<string, { award: number } | undefined>;
  const utilities = SOURCE_KILL_AWARD_TABLE.portUtilities as Record<string, { award: number } | undefined>;
  return (weapons[key] ?? utilities[key])?.award ?? SOURCE_KILL_AWARD_TABLE.default.award;
}

/** The original item each of this build's weapons is, for the audit. */
export function sourceKillAwardOriginal(key: WeaponId | Utility | string): string | null {
  const weapons = SOURCE_KILL_AWARD_TABLE.portWeapons as Record<string, { originalWeapon: string } | undefined>;
  const utilities = SOURCE_KILL_AWARD_TABLE.portUtilities as Record<string, { originalWeapon: string } | undefined>;
  return (weapons[key] ?? utilities[key])?.originalWeapon ?? null;
}
