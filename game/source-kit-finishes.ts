/** Resolves an original finish of a weapon whose composition inputs are staged per weapon.
 *
 * The AK-47's inputs were verified against the Redline first and its own resolver still
 * serves them. This is the same resolution for any other weapon: the staged catalogue
 * decides which finishes exist and what each one's own numbers are, the staged kit tree
 * supplies the weapon's own sampled textures, its own Phong values and each finish's own
 * pattern texture.
 *
 * The checks are shared with the AK resolver, so both refuse the same finishes for the
 * same reasons; what differs is where the weapon's own inputs and Phong values come from.
 */
import type { SourceKitWeaponInput, SourceRedlinePatternInput } from "./source-redline-compositor";
import { SOURCE_REDLINE_PATTERN_SAMPLER, sourceStyleSamplesPattern } from "./source-redline-compositor";
import type { SourceRedlineKit, SourceWeaponPhong } from "./source-redline-seed";
import type { SourceFinishWeaponSpec } from "./source-redline-finish";
import { loadSourcePaintKits, sourceRedlineKitFor } from "./source-paint-kits";
import { sourceComposableFinish } from "./source-ak-finishes";
import { loadSourceKitWeapon } from "./source-kit-inputs";
import { SOURCE_FINISH_WEAPONS } from "./source-finish-table.js";

/** Where the per-weapon staged inputs live. A weapon's finishes read their own pattern
 * from the same tree, because the weapon's inputs and its finishes' artwork were staged
 * together. */
export const SOURCE_KIT_INPUT_BASE = "/source/csgo-12426148/kit-inputs-fidelity-20260913/";

/** The sampler slots one weapon's own staged inputs occupy, plus the slot a finish's own pattern
 * is bound at. The compositor binds exactly the slots a style's programs declare out of this set,
 * so a style that reads anything else cannot be composed for this weapon and must not be offered:
 * the unit would sample unbound, which reads as black rather than as an error. */
export function sourceKitSamplers(inputs: readonly SourceKitWeaponInput[]): readonly number[] {
  return [...inputs.map((input) => input.sampler), SOURCE_REDLINE_PATTERN_SAMPLER];
}

/** The port's own name for one weapon's gun body. These names are the port's, not the
 * original's: a finish replaces exactly what this port's own models call their gun body.
 * The M4A1 has two because its first-person and world models name it differently and both
 * are the same original material. Which original weapon each port id is, and whether its
 * inputs are staged at all, is the generated table's business rather than a second list
 * here. */
const KIT_FINISH_MATERIAL_NAMES: Record<string, { replaces: readonly string[]; materialName: string }> = {
  vandal: {
    replaces:['Source_AK47_VertexLitGeneric'],materialName:'Source_AK47_VertexLitGeneric',
  },
  m4a4: {
    replaces: ["Source_M4A4_VertexLitGeneric", "Source_World_M4A4_VertexLitGeneric"],
    materialName: "Source_M4A4_VertexLitGeneric",
  },
  awp: {
    replaces: ["Source_AWP_FP_VertexLitGeneric", "Source_AWP_World_VertexLitGeneric"],
    materialName: "Source_AWP_FP_VertexLitGeneric",
  },
  glock: {
    replaces: ["Source_glock_VertexLitGeneric", "Source_World_glock_VertexLitGeneric"],
    materialName: "Source_glock_VertexLitGeneric",
  },
  usp: {
    // The suppressor is part of the same gun body and shares this material, as it does the
    // original's painted atlas, so it is dressed by the same replacement.
    replaces: ["Source_usp_VertexLitGeneric", "Source_World_usp_VertexLitGeneric"],
    materialName: "Source_usp_VertexLitGeneric",
  },
  deagle: {
    // This port spells the first-person and world gun bodies differently, so both exact
    // names are listed rather than a prefix match.
    replaces: ["Source_deagle_VertexLitGeneric", "Source_World_Deagle_VertexLitGeneric"],
    materialName: "Source_deagle_VertexLitGeneric",
  },
};

/** The original weapon a port weapon id is, or null if this port ships no such weapon. */
export function sourceKitOriginalWeapon(port: string) {
  return SOURCE_FINISH_WEAPONS.find((candidate) => candidate.id === port)?.originalWeapon ?? null;
}

/** The owner spec for a weapon whose own inputs are staged, or null: a weapon whose inputs
 * come from somewhere else (the AK-47's verified receipt) or whose inputs are not staged
 * at all is not served by this path. The Phong values are passed in rather than written
 * here, because they are the weapon's own original data. */
export function sourceKitFinishWeapon(port: string, phong: SourceWeaponPhong): SourceFinishWeaponSpec | null {
  const entry = SOURCE_FINISH_WEAPONS.find((candidate) => candidate.id === port);
  const names = KIT_FINISH_MATERIAL_NAMES[port];
  if (!entry || entry.inputSource !== "staged-kit-inputs" || !names) return null;
  return { id: entry.id, replaces: names.replaces, materialName: names.materialName, phong };
}

export interface SourceKitFinish {
  weapon: string;
  kit: SourceRedlineKit;
  /** The finish's own pattern, or null for a style whose program samples none: those read their
   * colour from the palette constants the kit carries and need no artwork bound. */
  pattern: SourceRedlinePatternInput | null;
  normal?: SourceRedlinePatternInput | null;
  phong: SourceWeaponPhong;
  inputs: readonly SourceKitWeaponInput[];
}
export interface SourceKitFinishResolver {
  resolve(paintKitId: number): Promise<SourceKitFinish>;
  /** The finishes this weapon offers that this resolver will actually compose. */
  available(): Promise<readonly number[]>;
}

export function createSourceKitFinishResolver(options: {
  weapon: string;
  catalogueBaseURL: string;
  /** Where this weapon's staged inputs live; the weapon's own directory hangs off it. */
  kitBaseURL: string;
  signal?: AbortSignal;
}): SourceKitFinishResolver {
  const base = options.kitBaseURL.endsWith("/") ? options.kitBaseURL : options.kitBaseURL + "/";
  const asset = `${base}${options.weapon}/`;
  let assets: Promise<{ catalogue: Awaited<ReturnType<typeof loadSourcePaintKits>>["catalogue"];
    weapon: Awaited<ReturnType<typeof loadSourceKitWeapon>>["weapon"] }> | null = null;
  const load = () => {
    if (!assets)
      assets = Promise.all([
        loadSourcePaintKits(options.catalogueBaseURL, { signal: options.signal }),
        loadSourceKitWeapon(options.weapon, asset, { signal: options.signal }),
      ]).then(([kits, weapon]) => ({ catalogue: kits.catalogue, weapon: weapon.weapon }))
        .catch((error) => { assets = null; throw error; });
    return assets;
  };
  return {
    async resolve(paintKitId) {
      const { catalogue, weapon } = await load();
      const entry = sourceComposableFinish(catalogue, options.weapon, paintKitId, sourceKitSamplers(weapon.kit.inputs));
      return { weapon: options.weapon, kit: sourceRedlineKitFor(entry,options.weapon),
        // A style whose program samples the finish's own pattern takes its own artwork; one whose
        // program samples none is composed from its palette constants and binds no pattern.
        pattern: sourceStyleSamplesPattern(entry.style) ? weapon.patternFor(paintKitId) : null,
        normal:entry.textureReferences.some(ref=>ref.field==='normal')?weapon.normalFor(paintKitId):null,
        phong: weapon.kit.phong, inputs: weapon.kit.inputs };
    },
    async available() {
      const { catalogue, weapon } = await load();
      const entry = catalogue.weapons.find((candidate) => candidate.weapon === options.weapon);
      if (!entry) return [];
      const samplers = sourceKitSamplers(weapon.kit.inputs);
      // What this resolver will actually compose: every composable finish, and - where the
      // style's program samples the finish's own pattern - only those whose artwork is staged
      // here. A solid-colour style needs no artwork, so it is offered on its palette alone.
      return entry.finishes.filter((finish) => {
        try {
          const composable = sourceComposableFinish(catalogue, options.weapon, Number(finish.id), samplers);
          if (sourceStyleSamplesPattern(composable.style)) weapon.patternFor(Number(finish.id));
          if(composable.textureReferences.some(ref=>ref.field==='normal'))weapon.normalFor(Number(finish.id));
          return true;
        } catch {
          return false;
        }
      }).map((finish) => Number(finish.id));
    },
  };
}
