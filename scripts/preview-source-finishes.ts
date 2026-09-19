/** Composes original finishes of several weapons in a real browser, from the served bytes.
 *
 * This is the check that the composition path really is driven by a finish rather than by
 * the one finish it was verified against: every finish resolves its own numbers and its own
 * artwork, every finish composes, and the compositions differ. The page also draws the
 * composed color map so the result can be looked at rather than only hashed.
 *
 * The preview covers the style families this port builds programs for: the verified style 7, the
 * styles that combine the finish's own pattern with the finish's own palette (2 and 5), and the
 * solid-colour style 1, whose program samples no pattern at all and takes its colour from the
 * palette constants alone. Two glock finishes of style 1 are composed on purpose: they share one
 * weapon's inputs and one program, so if the palette never reached the shader their two colour maps
 * would be identical.
 */
import { createSourceRedlineCompositor, sourcePaletteRegisters,
  type SourceKitWeaponInput, type SourceRedlinePatternInput } from "../game/source-redline-compositor";
import { createSourceAkFinishResolver } from "../game/source-ak-finishes";
import { createSourceKitFinishResolver } from "../game/source-kit-finishes";
import { sourceRedlineSkinParameters, type SourceRedlineKit, type SourceWeaponPhong }
  from "../game/source-redline-seed";
import { SOURCE_REDLINE_FINISH_SIZES } from "../game/source-redline-render-contract";
import { SOURCE_FINISHES } from "../game/source-finish-table";

const status = document.querySelector("#status") as HTMLElement;
const readout = document.querySelector("#readout") as HTMLElement;
const gallery = document.querySelector("#gallery") as HTMLElement;
const details = document.querySelector("#details") as HTMLElement;

/** One weapon the preview composes: where its finishes and its own inputs are served from, and
 * which original finishes to compose. */
interface Planned {
  weapon: string;
  /** The port's own id for the weapon, which is what the generated finish table is keyed by. */
  port: keyof typeof SOURCE_FINISHES;
  label: string;
  inputBaseURL: string;
  /** Where this weapon's finishes' own pattern textures are served from. The verified AK-47 path's
   * weapon textures and its finishes' artwork live in two different trees; a weapon whose inputs
   * are staged per weapon has both under its own directory. */
  patternBaseURL?: string;
  resolve(paintKitId: number): Promise<{ kit: SourceRedlineKit;
    pattern: SourceRedlinePatternInput | null;
    inputs?: readonly SourceKitWeaponInput[]; phong?: SourceWeaponPhong }>;
  available(): Promise<readonly number[]>;
  finishes: number[];
}

async function main() {
  const ak = createSourceAkFinishResolver({
    catalogueBaseURL: "/catalogue/",
    patternBaseURL: "/patterns/",
  });
  const staged = (weapon: string) => createSourceKitFinishResolver({ weapon,
    catalogueBaseURL: "/catalogue/", kitBaseURL: "/kit-inputs/" });
  const m4a1 = staged("weapon_m4a1"), glock = staged("weapon_glock"), usp = staged("weapon_usp_silencer");
  const plans: Planned[] = [
    // The verified path: the AK-47's own receipt, which is the composition this port checked
    // against the original client's tokens, and the styles it holds the samplers for.
    { weapon: "weapon_ak47", port: "vandal", label: "AK-47", inputBaseURL: "/shared/",
      patternBaseURL: "/patterns/", resolve: ak.resolve, available: ak.available,
      finishes: [282, 302, 180] },
    // A weapon whose inputs are staged per weapon: its own sampled textures, its own Phong values
    // and its own finishes. Two of its styles are composed - the style this port compiled first,
    // the style that multiplies the pattern by the finish's own colours, and the solid-colour
    // style, whose program reads no pattern at all.
    { weapon: "weapon_m4a1", port: "m4a4", label: "M4A1", inputBaseURL: "/kit-inputs/weapon_m4a1/",
      resolve: m4a1.resolve, available: m4a1.available, finishes: [309, 255, 101, 8] },
    // Two finishes of one solid-colour style on one weapon, plus a pattern style: the two share a
    // program and a weapon, so identical maps would mean the palette never reached the shader.
    { weapon: "weapon_glock", port: "glock", label: "格洛克", inputBaseURL: "/kit-inputs/weapon_glock/",
      resolve: glock.resolve, available: glock.available, finishes: [2, 3, 586] },
    // A style that multiplies the finish's own pattern by the finish's own four colours, which only
    // two of this weapon's finishes satisfy the composition's own rules for.
    { weapon: "weapon_usp_silencer", port: "usp", label: "USP", inputBaseURL: "/kit-inputs/weapon_usp_silencer/",
      resolve: usp.resolve, available: usp.available, finishes: [332] },
  ];
  const groups: { weapon: string; label: string; finishes: ReturnType<typeof record>[];
    available: number[]; availableMatchesTable: boolean }[] = [];
  for (const plan of plans) {
    const compositors = new Map<number, Awaited<ReturnType<typeof createSourceRedlineCompositor>>>();
    const results: ReturnType<typeof record>[] = [];
    for (const paintKitId of plan.finishes) {
      const finish = await plan.resolve(paintKitId);
      const style = finish.kit.style;
      let compositor = compositors.get(style);
      if (!compositor) {
        compositor = await createSourceRedlineCompositor({ inputBaseURL: plan.inputBaseURL,
          patternBaseURL: plan.patternBaseURL ?? plan.inputBaseURL, style,
          ...(finish.inputs ? { weaponInputs: finish.inputs } : {}) });
        compositors.set(style, compositor);
      }
      // The palette belongs to the finish and the registers to the style, so a style that declares
      // palette constants is given this finish's own four colours before it composes.
      if (sourcePaletteRegisters(style).length) compositor.setPalette(finish.kit.colours);
      if (finish.pattern) await compositor.setPattern(finish.pattern);
      const parameters = sourceRedlineSkinParameters({ paintKitId, seed: 422, wear: .2 },
        finish.kit, finish.phong);
      const composed = await compositor.compose(parameters,
        SOURCE_REDLINE_FINISH_SIZES.color, SOURCE_REDLINE_FINISH_SIZES.exponent);
      results.push(record(plan.weapon, paintKitId, style, finish.pattern, finish.kit.colours,
        parameters, composed, compositor));
      draw(composed.color);
    }
    for (const compositor of compositors.values()) compositor.dispose();
    const available = [...await plan.available()];
    groups.push({ weapon: plan.weapon, label: plan.label, finishes: results, available,
      // The menu this weapon offers and the transport rule both read the generated table, so the
      // resolver's own list has to be exactly it - a list that offers more would promise a finish the
      // composition refuses, and one that offers less would hide a finish it can draw.
      availableMatchesTable: [...available].sort((one, two) => one - two).join(",")
        === SOURCE_FINISHES[plan.port].map((finish) => finish.paintKitId)
          .sort((one, two) => one - two).join(",") });
  }
  const all = groups.flatMap((group) => group.finishes);
  const distinct = new Set(all.map((entry) => entry.colorSha256)).size;
  const solid = groups.flatMap((group) => group.finishes).filter((entry) => entry.style === 1);
  const solidDistinct = new Set(solid.map((entry) => entry.colorSha256)).size;
  // One pattern finish at two seeds. A paint kit's `pattern_offset_*_start/_end` are the range the
  // client draws that component from - not an animation over the wear - so two seeds are two
  // patterns, which is what a pattern index is. Both drawn transforms have to sit inside the kit's
  // own range, and the two composed colour maps have to differ, or the seed is not reaching the
  // composition.
  const seedSpread: { paintKitId: number; seed: number; fields: readonly number[];
    colorSha256: string; colorOpaque: number }[] = [];
  const ranged = await m4a1.resolve(8);
  const rangedCompositor = await createSourceRedlineCompositor({
    inputBaseURL: "/kit-inputs/weapon_m4a1/", patternBaseURL: "/kit-inputs/weapon_m4a1/",
    style: ranged.kit.style, weaponInputs: ranged.inputs });
  rangedCompositor.setPalette(ranged.kit.colours);
  if (ranged.pattern) await rangedCompositor.setPattern(ranged.pattern);
  for (const seed of [1, 2]) {
    const parameters = sourceRedlineSkinParameters({ paintKitId: 8, seed, wear: .2 },
      ranged.kit, ranged.phong);
    const composed = await rangedCompositor.compose(parameters,
      SOURCE_REDLINE_FINISH_SIZES.color, SOURCE_REDLINE_FINISH_SIZES.exponent);
    seedSpread.push({ paintKitId: 8, seed, fields: parameters.sourceUVFields.pattern,
      colorSha256: composed.color.sha256, colorOpaque: countNonZero(composed.color.rgba) });
    draw(composed.color);
  }
  rangedCompositor.dispose();
  const proof = {
    // Every composition must be its own map. The two solid-colour glock finishes are the ones that
    // would collide if the palette were not bound, and the two seed draws of one pattern finish are
    // the ones that would collide if the kit's ranges were not drawn from, so both are counted.
    status: distinct === all.length
      && new Set(seedSpread.map((entry) => entry.colorSha256)).size === seedSpread.length
      ? "original-finishes-composed-per-weapon" : "compositions-collided",
    weapons: groups,
    finishes: groups[0].finishes,
    composedCount: all.length,
    distinctColorMaps: distinct,
    solidColourCount: solid.length,
    distinctSolidColourMaps: solidDistinct,
    styles: [...new Set(all.map((entry) => entry.style))].sort((one, two) => one - two),
    // Every weapon's own list has to be the generated table's for that weapon.
    availableMatchesTable: groups.every((group) => group.availableMatchesTable),
    availableCounts: Object.fromEntries(groups.map((group) => [group.weapon, group.available.length])),
    seedSpread,
    distinctSeedSpreadMaps: new Set(seedSpread.map((entry) => entry.colorSha256)).size,
  };
  (window as unknown as { __AK_FINISH_PROOF__: unknown }).__AK_FINISH_PROOF__ = proof;
  status.textContent = proof.status === "original-finishes-composed-per-weapon"
    ? `${groups.length} 把武器共 ${all.length} 张原涂装各自合成完成（风格 ${proof.styles.join("/")}，颜色图互不相同）`
    : "有合成结果相同，说明涂装、调色板或武器输入没有真正参与合成";
  readout.textContent = all.map((entry) =>
    `${entry.weapon.replace("weapon_", "")} #${entry.paintKitId} · 风格 ${entry.style} · `
    + `${entry.patternSourceMaterial ? entry.patternSourceMaterial.split("/").pop() : "无图案（纯调色板）"} · `
    + `颜色 ${entry.colorSha256.slice(0, 12)}… · albedo ${entry.phongAlbedoFactor} · `
    + `alpha>0 像素 ${entry.colorOpaque}`).join("\n");
  details.textContent = JSON.stringify(proof, null, 1);
}

type Composed = Awaited<ReturnType<Awaited<ReturnType<typeof createSourceRedlineCompositor>>["compose"]>>;
function record(weapon: string, paintKitId: number, style: number,
  pattern: { sourceMaterial: string; sha256: string } | null,
  colours: readonly (readonly number[])[],
  parameters: { phongExponent: number; phongIntensity: number; phongAlbedoFactor: number },
  composed: Composed, compositor: { boundPattern(): { sha256: string } }) {
  return {
    weapon,
    paintKitId,
    style,
    colours,
    patternSourceMaterial: pattern ? pattern.sourceMaterial : null,
    patternSha256: pattern ? pattern.sha256 : null,
    phongExponent: parameters.phongExponent,
    phongIntensity: parameters.phongIntensity,
    phongAlbedoFactor: parameters.phongAlbedoFactor,
    colorSha256: composed.color.sha256,
    exponentSha256: composed.exponent.sha256,
    colorSize: composed.color.size,
    exponentSize: composed.exponent.size,
    boundPattern: compositor.boundPattern(),
    colorOpaque: countNonZero(composed.color.rgba),
    colorMean: meanOfChannels(composed.color.rgba),
  };
}
/** The mean of the composed colour map's three channels, which is what shows two solid-colour
 * finishes of one style carrying different palettes. */
function meanOfChannels(rgba: Uint8Array) {
  const sums = [0, 0, 0];
  let opaque = 0;
  for (let index = 0; index < rgba.length; index += 4){
    if (!rgba[index + 3]) continue;
    opaque++;
    for (let channel = 0; channel < 3; channel++) sums[channel] += rgba[index + channel];
  }
  return sums.map((sum) => (opaque ? Math.round((sum / opaque) * 10) / 10 : 0));
}
function draw(color: { size: number; rgba: Uint8Array }) {
  const canvas = document.createElement("canvas");
  canvas.width = color.size;
  canvas.height = color.size;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(color.size, color.size);
  image.data.set(color.rgba);
  context.putImageData(image, 0, 0);
  gallery.appendChild(canvas);
}

function countNonZero(rgba: Uint8Array) {
  let count = 0;
  for (let index = 3; index < rgba.length; index += 4) if (rgba[index] > 0) count++;
  return count;
}

main().catch((error) => {
  status.textContent = "合成失败：" + String(error);
  (window as unknown as { __AK_FINISH_PROOF__: unknown }).__AK_FINISH_PROOF__ = { status: "failed", error: String(error) };
});
