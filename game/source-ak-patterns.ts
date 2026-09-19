/** The original pattern textures of the AK-47 finishes this port can compose.
 *
 * `scripts/extract-source-ak-patterns.py` read each finish's own pattern texture out of
 * the original install and stored it losslessly; `scripts/stage-source-ak-patterns.py`
 * copied those PNGs into the served tree and wrote the manifest this module checks them
 * against. A finish is composed from its own artwork, and a finish the export does not
 * cover is refused rather than drawn with another finish's texture.
 */
import { sourceSha256 } from "./source-sha256";
import type { SourceRedlinePatternInput } from "./source-redline-compositor";
import manifest from "./source-ak-pattern-resources.json";

export const SOURCE_AK_PATTERN_RESOURCE = "inputs.json";

export interface SourceAkPattern {
  /** Path inside the served pattern directory. */
  path: string;
  bytes: number;
  sha256: string;
  /** The finish or finishes whose own texture this is. */
  paintKitIds: readonly string[];
  field: string;
  width: number;
  height: number;
  vtfFlags: number;
  rgba8Sha256: string;
  /** The original material the PNG was decoded from. */
  sourceMaterial: string;
}
export interface SourceAkPatterns {
  /** Every staged texture, in the manifest's own order. */
  entries: readonly SourceAkPattern[];
  /** The original export's own receipt, for the record. */
  provenance: { format: string; status: string; catalogueSha256: string; textures: number;
    /** Which styles the export read pattern textures for, and how many finishes the original left
     * ambiguous so that none was staged for them. */
    styles: readonly number[]; refusedFinishes: number };
}

function fail(message: string): never {
  throw Error("Original AK patterns: " + message);
}
const integer = (value: unknown, where: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) fail(`${where} is not an integer`);
  return value;
};
const digest = (value: unknown, where: string): string => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(`${where} is not a digest`);
  return value;
};

export async function loadSourceAkPatterns(
  baseUrl: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ patterns: SourceAkPatterns; hashVerified: Record<string, boolean> }> {
  const signal = options.signal,
    base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/",
    hashVerified: Record<string, boolean> = {},
    bytes = async (name: string) => {
      const row = manifest.find((entry) => entry.path === name);
      if (!row) fail("the staged manifest does not name " + name);
      const response = await fetch(base + name, { signal });
      if (!response.ok) fail("HTTP " + response.status + " " + name);
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.byteLength !== row.bytes || (await sourceSha256(data, signal)) !== row.sha256)
        fail("the staged bytes differ from the manifest: " + name);
      hashVerified[name] = true;
      return { data, row };
    };
  const { data: receiptBytes } = await bytes(SOURCE_AK_PATTERN_RESOURCE);
  const provenance = validateSourceAkPatternReceipt(
    JSON.parse(new TextDecoder().decode(receiptBytes)) as unknown);
  const entries = manifest
    .filter((entry) => entry.path !== SOURCE_AK_PATTERN_RESOURCE)
    .map((entry) => {
      const path = entry.path;
      if (typeof path !== "string" || !path.startsWith("png/") || path.includes(".."))
        fail("a staged texture path is not inside the served tree: " + String(path));
      const field = entry.field;
      if (field !== "pattern" && field !== "normal") fail("a staged texture has an unknown field " + String(field));
      const ids = entry.paintKitIds;
      if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== "string" || !id))
        fail("a staged texture names no finish: " + path);
      const width = integer(entry.width, `${path} width`), height = integer(entry.height, `${path} height`);
      if (width < 1 || height < 1 || Math.max(width, height) > 2048)
        fail(`${path} is outside the composed texture budget`);
      return { path, bytes: integer(entry.bytes, `${path} bytes`), sha256: digest(entry.sha256, `${path} digest`),
        paintKitIds: ids as readonly string[], field, width, height,
        vtfFlags: integer(entry.vtfFlags, `${path} VTF flags`),
        rgba8Sha256: digest(entry.rgba8Sha256, `${path} decoded digest`),
        sourceMaterial: typeof entry.sourceMaterial === "string" && entry.sourceMaterial
          ? entry.sourceMaterial : fail(`${path} names no original material`) };
    });
  if (!entries.length) fail("the staged manifest holds no textures");
  // One texture per finish and field, so a lookup can never be ambiguous.
  const covered = new Set<string>();
  for (const entry of entries)
    for (const id of entry.paintKitIds) {
      const key = `${entry.field}:${id}`;
      if (covered.has(key)) fail(`finish ${id} has more than one staged ${entry.field} texture`);
      covered.add(key);
    }
  return { patterns: { entries, provenance }, hashVerified };
}

/** Validates the export's own receipt and returns what the record carries. This is
 * separate from the fetch above because the staged digest gate means a hand-edited
 * receipt never reaches these checks, and both gates matter. */
export function validateSourceAkPatternReceipt(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("the staged receipt is not an object");
  const record = value as Record<string, unknown>;
  if (record.status !== "pattern_inputs_extracted") fail("the staged receipt is " + String(record.status));
  if (record.weapon !== "weapon_ak47") fail("the staged receipt is for " + String(record.weapon));
  // Which styles the export read from, which is what the export's own finish list covers. The one
  // this port compiled first has to be among them: an export that skipped it would be an export of
  // something else, however plausible the rest of the record looks.
  const styles = record.styles;
  if (!Array.isArray(styles) || !styles.length || styles.some((style) => !Number.isInteger(style)))
    fail("the staged receipt names no styles: " + JSON.stringify(styles));
  if (!(styles as number[]).includes(7))
    fail("the staged receipt does not cover the style this port compiled: " + JSON.stringify(styles));
  // A finish the original leaves ambiguous is recorded rather than staged, and the generated finish
  // table does not list it either, so the two together leave no listed finish without artwork.
  const refused = Array.isArray(record.refusedFinishes) ? record.refusedFinishes : [];
  const textures = Array.isArray(record.textures) ? record.textures.length : 0;
  if (!textures) fail("the staged receipt names no textures");
  // The finish count the extractor reported has to describe a real set, so a receipt
  // cannot claim to cover nothing while listing textures.
  if (typeof record.finishCount !== "number" || record.finishCount < 1)
    fail("the staged receipt covers no finishes");
  return {
    format: "source-ak-pattern-inputs-v1",
    status: record.status as string,
    catalogueSha256: digest(record.catalogueSha256, "the source catalogue digest"),
    styles: (styles as number[]).slice().sort((one, two) => one - two),
    refusedFinishes: refused.length,
    textures,
  };
}

/** The pattern texture one finish's own artwork is, or a refusal. A finish the export
 * does not cover is never silently drawn with another finish's texture. */
export function sourceAkPatternFor(patterns: SourceAkPatterns, paintKitId: number): SourceRedlinePatternInput {
  return sourceAkTextureFor(patterns,paintKitId,'pattern');
}
export function sourceAkNormalFor(patterns: SourceAkPatterns, paintKitId: number): SourceRedlinePatternInput {
  return sourceAkTextureFor(patterns,paintKitId,'normal');
}
function sourceAkTextureFor(patterns: SourceAkPatterns, paintKitId: number, field:'pattern'|'normal'): SourceRedlinePatternInput {
  if (!Number.isInteger(paintKitId) || paintKitId < 1) fail("a finish id must be a positive integer");
  const wanted = String(paintKitId);
  const matches = patterns.entries.filter((entry) => entry.field === field && entry.paintKitIds.includes(wanted));
  if (matches.length !== 1)
    fail(`${matches.length} staged ${field} textures cover finish ${wanted}`);
  const pattern = matches[0];
  return { paintKitId, sourceMaterial: pattern.sourceMaterial, path: pattern.path, bytes: pattern.bytes,
    sha256: pattern.sha256, rgba8Sha256: pattern.rgba8Sha256, width: pattern.width, height: pattern.height,
    vtfFlags: pattern.vtfFlags };
}

/** Whether the export carries this finish's own pattern texture. */
export function sourceAkPatternExists(patterns: SourceAkPatterns, paintKitId: number) {
  const wanted = String(paintKitId);
  return patterns.entries.some((entry) => entry.field === "pattern" && entry.paintKitIds.includes(wanted));
}
