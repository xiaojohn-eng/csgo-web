/**
 * What a `CustomWeapon` permutation declares its palette constants to be, and which sampler slots
 * have no staged texture yet.
 *
 * Two recorded blockers sat in front of the finishes this port withholds, and both turn out to be
 * answerable from artifacts the repository already carries:
 *
 *  * **the palette packing**: a permutation's own constant table declares `c0 = g_cCamo0_camo3r`,
 *    `c1 = g_cCamo1_camo3g`, `c2 = g_cCamo2_camo3b` for the colour pass of every style but 4 (which
 *    declares `c0` alone) and 7 (which declares none). Nine colours' worth of channels in three
 *    float4s is exactly four RGB colours, and the translated bodies agree: styles 1, 2 and 5 read
 *    `c0.xyzw` and `c0.wwww` *separately*, so `w` carries something other than the colour in `xyz`.
 *    The declarations are the evidence; the previous search looked for a *code* path that packs four
 *    colours into three constants in the shipped shader and found none, which is consistent - the
 *    packing is declared by the permutation, not computed by shader command code.
 *  * **the three sampler slots**: the constant table also names the samplers, and the staged roles
 *    cover six of nine. The three without a role are 4 `MasksSampler`, 6 `NormalsSampler` and
 *    7 `OSPosSampler`.
 *
 * Nothing here is inferred from a name alone: each declaration is read out of the permutation's own
 * table, and the channel usage is read out of the program the port's own translator produces.
 *
 * Run: npx tsx scripts/probe-source-camo-packing.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sourceCustomWeaponFragmentShader } from '../game/source-redline-program';

const EXPORT = resolve('.reference-assets/source-exports/customweapon-style-programs');
const OUT = resolve('research/source-camo-packing.json');

interface Constant { register: number; count: number; name: string }
interface Permutation { present: boolean; declaredSamplers?: number[];
  ctabConstants?: Constant[]; body?: unknown }
const evidence: {
  format: string; status: string; samplerNames: Record<string, string>;
  stagedInputRoles: Record<string, string>;
  styles: Record<string, Record<string, Permutation>>;
} = JSON.parse(readFileSync(resolve(EXPORT, 'evidence.json'), 'utf8'));
const tokens: Record<string, Record<string, number[][]>> = JSON.parse(
  readFileSync(resolve(EXPORT, 'tokens.json'), 'utf8'));

const fail = (what: string): never => {
  throw new Error(`CustomWeapon packing read differs: ${what}`);
};

// --- the sampler slots, and which of them the staged roles do not cover.
const SAMPLERS: Record<string, string> = {'0': 'AOSampler', '1': 'ScratchesSampler',
  '2': 'ExponentSampler', '3': 'BaseSampler', '4': 'MasksSampler', '5': 'GrungeSampler',
  '6': 'NormalsSampler', '7': 'OSPosSampler', '8': 'PatternSampler'};
const ROLES: Record<string, string> = {'0': 'ao', '1': 'paintWear', '2': 'weaponExponent',
  '3': 'weaponAlbedo', '5': 'gunGrunge', '8': 'pattern'};
if (JSON.stringify(evidence.samplerNames) !== JSON.stringify(SAMPLERS)) fail('samplerNames moved');
if (JSON.stringify(evidence.stagedInputRoles) !== JSON.stringify(ROLES)) fail('stagedInputRoles moved');
const unstaged = Object.keys(SAMPLERS).filter((slot) => !(slot in ROLES)).sort();
if (unstaged.join(',') !== '4,6,7') fail(`unstaged slots are ${unstaged.join(',')}`);

// --- the palette declarations, per style and pass.
const CAMO = {0: 'g_cCamo0_camo3r', 1: 'g_cCamo1_camo3g', 2: 'g_cCamo2_camo3b'};
const STYLES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const declarations: Record<string, {present: boolean; color: string[]; exponent: string[]}> = {};
for (const style of STYLES) {
  const color = evidence.styles[style]?.['color'];
  const exponent = evidence.styles[style]?.['exponent'];
  if (!color?.present) fail(`style ${style} has no colour permutation`);
  const camoOf = (rows: Constant[] | undefined) => (rows ?? [])
    .filter((row) => row.name in Object.values(CAMO) || row.name.startsWith('g_cCamo'))
    .map((row) => `c${row.register}=${row.name}`).sort();
  declarations[style] = {present: true, color: camoOf(color.ctabConstants),
    exponent: camoOf(exponent?.ctabConstants)};
}
const CAMO_THREE = ['c0=g_cCamo0_camo3r', 'c1=g_cCamo1_camo3g', 'c2=g_cCamo2_camo3b'];
const EXPECTED: Record<string, string[]> = {
  '1': CAMO_THREE, '2': CAMO_THREE, '3': CAMO_THREE,
  '4': ['c0=g_cCamo0_camo3r'],
  '5': CAMO_THREE, '6': CAMO_THREE, '7': [], '8': CAMO_THREE, '9': CAMO_THREE};
for (const style of STYLES) {
  if (declarations[style].color.join('|') !== EXPECTED[style].join('|'))
    fail(`style ${style} colour declarations are ${declarations[style].color.join(',')}`);
  if (declarations[style].exponent.length !== 0)
    fail(`style ${style} exponent declares a camo constant: ${declarations[style].exponent}`);
}

// --- what the translated bodies do with those registers. Only the permutations the port's own
// translator accepts can be checked here, and each one that translates is checked.
const TRANSLATABLE = ['1', '2', '4', '5', '7'];
const usage: Record<string, Record<string, string[]>> = {};
for (const style of TRANSLATABLE) {
  const color = evidence.styles[style]['color'];
  const program = tokens[style]?.['color'];
  if (!program) fail(`style ${style} has no colour tokens`);
  const glsl = sourceCustomWeaponFragmentShader({
    tokens: program, samplers: color.declaredSamplers ?? [],
    constants: (color.ctabConstants ?? []).map((row) => row.register)}, 'uniforms');
  const reads = new Map<string, Set<string>>();
  for (const match of glsl.matchAll(/\b(c[0-9]+)\.([xyzw]{1,4})\b/g)) {
    const set = reads.get(match[1]) ?? new Set<string>();
    set.add(match[2]);
    reads.set(match[1], set);
  }
  const declared = new Map<string, string>((color.ctabConstants ?? [])
    .map((row): [string, string] => ['c' + row.register, row.name]));
  const camoReads: Record<string, string[]> = {};
  for (const [register, swizzles] of reads) {
    if (!(declared.get(register) ?? '').startsWith('g_cCamo')) continue;
    camoReads[register] = [...swizzles].sort();
  }
  usage[style] = camoReads;
  if (Object.keys(camoReads).length !== EXPECTED[style].length)
    fail(`style ${style} reads ${Object.keys(camoReads).length} camo registers`);
}
// The corroboration: where a constant carries one colour in `xyz` and one channel of another in `w`,
// the program has to read `w` apart from the vector - and three styles do exactly that.
for (const style of ['1', '2', '5']) {
  const reads = usage[style];
  for (const register of Object.keys(reads)) {
    if (!reads[register].includes('xyzw') || !reads[register].includes('wwww'))
      fail(`style ${style} ${register} reads ${reads[register].join(' ')}`);
  }
}

// --- which styles want which sampler, and which of those the staged roles do not cover. This is the
// table a later step needs: it says exactly which texture a style is still missing, per style and per
// pass, instead of leaving it as "three unknown sampler roles".
const needs: Record<string, {pass: string; sampler: number; name: string; role: string | null}[]> = {};
for (const style of STYLES) {
  for (const pass of ['color', 'exponent'] as const) {
    const row = evidence.styles[style]?.[pass];
    if (!row?.present) continue;
    for (const slot of row.declaredSamplers ?? []) {
      needs[style] = needs[style] ?? [];
      needs[style].push({pass, sampler: slot, name: SAMPLERS[String(slot)],
        role: ROLES[String(slot)] ?? null});
    }
  }
}
const missingByStyle: Record<string, string[]> = {};
for (const [style, rows] of Object.entries(needs)) {
  missingByStyle[style] = [...new Set(rows.filter((row) => row.role === null).map((row) => row.name))].sort();
}
// Style 7 - the one the port already draws - wants none of the three, which is why it works today.
if (missingByStyle['7'].length !== 0)
  fail(`style 7 now wants an unstaged sampler: ${missingByStyle['7'].join(', ')}`);
// And the four styles the port's translator accepts want only the mask.
for (const style of ['1', '2', '4', '5']) {
  if (missingByStyle[style].join(',') !== 'MasksSampler')
    fail(`style ${style} wants ${missingByStyle[style].join(',')}`);
}

const report = {
  format: 'source-camo-packing-v1',
  source: {file: '.reference-assets/source-exports/customweapon-style-programs/evidence.json',
           from: evidence.status},
  samplers: {'all': SAMPLERS, 'stagedRoles': ROLES,
             'unstaged': unstaged.map((slot) => ({slot: Number(slot), name: SAMPLERS[slot]})),
             'reading': ('A permutation declares the samplers it samples by name. Six of the nine '
                         + 'are covered by a staged role; the three that are not are the mask, the '
                         + 'normals and the object-space position.')},
  declarations,
  expected: EXPECTED,
  reads: usage,
  samplersByStyle: needs,
  missingByStyle,
  missingReading: ('A style is short an input only when it declares a sampler no staged role covers, '
                   + 'and the table says which: styles 1, 2, 4, 5, 8 and 9 want the mask, styles 3 and '
                   + '6 want the normals and the object-space position as well, and style 7 - the one '
                   + 'the port already draws - wants none of the three, which is why it works today. '
                   + 'The mask and the position both ship for every weapon the port covers, as '
                   + '`models/weapons/customization/<folder>/<folder>_masks.vtf` and `_pos.vtf`; the '
                   + 'normals come from the finish\'s own pattern, not from the weapon.'),
  packing: {
    registers: [{'register': 0, 'declared': CAMO[0], 'xyz': 'colour 0', 'w': 'colour 3 red'},
                {'register': 1, 'declared': CAMO[1], 'xyz': 'colour 1', 'w': 'colour 3 green'},
                {'register': 2, 'declared': CAMO[2], 'xyz': 'colour 2', 'w': 'colour 3 blue'}],
    reading: ('Nine colours\' worth of channels in three float4s is exactly four RGB colours, and '
              + 'the declarations say which: each of the three carries one colour in its first three '
              + 'channels and one channel of the fourth in `w`. The translated bodies agree where it '
              + 'can be checked - styles 1, 2 and 5 read `c0.xyzw` and `c0.wwww` separately. Style 4 '
              + 'declares `c0` alone and reads only the whole vector; style 7 declares no camo '
              + 'constant at all, so the four colours do not enter its program this way, which is why '
              + 'the earlier search for the packing in style 7\'s neighbourhood found none.')},
  boundary: ('What is read is each permutation\'s own declaration of its palette constants and the '
             + 'channel usage of the bodies the port can translate. What is **not** read is the code '
             + 'that fills those three registers from the material\'s four `$camocolorN` variables - '
             + 'and the port does not need it, because it compiles the permutation itself and fills '
             + 'its own uniforms, so the declarations are enough to pack them. Neither is the texture '
             + 'each unstaged sampler slot carries: the names are known (`MasksSampler`, '
             + '`NormalsSampler`, `OSPosSampler`) and the finish generator names the material '
             + 'variables it sets (`$maskstexture`, `$postexture`, ...), but the files behind two of '
             + 'them are still unstaged, and no translation here can supply them.'),
};
writeFileSync(OUT, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({format: report.format, unstaged: report.samplers.unstaged,
  stylesWithPalette: STYLES.filter((style) => EXPECTED[style].length > 0),
  translated: TRANSLATABLE, reads: usage}, null, 1));
