/**
 * The fade the original gives a decal as the fog thickens.
 *
 * `DecalModulate` does not only tint a bullet hole toward the fog colour: it fades the decal out,
 * by lerping its texel toward the neutral value the sheet is authored around, so a decal far enough
 * into the haze returns the surface untouched instead of sitting on it as a grey patch. Both halves
 * of that are the shipped program's own arithmetic, and both are computed from the map's own fog -
 * the same capped ramp the whole scene uses, measured as the distance from the eye.
 *
 * `scripts/probe-source-decal-fog-fade.py` reads the shader's parameter declarations, its `ps_2_b`
 * combos and the decal materials this map's impacts reach; `scripts/stage-source-decal-fog-fade.py`
 * copies the numbers the runtime acts on into `game/source-decal-fog-fade-data.ts`. This module only
 * validates. Nothing here is defaulted, guessed or clamped into range.
 */
import {SOURCE_DECAL_FOG_FADE_DATA} from './source-decal-fog-fade-data.js';

export type SourceDecalFogFade = {
  /** Fog amount at which the fade starts, and at which the decal has faded out completely. */
  readonly start: number;
  readonly end: number;
  /** `$FOGSCALE` and `$FOGEXPONENT`, which shape the tint rather than the fade. */
  readonly scale: number;
  readonly exponent: number;
  /** The texel value at which `2 * texel * destination` leaves the surface alone. */
  readonly neutral: number;
};

export type SourceDecalFogFadeTable = {
  readonly shaderSha256: string;
  readonly neutral: number;
  /** What each of the shader's four parameters declares, `null` where it declares no default. */
  readonly declared: Readonly<Record<'exponent' | 'scale' | 'fadeStart' | 'fadeEnd', string | null>>;
  /** The two declared defaults as numbers: what a sheet that states no fade still tints with. */
  readonly defaults: { readonly scale: number; readonly exponent: number };
  /** The shipped programs this table transcribes, as instruction listings the test compares. */
  readonly programs: Readonly<Record<'fade' | 'plain' | 'vertexAlpha', {
    readonly static: number;
    readonly dynamic: number;
    readonly sha256: string;
    readonly instructions: readonly string[];
  }>>;
  readonly limitations: readonly string[];
  /** The fade the material this atlas belongs to asks for, or null when it asks for none. */
  forAtlas(atlas: string): SourceDecalFogFade | null;
};

const fail = (message: string): never => {
  throw new Error('Source decal fog fade: ' + message);
};
const HASH = /^[0-9a-f]{64}$/;
const block = (value: unknown, label: string): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : fail(label + ' is not an object');
const number = (value: unknown, label: string): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fail(label + ' is not a number');
const hash = (value: unknown, label: string): string =>
  typeof value === 'string' && HASH.test(value) ? value : fail(label + ' is not a sha256');

export function createSourceDecalFogFade(data: unknown): SourceDecalFogFadeTable {
  const root = block(data, 'the table');
  if (root.format !== 'source-decal-fog-fade-v1') fail('unknown format ' + String(root.format));
  const shaderSha256 = hash(root.shaderSha256, 'the shader hash');
  const neutral = number(root.neutral, 'the neutral texel');
  if (neutral !== 0.5) fail('the neutral texel is ' + neutral + ', not the mid grey the sheet uses');

  const declared = block(root.declared, 'the declared defaults');
  const expected = {exponent: '0.4', scale: '1.0'};
  for (const [key, value] of Object.entries(expected))
    if (declared[key] !== value) fail(`$FOG${key.toUpperCase()} declares ${String(declared[key])}`);
  for (const key of ['fadeStart', 'fadeEnd'])
    if (declared[key] !== null) fail(`$FOG${key === 'fadeStart' ? 'FADESTART' : 'FADEEND'} declares a default`);
  const defaults = {scale: Number(declared.scale), exponent: Number(declared.exponent)};
  if (!(defaults.scale > 0 && defaults.exponent > 0)) fail('the declared defaults are not both positive');

  const programs = block(root.programs, 'the programs');
  const wanted = ['fade', 'plain', 'vertexAlpha'] as const;
  const checked: Record<string, unknown> = {};
  for (const name of wanted) {
    const program = block(programs[name], 'the ' + name + ' program');
    const instructions = program.instructions;
    if (!Array.isArray(instructions) || !instructions.length ||
      instructions.some((line) => typeof line !== 'string'))
      fail('the ' + name + ' program states no instructions');
    checked[name] = {
      static: number(program.static, name + ' static combo'),
      dynamic: number(program.dynamic, name + ' dynamic combo'),
      sha256: hash(program.sha256, name + ' program hash'),
      instructions: instructions as string[],
    };
  }
  const fade = checked.fade as {instructions: string[]};
  const plain = checked.plain as {instructions: string[]};
  // The two programs differ exactly by the fade, and the fade is the lerp toward the neutral value.
  if (!fade.instructions.includes('lrp r2.xyz, r1.yyyy, c1.xxxx, r0.xyzw'))
    fail('the fade program no longer lerps the texel toward its neutral');
  if (plain.instructions.some((line) => line.includes(', c1.xxxx,')))
    fail('the plain program carries the fade after all');
  if (fade.instructions.length <= plain.instructions.length)
    fail('the fade program is not the longer of the two');

  const atlases = block(root.fadeAtlases, 'the atlases');
  const table: Record<string, SourceDecalFogFade> = {};
  for (const [atlas, value] of Object.entries(atlases)) {
    if (value === null) continue;
    const row = block(value, 'the fade of ' + atlas);
    const entry: SourceDecalFogFade = {
      start: number(row.fadeStart, atlas + ' fade start'),
      end: number(row.fadeEnd, atlas + ' fade end'),
      scale: number(row.scale, atlas + ' scale'),
      exponent: number(row.exponent, atlas + ' exponent'),
      neutral,
    };
    if (!(entry.start >= 0 && entry.end > entry.start && entry.end <= 1))
      fail(`${atlas} fades between ${entry.start} and ${entry.end}, which is not a range of fog`);
    if (!(entry.scale > 0 && entry.exponent > 0))
      fail(`${atlas} states a scale or exponent that is not positive`);
    table[atlas] = entry;
  }
  if (!Object.keys(table).length) fail('no shipped sheet asks for the fade');
  if (!Object.keys(atlases).some((atlas) => atlases[atlas] === null))
    fail('no shipped sheet is recorded as asking for no fade');

  const limitations = root.limitations;
  if (!Array.isArray(limitations) || !limitations.length ||
    limitations.some((line) => typeof line !== 'string' || !line))
    fail('the table states no limitations');

  return {
    shaderSha256, neutral, defaults,
    declared: {
      exponent: declared.exponent as string | null, scale: declared.scale as string | null,
      fadeStart: null, fadeEnd: null,
    },
    programs: checked as unknown as SourceDecalFogFadeTable['programs'],
    limitations: limitations as string[],
    forAtlas: (atlas: string) => table[atlas] ?? null,
  };
}

/** The original decal fog fade, validated at import so a bad table cannot fade a decal wrongly. */
export const SOURCE_DECAL_FOG_FADE = createSourceDecalFogFade(SOURCE_DECAL_FOG_FADE_DATA);
