import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

/**
 * What the client does with a paint kit's four colours.
 *
 * The report is the read; this pins the two things a later step would otherwise re-derive: that the
 * colours are the kit record's own bytes (four groups of three, four bytes apart) and that the
 * upload scales them by exactly the float32 nearest 1/255 - and it pins the boundary, because the
 * bridge from those four material variables to a shader's three constants is still unread.
 */
const report = JSON.parse(readFileSync(
  resolve(__dirname,'..','research','source-camo-palette.json'),'utf8')) as {
  format: string;
  sources: {client64Sha256: string; binariesSearched: number};
  filler: {at: string; length: number; callers: string[]; kitIndexField: string;
    blockCleared: {at: string; bytes: number}; scaleOut: {at: string; value: number};
    reading: string};
  palette: {firstByte: string; channels: string[]; strideInRecord: number; to: string[]}[];
  recordFieldsCopied: string[];
  uploader: {at: string; length: number; variables: Record<string, string>; format: string;
    scaleAt: string; scale: number; scaleReading: string; reading: string};
  materialBlock: {generator: string; shapes: string;
    everyStyle: {variable: string; from: string}[];
    paletteBlock: {variable: string; from: string}[];
    style0: {variable: string; from: string}[];
    style1: {variable: string; from: string}[];
    styleSwitch: string; reading: string};
  carriers: Record<string, string[]>;
  boundary: string;
};

describe('the paint kit palette, as the client reads and uploads it', () => {
  it('is the kit record\'s own bytes, four colours three apart', () => {
    expect(report.format).toBe('source-camo-palette-v1');
    expect(report.filler.at).toBe('0xf52b90');
    expect(report.filler.kitIndexField).toBe('this + 0x18');
    // The record is read through the client's own item schema, by index.
    expect(report.filler.reading).toMatch(/four \(r, g, b\) triples in the record's own order/);
    expect(report.palette).toHaveLength(4);
    expect(report.palette.map((row) => row.firstByte)).toEqual(['0xbc','0xc0','0xc4','0xc8']);
    for (const row of report.palette) {
      expect(row.channels).toHaveLength(3);
      expect(row.strideInRecord).toBe(4);
    }
    // Three bytes per colour and a fourth the code never reads, so the triples are not contiguous.
    expect(report.palette[0].channels).toEqual(['0xbc','0xbd','0xbe']);
    expect(report.palette[3].channels).toEqual(['0xc8','0xc9','0xca']);
    // And they land three floats per colour, twelve bytes apart.
    expect(report.palette[0].to).toEqual(['0x9c4','0x9c8','0x9cc']);
    expect(report.palette[3].to).toEqual(['0x9e8','0x9ec','0x9f0']);
  });

  it('uploads four colours as four colours, scaled by exactly 1/255', () => {
    expect(report.uploader.at).toBe('0xf52040');
    expect(report.uploader.variables).toEqual({
      $camocolor0: '0xf52120', $camocolor1: '0xf52180',
      $camocolor2: '0xf521e0', $camocolor3: '0xf52240'});
    expect(report.uploader.format).toBe('[%f %f %f]');
    expect(report.uploader.scaleAt).toBe('0x1936e9c');
    // The four bytes are the float32 nearest 1/255, not a decimal that rounds to it.
    expect(report.uploader.scale).toBe(Math.fround(1 / 255));
    expect(report.uploader.scaleReading).toMatch(/byte 0\.\.255 becomes 0\.\.1/);
    expect(report.uploader.reading).toMatch(/no packing happens here/);
    // Both halves are the client's: the server carries none of these variable names.
    for (const name of ['$camocolor0','$camocolor3']) {
      expect(report.carriers[name].length).toBeGreaterThan(0);
      expect(report.carriers[name].filter((binary) => binary.includes('server'))).toEqual([]);
    }
    expect(report.sources.binariesSearched).toBe(18);
  });

  it('names every material variable a finish sets, and which of them each style adds', () => {
    const block = report.materialBlock;
    expect(block.generator).toBe('0xf52040');
    // Set before the style dispatch, so every style carries them.
    expect(block.everyStyle).toEqual([{variable: '$aotexture', from: '[rbx + 0x4a8]'},
      {variable: '$weartexture', from: '[rbx + 0xb3c]'}]);
    // And the shared block both style branches jump back into: the colours plus the finish's own
    // knobs. This is why a style-7 finish and a style-0 finish both get four colours.
    expect(block.paletteBlock.map((row) => row.variable)).toEqual(['$camocolor0','$camocolor1',
      '$camocolor2','$camocolor3','$wearprogress','$paintstyle','$patterntexturetransform',
      '$weartexturetransform','$grungetexturetransform','$phongalbedofactor','$phongintensity',
      '$phongexponent']);
    // Two shapes, and the style-0 one adds textures by switching on the kit's own style field.
    expect(block.shapes).toMatch(/every\*\* style ends up with\s+the colours/);
    expect(block.styleSwitch).toMatch(/this \+ 0x9bc/);
    expect(block.styleSwitch).toMatch(/0x2a4/);
    const byName = (rows: {variable: string; from: string}[]) =>
      Object.fromEntries(rows.map((row) => [row.variable, row.from]));
    const style0 = byName(block.style0);
    expect(style0['$baseTexture']).toBe('[rbx + 0x98]');
    expect(style0['$maskstexture']).toBe('[rbx + 0x2a0]');
    expect(style0['$grungetexture']).toBe('[rbx + 0xa38]');
    expect(style0['$exptexture']).toBe('[rbx + 0x19c]');
    expect(style0['$painttexture']).toBe('[rbx + 0x6b0]');
    expect(style0['$postexture']).toBe('[rbx + 0x3a4]');
    expect(style0['$surfacetexture']).toBe('[rbx + 0x5ac]');
    const style1 = byName(block.style1);
    expect(style1['$exponentmode']).toBe('1');
    expect(style1['$exptexture']).toBe('[rbx + 0x19c]');
    expect(style1['$maskstexture']).toBe('[rbx + 0x2a0]');
    // The palette block's own values: the four colours through one format, and the finish's knobs
    // through theirs, so nothing here is a raw field.
    const palette = byName(block.paletteBlock);
    expect(palette['$camocolor0']).toBe('[%f %f %f]');
    expect(palette['$wearprogress']).toBe('%f');
    expect(palette['$paintstyle']).toBe('%i');
    expect(palette['$phongexponent']).toBe('%f');
    // What the names do not settle is the mapping into the program.
    expect(block.reading).toMatch(/not read is how those variables reach the shader program's samplers/);
  });

  it('keeps the unread half named rather than implied', () => {
    // The kit record's other fields are copied too, and are recorded but not identified.
    expect(report.recordFieldsCopied).toEqual(['+0xb8 -> this + 0x9bc','+0xe9 -> this + 0x9f8',
      '+0xea - 1 -> this + 0x9f4','+0xeb -> this + 0x9fc','+0xec -> this + 0xa08',
      '+0x118 -> this + 0xc4c']);
    // The withdrawn assumption, and the one that replaces it.
    expect(report.boundary).toMatch(/bridge from those four material variables to a shader's three/);
    expect(report.boundary).toMatch(/which colour reaches which\s+constant is still unknown/);
    expect(report.boundary).toMatch(/is withdrawn/);
    expect(report.boundary).toMatch(/no such rule/);
  });
});
