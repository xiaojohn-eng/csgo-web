/** How an original `CustomWeapon` permutation uses the palette constants it declares.
 *
 * The palette constants (`g_cCamo0_camo3r`, `g_cCamo1_camo3g`, `g_cCamo2_camo3b`) are
 * three float4s carrying the paint kit's four colours. Which channel holds which colour
 * is a property of how the *original program* consumes them, so this translates the
 * permutation with the runtime's own translator and reports every swizzle of every
 * declared constant that appears in the translated body. Nothing is inferred from a
 * constant's name.
 *
 * Run: npx tsx scripts/probe-source-customweapon-palette.ts [style ...]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sourceCustomWeaponFragmentShader } from '../game/source-redline-program';

const EXPORT = resolve('.reference-assets/source-exports/customweapon-style-programs');
const tokens: Record<string, Record<string, number[][]>> = JSON.parse(
  readFileSync(resolve(EXPORT, 'tokens.json'), 'utf8'));
const evidence: {
  styles: Record<string, Record<string, { present: boolean; declaredSamplers?: number[];
    ctabConstants?: { register: number; count: number; name: string }[] }>>;
} = JSON.parse(readFileSync(resolve(EXPORT, 'evidence.json'), 'utf8'));

/** Every swizzle of every constant register a translated body reads. */
function constantReads(glsl: string) {
  const reads = new Map<string, Set<string>>();
  for (const match of glsl.matchAll(/\b(c[0-9]+)\.([xyzw]{1,4})\b/g)) {
    const set = reads.get(match[1]) ?? new Set<string>();
    set.add(match[2]);
    reads.set(match[1], set);
  }
  return reads;
}

const requested = process.argv.slice(2).filter((value) => !value.startsWith('-'));
const styles = requested.length ? requested : ['7', '2', '5', '8', '9', '1', '4'];
let printed = 0;
for (const style of styles) {
  for (const pass of ['color', 'exponent']) {
    const permutation = evidence.styles[style]?.[pass];
    if (!permutation?.present) { console.log(`style ${style} ${pass}: not shipped`); continue; }
    const program = tokens[style]?.[pass];
    if (!program) { console.log(`style ${style} ${pass}: no tokens`); continue; }
    const constants = (permutation.ctabConstants ?? []).map((row) => row.register);
    const glsl = sourceCustomWeaponFragmentShader(
      { tokens: program, samplers: permutation.declaredSamplers ?? [], constants }, 'uniforms');
    const reads = constantReads(glsl);
    const named = new Map((permutation.ctabConstants ?? [])
      .map((row) => [row.register, row.name] as const));
    console.log(`style ${style} ${pass}: ${glsl.split('\n').length} GLSL lines, declares ` +
      `${constants.map((register) => `c${register}=${named.get(register) ?? '?'}`).join(', ')}`);
    for (const [register, swizzles] of [...reads].sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))) {
      const usage = [...swizzles].sort().map((swizzle) => `${register}.${swizzle}`).join(' ');
      console.log(`    reads ${usage}${named.has(Number(register.slice(1))) ? `   (${named.get(Number(register.slice(1)))})` : ''}`);
    }
    printed++;
  }
}
console.log(`translated ${printed} permutations`);
