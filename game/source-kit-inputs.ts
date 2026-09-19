/** A weapon's own style-7 composition inputs, as staged from the original install.
 *
 * Every weapon's material carries its own Phong values, and its own ambient-occlusion,
 * weapon-albedo and exponent textures; the M4A1's albedo boost is 25 where the AK-47's is
 * 35, so these travel per weapon rather than as constants. The staged manifest names each
 * texture and its digest, and the served receipt names the weapon's Phong values and the
 * finishes the original install does not resolve to one pattern.
 *
 * Nothing here is defaulted: a weapon the manifest does not cover, a role it is missing,
 * or a digest that is not a digest is refused.
 */
import { sourceSha256 } from "./source-sha256";
import type { SourceKitWeaponInput, SourceRedlinePatternInput } from "./source-redline-compositor";
import type { SourceWeaponPhong } from "./source-redline-seed";
import manifest from "./source-kit-input-resources.json";

/** The receipt the staging writes beside a weapon's textures. */
export const SOURCE_KIT_RECEIPT = "inputs.json";
/** The five roles the style-7 composition samples, and the sampler the original program reads each
 * at. The composition binds these and only these. */
export const SOURCE_KIT_SAMPLED_ROLES = ["ao", "paintWear", "weaponExponent", "weaponAlbedo", "gunGrunge"] as const;
/** Every role the staged catalogue carries for a weapon, which is the five above plus the two the
 * *other* styles sample: the colour and exponent passes of styles 1, 2, 4 and 5 declare
 * `MasksSampler` and styles 3 and 6 also declare `OSPosSampler`, per the permutations' own constant
 * tables. A weapon missing one of these is refused even though style 7 does not read it, because
 * the staged catalogue is what any style composes from. */
export const SOURCE_KIT_STAGED_ROLES = [...SOURCE_KIT_SAMPLED_ROLES, "mask", "osPos", "surface"] as const;
/** The paint-space UV atlas: staged for the record, not sampled by the composition. */
export const SOURCE_KIT_UV_ROLE = "uv";

interface ManifestEntry {
  weapon: string; path: string; bytes: number; sha256: string; rgba8Sha256: string;
  role: string; sampler: number; paintKitIds: readonly string[]; width: number; height: number;
  vtfFlags: number; sourceMaterial: string;
}
const entries = manifest as readonly ManifestEntry[];

export interface SourceKitWeapon {
  weapon: string;
  /** The five textures the composition samples, in the manifest's own order. */
  inputs: readonly SourceKitWeaponInput[];
  phong: SourceWeaponPhong;
  /** Finishes this weapon offers whose own pattern texture is staged. */
  patternIds: readonly number[];
  /** Finishes the original install does not resolve to a single pattern, for the record. */
  refusedFinishes: readonly string[];
}

function fail(message: string): never {
  throw Error("Original kit inputs: " + message);
}
const digest = (value: unknown, where: string): string => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(`${where} is not a digest`);
  return value;
};
const integer = (value: unknown, where: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) fail(`${where} is not an integer`);
  return value;
};

/** Validates the staged manifest and returns it grouped by weapon. This is separate from
 * the fetch below so the structural rules can be exercised on their own. */
export function groupSourceKitInputs(source: unknown) {
  if (!Array.isArray(source) || !source.length) fail("the staged manifest holds no entries");
  const byWeapon = new Map<string, ManifestEntry[]>();
  for (const raw of source) {
    if (typeof raw !== "object" || raw === null) fail("a staged entry is not an object");
    const entry = raw as ManifestEntry;
    if (typeof entry.weapon !== "string" || !entry.weapon) fail("a staged entry names no weapon");
    if (entry.path.includes("..") || entry.path.startsWith("/"))
      fail(`${entry.weapon}: ${entry.path} is not inside the served tree`);
    if (!Number.isInteger(entry.sampler) || entry.sampler < -1 || entry.sampler >= 16)
      fail(`${entry.weapon}: ${entry.path} has an impossible sampler`);
    const list = byWeapon.get(entry.weapon) ?? [];
    list.push(entry);
    byWeapon.set(entry.weapon, list);
  }
  for (const [weapon, list] of byWeapon) {
    const seen = new Set<string>();
    for (const entry of list) {
      const key = `${entry.role}:${entry.path}`;
      if (seen.has(key)) fail(`${weapon} stages ${entry.path} twice`);
      seen.add(key);
    }
    // One texture per staged role: a weapon missing one cannot be composed, and two
    // candidates for one would make the binding ambiguous.
    for (const role of SOURCE_KIT_STAGED_ROLES) {
      const matches = list.filter((entry) => entry.role === role);
      if (matches.length !== 1)
        fail(`${weapon} stages ${matches.length} textures for role ${role}, not one`);
      const sampler = integer(matches[0].sampler, `${weapon} ${role} sampler`);
      if (sampler < 0) fail(`${weapon} ${role} carries no sampler`);
    }
    if (list.filter((entry) => entry.role === SOURCE_KIT_UV_ROLE).length > 1)
      fail(`${weapon} stages more than one UV atlas`);
    if (list.filter((entry) => entry.role === "receipt").length !== 1)
      fail(`${weapon} stages no receipt`);
    // Every staged texture is described well enough to be fetched and checked.
    for (const entry of list) {
      if (entry.role === "receipt") continue;
      const where = `${weapon} ${entry.path}`;
      const width = integer(entry.width, `${where} width`), height = integer(entry.height, `${where} height`);
      if (width < 1 || height < 1 || Math.max(width, height) > 2048)
        fail(`${where} is outside the composed texture budget`);
      if (integer(entry.bytes, `${where} bytes`) < 1) fail(`${where} holds no bytes`);
      if (integer(entry.vtfFlags, `${where} flags`) < 0) fail(`${where} has impossible flags`);
      digest(entry.sha256, `${where} PNG digest`);
      digest(entry.rgba8Sha256, `${where} decoded digest`);
      if (typeof entry.sourceMaterial !== "string" || !entry.sourceMaterial)
        fail(`${where} names no original material`);
      if (entry.role === "pattern" && !entry.paintKitIds.length)
        fail(`${where} serves no finish`);
    }
  }
  return byWeapon;
}

export interface LoadedSourceKitWeapon {
  kit: SourceKitWeapon;
  /** The finish's own pattern texture, or a refusal naming the finish. */
  patternFor(paintKitId: number): SourceRedlinePatternInput;
  normalFor(paintKitId: number): SourceRedlinePatternInput;
}

export async function loadSourceKitWeapon(
  weapon: string,
  baseUrl: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ weapon: LoadedSourceKitWeapon; hashVerified: Record<string, boolean> }> {
  const byWeapon = groupSourceKitInputs(entries);
  const list = byWeapon.get(weapon);
  if (!list) fail(`the staged manifest covers no ${weapon}`);
  const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  const signal = options.signal;
  const hashVerified: Record<string, boolean> = {};
  const sampled = SOURCE_KIT_STAGED_ROLES.map((role) => {
    const entry = list.find((candidate) => candidate.role === role)!;
    return { sampler: entry.sampler, srgb: role === "ao" || role === "weaponAlbedo" || role === "gunGrunge",
      source: entry.sourceMaterial, path: entry.path, bytes: entry.bytes, sha256: entry.sha256,
      rgba8Sha256: entry.rgba8Sha256, width: entry.width, height: entry.height,
      vtfFlags: entry.vtfFlags } satisfies SourceKitWeaponInput;
  });
  // The weapon's Phong values and the original's own refusals live in the receipt the
  // staging wrote beside the textures, so it is fetched and checked like any other file.
  const receiptEntry = list.find((entry) => entry.role === "receipt")!;
  const response = await fetch(base + receiptEntry.path, { signal, cache: "no-cache" });
  if (!response.ok) fail(`${weapon} receipt HTTP ${response.status}`);
  const receiptBytes = new Uint8Array(await response.arrayBuffer());
  if (receiptBytes.byteLength !== receiptEntry.bytes
    || (await sourceSha256(receiptBytes, signal)) !== receiptEntry.sha256)
    fail(`${weapon} receipt differs from the manifest`);
  hashVerified[receiptEntry.path] = true;
  const receipt = JSON.parse(new TextDecoder().decode(receiptBytes)) as unknown;
  if (typeof receipt !== "object" || receipt === null) fail(`${weapon} receipt is not an object`);
  const record = receipt as Record<string, unknown>;
  if (record.weapon !== weapon) fail(`the receipt is for ${String(record.weapon)}, not ${weapon}`);
  if (record.status !== "kit_inputs_extracted") fail(`the receipt is ${String(record.status)}`);
  const phongRecord = record.phong as Record<string, unknown> | undefined;
  const ranges = phongRecord?.phongFresnelRanges;
  if (!Array.isArray(ranges) || ranges.length !== 3 || !ranges.every((value) => typeof value === "number" && Number.isFinite(value)))
    fail(`${weapon} carries no three Fresnel ranges`);
  const phong: SourceWeaponPhong = {
    phongBoost: integer(phongRecord?.phongBoost, `${weapon} phong boost`),
    phongAlbedoBoost: integer(phongRecord?.phongAlbedoBoost, `${weapon} albedo boost`),
    phongFresnelRanges: [ranges[0], ranges[1], ranges[2]] as [number, number, number],
  };
  // These are the cloned weapon's own VMT fields, retained independently of the
  // generated paint maps and of the paintkit's Phong overrides.
  const materials=record.materials as Record<string,{text?:unknown}>|undefined;
  const ownMaterials=Object.entries(materials??{}).filter(([path])=>path.startsWith('materials/models/weapons/v_models/'));
  if(ownMaterials.length!==1||typeof ownMaterials[0][1].text!=='string')fail(`${weapon} has no original weapon VMT`);
  const values=new Map([...ownMaterials[0][1].text.matchAll(/"(\$[^"\n]+)"\s*"([^"\n]*)"/g)]
    .map(match=>[match[1].toLowerCase(),match[2]]));
  const tint=values.get('$envmaptint')?.replaceAll('[','').replaceAll(']','').trim().split(/\s+/).map(Number);
  if(values.get('$envmap')!=='env_cubemap'||values.get('$envmapfresnel')!=='1'
    ||values.get('$basemapalphaphongmask')!=='1'||!tint||tint.length!==3||tint.some(value=>!Number.isFinite(value)||value<0))
    fail(`${weapon} has an unsupported original reflection VMT`);
  phong.envmap={tint:tint as[number,number,number],fresnel:true,mask:'phongMask'};
  if (phong.phongBoost < 1 || phong.phongAlbedoBoost < 1)
    fail(`${weapon} carries a non-positive Phong value`);
  const refused = ((record.refusedFinishes ?? []) as { paintKitId?: unknown }[])
    .map((entry) => String(entry.paintKitId));
  const patternIds = [...new Set(list.filter((entry) => entry.role === "pattern")
    .flatMap((entry) => entry.paintKitIds))]
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((one, two) => one - two);
  if (!patternIds.length) fail(`${weapon} stages no finish pattern`);
  // A finish the original does not resolve to one pattern cannot be staged, so the two
  // sets must not overlap.
  for (const refusedId of refused)
    if (patternIds.includes(Number(refusedId)))
      fail(`${weapon} stages a pattern for ${refusedId}, which the original does not resolve`);
  const textureFor=(paintKitId:number,role:'pattern'|'normal'):SourceRedlinePatternInput=>{
        if (!Number.isInteger(paintKitId) || paintKitId < 1)
          fail("a finish id must be a positive integer");
        const matches = list.filter((entry) => entry.role === role
          && entry.paintKitIds.includes(String(paintKitId)));
        if (matches.length !== 1)
          fail(`${matches.length} staged ${role} textures cover finish ${paintKitId} on ${weapon}`);
        const entry = matches[0];
        return { paintKitId, sourceMaterial: entry.sourceMaterial, path: entry.path, bytes: entry.bytes,
          sha256: entry.sha256, rgba8Sha256: entry.rgba8Sha256, width: entry.width, height: entry.height,
          vtfFlags: entry.vtfFlags };
      };
  return {
    weapon: {
      kit: { weapon, inputs: sampled, phong, patternIds, refusedFinishes: refused },
      patternFor:paintKitId=>textureFor(paintKitId,'pattern'),
      normalFor:paintKitId=>textureFor(paintKitId,'normal'),
    },
    hashVerified,
  };
}
