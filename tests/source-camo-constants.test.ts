import {describe,expect,it} from 'vitest';
import {SOURCE_CAMO_BYTE_SCALE,SOURCE_CAMO_FOURTH_CHANNELS,SOURCE_CAMO_REGISTERS,
  sourceCamoPaletteConstants,sourceCamoPaletteDescription} from '../game/source-camo-palette';

/**
 * How a finish's four colours pack into a permutation's palette constants.
 *
 * The packing is the permutations' own declaration - `g_cCamo0_camo3r`, `g_cCamo1_camo3g` and
 * `g_cCamo2_camo3b` - so the test pins the arrangement, the scale the client itself applies, and the
 * refusals that keep a partially-given palette from reaching a shader.
 */
// The AK-47's Red Laminate, as the staged catalogue writes it: four byte triples.
const RED_LAMINATE = [[17,16,15],[150,5,9],[119,108,94],[233,58,7]] as const;

describe('a finish\'s palette, packed the way the permutations declare', () => {
  it('puts one colour in xyz and one channel of the fourth in w', () => {
    const packed = sourceCamoPaletteConstants(RED_LAMINATE);
    expect(packed.map((row) => row.register)).toEqual([...SOURCE_CAMO_REGISTERS]);
    expect(SOURCE_CAMO_FOURTH_CHANNELS).toEqual(['r','g','b']);
    const f = (byte: number) => Math.fround(byte * Math.fround(1/255));
    expect(packed[0].values).toEqual([f(17), f(16), f(15), f(233)]);
    expect(packed[1].values).toEqual([f(150), f(5), f(9), f(58)]);
    expect(packed[2].values).toEqual([f(119), f(108), f(94), f(7)]);
    // Three vec4s is exactly four RGB colours: twelve channels in, twelve out.
    expect(packed.flatMap((row) => row.values)).toHaveLength(12);
  });

  it('scales by exactly the float32 nearest 1/255, which is the client\'s own scale', () => {
    expect(SOURCE_CAMO_BYTE_SCALE).toBe(Math.fround(1/255));
    const packed = sourceCamoPaletteConstants([[0,0,0],[255,255,255],[1,1,1],[255,0,128]]);
    // The ends land where they should: zero stays zero and a full byte reaches one.
    expect(packed[0].values[0]).toBe(0);
    expect(packed[1].values[0]).toBe(1);
    expect(packed[1].values[1]).toBe(1);
    // And a single byte is the scale itself, not a decimal that rounds to it.
    expect(packed[2].values[0]).toBe(Math.fround(1/255));
  });

  it('takes only the registers the style declares', () => {
    // Style 4 declares `c0` alone, so uploading c1 and c2 would bind uniforms its program never reads.
    const one = sourceCamoPaletteConstants(RED_LAMINATE, [0]);
    expect(one).toHaveLength(1);
    expect(one[0].register).toBe(0);
    expect(one[0].values[3]).toBe(Math.fround(233 * Math.fround(1/255)));
    // Style 7 declares none, so it takes none and gets an empty list rather than a full one.
    expect(sourceCamoPaletteConstants(RED_LAMINATE, [])).toEqual([]);
    expect(sourceCamoPaletteDescription(RED_LAMINATE)).toBe('17,16,15 / 150,5,9 / 119,108,94 / 233,58,7');
  });

  it('refuses a palette it cannot pack rather than guessing a channel', () => {
    const three = RED_LAMINATE.slice(0, 3) as unknown as number[][];
    expect(() => sourceCamoPaletteConstants(three)).toThrow(/four colours/);
    expect(() => sourceCamoPaletteConstants([...three,[233,58]] as number[][]))
      .toThrow(/colour 3 must be original RGB or RGBA/);
    expect(() => sourceCamoPaletteConstants([...three,[256,58,7]] as number[][]))
      .toThrow(/not 0\.\.255/);
    expect(() => sourceCamoPaletteConstants(RED_LAMINATE, [0,3])).toThrow(/no palette constant in register 3/);
    expect(() => sourceCamoPaletteConstants(RED_LAMINATE, [0,0])).toThrow(/named twice/);
  });
});
