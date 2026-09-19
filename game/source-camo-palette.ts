/** How a finish's four colours reach a permutation's palette constants.
 *
 * The packing is not a rule anyone had to infer: it is what the permutations' own constant tables
 * declare. `g_cCamo0_camo3r`, `g_cCamo1_camo3g` and `g_cCamo2_camo3b` are three vec4 constants, and
 * three vec4s hold exactly four RGB colours - so each constant carries one colour in its first three
 * channels and one channel of the fourth colour in `w`. The translated bodies agree where that can be
 * checked: styles 1, 2 and 5 read `cN.xyzw` and `cN.wwww` separately, which is what a `w` holding a
 * different colour implies, and style 4 declares only `c0` and reads only the whole vector.
 *
 * The catalogue preserves each original RGB or RGBA colour. The client filler reads only
 * bytes +0/+1/+2 from the four-byte colour records at kit +0xbc/+0xc0/+0xc4/+0xc8;
 * the fourth byte is not copied into its RGB vectors (research/source-camo-palette.json).
 * This keeps e.g. AWP 395's original [24,32,54,255] intact while composing from its RGB.
 * The client uploads
 * them scaled by a global whose four bytes are exactly the float32 nearest 1/255 (read from
 * `0x1936e9c`), so the same scale is applied here rather than a decimal that rounds to it.
 *
 * A style that declares no palette constant takes none of these; one that declares fewer takes only
 * the ones it names.
 */
const ONE_OVER_255 = Math.fround(1 / 255);

/** The registers the declarations put the three palette constants in, in colour order. */
export const SOURCE_CAMO_REGISTERS = [0, 1, 2] as const;
/** The channel of the fourth colour each constant carries in its `w`. */
const FOURTH_CHANNEL = ["r", "g", "b"] as const;

export interface SourceCamoConstant {
  /** The constant register the permutation declares, which is what the shader reads. */
  register: number;
  /** The four components, in the order the shader's own swizzles read them. */
  values: readonly [number, number, number, number];
}

function fail(message: string): never {
  throw Error("Finish palette: " + message);
}

/** Packs a finish's four colours into the constants a permutation declares.
 *
 * `registers` is the list the style's own constant table names - styles 1, 2 and 5 declare all
 * three, style 4 only the first, and style 7 none. Asking for more than the style declares would
 * upload a uniform the program never reads. */
export function sourceCamoPaletteConstants(
  colours: readonly (readonly number[])[],
  registers: readonly number[] = SOURCE_CAMO_REGISTERS,
): SourceCamoConstant[] {
  if (!Array.isArray(colours) || colours.length !== 4) fail("a finish carries four colours");
  for (const [index, colour] of colours.entries()) {
    if (!Array.isArray(colour) || (colour.length !== 3 && colour.length !== 4))
      fail(`colour ${index} must be original RGB or RGBA`);
    for (const [channel, value] of colour.entries()) {
      if (!Number.isInteger(value) || value < 0 || value > 255)
        fail(`colour ${index} channel ${channel} is ${String(value)}, not 0..255`);
    }
  }
  const fourth = colours[3];
  const packed = new Map<number, readonly [number, number, number, number]>();
  SOURCE_CAMO_REGISTERS.forEach((register, index) => {
    const colour = colours[index];
    // The fourth colour's r, g and b go into the three constants' `w` in register order.
    packed.set(register, [colour[0], colour[1], colour[2], fourth[index]].map(
      (value) => Math.fround(value * ONE_OVER_255)) as [number, number, number, number]);
  });
  const wanted = [...registers];
  if (new Set(wanted).size !== wanted.length) fail("a register is named twice");
  for (const register of wanted)
    if (!packed.has(register)) fail(`a permutation has no palette constant in register ${register}`);
  return wanted.map((register) => ({register, values: packed.get(register)!}));
}

/** The four colours as the catalogue writes them, for a message. */
export function sourceCamoPaletteDescription(colours: readonly (readonly number[])[]): string {
  return colours.map((colour) => colour.join(",")).join(" / ");
}

/** The scale the client multiplies by, exported so a caller can state it rather than repeat it. */
export const SOURCE_CAMO_BYTE_SCALE = ONE_OVER_255;
/** The channels of the fourth colour, in register order, for a reader of this file. */
export const SOURCE_CAMO_FOURTH_CHANNELS = FOURTH_CHANNEL;
