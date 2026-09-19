/** The original finish a player has selected, as it travels between clients.
 *
 * The id, the weapon and the wear window are the original ones, taken from the generated
 * finish table (`scripts/stage-source-paint-kits.py` writes it from the staged catalogue),
 * so the client and the server refuse the same values without either of them having to
 * fetch the catalogue: an id that is not an original finish of that weapon this port can
 * compose, a finish named for one weapon and worn by another, or a wear outside that
 * finish's own original window, never travels.
 */
// The server build resolves ESM paths, so the extension is explicit here the same way it
// is in the other modules the server imports.
import { SOURCE_FINISH_TABLE_FORMAT, SOURCE_FINISHES, SOURCE_FINISH_WEAPONS } from "./source-finish-table.js";

if (SOURCE_FINISH_TABLE_FORMAT !== "source-finish-table-v1")
  throw Error("Original finish table format differs");

/** A weapon whose original finishes this port can compose, named the way the port names it. */
export type SourceFinishWeaponId = (typeof SOURCE_FINISH_WEAPONS)[number]["id"];
export type SourceWeaponFinish = {
  weapon: SourceFinishWeaponId;
  paintKitId: number;
  seed: number;
  wear: number;
};
const FINISH_WEAPON_IDS = SOURCE_FINISH_WEAPONS.map((entry) => entry.id) as readonly string[];
type FinishEntry = { readonly paintKitId: number; readonly wearMinimum: number; readonly wearMaximum: number };
const FINISHES: Record<string, readonly FinishEntry[]> = SOURCE_FINISHES;

export function sourceFinishWeapon(weapon: unknown): SourceFinishWeaponId | null {
  return typeof weapon === "string" && FINISH_WEAPON_IDS.includes(weapon)
    ? (weapon as SourceFinishWeaponId)
    : null;
}

/** The original wear window of one finish of one weapon this port can compose, or null.
 * The weapon is part of the lookup because the same original id is a different finish on
 * another weapon, and offering one weapon's window for the other's finish would let a wear
 * through that the original never presents for it. */
export function sourceFinishWearWindow(weapon: unknown, paintKitId: unknown) {
  const id = sourceFinishWeapon(weapon);
  if (!id || !Number.isInteger(paintKitId)) return null;
  return FINISHES[id].find((finish) => finish.paintKitId === paintKitId) ?? null;
}

/** The original finishes one weapon offers that this port can compose. */
export function sourceFinishIds(weapon: unknown): readonly number[] {
  const id = sourceFinishWeapon(weapon);
  return id ? FINISHES[id].map((finish) => finish.paintKitId) : [];
}

export function validSourceWeaponFinish(value: unknown): SourceWeaponFinish | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const weapon = sourceFinishWeapon(v.weapon);
  if (!weapon || typeof v.paintKitId !== "number") return null;
  const window = sourceFinishWearWindow(weapon, v.paintKitId);
  if (!window) return null;
  if (typeof v.seed !== "number" || !Number.isInteger(v.seed) || v.seed < 0 || v.seed > 1000) return null;
  if (typeof v.wear !== "number" || !Number.isFinite(v.wear)) return null;
  // Inventory attributes and the original wear limits are float32. Compare in
  // that same domain before returning the wire value: .06 becomes .0599999987,
  // and must survive the renderer/server validating the accepted packet again.
  const wear = Math.fround(v.wear);
  if (!Number.isFinite(wear) || wear < Math.fround(window.wearMinimum) || wear > Math.fround(window.wearMaximum)) return null;
  return { weapon, paintKitId: v.paintKitId, seed: v.seed, wear };
}

export function sourceWeaponFinishKey(value: SourceWeaponFinish | null | undefined) {
  return value
    ? `${value.weapon}:${value.paintKitId}:${value.seed}:${Math.fround(value.wear)}`
    : "default";
}
