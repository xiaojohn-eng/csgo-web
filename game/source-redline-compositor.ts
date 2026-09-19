import { sourceSha256 } from "./source-sha256";
import { sourceRedlineAlbedoShaderConstant, sourceRedlineAlbedoMaterialValue } from "./source-redline-parameters";
import { sourceRedlineSRGBWrite, SOURCE_REDLINE_OUTPUT_BOUNDARY } from "./source-redline-render-contract";
import {
  sourceCustomWeaponFragmentShader,
  sourceRedlineFragmentShader,
  sourceRedlineVertexShader,
  type SourceRedlinePass,
} from "./source-redline-program";
import {SOURCE_CUSTOMWEAPON_PROGRAM_DATA,SOURCE_CUSTOMWEAPON_PROGRAM_STYLES} from "./source-customweapon-program-data";
import {SOURCE_CUSTOMWEAPON_LOW_ALBEDO_DATA} from "./source-customweapon-low-albedo-data";
import {sourceCamoPaletteConstants} from "./source-camo-palette";
/** The style whose program this port compiled and checked against the original's own tokens, and
 * the one the Redline path composes. */
export const SOURCE_REDLINE_STYLE = 7;
/** The styles this port can build a program for: the one it compiled itself, plus the ones the
 * exported program data carries from the original's own tokens. A style outside this list has no
 * program here, so a finish of that style must not be offered - listing it would promise artwork
 * nothing can draw. */
export const SOURCE_COMPOSABLE_STYLES: readonly number[] = Object.freeze([
  SOURCE_REDLINE_STYLE,
  ...SOURCE_CUSTOMWEAPON_PROGRAM_STYLES.map((style) => Number(style)),
]);
/** One style's programs, or a refusal naming the style; a style the data does not carry must not be
 * approximated with another. */
export function sourceCustomWeaponStyleProgram(style: number, materialFactor = 1) {
  sourceRedlineAlbedoMaterialValue(materialFactor);
  const key = String(style);
  const data = materialFactor < 1 ? SOURCE_CUSTOMWEAPON_LOW_ALBEDO_DATA : SOURCE_CUSTOMWEAPON_PROGRAM_DATA;
  if (!Object.prototype.hasOwnProperty.call(data, key))
    throw Error(`The program data carries no CustomWeapon style ${style}${materialFactor < 1 ? " with albedo factor below one" : ""}`);
  return (data as unknown as Record<string, {
    color: {tokens: readonly (readonly number[])[]; samplers: readonly number[];
      constants: readonly {register: number; name: string; count?:number}[]};
    exponent: {tokens: readonly (readonly number[])[]; samplers: readonly number[];
      constants: readonly {register: number; name: string; count?:number}[]};
  }>)[key];
}
/** Whether a style's programs sample the finish's own pattern at all. The styles that do not -
 * the solid-colour ones - take their colour from their own palette constants, so they need no
 * artwork staged and no pattern bound, and a finish of such a style is composable with none.
 *
 * This is read from the programs' own declarations rather than assumed from the style number,
 * because the number is the original's and the samplers are the program's. */
export function sourceStyleSamplesPattern(style: number): boolean {
  if (style === SOURCE_REDLINE_STYLE) return true;
  const data = sourceCustomWeaponStyleProgram(style);
  return [data.color.samplers, data.exponent.samplers]
    .some((list) => list.includes(PATTERN_SAMPLER));
}
/** Whether every sampler a style's two programs declare is one of `samplers`. A style that reads a
 * sampler the weapon's inputs do not hold cannot be composed: that unit would sample unbound, which
 * reads as black rather than as an error. This is the condition the compositor enforces when it
 * binds a weapon's own set, expressed so a resolver can refuse the finish before one is built. */
export function sourceStyleFitsSamplers(style: number, samplers: readonly number[]): boolean {
  if (style === SOURCE_REDLINE_STYLE)
    return SOURCE_REDLINE_VERIFIED_SAMPLERS.every((sampler) => samplers.includes(sampler));
  if (!SOURCE_COMPOSABLE_STYLES.includes(style)) return false;
  const data = sourceCustomWeaponStyleProgram(style);
  return [...data.color.samplers, ...data.exponent.samplers]
    .every((sampler) => samplers.includes(sampler));
}
/** The palette registers a style's colour program declares, in register order. Register 3 is the
 * Phong/wear row every permutation declares and is not a colour; the rest belong to the finish. A
 * style that declares none - the verified one - takes no colours at all. */
export function sourcePaletteRegisters(style: number, materialFactor = 1): readonly number[] {
  if (style === SOURCE_REDLINE_STYLE) return [];
  return sourceCustomWeaponStyleProgram(style, materialFactor).color.constants
    .map((row) => row.register)
    .filter((register) => register < 3)
    .sort((one, two) => one - two);
}
export type SourceRedlineTransform = readonly [
  readonly [number, number, number, number],
  readonly [number, number, number, number],
];
export interface SourceRedlineCompositeParameters {
  /** Material shader values, after original paintkit conversion. */
  phongExponent: number;
  phongIntensity: number;
  phongAlbedoFactor: number;
  wear: number;
  /** Explicit matrices; seed to matrix conversion is a separate contract. */
  pattern: SourceRedlineTransform;
  wearTransform: SourceRedlineTransform;
  grunge: SourceRedlineTransform;
}
/** The weapon-level inputs the original AK composition samples. They belong to the
 * weapon rather than to any finish, so every finish samples these same five from the
 * verified Redline receipt; only the pattern at sampler 8 is the finish's own. */
const SHARED_INPUTS = [
  [0, "rif_ak47_ao.vtf", true],
  [1, "paint_wear.vtf", false],
  [2, "ak47_exponent.vtf", false],
  [3, "v_models/rif_ak47/ak47.vtf", true],
  [5, "gun_grunge.vtf", true],
] as const;
/** Where a finish's own pattern texture is sampled. */
const PATTERN_SAMPLER = 8;
/** The samplers the verified Redline path binds: the five weapon-level textures its own receipt
 * holds, plus the finish's own pattern. A style whose programs read a sampler outside this list
 * cannot be built from that receipt - the unit would sample unbound, which reads as black rather
 * than as an error - which is what limits the styles the AK-47's verified path composes. It is
 * exported so a resolver (and the table generator) can refuse such a style before one is built,
 * from the same list the binding uses rather than from a second copy. */
export const SOURCE_REDLINE_VERIFIED_SAMPLERS: readonly number[] = [
  ...SHARED_INPUTS.map(([sampler]) => sampler), PATTERN_SAMPLER,
];
/** The sampler a finish's own pattern texture is bound at, for a caller that has to decide whether
 * a weapon's inputs cover the styles that sample it. */
export const SOURCE_REDLINE_PATTERN_SAMPLER = PATTERN_SAMPLER;
/** A finish's own pattern texture, as the staged pattern manifest describes it. When one
 * is given it replaces the receipt's own sampler-8 texture, so a finish is composed from
 * its own artwork rather than the verified finish's. */
/** One texture the composition binds, named by the sampler the original program reads it
 * at. A weapon's own set comes from the staged kit manifest; the AK's set comes from the
 * verified Redline receipt, which is what keeps that composition unchanged. */
export interface SourceKitWeaponInput {
  /** The original program's own sampler index. */
  sampler: number;
  srgb: boolean;
  /** The original material the PNG was decoded from. */
  source: string;
  path: string;
  bytes: number;
  sha256: string;
  rgba8Sha256: string;
  width: number;
  height: number;
  vtfFlags: number;
}
export interface SourceRedlinePatternInput {
  paintKitId: number;
  /** The original material the PNG was decoded from. */
  sourceMaterial: string;
  /** Path of the PNG relative to the pattern base URL. */
  path: string;
  bytes: number;
  sha256: string;
  rgba8Sha256: string;
  width: number;
  height: number;
  vtfFlags: number;
}
interface TextureReceipt {
  path: string;
  png: string;
  pngSha256: string;
  rgba8Sha256: string;
  width: number;
  height: number;
  vtfFlags: number;
}
/** Private deterministic compositor using original style7 VS/PS instructions.
 * It produces candidate color and exponent maps, not a verified inventory skin.
 * Inputs stay original; only mip0 with bilinear filtering is currently selected.
 * Original input filter/mip bytes and final compressed pixels remain outstanding. */
export async function createSourceRedlineCompositor(options: {
  inputBaseURL: string;
  /** A finish's own pattern texture. Omitted, the verified finish's own is used, which
   * keeps the composition this port already checked byte for byte unchanged. */
  pattern?: SourceRedlinePatternInput;
  /** Where a finish's own pattern PNG lives. Required to compose any finish other than
   * the one the receipt already holds, because `setPattern` fetches from here; it is not
   * derived from `inputBaseURL`, which holds the weapon's textures rather than the
   * finishes'. */
  patternBaseURL?: string;
  /** A weapon's own sampled textures. Omitted, the five come from the verified Redline
   * receipt; given, they are taken as the weapon's own set and the receipt is not read,
   * because it would be a different weapon's. Such a weapon has no initial pattern -- the
   * verified receipt's is another weapon's artwork -- so a finish's own must be bound with
   * `setPattern` before it can be composed, and `patternBaseURL` is required for that. */
  weaponInputs?: readonly SourceKitWeaponInput[];
  /** The finish's style, which picks the original program to build. The Redline path's own
   * style is the default, and it is built from the shader this port already compiled; any
   * other style is built from the original's own tokens in the program data, and declares
   * its own samplers, its own constants and - for the styles that carry colours - its own
   * palette registers. A style the data does not carry is refused rather than approximated. */
  style?: number;
  /** Original selector includes 800*(factor<1), so this creates that factor's
   * program pair. The owner caches by both style and this branch. */
  phongAlbedoFactor?: number;
  /** The finish's four palette colours, as the catalogue writes them. Every style except the
   * verified one reads them, so a style that declares palette constants uses these as its initial
   * palette; a different finish of the same style binds its own with `setPalette`. */
  colours?: readonly (readonly number[])[];
  signal?: AbortSignal;
}) {
  const signal = options.signal,
    base = new URL(options.inputBaseURL, location.href),
    patternBase = new URL(options.patternBaseURL ?? options.inputBaseURL, location.href);
  const style = options.style ?? SOURCE_REDLINE_STYLE;
  const materialFactor = options.phongAlbedoFactor ?? 1;
  sourceRedlineAlbedoMaterialValue(materialFactor);
  const lowAlbedo = materialFactor < 1;
  const styleData = style === SOURCE_REDLINE_STYLE && !lowAlbedo
    ? null : sourceCustomWeaponStyleProgram(style, materialFactor);
  // The palette registers the style's own colour program declares, packed from the finish's four
  // colours. A style that declares none takes none. The palette belongs to the finish rather than
  // to the style - two finishes of one style pack different colours into the same registers - so
  // it is a binding the caller may replace with `setPalette`, and a composition that ran before a
  // palette was bound is refused rather than uploaded as zeroes.
  const paletteRegisters = sourcePaletteRegisters(style, materialFactor);
  let palette = paletteRegisters.length && options.colours
    ? sourceCamoPaletteConstants(options.colours, paletteRegisters)
    : [];
  // A style whose programs declare no pattern sampler has no artwork to bind: the colour comes from
  // the palette, so requiring a pattern would invent one.
  const styleReadsPattern = sourceStyleSamplesPattern(style);
  if (options.weaponInputs && !options.patternBaseURL && styleReadsPattern)
    throw Error("A weapon's own inputs need the pattern base URL its finishes are served from");
  // The verified AK path reads its receipt; a weapon with its own staged inputs does not,
  // because that receipt would be another weapon's.
  let receipt: { status: string; paintKitId: number; paintKit: { style: string };
    textures: TextureReceipt[] } | null = null;
  if (!options.weaponInputs) {
    const response = await fetch(new URL("inputs.json", base), { signal, cache: "no-cache" });
    if (!response.ok) throw Error("Redline inputs HTTP " + response.status);
    const receiptBytes = new Uint8Array(await response.arrayBuffer());
    if (
      (await sourceSha256(receiptBytes, signal)) !==
      "05323cbe72df4921c9f92b324dfd52214787aced339bdcd5f3e36f877a649243"
    )
      throw Error("Original Redline input receipt checksum differs");
    receipt = JSON.parse(new TextDecoder().decode(receiptBytes)) as typeof receipt;
    if (
      receipt!.status !== "inputs_extracted_no_composite" ||
      receipt!.paintKitId !== 282 ||
      receipt!.paintKit.style !== "7"
    )
      throw Error("Original Redline input identity differs");
  }
  const canvas = document.createElement("canvas"),
    gl = canvas.getContext("webgl2", { alpha: true, antialias: false })!;
  if (!gl) throw Error("WebGL2 required for original CustomWeapon candidate");
  const textures: WebGLTexture[] = [],
    shaders: WebGLShader[] = [],
    programs = new Map<SourceRedlinePass, WebGLProgram>();
  const fb = gl.createFramebuffer(),
    vao = gl.createVertexArray();
  let disposed = false,
    busy = false,
    checkedBytes = 0;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const p of programs.values()) gl.deleteProgram(p);
    for (const s of shaders) gl.deleteShader(s);
    for (const t of textures) gl.deleteTexture(t);
    gl.deleteFramebuffer(fb);
    gl.deleteVertexArray(vao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
  const compile = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    shaders.push(s);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)!);
    return s;
  };
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.bindVertexArray(vao);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    // One descriptor per sampler. The five weapon-level inputs come from the verified
    // receipt; sampler 8 is the finish's own pattern, from its own manifest when one was
    // supplied and from the receipt otherwise. Only the pattern is ever replaced later,
    // so a finish can be composed without a second set of the weapon's textures.
    const fromReceipt = (sampler: number, suffix: string, srgb: boolean) => {
      const candidates = receipt!.textures.filter((t) => t.path.endsWith(suffix));
      if (candidates.length !== 1) throw Error("Original Redline sampler identity differs");
      const t = candidates[0];
      if (
        t.width < 1 ||
        t.height < 1 ||
        Math.max(t.width, t.height) > 2048 ||
        !t.png.startsWith(".reference-assets/source-exports/ak47-redline-inputs/png/")
      )
        throw Error("Redline input texture budget/path differs");
      const path = t.png.slice(".reference-assets/source-exports/ak47-redline-inputs/".length);
      if (path.includes("..")) throw Error("Invalid original Redline input path");
      return { sampler, srgb, source: t.path, base, path, bytes: null as number | null,
        sha256: t.pngSha256, rgba8Sha256: t.rgba8Sha256, width: t.width, height: t.height,
        vtfFlags: t.vtfFlags };
    };
    /** A weapon's own input, checked the way the receipt's own are. */
    const fromWeaponInput = (input: SourceKitWeaponInput) => {
      if (!Number.isInteger(input.sampler) || input.sampler < 0 || input.sampler >= 16)
        throw Error("Original weapon input sampler differs");
      if (![input.width, input.height, input.bytes, input.vtfFlags].every(Number.isInteger)
        || input.width < 1 || input.height < 1 || Math.max(input.width, input.height) > 2048
        || input.bytes < 1 || input.vtfFlags < 0)
        throw Error("Original weapon input budget differs");
      if (!/^[0-9a-f]{64}$/.test(input.sha256) || !/^[0-9a-f]{64}$/.test(input.rgba8Sha256))
        throw Error("Original weapon input digest differs");
      if (typeof input.source !== "string" || !input.source
        || input.path.includes("..") || input.path.startsWith("/"))
        throw Error("Original weapon input identity differs");
      return { sampler: input.sampler, srgb: input.srgb, source: input.source, base, path: input.path,
        bytes: input.bytes as number | null, sha256: input.sha256, rgba8Sha256: input.rgba8Sha256,
        width: input.width, height: input.height, vtfFlags: input.vtfFlags };
    };
    const patternDescriptor = (p: SourceRedlinePatternInput) => {
      if (p.path.includes("..") || p.path.startsWith("/"))
        throw Error("Invalid original pattern input path");
      if (
        !Number.isInteger(p.paintKitId) || p.paintKitId < 1 ||
        !Number.isInteger(p.width) || !Number.isInteger(p.height) ||
        p.width < 1 || p.height < 1 || Math.max(p.width, p.height) > 2048 ||
        !Number.isInteger(p.bytes) || p.bytes < 1 ||
        !Number.isInteger(p.vtfFlags) || p.vtfFlags < 0 ||
        !/^[0-9a-f]{64}$/.test(p.sha256) || !/^[0-9a-f]{64}$/.test(p.rgba8Sha256) ||
        typeof p.sourceMaterial !== "string" || !p.sourceMaterial
      )
        throw Error("Original pattern input budget/identity differs");
      return { sampler: PATTERN_SAMPLER, srgb: true, source: p.sourceMaterial, base: patternBase,
        path: p.path, bytes: p.bytes as number | null, sha256: p.sha256, rgba8Sha256: p.rgba8Sha256,
        width: p.width, height: p.height, vtfFlags: p.vtfFlags };
    };
    type Descriptor = ReturnType<typeof fromReceipt>;
    let patternTexture: WebGLTexture | null = null;
    /** Uploads one original texture, verifying its bytes, its decode and its address
     * modes. Replacing the pattern releases the one it replaces, so a sequence of
     * finishes does not grow the texture set. */
    /** Uploads one original texture, verifying its bytes and, on the load path, the
     * pixels it decodes to.
     *
     * `verifyPixels` is the decoded-pixel read-back: it uploads the texture, re-reads it
     * through the framebuffer and compares the bytes, which is how the load path proves
     * the browser decoded the original PNG to the pixels the original decoder produced.
     * It is only reliable while the framebuffer's attachment is not being swapped: after
     * a swap the read can observe the previous attachment or nothing at all, so a swap is
     * verified by its bytes, its dimensions and the composition that follows instead of
     * by a read that would report the attachment's state rather than the texture's.
     */
    const upload = async (t: Descriptor, verifyPixels: boolean) => {
      signal?.throwIfAborted();
      const r = await fetch(new URL(t.path, t.base), { signal, cache: "no-cache" });
      if (!r.ok) throw Error("Redline texture HTTP " + r.status);
      const bytes = await r.arrayBuffer();
      if (t.bytes !== null && bytes.byteLength !== t.bytes)
        throw Error("Original pattern input byte count differs");
      if ((await sourceSha256(new Uint8Array(bytes), signal)) !== t.sha256)
        throw Error("Original Redline PNG checksum differs");
      checkedBytes += bytes.byteLength;
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
        colorSpaceConversion: "none",
        premultiplyAlpha: "none",
        imageOrientation: "none",
      });
      if (bitmap.width !== t.width || bitmap.height !== t.height) {
        bitmap.close();throw Error("Original Redline bitmap dimensions differ");
      }
      const tex = gl.createTexture()!;
      textures.push(tex);
      gl.activeTexture(gl.TEXTURE0 + t.sampler);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      try { gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        t.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bitmap,
      ); } finally { bitmap.close(); }
      // texImage2D copies pixels. Keeping every replaced pattern bitmap alive
      // would accumulate full-resolution CPU images during same-style switches.
      // The upload itself can fail — a context that cannot hold another texture of this
      // size leaves the texture empty, and every read of it then returns zeros, which is
      // indistinguishable from a wrong texture unless the error is asked for.
      const uploadError = gl.getError();
      if (uploadError !== gl.NO_ERROR)
        throw Error(`Original GPU upload failed for ${t.source}: GL error ${uploadError}`);
      // The sampling state is set before the texture is read or used: the default
      // minification filter expects a mip pyramid this upload does not have.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, t.vtfFlags & 4 ? gl.CLAMP_TO_EDGE : gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, t.vtfFlags & 8 ? gl.CLAMP_TO_EDGE : gl.REPEAT);
      if (verifyPixels) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw Error("Original Redline input framebuffer incomplete");
        gl.finish();
        const decoded = new Uint8Array(t.width * t.height * 4);
        gl.readPixels(0, 0, t.width, t.height, gl.RGBA, gl.UNSIGNED_BYTE, decoded);
        const readError = gl.getError();
        if (readError !== gl.NO_ERROR)
          throw Error(`Original GPU read failed for ${t.source}: GL error ${readError}`);
        const decodedSha = await sourceSha256(decoded, signal);
        if (decodedSha !== t.rgba8Sha256)
          // Naming the texture matters: a mismatch is a property of that texture, and
          // without the name the only way to find it is to bisect the input list.
          throw Error(`Original GPU decoded pixels differ for ${t.source}: read `
            + `${decodedSha.slice(0, 12)}… expected ${t.rgba8Sha256.slice(0, 12)}…`);
        // Detached once verified, so the next attachment starts from a clean framebuffer.
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      }
      if (t.sampler === PATTERN_SAMPLER) {
        // The replaced texture is released here rather than at disposal, so composing a
        // sequence of finishes holds one pattern at a time.
        if (patternTexture) {
          gl.deleteTexture(patternTexture);
          const at = textures.indexOf(patternTexture);
          if (at >= 0) textures.splice(at, 1);
        }
        patternTexture = tex;
      }
      return tex;
    };
    const inputs = options.weaponInputs
      ? options.weaponInputs.map(fromWeaponInput)
      : SHARED_INPUTS.map(([sampler, suffix, srgb]) => fromReceipt(sampler, suffix, srgb));
    // The program declares which samplers it reads, so a weapon's own set has to cover
    // exactly those. Without this, a mis-staged set would bind a texture to a unit the
    // program never samples and leave a unit it does sample unbound, which samples as
    // black rather than as an error. The pattern is bound separately, so it is not counted
    // here; a style that reads no pattern simply declares fewer samplers.
    const programSamplers = (styleData
      ? [...new Set([...styleData.color.samplers, ...styleData.exponent.samplers])]
      : SHARED_INPUTS.map(([sampler]) => sampler))
      .filter((sampler) => sampler !== PATTERN_SAMPLER)
      .sort((one, two) => one - two);
    const boundSamplers = inputs.map((t) => t.sampler).sort((one, two) => one - two);
    // A weapon's staged set serves every style, so it may carry samplers this program does not read;
    // what it must not do is miss one the program does read, which would sample as black.
    const wanted = inputs.filter((t) => programSamplers.includes(t.sampler));
    if (wanted.map((t) => t.sampler).sort((one, two) => one - two).join(",") !== programSamplers.join(","))
      throw Error(`A weapon's own inputs cover samplers ${boundSamplers.join(",")}, `
        + `and this program reads ${programSamplers.join(",")}`);
    for (const t of wanted) await upload(t, true);
    // The verified path's pattern lives beside its receipt rather than in the pattern
    // directory, and is bound up front; a weapon with its own inputs has no artwork until
    // a finish asks for one, so the first composition must wait for `setPattern`.
    if (!styleReadsPattern && options.pattern)
      throw Error(`CustomWeapon style ${style} samples no pattern, so the pattern given would be ignored`);
    const initialPattern = !styleReadsPattern
      ? null
      : options.pattern
        ? patternDescriptor(options.pattern)
        : options.weaponInputs ? null : fromReceipt(PATTERN_SAMPLER, "elegantredv1.1.vtf", true);
    if (initialPattern) await upload(initialPattern, true);
    let boundPattern: { paintKitId: number | null; sourceMaterial: string | null; sha256: string } = {
      paintKitId: options.pattern ? options.pattern.paintKitId : null,
      sourceMaterial: initialPattern ? initialPattern.source : null,
      sha256: initialPattern ? initialPattern.sha256 : "",
    };
    const vs = compile(gl.VERTEX_SHADER, sourceRedlineVertexShader());
    for (const pass of ["color", "exponent"] as const) {
      const p = gl.createProgram()!;
      programs.set(pass, p);
      gl.attachShader(p, vs);
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, styleData
        ? sourceCustomWeaponFragmentShader({
            tokens: styleData[pass].tokens, samplers: styleData[pass].samplers,
            constants: styleData[pass].constants.flatMap((row) => Array.from({length:row.count??1},(_,i)=>row.register+i))})
        : sourceRedlineFragmentShader(pass)));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p)!);
      gl.useProgram(p);
      // Each pass binds exactly the samplers its own program declares; the verified path binds its
      // five plus the pattern, which is what it has always done.
      for (const sampler of styleData
        ? styleData[pass].samplers
        : [...programSamplers, PATTERN_SAMPLER])
        gl.uniform1i(gl.getUniformLocation(p, "s" + sampler), sampler);
    }
    signal?.throwIfAborted();
    const audit = {
      status: style === SOURCE_REDLINE_STYLE ? "original_style7_shader_candidate"
        : "original_customweapon_shader_candidate",
      checkedBytes,
      originalPNGChecksumsVerified: true,
      originalDecodedGPUChecksumsVerified: true,
      samplers: [...wanted.map((t) => ({ sampler: t.sampler, source: t.source, srgb: t.srgb })),
        ...(initialPattern
          ? [{ sampler: PATTERN_SAMPLER, source: initialPattern.source, srgb: initialPattern.srgb }]
          : [])],
      // The weapon-level inputs never change; the finish's own pattern is reported by
      // each composition, since it is what a caller can replace.
      patternSampler: PATTERN_SAMPLER,
      seedMappingVerified: false,
      originalClientOutputCompared: false,
      mip: "explicit mip0 bilinear",
      outputEncoding: {
        color: "WebGL SRGB8_ALPHA8 framebuffer",
        exponent: "WebGL RGBA8 framebuffer",
      },
      outputBoundary: SOURCE_REDLINE_OUTPUT_BOUNDARY,
      shaderSelection: { style, lowAlbedo, colorStatic: style + (lowAlbedo ? 160 : 0),
        exponentStatic: style + 10 + (lowAlbedo ? 160 : 0) },
    };
    return {
      audit,
      dispose,
      /** Binds a finish's own pattern. Composing without one uses the receipt's, which is
       * the verified finish's; this is what lets another original finish be composed
       * without a second set of the weapon's textures. */
      setPattern: async (input: SourceRedlinePatternInput) => {
        if (disposed) throw Error("Original Redline compositor disposed");
        if (busy) throw Error("Original Redline compositor already composing");
        if (!styleReadsPattern)
          throw Error(`CustomWeapon style ${style} samples no pattern, so one cannot be bound`);
        if (!options.patternBaseURL)
          throw Error("Composing another finish needs the pattern base URL it is served from");
        const descriptor = patternDescriptor(input);
        if (boundPattern.paintKitId === input.paintKitId && boundPattern.sha256 === input.sha256) return;
        busy = true;
        try {
          await upload(descriptor, false);
          boundPattern = { paintKitId: input.paintKitId, sourceMaterial: descriptor.source,
            sha256: descriptor.sha256 };
        } finally {
          busy = false;
        }
      },
      /** Binds a finish's four colours, packed into the registers this style's colour program
       * declares. The registers belong to the style and the colours to the finish, which is why
       * this is separate from construction: two finishes of one style pack different colours into
       * the same three constants. A style that declares no palette constant takes none. */
      setPalette: (colours: readonly (readonly number[])[]) => {
        if (disposed) throw Error("Original Redline compositor disposed");
        if (busy) throw Error("Original Redline compositor already composing");
        if (!paletteRegisters.length)
          throw Error(`CustomWeapon style ${style} declares no palette constant, so it takes no colours`);
        palette = sourceCamoPaletteConstants(colours, paletteRegisters);
      },
      /** The finish whose own pattern is currently bound, or null for the verified one. */
      boundPattern: () => ({ ...boundPattern }),
      // Explicit same-size diagnostics retain the old second argument. Runtime
      // owner supplies the separately verified exponent descriptor as argument 3.
      compose: async (parameters: SourceRedlineCompositeParameters, size = 2048, exponentSize = size) => {
        if (disposed) throw Error("Original Redline compositor disposed");
        if (busy) throw Error("Original Redline compositor already composing");
        if ((parameters.phongAlbedoFactor < 1) !== lowAlbedo)
          throw Error("CustomWeapon composition factor selects a different program pair");
        // A weapon with its own inputs starts with no artwork bound, so a composition that
        // ran before a finish asked for one would sample an empty pattern unit and look
        // like a composition rather than like a missing input. A style whose program reads
        // no pattern has nothing to bind and composes from its palette alone.
        if (styleReadsPattern && !patternTexture) throw Error("This weapon has no finish pattern bound to compose");
        // A style whose colour program reads palette constants composes from the finish's own four
        // colours, so a composition before one is bound would upload zeroes and look like a finish.
        if (paletteRegisters.length && !palette)
          throw Error(`CustomWeapon style ${style} reads ${paletteRegisters.length} palette constants and no colours were given`);
        signal?.throwIfAborted();
        if (
          !Number.isInteger(size) ||
          size < 1 ||
          size > 2048 ||
          !Number.isInteger(exponentSize) || exponentSize < 1 || exponentSize > 2048 ||
          ![
            parameters.phongExponent,
            parameters.phongIntensity,
            parameters.wear,
            ...parameters.pattern.flat(),
            ...parameters.wearTransform.flat(),
            ...parameters.grunge.flat(),
          ].every(Number.isFinite)
        )
          throw Error("Invalid explicit Redline composite parameters");
        sourceRedlineAlbedoMaterialValue(parameters.phongAlbedoFactor);
        busy = true;
        const target = gl.createTexture()!;
        gl.activeTexture(gl.TEXTURE9);
        gl.bindTexture(gl.TEXTURE_2D, target);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        const result = {} as Record<SourceRedlinePass, { size: number; rgba: Uint8Array; sha256: string }>;
        try {
          for (const pass of ["color", "exponent"] as const) {
            const passSize = pass === "color" ? size : exponentSize;
            gl.viewport(0, 0, passSize, passSize);
            if (disposed) throw Error("Original Redline compositor disposed");
            signal?.throwIfAborted();
            const p = programs.get(pass)!;
            gl.useProgram(p);
            gl.uniform1ui(gl.getUniformLocation(p, "sourceRoundBarrier"), 0);
            gl.uniform4fv(gl.getUniformLocation(p, "c3"), [
              sourceRedlineAlbedoShaderConstant(parameters.phongAlbedoFactor),
              parameters.phongExponent,
              parameters.phongIntensity,
              parameters.wear,
            ]);
            // The palette the style's own colour program reads, in the registers it declares. The
            // exponent program declares none, so it takes none - the same list decides both.
            if (pass === "color")
              for (const row of palette)
                gl.uniform4fv(gl.getUniformLocation(p, "c" + row.register),
                  row.values as unknown as number[]);
            // Original projected styles copy the first two matrix rows to PS c10/c11.
            // This is the same material transform used by VS c48/c49.
            if(pass==='color'&&(style===3||style===6))for(const[index,row]of parameters.pattern.entries())
              gl.uniform4fv(gl.getUniformLocation(p,'c'+(10+index)),row);
            for (const [index, row] of [
              ...parameters.pattern,
              ...parameters.wearTransform,
              ...parameters.grunge,
            ].entries())
              gl.uniform4fv(gl.getUniformLocation(p, "c" + (48 + index)), row);
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              sourceRedlineSRGBWrite(pass) ? gl.SRGB8_ALPHA8 : gl.RGBA8,
              passSize,
              passSize,
              0,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              null,
            );
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
              throw Error("Original Redline output framebuffer incomplete");
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            const rgba = new Uint8Array(passSize * passSize * 4);
            gl.readPixels(0, 0, passSize, passSize, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
            const error = gl.getError();
            if (error !== gl.NO_ERROR) throw Error("Original Redline GPU error " + error);
            result[pass] = { size: passSize, rgba, sha256: await sourceSha256(rgba, signal) };
          }
          return { size, parameters, color: result.color, exponent: result.exponent,
            pattern: { ...boundPattern }, audit };
        } finally {
          gl.deleteTexture(target);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          busy = false;
        }
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
