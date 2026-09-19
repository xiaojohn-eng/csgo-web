import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

/**
 * What a `CustomWeapon` permutation declares its palette constants to be, and which sampler slots
 * have no staged texture.
 *
 * This is the evidence that unblocks the palette for the withheld finishes: the packing is not a
 * code path that had to be found, it is a declaration each permutation carries. The test pins the
 * declarations per style, the corroborating channel usage, and the three sampler slots still
 * unnamed - so a later step cannot quietly repack the constants.
 */
const report = JSON.parse(readFileSync(
  resolve(__dirname,'..','research','source-camo-packing.json'),'utf8')) as {
  format: string;
  source: {file: string; from: string};
  samplers: {all: Record<string,string>; stagedRoles: Record<string,string>;
    unstaged: {slot: number; name: string}[]; reading: string};
  declarations: Record<string, {present: boolean; color: string[]; exponent: string[]}>;
  expected: Record<string, string[]>;
  reads: Record<string, Record<string, string[]>>;
  samplersByStyle: Record<string, {pass: string; sampler: number; name: string; role: string | null}[]>;
  missingByStyle: Record<string, string[]>;
  missingReading: string;
  packing: {registers: {register: number; declared: string; xyz: string; w: string}[]; reading: string};
  boundary: string;
};

const THREE = ['c0=g_cCamo0_camo3r','c1=g_cCamo1_camo3g','c2=g_cCamo2_camo3b'];

describe('the CustomWeapon palette declarations', () => {
  it('reads the packing out of each permutation\'s own constant table', () => {
    expect(report.format).toBe('source-camo-packing-v1');
    // Every style but 4 declares the three camel constants; style 4 declares one; style 7 none.
    for (const style of ['1','2','3','5','6','8','9']) {
      expect(report.declarations[style].color).toEqual(THREE);
    }
    expect(report.declarations['4'].color).toEqual(['c0=g_cCamo0_camo3r']);
    expect(report.declarations['7'].color).toEqual([]);
    // No exponent pass declares a palette constant at all.
    for (const style of Object.keys(report.declarations)) {
      expect(report.declarations[style].exponent).toEqual([]);
    }
    // And the report agrees with itself about what it expects to find.
    expect(report.expected).toEqual(Object.fromEntries(
      Object.entries(report.declarations).map(([style, row]) => [style, row.color])));
    // The packing the declarations state: one colour in xyz, one channel of the fourth in w.
    expect(report.packing.registers).toEqual([
      {register: 0, declared: 'g_cCamo0_camo3r', xyz: 'colour 0', w: 'colour 3 red'},
      {register: 1, declared: 'g_cCamo1_camo3g', xyz: 'colour 1', w: 'colour 3 green'},
      {register: 2, declared: 'g_cCamo2_camo3b', xyz: 'colour 2', w: 'colour 3 blue'}]);
    expect(report.packing.reading).toMatch(/exactly four RGB colours/);
    // Style 7 is why the earlier hunt came up empty, and the report says so.
    expect(report.packing.reading).toMatch(/style 7 declares no camo\s+constant at all/);
  });

  it('corroborates the packing with the channel usage the translator produces', () => {
    // Where a constant carries one colour in xyz and one channel of another in w, the body has to
    // read w apart from the vector. Three styles do, and style 4 reads the vector alone.
    for (const style of ['1','2','5']) {
      for (const register of ['c0','c1','c2']) {
        expect(report.reads[style][register]).toEqual(['wwww','xyzw']);
      }
    }
    expect(report.reads['4']).toEqual({c0: ['xyzw']});
    // Style 7 reads no camo register: its colours do not arrive as palette constants.
    expect(report.reads['7']).toEqual({});
  });

  it('says which sampler each style wants, and which of them has no staged texture', () => {
    // Style 7, the one the port draws today, wants none of the three - which is why it works.
    expect(report.missingByStyle['7']).toEqual([]);
    // The four the translator accepts want the mask and nothing else.
    for (const style of ['1','2','4','5']) expect(report.missingByStyle[style]).toEqual(['MasksSampler']);
    // And the rest are missing what they are missing.
    expect(report.missingByStyle['8']).toEqual(['MasksSampler']);
    expect(report.missingByStyle['9']).toEqual(['MasksSampler']);
    expect(report.missingByStyle['3']).toEqual(['NormalsSampler','OSPosSampler']);
    expect(report.missingByStyle['6']).toEqual(['MasksSampler','NormalsSampler','OSPosSampler']);
    // Style 2's colour pass wants six samplers, four of them covered, and its exponent pass five.
    const color = report.samplersByStyle['2'].filter((row) => row.pass === 'color');
    expect(color.map((row) => `${row.sampler}:${row.name}`)).toEqual(['0:AOSampler',
      '1:ScratchesSampler','3:BaseSampler','4:MasksSampler','5:GrungeSampler','8:PatternSampler']);
    expect(color.filter((row) => row.role === null).map((row) => row.name)).toEqual(['MasksSampler']);
    expect(report.missingReading).toMatch(/the normals come from the finish's own pattern/);
  });

  it('names the three sampler slots the staged roles do not cover', () => {
    expect(report.samplers.all).toEqual({'0': 'AOSampler', '1': 'ScratchesSampler',
      '2': 'ExponentSampler', '3': 'BaseSampler', '4': 'MasksSampler', '5': 'GrungeSampler',
      '6': 'NormalsSampler', '7': 'OSPosSampler', '8': 'PatternSampler'});
    expect(report.samplers.unstaged).toEqual([{slot: 4, name: 'MasksSampler'},
      {slot: 6, name: 'NormalsSampler'}, {slot: 7, name: 'OSPosSampler'}]);
    // The report keeps the unread half explicit rather than implying the slots are resolved.
    expect(report.boundary).toMatch(/files behind two of\s+them are still unstaged/);
    expect(report.boundary).toMatch(/does not need it, because it compiles the permutation it/);
  });
});
