/** The original paint-kit catalogue for the weapons this port implements.
 *
 * The staged document is derived from the original install's own `items_game.txt` and
 * its own localisation files (see `scripts/stage-source-paint-kits.py`), and it ships
 * with the digest of the catalogue it came from. This module fetches it, checks it
 * against the staged manifest, and validates its shape, so a finish the original does
 * not offer cannot reach the game and a changed original is refused rather than
 * partially applied. Nothing here is named or coloured by this port.
 */
import { sourceSha256 } from "./source-sha256";
import type { SourceRedlineKit } from "./source-redline-seed";
import manifest from "./source-paint-kit-resources.json";
import {sourcePaintTextureScale} from './source-paint-geometry';

export const SOURCE_PAINT_KIT_FORMAT = "source-paint-kits-v1";
export const SOURCE_PAINT_KIT_RESOURCE = "paint-kits.json";

/** How the original's own install resolves the texture a finish names. */
export type SourcePaintKitResolution = "unique" | "ambiguous" | "unresolved";
export interface SourcePaintKitTextureReference {
  field: string;
  /** The value the original's own paint-kit block carries. */
  sourceValue: string;
  resolution: SourcePaintKitResolution;
  candidates: readonly string[];
}
export interface SourcePaintKit {
  /** The original's paint-kit id, as a string. */
  id: string;
  /** The original's internal name, e.g. `cu_ak47_cobra`. */
  name: string;
  /** The original's own display name in each language. */
  englishName: string;
  chineseName: string;
  rarity: string;
  rarityValue: number;
  style: number;
  pattern: string;
  patternScale: number;
  patternOffsetX: readonly [number, number];
  patternOffsetY: readonly [number, number];
  patternRotate: readonly [number, number];
  seed: number;
  wearMinimum: number;
  wearMaximum: number;
  wearDefault: number;
  /** The original's four palette colours, three or four components each. */
  colours: readonly (readonly number[])[];
  phongExponent: number;
  phongIntensity: number;
  /** The original's own `phongalbedoboost`; -1 means "keep the weapon's". */
  phongAlbedoBoost: number;
  onlyFirstMaterial: number;
  ignoreWeaponSizeScale: number;
  textureReferences: readonly SourcePaintKitTextureReference[];
}
export interface SourcePaintKitRarity {
  value: number;
  color: string | null;
  locKey: string | null;
  englishLabel: string;
  chineseLabel: string;
}
export interface SourcePaintKitWeapon {
  weapon: string;
  finishes: readonly SourcePaintKit[];
}
export interface SourcePaintKitCatalogue {
  format: string;
  status: string;
  cataloguedFrom: {
    format: string;
    manifestSha256: string;
    sourceioCommit: string | null;
    catalogueSha256: string;
  };
  rarities: Readonly<Record<string, SourcePaintKitRarity>>;
  defaultKitId: string;
  factory: SourcePaintKit;
  weapons: readonly SourcePaintKitWeapon[];
  boundaries: readonly string[];
}

function fail(message: string): never {
  throw Error("Original paint kits: " + message);
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown, where: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${where} is not a finite number`);
  return value;
};
const integer = (value: unknown, where: string): number => {
  const parsed = finite(value, where);
  if (!Number.isInteger(parsed)) fail(`${where} is not an integer`);
  return parsed;
};
const text = (value: unknown, where: string): string => {
  if (typeof value !== "string" || !value) fail(`${where} is not a non-empty string`);
  return value;
};

/** One finish, validated field by field. A finish the original describes differently is
 * refused rather than repaired. */
function validateFinish(value: unknown, where: string, rarities: Readonly<Record<string, SourcePaintKitRarity>>): SourcePaintKit {
  if (!isRecord(value)) fail(`${where} is not a finish`);
  const id = text(value.id, `${where} id`);
  const colours = value.colours;
  if (!Array.isArray(colours) || colours.length !== 4) fail(`${where} does not carry four original colours`);
  const parsedColours = colours.map((entry, index) => {
    if (!Array.isArray(entry) || (entry.length !== 3 && entry.length !== 4))
      fail(`${where} colour ${index} is not an original RGB(A) colour`);
    return entry.map((component, channel) => {
      const parsed = integer(component, `${where} colour ${index} channel ${channel}`);
      if (parsed < 0 || parsed > 255) fail(`${where} colour ${index} channel ${channel} is outside 0..255`);
      return parsed;
    });
  });
  const rarity = text(value.rarity, `${where} rarity`);
  if (!rarities[rarity]) fail(`${where} names rarity ${rarity}, which the catalogue does not carry`);
  const references = value.textureReferences;
  if (!Array.isArray(references)) fail(`${where} does not carry a texture reference list`);
  const parsedReferences = references.map((entry, index) => {
    if (!isRecord(entry)) fail(`${where} texture reference ${index} is not an object`);
    const resolution = text(entry.resolution, `${where} texture reference ${index} resolution`);
    if (resolution !== "unique" && resolution !== "ambiguous" && resolution !== "unresolved")
      fail(`${where} texture reference ${index} has an unknown resolution ${resolution}`);
    const verdict: SourcePaintKitResolution = resolution;
    const candidates = entry.candidates;
    if (!Array.isArray(candidates) || candidates.some((candidate) => typeof candidate !== "string"))
      fail(`${where} texture reference ${index} has a non-string candidate`);
    // The staged file's own verdict has to match its candidate list, so a hand-edited
    // catalogue cannot claim a unique texture while listing several.
    if (resolution === "unique" && candidates.length !== 1)
      fail(`${where} texture reference ${index} calls ${candidates.length} candidates unique`);
    if (resolution === "ambiguous" && candidates.length < 2)
      fail(`${where} texture reference ${index} calls ${candidates.length} candidates ambiguous`);
    if (resolution === "unresolved" && candidates.length)
      fail(`${where} texture reference ${index} is unresolved yet lists ${candidates.length} candidates`);
    return { field: text(entry.field, `${where} texture reference ${index} field`),
      sourceValue: text(entry.sourceValue, `${where} texture reference ${index} value`),
      resolution: verdict, candidates: candidates as readonly string[] };
  });
  const pair = (entry: unknown, label: string): readonly [number, number] => {
    if (!Array.isArray(entry) || entry.length !== 2)
      fail(`${where} ${label} is not an original pair`);
    return [finite(entry[0], `${where} ${label} start`), finite(entry[1], `${where} ${label} end`)];
  };
  const style = integer(value.style, `${where} style`);
  if (style < 0) fail(`${where} has a negative style`);
  const wearMinimum = finite(value.wearMinimum, `${where} wear minimum`);
  const wearMaximum = finite(value.wearMaximum, `${where} wear maximum`);
  if (wearMaximum < wearMinimum) fail(`${where} wears from ${wearMinimum} to ${wearMaximum}`);
  return {
    id, name: text(value.name, `${where} internal name`),
    englishName: text(value.englishName, `${where} English name`),
    chineseName: text(value.chineseName, `${where} Chinese name`),
    rarity, rarityValue: integer(value.rarityValue, `${where} rarity value`), style,
    pattern: text(value.pattern, `${where} pattern`),
    patternScale: finite(value.patternScale, `${where} pattern scale`),
    patternOffsetX: pair(value.patternOffsetX, "pattern offset x"),
    patternOffsetY: pair(value.patternOffsetY, "pattern offset y"),
    patternRotate: pair(value.patternRotate, "pattern rotate"),
    seed: integer(value.seed, `${where} seed`),
    wearMinimum, wearMaximum, wearDefault: finite(value.wearDefault, `${where} wear default`),
    colours: parsedColours, phongExponent: finite(value.phongExponent, `${where} phong exponent`),
    phongIntensity: finite(value.phongIntensity, `${where} phong intensity`),
    phongAlbedoBoost: finite(value.phongAlbedoBoost, `${where} phong albedo boost`),
    onlyFirstMaterial: integer(value.onlyFirstMaterial, `${where} only_first_material`),
    ignoreWeaponSizeScale: integer(value.ignoreWeaponSizeScale, `${where} ignore_weapon_size_scale`),
    textureReferences: parsedReferences,
  };
}

export async function loadSourcePaintKits(baseUrl: string, options: { signal?: AbortSignal } = {
}): Promise<{ catalogue: SourcePaintKitCatalogue; hashVerified: Record<string, boolean> }> {
  const signal = options.signal,
    base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/",
    row = manifest.find((entry) => entry.path === SOURCE_PAINT_KIT_RESOURCE);
  if (!row) fail("the staged manifest does not name " + SOURCE_PAINT_KIT_RESOURCE);
  const response = await fetch(base + SOURCE_PAINT_KIT_RESOURCE, { signal });
  if (!response.ok) fail("HTTP " + response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== row.bytes || (await sourceSha256(bytes, signal)) !== row.sha256)
    fail("the staged bytes differ from the manifest");
  return { catalogue: validateSourcePaintKitCatalogue(JSON.parse(new TextDecoder().decode(bytes)) as unknown),
    hashVerified: { [SOURCE_PAINT_KIT_RESOURCE]: true } };
}

/** Validates a staged document and returns it typed. This is separate from the fetch
 * above so the structural rules can be exercised on their own: the loader's digest gate
 * means a hand-edited document never gets this far, and both gates matter. */
export function validateSourcePaintKitCatalogue(document: unknown): SourcePaintKitCatalogue {
  if (!isRecord(document)) fail("the staged document is not an object");
  if (document.format !== SOURCE_PAINT_KIT_FORMAT) fail("unexpected format " + String(document.format));
  const cataloguedFrom = document.cataloguedFrom;
  if (!isRecord(cataloguedFrom)) fail("the staged document names no catalogue it came from");
  const manifestSha = text(cataloguedFrom.manifestSha256, "the source install manifest digest");
  if (!/^[0-9a-f]{64}$/.test(manifestSha)) fail("the source install manifest digest is not a digest");
  const catalogueSha = text(cataloguedFrom.catalogueSha256, "the source catalogue digest");
  if (!/^[0-9a-f]{64}$/.test(catalogueSha)) fail("the source catalogue digest is not a digest");
  const rawRarities = document.rarities;
  if (!isRecord(rawRarities) || !Object.keys(rawRarities).length) fail("the staged document carries no rarities");
  const rarities: Record<string, SourcePaintKitRarity> = {};
  for (const [key, entry] of Object.entries(rawRarities)) {
    if (!isRecord(entry)) fail(`rarity ${key} is not an object`);
    rarities[key] = { value: integer(entry.value, `rarity ${key} value`),
      color: typeof entry.color === "string" ? entry.color : null,
      locKey: typeof entry.locKey === "string" ? entry.locKey : null,
      englishLabel: text(entry.englishLabel, `rarity ${key} English label`),
      chineseLabel: text(entry.chineseLabel, `rarity ${key} Chinese label`) };
  }
  const defaultKitId = text(document.defaultKitId, "the default paint-kit id");
  const factory = validateFinish(document.factory, "the factory finish", rarities);
  if (factory.id !== defaultKitId) fail(`the factory finish is ${factory.id}, not the default ${defaultKitId}`);
  if (factory.name !== "default") fail(`the factory finish is named ${factory.name}`);
  const rawWeapons = document.weapons;
  if (!Array.isArray(rawWeapons) || !rawWeapons.length) fail("the staged document lists no weapons");
  const weapons = rawWeapons.map((entry, index) => {
    if (!isRecord(entry)) fail(`weapon ${index} is not an object`);
    const weapon = text(entry.weapon, `weapon ${index} name`);
    const finishes = entry.finishes;
    if (!Array.isArray(finishes) || !finishes.length) fail(`${weapon} lists no finishes`);
    const parsed = finishes.map((finish, position) => validateFinish(finish, `${weapon} finish ${position}`, rarities));
    const ids = new Set(parsed.map((finish) => finish.id));
    if (ids.size !== parsed.length) fail(`${weapon} lists the same finish twice`);
    // The original keeps the factory finish out of a weapon's finish list: it is the
    // state of having no finish, and it travels here as `factory`. A list that mixes
    // the two would double-count it, so it is refused.
    if (ids.has(defaultKitId)) fail(`${weapon} lists the factory finish among its finishes`);
    return { weapon, finishes: parsed };
  });
  const boundaries = document.boundaries;
  if (!Array.isArray(boundaries) || boundaries.some((entry) => typeof entry !== "string"))
    fail("the staged document carries no boundary list");
  return { format: SOURCE_PAINT_KIT_FORMAT, status: text(document.status, "the staged status"),
    cataloguedFrom: { format: text(cataloguedFrom.format, "the source catalogue format"), manifestSha256: manifestSha,
      sourceioCommit: typeof cataloguedFrom.sourceioCommit === "string" ? cataloguedFrom.sourceioCommit : null,
      catalogueSha256: catalogueSha },
    rarities, defaultKitId, factory, weapons, boundaries: boundaries as readonly string[] };
}

/** The finish one weapon offers under one original id, or the factory finish when the
 * id is unknown — never a different finish's data. */
export function sourcePaintKitFor(catalogue: SourcePaintKitCatalogue, weapon: string, id: unknown) {
  const entry = catalogue.weapons.find((candidate) => candidate.weapon === weapon);
  if (!entry) fail(`no staged finishes for ${weapon}`);
  if (typeof id !== "string") return catalogue.factory;
  return entry.finishes.find((finish) => finish.id === id) ?? catalogue.factory;
}

/** True when the catalogue offers this finish for this weapon under its own id. */
export function sourcePaintKitExists(catalogue: SourcePaintKitCatalogue, weapon: string, id: unknown) {
  if (typeof id !== "string") return false;
  return (catalogue.weapons.find((candidate) => candidate.weapon === weapon)?.finishes ?? [])
    .some((finish) => finish.id === id);
}

/** Every finish one weapon offers, in the original's own order. */
export function sourcePaintKitsForWeapon(catalogue: SourcePaintKitCatalogue, weapon: string) {
  const entry = catalogue.weapons.find((candidate) => candidate.weapon === weapon);
  if (!entry) fail(`no staged finishes for ${weapon}`);
  return entry.finishes;
}

/** One staged finish as the composition parameters take it. The original id travels as a
 * number, and the finish's own Phong values, wear window and pattern transform are
 * carried across unchanged; nothing is defaulted here. */
export function sourceRedlineKitFor(finish: SourcePaintKit,originalWeapon?:string): SourceRedlineKit {
  const paintKitId = Number(finish.id);
  if (!Number.isInteger(paintKitId) || paintKitId < 0) fail(`finish ${finish.id} is not an original id`);
  return {
    paintKitId,
    style: finish.style,
    colours: finish.colours,
    phongExponent: finish.phongExponent,
    phongIntensity: finish.phongIntensity,
    phongAlbedoBoost: finish.phongAlbedoBoost,
    patternScale: finish.patternScale,
    patternOffsetX: finish.patternOffsetX,
    patternOffsetY: finish.patternOffsetY,
    patternRotate: finish.patternRotate,
    wearMinimum: finish.wearMinimum,
    wearMaximum: finish.wearMaximum,
    ...(finish.ignoreWeaponSizeScale===1?{}:{textureScale:sourcePaintTextureScale(originalWeapon,finish.style,finish.ignoreWeaponSizeScale)}),
  };
}
