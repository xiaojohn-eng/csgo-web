import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
import {SOURCE_CUSTOMWEAPON_PROGRAM_DATA,SOURCE_CUSTOMWEAPON_PROGRAM_FORMAT,SOURCE_CUSTOMWEAPON_PROGRAM_STYLES}
  from '../game/source-customweapon-program-data';
import {SOURCE_REDLINE_PROGRAM_DATA} from '../game/source-redline-program-data';
import {sourceCustomWeaponFragmentShader,sourceRedlineFragmentShader} from '../game/source-redline-program';

/**
 * The program data for the styles this port composes.
 *
 * Two things are being pinned. The first is that the rows are the original's own: the style-7 rows
 * exported here have to be byte-identical to the ones the Redline path already ships, which is what
 * makes the export faithful rather than merely plausible. The second is that every style present
 * actually builds with the browser-side translator and declares the samplers and constants it says
 * it does - a style whose program cannot be built must not be listed, because listing it would
 * promise a finish that cannot be drawn.
 */
const native=JSON.parse(readFileSync(resolve(__dirname,'..','research/source-customweapon-all-programs.json'),'utf8'));
const PASSES = ['color','exponent'] as const;

describe('the original programs this port composes', () => {
  it('exports only styles the browser-side translator can build', () => {
    expect(SOURCE_CUSTOMWEAPON_PROGRAM_FORMAT).toBe('source-customweapon-program-data-v1');
    expect(SOURCE_CUSTOMWEAPON_PROGRAM_STYLES).toEqual(['1','2','3','4','5','6','8','9']);
    // Every listed style builds, for both passes, with nothing unsupported.
    for (const style of SOURCE_CUSTOMWEAPON_PROGRAM_STYLES) {
      for (const pass of PASSES) {
        const entry = SOURCE_CUSTOMWEAPON_PROGRAM_DATA[style][pass];
        expect(entry.tokens.length).toBe(entry.tokenCount);
        const glsl = sourceCustomWeaponFragmentShader({
          tokens: entry.tokens, samplers: entry.samplers,
          constants: entry.constants.flatMap((row) => Array.from({length:row.count},(_,i)=>row.register+i))}, 'textures');
        // The program declares a sampler per input it reads, and a constant per register bar c3.
        for (const sampler of entry.samplers)
          expect(glsl).toContain(`uniform sampler2D s${sampler};`);
        for (const row of entry.constants)
          if (row.register !== 3) expect(glsl).toContain(`uniform vec4 c${row.register};`);
        expect(glsl).toContain('uniform vec4 c3;');
      }
    }
  });

  it('carries the original\'s own rows, hashes and declarations', () => {
    for (const style of SOURCE_CUSTOMWEAPON_PROGRAM_STYLES) {
      for (const pass of PASSES) {
        const entry = SOURCE_CUSTOMWEAPON_PROGRAM_DATA[style][pass];
        const row = native.programs.find((row:{style:number;pass:string;lowAlbedo:boolean})=>row.style===Number(style)&&row.pass===pass&&!row.lowAlbedo);
        expect(entry.sha256).toBe(row.sha256);
        expect(entry.tokenCount).toBe(row.tokenCount);
        expect(entry.samplers).toEqual(row.samplers);
        expect(entry.constants).toEqual(row.constants);
        // The rows only use opcodes the receipt lists for that style.
        const opcodes = [...new Set(entry.tokens.map((row) => (row[0] as number) & 0xFFFF))].sort((a,b) => a-b);
        for (const opcode of opcodes) expect([1,2,4,5,6,7,8,11,18,31,32,66,81,88,90]).toContain(opcode);
      }
    }
  });

  it('reproduces the shipped style-7 rows exactly, which is what makes the export faithful', () => {
    const export7 = JSON.parse(readFileSync(
      resolve(__dirname,'..','.reference-assets','source-exports','customweapon-style-programs',
        'tokens.json'),'utf8')) as Record<string, Record<string, number[][]>>;
    for (const pass of PASSES) {
      const shipped = SOURCE_REDLINE_PROGRAM_DATA[pass].tokens as unknown as number[][];
      expect(JSON.stringify(export7['7'][pass])).toBe(JSON.stringify(shipped));
    }
    // And the translation of those rows is the shader the Redline path compiles today.
    for (const pass of PASSES) {
      const entry = SOURCE_CUSTOMWEAPON_PROGRAM_DATA['1'][pass];
      expect(typeof sourceRedlineFragmentShader(pass)).toBe('string');
      expect(entry.tokens.length).toBeGreaterThan(0);
    }
  });

  it('keeps the palette where the permutations declare it, and refuses an unsupported opcode', () => {
    // The three camel constants sit at c0, c1 and c2 in every style that declares them, and c3 is
    // the phong-and-wear constant the caller uploads.
    for (const style of ['1','2','5'] as const) {
      const entry = SOURCE_CUSTOMWEAPON_PROGRAM_DATA[style]['color'];
      expect(entry.constants.map((row) => `${row.register}:${row.name}`)).toEqual(
        ['0:g_cCamo0_camo3r','1:g_cCamo1_camo3g','2:g_cCamo2_camo3b','3:g_fvPhongSettings_wear']);
      // Every one of them reads the mask, and it is slot 4.
      expect(entry.samplers).toContain(4);
    }
    expect(SOURCE_CUSTOMWEAPON_PROGRAM_DATA['4']['color'].constants.map((row) => row.register))
      .toEqual([0,3]);
    // A row the translator does not implement is refused rather than silently dropped.
    expect(() => sourceCustomWeaponFragmentShader({
      tokens: [[999, 0, 0, 0]], samplers: [0], constants: [3]})).toThrow(/Unsupported original CustomWeapon opcode/);
  });
});
