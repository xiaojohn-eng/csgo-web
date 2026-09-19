/** Resolves an original AK finish to the numbers and the artwork it is composed from.
 *
 * The staged catalogue says which finishes the weapon offers and what each one's own
 * numbers are; the staged pattern manifest says which of them this port has the original
 * artwork for. Both are fetched once, together, and a finish is refused when either of
 * them does not hold it — so the composition path can never fall back to another
 * finish's numbers or another finish's texture.
 */
import type { SourceRedlinePatternInput } from "./source-redline-compositor";
import { SOURCE_COMPOSABLE_STYLES, SOURCE_REDLINE_VERIFIED_SAMPLERS, sourceStyleFitsSamplers,
  sourceStyleSamplesPattern } from "./source-redline-compositor";
import { loadSourcePaintKits, sourcePaintKitFor, sourceRedlineKitFor } from "./source-paint-kits";
import { loadSourceAkPatterns, sourceAkPatternFor, sourceAkNormalFor, type SourceAkPatterns } from "./source-ak-patterns";
import type { SourceRedlineKit } from "./source-redline-seed";
import {sourcePaintTextureScale} from './source-paint-geometry';

/** The weapon this path has artwork staged for. */
export const SOURCE_AK_FINISH_WEAPON = "weapon_ak47";

/** The checks that decide whether one original finish of one weapon can be composed at
 * all: it must be a finish that weapon offers, of a style this port can build a program for, whose
 * programs read only samplers that weapon's own input set holds. An original normal map
 * belongs to the final VertexLitGeneric material, with the native clone guard for styles 7/8/9. A style whose program samples the finish's own pattern must name one the
 * original resolves to a single texture. Original UVScale and projected WeaponLength/36 factors
 * are verified against all 238 native generator cases. A style whose program samples no pattern must not
 * name one at all. Original zero-boost kits use +Infinity and the native shader uploads its
 * reciprocal +0. Both the AK's resolver and the staged-kit one go through this, so
 * they refuse the same things for the same reasons; they differ only in which samplers `samplers`
 * names. */
export function sourceComposableFinish(catalogue: Parameters<typeof sourcePaintKitFor>[0],
  weapon: string, paintKitId: number, samplers: readonly number[]) {
  if (!Number.isInteger(paintKitId) || paintKitId < 1) throw Error("A finish id must be a positive integer");
  const entry = sourcePaintKitFor(catalogue, weapon, String(paintKitId));
  if (entry.id !== String(paintKitId))
    throw Error(`Finish ${paintKitId} is not an original ${weapon} finish`);
  if (!SOURCE_COMPOSABLE_STYLES.includes(entry.style))
    throw Error(`Finish ${paintKitId} is style ${entry.style}, and this port builds no program for it`);
  if (!sourceStyleFitsSamplers(entry.style, samplers))
    throw Error(`Finish ${paintKitId} is style ${entry.style}, which reads a sampler this weapon's inputs do not hold`);
  const normals=entry.textureReferences.filter(reference=>reference.field==='normal');
  if(normals.length&&(![7,8,9].includes(entry.style)||normals.length!==1||normals[0].resolution!=='unique'))
    throw Error(`Finish ${paintKitId} has no uniquely resolved original draw-material normal map`);
  const patterns = entry.textureReferences.filter((reference) => reference.field === "pattern");
  if (sourceStyleSamplesPattern(entry.style)) {
    if (!patterns.length)
      throw Error(`Finish ${paintKitId} is style ${entry.style}, whose program samples the finish's own pattern, and it names none`);
    if (patterns.some((reference) => reference.resolution !== "unique"))
      throw Error(`Finish ${paintKitId} names a pattern the original does not resolve to one texture`);
  } else if (patterns.length) {
    throw Error(`Finish ${paintKitId} is style ${entry.style}, whose program samples no pattern, yet it names one`);
  }
  sourcePaintTextureScale(weapon,entry.style,entry.ignoreWeaponSizeScale);
  return entry;
}

export interface SourceAkFinish {
  kit: SourceRedlineKit;
  /** The finish's own pattern, or null for a style whose program samples none: those read their
   * colour from the palette constants the kit carries and have no artwork to bind. */
  pattern: SourceRedlinePatternInput | null;
  normal?: SourceRedlinePatternInput | null;
}
export interface SourceAkFinishResolver {
  resolve(paintKitId: number): Promise<SourceAkFinish>;
  /** Ids this resolver accepts, once the catalogue is loaded. */
  available(): Promise<readonly number[]>;
}

export function createSourceAkFinishResolver(options: {
  catalogueBaseURL: string;
  patternBaseURL: string;
  signal?: AbortSignal;
}): SourceAkFinishResolver {
  let assets: Promise<{ kits: Awaited<ReturnType<typeof loadSourcePaintKits>>["catalogue"];
    patterns: SourceAkPatterns }> | null = null;
  const load = () => {
    if (!assets)
      assets = Promise.all([
        loadSourcePaintKits(options.catalogueBaseURL, { signal: options.signal }),
        loadSourceAkPatterns(options.patternBaseURL, { signal: options.signal }),
      ]).then(([kits, patterns]) => ({ kits: kits.catalogue, patterns: patterns.patterns }))
        .catch((error) => { assets = null; throw error; });
    return assets;
  };
  const resolve = async (paintKitId: number): Promise<SourceAkFinish> => {
    const { kits, patterns } = await load();
    const entry = sourceComposableFinish(kits, SOURCE_AK_FINISH_WEAPON, paintKitId,
      SOURCE_REDLINE_VERIFIED_SAMPLERS);
    return { kit: sourceRedlineKitFor(entry,SOURCE_AK_FINISH_WEAPON),
      pattern: sourceStyleSamplesPattern(entry.style) ? sourceAkPatternFor(patterns, paintKitId) : null,
      normal:entry.textureReferences.some(ref=>ref.field==='normal')?sourceAkNormalFor(patterns,paintKitId):null };
  };
  return {
    resolve,
    async available() {
      const { kits, patterns } = await load();
      const entry = kits.weapons.find((candidate) => candidate.weapon === SOURCE_AK_FINISH_WEAPON);
      if (!entry) return [];
      // The finishes this resolver will actually compose: every composable one whose artwork the
      // staged manifest holds, where its style's program samples a pattern at all. A solid-colour
      // style needs no artwork, so it is offered on the strength of its palette alone.
      return entry.finishes.filter((finish) => {
        try {
          const composable = sourceComposableFinish(kits, SOURCE_AK_FINISH_WEAPON, Number(finish.id),
            SOURCE_REDLINE_VERIFIED_SAMPLERS);
          if (sourceStyleSamplesPattern(composable.style)) sourceAkPatternFor(patterns, Number(finish.id));
          if(composable.textureReferences.some(ref=>ref.field==='normal'))sourceAkNormalFor(patterns,Number(finish.id));
          return true;
        } catch {
          return false;
        }
      }).map((finish) => Number(finish.id));
    },
  };
}
