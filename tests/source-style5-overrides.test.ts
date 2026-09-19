import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sourceRedlineSkinParameters } from '../game/source-redline-seed';
import { sourceRedlineKitFor, sourcePaintKitFor, validateSourcePaintKitCatalogue } from '../game/source-paint-kits';
import { sourceCustomWeaponStyleProgram } from '../game/source-redline-compositor';
import { sourceCustomWeaponFragmentShader } from '../game/source-redline-program';
import { SOURCE_CUSTOMWEAPON_PROGRAM_DATA } from '../game/source-customweapon-program-data';
import { SOURCE_CUSTOMWEAPON_LOW_ALBEDO_DATA } from '../game/source-customweapon-low-albedo-data';
import type { SourceWeaponPhong } from '../game/source-redline-seed';
import { sourceCamoPaletteConstants } from '../game/source-camo-palette';

const read = (file: string) => readFileSync(file);
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const catalogueBytes = read('public/source/csgo-12426148/skins/paint-kits.json');
const catalogue = validateSourcePaintKitCatalogue(JSON.parse(catalogueBytes.toString()));
const proof = JSON.parse(read('research/source-style5-overrides.json').toString()) as {
  status: string; catalogueSha256: string;
  cases: { weapon: string; paintKitId: number; kit: unknown; phong: SourceWeaponPhong;
    nativeCompositeIntensityInteger: number;
    materialAfterBranch: Record<string, number | string>;
    laterCompositeScalarArguments: Record<string, { hostParsedFloat32: number }>;
    selectors: Record<'color' | 'exponent', { static: number }>;
  }[];
  programs: Record<string, { sha256: string; aliasResolvedStatic: number }>;
};

describe('actual style-5 paint-kit clone and shader branches', () => {
  it('accepts the original RGBA records for AWP 395 and three Glock phases without putting their alpha in the RGB palette', () => {
    const reading = JSON.parse(read('research/source-camo-palette.json').toString());
    expect(reading.palette.map((row: { strideInRecord: number; channels: string[] }) =>
      [row.strideInRecord, row.channels.length])).toEqual([[4, 3], [4, 3], [4, 3], [4, 3]]);
    const rgbaKits: string[] = [];
    for (const row of proof.cases) {
      const entry = sourcePaintKitFor(catalogue, row.weapon, String(row.paintKitId));
      const before = JSON.stringify(entry.colours);
      const constants = sourceCamoPaletteConstants(entry.colours);
      expect(constants).toHaveLength(3);
      if (entry.colours.some(colour => colour.length === 4)) {
        rgbaKits.push(`${row.weapon}:${row.paintKitId}`);
        // Native reads the first three bytes of each four-byte record. Change all alpha
        // bytes independently: neither RGB vectors nor packed fourth-colour RGB changes.
        for (const alpha of [0, 127, 255])
          expect(sourceCamoPaletteConstants(entry.colours.map(colour => [...colour.slice(0, 3), alpha])))
            .toEqual(constants);
      }
      expect(JSON.stringify(entry.colours)).toBe(before);
    }
    expect(rgbaKits).toEqual(['weapon_awp:395', 'weapon_glock:1119', 'weapon_glock:1120', 'weapon_glock:1122']);
    const awp = sourcePaintKitFor(catalogue, 'weapon_awp', '395');
    expect(awp.colours[2]).toEqual([24, 32, 54, 255]);
    // Ignoring alpha in the shader does not authorize malformed source data.
    for (const invalid of [-1, 256, NaN, 1.5])
      expect(() => sourceCamoPaletteConstants(awp.colours.map(colour => [...colour.slice(0, 3), invalid])))
        .toThrow('not 0..255');
    expect(() => sourceCamoPaletteConstants(awp.colours.map(colour => [...colour, 0, 0])))
      .toThrow('original RGB or RGBA');
  });
  it('matches all ten original schema/VMT executions, including fractional formatting and draw-material overrides', () => {
    expect(proof.status).toBe('native-clone-scalars-and-selector-executed');
    // Other catalogue entries gain native path resolution; the ten original input
    // records below must still match the immutable native execution receipt in full.
    expect(proof.catalogueSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.cases.map(row => `${row.weapon}:${row.paintKitId}`)).toEqual([
      'weapon_m4a1:780', 'weapon_awp:51', 'weapon_awp:395', 'weapon_glock:48',
      'weapon_glock:1119', 'weapon_glock:1120', 'weapon_glock:1121', 'weapon_glock:1122',
      'weapon_glock:1123', 'weapon_deagle:425',
    ]);
    for (const row of proof.cases) {
      const entry = sourcePaintKitFor(catalogue, row.weapon, String(row.paintKitId));
      expect(row.kit).toMatchObject(entry);
      const kit = sourceRedlineKitFor(entry);
      const parameters = sourceRedlineSkinParameters({ paintKitId: row.paintKitId, seed: 422,
        wear: (kit.wearMinimum + kit.wearMaximum) / 2 }, kit, row.phong);
      for (const key of ['phongAlbedoFactor', 'phongIntensity', 'phongExponent'] as const)
        expect(parameters[key], `${row.weapon}:${row.paintKitId} ${key}`)
          .toBe(row.laterCompositeScalarArguments[key].hostParsedFloat32);
      expect(row.nativeCompositeIntensityInteger).toBe(255);
      expect(parameters.materialPhong.phongAlbedoBoost).toBe(Number(row.materialAfterBranch.$phongalbedoboost));
      expect(parameters.materialPhong.phongBoost).toBe(Number(row.materialAfterBranch.$phongboost));
      expect(row.materialAfterBranch.$phongalbedotint).toBe(1);
      const selected = sourceCustomWeaponStyleProgram(5, parameters.phongAlbedoFactor);
      for (const pass of ['color', 'exponent'] as const) {
        const requested = row.selectors[pass].static;
        const expected = requested >= 160 ? SOURCE_CUSTOMWEAPON_LOW_ALBEDO_DATA['5'][pass]
          : SOURCE_CUSTOMWEAPON_PROGRAM_DATA['5'][pass];
        expect(selected[pass].tokens).toEqual(expected.tokens);
        expect(expected.sha256).toBe(proof.programs[String(requested)].sha256);
      }
    }
  });

  it('carries the actual low-factor color program and follows the original exponent alias', () => {
    const low = SOURCE_CUSTOMWEAPON_LOW_ALBEDO_DATA['5'];
    expect(low.color.static).toBe(165);
    expect(low.color.aliasResolvedStatic).toBe(165);
    expect(low.exponent.static).toBe(175);
    expect(low.exponent.aliasResolvedStatic).toBe(15);
    expect(low.exponent.tokens).toEqual(SOURCE_CUSTOMWEAPON_PROGRAM_DATA['5'].exponent.tokens);
    expect(low.color.tokens).not.toEqual(SOURCE_CUSTOMWEAPON_PROGRAM_DATA['5'].color.tokens);
    expect(low.color.samplers).toContain(2);
    expect(SOURCE_CUSTOMWEAPON_PROGRAM_DATA['5'].color.samplers).not.toContain(2);
    for (const pass of ['color', 'exponent'] as const) {
      const entry = low[pass];
      const raw = read(`.reference-assets/source-exports/style5-albedo-overrides/customweapon_ps30-static${entry.static}-dynamic0.dx9`);
      expect(sha(raw)).toBe(entry.sha256);
      const glsl = sourceCustomWeaponFragmentShader({ ...entry, constants: entry.constants.map(row => row.register) });
      for (const sampler of entry.samplers) expect(glsl).toContain(`uniform sampler2D s${sampler};`);
    }
  });

  it('does not silently use another branch for a missing or invalid program selection', () => {
    for (const value of [0, -1, NaN, -Infinity, 1e100])
      expect(() => sourceCustomWeaponStyleProgram(5, value)).toThrow('positive float32');
    expect(sourceCustomWeaponStyleProgram(7,.5).color.tokens).toEqual(SOURCE_CUSTOMWEAPON_LOW_ALBEDO_DATA['7'].color.tokens);
    expect(sourceCustomWeaponStyleProgram(5, 1).color.tokens).toEqual(SOURCE_CUSTOMWEAPON_PROGRAM_DATA['5'].color.tokens);
  });
});
