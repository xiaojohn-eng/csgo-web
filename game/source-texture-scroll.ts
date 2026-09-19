/** The original `texturescroll` material proxy, as its own installed client composes it.
 *
 * Dust2's second sky layer names this proxy twice (once for `$basetexturetransform`, once
 * for `$texture2transform`), and nothing in the shipped material says what the three
 * numbers mean. They were read out of the client's own code instead
 * (`scripts/probe-source-texture-scroll-apply.py`, `research/source-texture-scroll-apply.json`):
 *
 *   * the angle is converted to radians with the client's own double `pi/180`,
 *   * `sincos` of that angle gives the drift direction,
 *   * each offset is `frac(curtime * rate * direction)`, the fractional part with 1.0 added
 *     when the product is negative, so both stay in `[0, 1)`,
 *   * `scale` only multiplies the two diagonal entries, so it scales the texture rather
 *     than rotating it, and the angle appears nowhere else,
 *   * the matrix is `[scale 0 0 u; 0 scale 0 v; 0 0 1 0; 0 0 0 1]` and is written through the
 *     material variable's `SetMatrixValue` (a non-matrix variable gets the two offsets as a
 *     vector instead).
 *
 * The material files spell the keys in lower case (`texturescrollvar`, `texturescrollrate`,
 * `texturescrollangle`, `texturescale`) while the client reads camel case; the engine's
 * KeyValues lookups ignore case, which is why both spellings are the same keys.
 */

/** The client ships this double for degrees to radians; the probe asserts the exact value. */
export const SOURCE_TEXTURE_SCROLL_DEGREES_TO_RADIANS = 0.017453292519943295;
/** The two transforms the shipped sky material names. */
export const SOURCE_TEXTURE_SCROLL_TRANSFORMS = ['$basetexturetransform', '$texture2transform'] as const;
export type SourceTextureScrollTransform = (typeof SOURCE_TEXTURE_SCROLL_TRANSFORMS)[number];

/** One `texturescroll` proxy block of one shipped material. */
export type SourceTextureScrollBlock = {
  variable: string; rate: number; angleDegrees: number; scale: number;
};
/** What one material stages: the blocks its own `proxies` block declares. */
export type SourceTextureScrollParameters = {
  rate: number; angleDegrees: number; scale: number;
};

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid original texture scroll: ${message}`);
}

/** The proxy's own wrap, measured at the branch that adds the client's 1.0: the fractional
 * part of the value, shifted up when the value is negative. */
export function sourceTextureScrollFraction(value: number): number {
  check(Number.isFinite(value), `a non-finite scroll product ${value}`);
  const fraction = value - Math.trunc(value);
  return fraction < 0 ? fraction + 1 : fraction;
}

/** The two offsets the proxy writes, at one clock reading. */
export function sourceTextureScrollOffsets(parameters: SourceTextureScrollParameters, timeSeconds: number) {
  const { rate, angleDegrees, scale } = parameters;
  check(Number.isFinite(rate) && Number.isFinite(angleDegrees) && Number.isFinite(scale),
    `non-finite parameters ${JSON.stringify(parameters)}`);
  check(Number.isFinite(timeSeconds), `a non-finite clock ${timeSeconds}`);
  const radians = angleDegrees * SOURCE_TEXTURE_SCROLL_DEGREES_TO_RADIANS;
  return { u: sourceTextureScrollFraction(timeSeconds * rate * Math.cos(radians)),
    v: sourceTextureScrollFraction(timeSeconds * rate * Math.sin(radians)) };
}

/** The 4x4 the proxy hands to `SetMatrixValue`, row-major: the two offsets sit in the last
 * column of the first two rows and the scale on both diagonals, with nothing else. */
export function sourceTextureScrollMatrix(parameters: SourceTextureScrollParameters, timeSeconds: number): number[] {
  const { u, v } = sourceTextureScrollOffsets(parameters, timeSeconds);
  const { scale } = parameters;
  return [scale, 0, 0, u, 0, scale, 0, v, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** The staged blocks of one material, checked the way the runtime reads them. The values
 * the material does not state keep the proxy's own defaults, which the probe read as
 * rate 1, angle 0 and scale 1 (and a variable name of the empty string, i.e. nothing to
 * write, which the material always overrides here). */
export function sourceTextureScrollBlocks(raw: unknown): SourceTextureScrollBlock[] {
  if (raw === undefined) return [];
  check(Array.isArray(raw), 'the staged blocks are not a list');
  return raw.map((row, index) => {
    check(row && typeof row === 'object', `block ${index} is not an object`);
    const block = row as Record<string, unknown>;
    const variable = block.variable;
    check(typeof variable === 'string' && (SOURCE_TEXTURE_SCROLL_TRANSFORMS as readonly string[]).includes(variable),
      `block ${index} names ${String(variable)}, which is not one of the two transforms the material uses`);
    const numbers: number[] = [];
    for (const key of ['rate', 'angle', 'scale'] as const) {
      const value = block[key];
      check(typeof value === 'number' && Number.isFinite(value), `block ${index} states a non-numeric ${key}`);
      numbers.push(value);
    }
    return { variable, rate: numbers[0], angleDegrees: numbers[1], scale: numbers[2] };
  });
}

/** The block that writes one transform, or null when the material does not scroll it. */
export function sourceTextureScrollFor(blocks: readonly SourceTextureScrollBlock[],
  variable: SourceTextureScrollTransform): SourceTextureScrollBlock | null {
  const found = blocks.filter((block) => block.variable === variable);
  check(found.length <= 1, `${variable} is scrolled more than once`);
  return found[0] ?? null;
}

export const SOURCE_TEXTURE_SCROLL_LIMITATIONS = [
  'The measured composition covers the proxy itself. `$texture2transform` is read and staged the same way, but this build only draws the base texture of the two-texture sky shader, so the second transform is not applied to anything yet.',
  'The proxy writes the material variable at bind time; this build advances the same formula from the game clock, so both endpoints keep the same drift without sharing an absolute clock.',
] as const;
