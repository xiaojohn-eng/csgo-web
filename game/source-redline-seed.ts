import type {SourceEnvmapParameters} from './source-material-environment';
import { SourceUniformRandomStream } from "./source-spread";
import {
  sourceRedlinePhongMaterialValue,
  sourceRedlineWearMaterialValue,
  sourceRedlineAlbedoMaterialValue,
} from "./source-redline-parameters";
import type { SourceRedlineTransform } from "./source-redline-compositor";
const f = Math.fround;
export type SourceRedlineSkinInput = { paintKitId: number; seed: number; wear: number };
/** The AK-47's own Phong values, which the original caller clones before submitting a
 * composition. Both belong to the weapon rather than to a finish: the shipped AK VMT
 * carries albedo boost 35 and phong boost 2, and the caller preserves the boost and
 * divides the finish's own intensity by the weapon's, truncating to an integer, which is
 * why kit 282's intensity 10 arrives as 5. See `probe-source-redline-phong.py`.
 *
 * They are not the same for every weapon — the M4A1's material carries albedo boost 25 —
 * which is why they travel as a value rather than as constants. */
export const SOURCE_AK_PHONG_BOOST = 2;
export const SOURCE_AK_PHONG_ALBEDO_BOOST = 35;
/** The AK-47's original `$phongfresnelranges`, read from its own weapon VMT by
 * `scripts/extract-source-kit-inputs.py`. The M4A1 happens to carry the same three stops
 * and the AWP does not, which is why they are read per weapon rather than assumed. */
export const SOURCE_AK_PHONG_FRESNEL_RANGES = [0.83, 0.83, 1] as const;
export interface SourceWeaponPhong {
  envmap?:SourceEnvmapParameters;
  /** The weapon material's `$phongboost`; used as the intensity divisor only by the
   * original styles that do not bypass that adjustment. */
  phongBoost: number;
  /** The original weapon material's `$phongalbedoboost`, before the finish's clone branch. */
  phongAlbedoBoost: number;
  /** The weapon material's `$phongfresnelranges`: the three stops the Phong term mixes
   * between. The weapon's own, because the original states them per material. */
  phongFresnelRanges: readonly [number, number, number];
}
export const SOURCE_AK_WEAPON_PHONG: SourceWeaponPhong = Object.freeze({
  phongBoost: SOURCE_AK_PHONG_BOOST,
  phongAlbedoBoost: SOURCE_AK_PHONG_ALBEDO_BOOST,
  phongFresnelRanges: Object.freeze(SOURCE_AK_PHONG_FRESNEL_RANGES),
});
/** One original finish's own numbers, as the staged paint-kit catalogue carries them. */
export interface SourceRedlineKit {
  paintKitId: number;
  /** The finish's style, which picks the original program the composition is built from. */
  style: number;
  /** The finish's four palette colours, as the catalogue writes them. The styles other than
   * the verified one read them into their own palette constants; the verified one declares
   * no such constant and composes from its pattern alone. */
  colours: readonly (readonly number[])[];
  phongExponent: number;
  phongIntensity: number;
  /** The original's own `phongalbedoboost`; -1 means "keep the weapon's". */
  phongAlbedoBoost: number;
  patternScale: number;
  patternOffsetX: readonly [number, number];
  patternOffsetY: readonly [number, number];
  patternRotate: readonly [number, number];
  wearMinimum: number;
  wearMaximum: number;
  /** Native weapon UVScale, or WeaponLength/36 for projected styles. Omitted
   * only for the original ignore-size identity case. Multiplies all 3 scales. */
  textureScale?:number;
}
/** The finish this port verified first: original AK paint kit 282, whose composition was
 * checked against the original client's own tokens. Every other finish is described by
 * the same shape, so this stays the identity case the earlier evidence covers. */
export const SOURCE_REDLINE_KIT_282: SourceRedlineKit = Object.freeze({
  paintKitId: 282,
  style: 7,
  // The Redline's own palette, as the catalogue carries it: four neutrals, which is what the
  // original writes for a finish whose style declares no palette constant at all.
  colours: [[128,128,128],[128,128,128],[128,128,128],[128,128,128]] as readonly (readonly number[])[],
  phongExponent: 150,
  phongIntensity: 10,
  phongAlbedoBoost: -1,
  patternScale: 1,
  patternOffsetX: [0, 0] as const,
  patternOffsetY: [0, 0] as const,
  patternRotate: [0, 0] as const,
  wearMinimum: 0.1,
  wearMaximum: 0.7,
});
export type SourceRedlineUVFields = readonly [
  scale: number,
  offsetX: number,
  offsetY: number,
  rotation: number,
];
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translation = (x: number, y: number) => {
  const a = identity();
  a[3] = x;
  a[7] = y;
  return a;
};
function multiply(a: number[], b: number[]) {
  return Array.from({ length: 16 }, (_, index) => {
    const row = (index >> 2) * 4,
      col = index & 3;
    return f(
      f(f(f(a[row] * b[col]) + f(a[row + 1] * b[col + 4])) + f(a[row + 2] * b[col + 8])) +
        f(a[row + 3] * b[col + 12]),
    );
  });
}
/** Original five-field parser branch 0x327aa..0x3291a, not the generic
 * center/scale/rotate/translate branch. sincosf ABI is host supplied, rounded
 * float32; native matrix arithmetic is checked independently for every UI seed. */
export function sourceRedlineUVMatrix(fields: SourceRedlineUVFields): SourceRedlineTransform {
  const [scale, tx, ty, rotation] = fields.map((n) => f(Number(f(n).toFixed(2))));
  const scaling = identity();
  scaling[0] = scaling[5] = scale;
  const angle = f(rotation * (Math.PI / 180)),
    s = f(Math.sin(angle)),
    c = f(Math.cos(angle)),
    rot = identity();
  rot[0] = rot[5] = c;
  rot[1] = -s;
  rot[4] = s;
  let matrix = multiply(multiply(translation(f(tx - 0.5), f(ty - 0.5)), scaling), rot);
  const half = scale === 0 ? 0.5 : f(0.5 / scale),
    negativeAngle = f(f(-rotation) * f(Math.PI / 180));
  const ns = f(Math.sin(negativeAngle)),
    nc = f(Math.cos(negativeAngle));
  // Preserve the original in-place dependency: the second translation uses
  // the already updated first component. Do not replace with a standard pivot.
  const x = f(f(half * nc) - f(half * ns)),
    y = f(f(ns * x) + f(nc * half));
  matrix = multiply(matrix, translation(x, y));
  return [matrix.slice(0, 4), matrix.slice(4, 8)] as unknown as SourceRedlineTransform;
}
/** UI contract: an original AK finish, seed 0..1000, and inventory wear already inside
 * that finish's own original wear window. No second wear remap and no render-time
 * randomness. The finite seed domain is a validated UI contract, not an engine int32
 * limit.
 *
 * The finish is what varies: its pattern texture is supplied separately, and its own
 * Phong exponent, Phong intensity and wear window come from the staged catalogue. The
 * weapon-level values and the seeded wear/grunge draws do not vary, so kit 282 with the
 * default finish reproduces exactly what the earlier verified composition produced. */
export function sourceRedlineSkinParameters(
  input: SourceRedlineSkinInput,
  kit: SourceRedlineKit = SOURCE_REDLINE_KIT_282,
  weapon: SourceWeaponPhong = SOURCE_AK_WEAPON_PHONG,
) {
  if (input.paintKitId !== kit.paintKitId)
    throw Error(`Redline finish ${kit.paintKitId} cannot be asked for as ${input.paintKitId}`);
  if (!Number.isInteger(weapon.phongBoost) || weapon.phongBoost < 1)
    throw Error("The weapon's original Phong boost must be a positive integer");
  if (!Number.isInteger(weapon.phongAlbedoBoost) || weapon.phongAlbedoBoost < 1)
    throw Error("The weapon's original albedo boost must be a positive integer");
  if (weapon.phongFresnelRanges.length !== 3 || !weapon.phongFresnelRanges.every(Number.isFinite))
    throw Error("The weapon's original Phong Fresnel ranges must be three numbers");
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 1000)
    throw Error("Redline requires seed 0..1000");
  if (
    !Number.isFinite(kit.phongExponent) ||
    kit.phongExponent < 0 ||
    kit.phongExponent > 255 ||
    !Number.isFinite(kit.phongIntensity) ||
    kit.phongIntensity < 0 ||
    kit.phongIntensity > 255
  )
    throw Error("Original paintkit Phong values must be 0..255");
  // The composition's albedo factor, as the original's own parameter branch computes it (that branch
  // has been executed and recorded: `.reference-assets/source-exports/ak47-redline-programs/
  // phong-parameters.json` `clientMaterialCloneParameterBranch` holds material 35 with kit 8 giving
  // 4.375, material 35 with kit -1 giving 35, and material -1 giving the material's phong boost):
  //   kit's phongalbedoboost -1   → the weapon's own value, which is the verified finish's case;
  //   kit's phongalbedoboost >= 0 → the weapon's own value divided by it.
  // The weapon's own value is required to be a positive integer above, so the original's other
  // fallback - a weapon with no albedo boost at all - cannot arise here.
  if (!Number.isFinite(kit.phongAlbedoBoost) || !Number.isInteger(kit.phongAlbedoBoost)
    || kit.phongAlbedoBoost < -1)
    throw Error("Original paintkit albedo boost is not the original's own value");
  // Native zero-boost kits retain +Infinity through CMaterialVar and upload its reciprocal +0.
  const albedoFactor = kit.phongAlbedoBoost === -1
    ? weapon.phongAlbedoBoost
    : f(weapon.phongAlbedoBoost / kit.phongAlbedoBoost);
  for (const [name, pair] of [["x", kit.patternOffsetX], ["y", kit.patternOffsetY],
    ["rotation", kit.patternRotate]] as const)
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some((value) => !Number.isFinite(value)))
      throw Error(`Original paintkit pattern ${name} is not an original pair`);
  if (!Number.isFinite(kit.patternScale) || kit.patternScale === 0)
    throw Error("Original paintkit pattern scale must be a finite non-zero number");
  if (!Number.isFinite(kit.wearMinimum) || !Number.isFinite(kit.wearMaximum)
    || !(kit.wearMaximum >= kit.wearMinimum))
    throw Error("Original paintkit wear window is not a window");
  // The wire hands off a float32 inventory attribute. Decimal catalogue limits
  // must be compared in that same domain, including original minimum/maximum
  // endpoints; material formatting and all following RNG draws stay unchanged.
  const inputWear = f(input.wear);
  if (!Number.isFinite(input.wear) || !Number.isFinite(inputWear) || inputWear < f(kit.wearMinimum) || inputWear > f(kit.wearMaximum))
    throw Error(`Redline finish ${kit.paintKitId} wears from ${kit.wearMinimum} to ${kit.wearMaximum}`);
  const rng = new SourceUniformRandomStream(input.seed);
  // The finish's own pattern transform, drawn the way the client draws it: the scale is the kit's
  // own single value, and the other three components are one draw each from the kit's own ranges,
  // in the order x, y, rotate. A kit whose range is a point - which is what the verified finish's
  // three ranges are - returns exactly that point, so its composition is unchanged; a kit with a
  // real range is where a pattern index shifts, which is the original's own behaviour. The three
  // draws are taken here rather than after the wear transform because they come first in the
  // client's order, and the stream's alignment is what the earlier verification pinned.
  // See `scripts/probe-source-paintkit-transform.py` and `research/source-paintkit-transform.json`.
  const pattern: SourceRedlineUVFields = [
    kit.patternScale,
    rng.randomFloat(kit.patternOffsetX[0], kit.patternOffsetX[1]),
    rng.randomFloat(kit.patternOffsetY[0], kit.patternOffsetY[1]),
    rng.randomFloat(kit.patternRotate[0], kit.patternRotate[1]),
  ];
  const draw = (): SourceRedlineUVFields => [
    rng.randomFloat(f(1.6), f(1.8)),
    rng.randomFloat(),
    rng.randomFloat(),
    rng.randomFloat(0, 360),
  ];
  const wear = draw(),
    grunge = draw();
  const scale=kit.textureScale??1;
  if(!Number.isFinite(scale)||scale<=0)throw Error('Original weapon paint scale must be positive and finite');
  const scaled=(fields:SourceRedlineUVFields):SourceRedlineUVFields=>scale===1?fields:[f(f(fields[0])*f(scale)),fields[1],fields[2],fields[3]];
  const scaledPattern=scaled(pattern),scaledWear=scaled(wear),scaledGrunge=scaled(grunge);
  return {
    phongAlbedoFactor: sourceRedlineAlbedoMaterialValue(albedoFactor),
    phongExponent: sourceRedlinePhongMaterialValue(kit.phongExponent),
    // Original clone 0xf5281c..0xf52845 bypasses division for styles 4, 5, 6 and 8.
    // Other styles truncate the float32 quotient at object+c48 before formatting it.
    phongIntensity: sourceRedlinePhongMaterialValue(
      [4, 5, 6, 8].includes(kit.style) ? kit.phongIntensity
        : Math.trunc(f(kit.phongIntensity / weapon.phongBoost)),
    ),
    // The factor used by the compositor and the boost in the cloned draw material
    // are separate: styles 4/5/6/8/9 force albedo tint and write max(material,kit).
    // Native actual-kit cases: AWP 395 writes 60, Deagle 425 writes 70. Their factors
    // are below one; using those factors as the material boost would also be wrong.
    materialPhong: {
      ...weapon,
      phongAlbedoBoost: [4, 5, 6, 8, 9].includes(kit.style)
        ? Math.max(weapon.phongAlbedoBoost, kit.phongAlbedoBoost) : weapon.phongAlbedoBoost,
    },
    wear: sourceRedlineWearMaterialValue(input.wear),
    pattern: sourceRedlineUVMatrix(scaledPattern),
    wearTransform: sourceRedlineUVMatrix(scaledWear),
    grunge: sourceRedlineUVMatrix(scaledGrunge),
    sourceInput: { ...input },
    sourceUVFields: { pattern:scaledPattern, wear:scaledWear, grunge:scaledGrunge },
    parameterEvidence:
      "original_client_rng_order_and_matrix_arithmetic_host_sincosf_boundary" as const,
  };
}
