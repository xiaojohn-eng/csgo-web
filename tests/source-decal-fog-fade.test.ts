import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSourceDecalFogFade,
  SOURCE_DECAL_FOG_FADE,
} from '../game/source-decal-fog-fade';
import { SOURCE_DECAL_FOG_FADE_DATA, SOURCE_DECAL_FOG_FADE_SOURCES } from '../game/source-decal-fog-fade-data';
import { SOURCE_DECAL_PROGRAM } from '../game/source-impact-decals';
import { SOURCE_DUST2_ENVIRONMENT } from '../game/source-environment';

const report = JSON.parse(readFileSync(resolve(__dirname, '..', 'research/source-decal-fog-fade.json'), 'utf8')) as {
  format: string;
  shader: {sha256: string; flags: {define: string; value: number; field: number}[];
    parameters: {name: string; default: string | null; description: string | null}[]};
  container: {sha256: string; statics: string[]; dynamicCombos: number;
    programs: Record<string, {static: number; dynamic: number; bytes: number; sha256: string;
      instructions: string[]}>};
  ctabNames: string[];
  formula: Record<string, string>;
  fadeMaterials: {material: string; stated: Record<string, number>}[];
  reachableAtlases: Record<string, {shader: string; stated: Record<string, number>; materials: number}>;
  sources: {sheets: Record<string, {path: string; flags: string; named: string[]}>};
  reading: string;
  boundary: string;
};

const base = SOURCE_DECAL_FOG_FADE_DATA as unknown as Record<string, unknown>;
const withDeclared = (value: Record<string, unknown>) =>
  ({...base, declared: {...(base['declared'] as object), ...value}});
const withAtlas = (atlas: string, value: unknown) =>
  ({...base, fadeAtlases: {...(base['fadeAtlases'] as object), [atlas]: value}});
const withProgram = (name: string, instructions: string[]) => ({
  ...base,
  programs: {...(base['programs'] as object), [name]: {...(base['programs'] as Record<string, object>)[name], instructions}},
});

describe('Original decal fog fade', () => {
  it('is generated from the probe report, so the table cannot drift from the measurement', () => {
    expect(report.format).toBe('source-decal-fog-fade-v1');
    expect(SOURCE_DECAL_FOG_FADE_DATA).toMatchObject({format: 'source-decal-fog-fade-v1'});
    expect(SOURCE_DECAL_FOG_FADE.shaderSha256).toBe(report.shader.sha256);
    expect(SOURCE_DECAL_FOG_FADE.neutral).toBe(0.5);
    expect(SOURCE_DECAL_FOG_FADE.declared).toEqual({exponent: '0.4', scale: '1.0',
      fadeStart: null, fadeEnd: null});
    expect(SOURCE_DECAL_FOG_FADE_SOURCES.shaderSha256).toBe(report.shader.sha256);
    expect(SOURCE_DECAL_FOG_FADE_SOURCES.containerSha256).toBe(report.container.sha256);
    expect(SOURCE_DECAL_FOG_FADE_SOURCES.fadeProgramSha256).toBe(report.container.programs['0x2/0'].sha256);
  });

  it('carries the shipped programs it transcribes, instruction for instruction', () => {
    expect(SOURCE_DECAL_FOG_FADE.programs.fade).toEqual({
      static: 2, dynamic: 0, sha256: report.container.programs['0x2/0'].sha256,
      instructions: report.container.programs['0x2/0'].instructions});
    expect(SOURCE_DECAL_FOG_FADE.programs.plain).toEqual({
      static: 0, dynamic: 0, sha256: report.container.programs['0x0/0'].sha256,
      instructions: report.container.programs['0x0/0'].instructions});
    expect(SOURCE_DECAL_FOG_FADE.programs.vertexAlpha).toEqual({
      static: 1, dynamic: 1, sha256: report.container.programs['0x1/1'].sha256,
      instructions: report.container.programs['0x1/1'].instructions});
    // The four combos and the two dynamic ones, and the flags the shader declares beside them.
    expect(report.container.statics).toEqual(['0x0', '0x1', '0x2', '0x3']);
    expect(report.container.dynamicCombos).toBe(2);
    expect(report.shader.flags.map((row) => row.define)).toEqual(['VERTEXALPHA', 'FOGFADE', 'PIXELFOGTYPE']);
    expect(report.ctabNames).toContain('g_FogParams');
    expect(report.ctabNames).toContain('g_FogTweakParams');
  });

  it('reads the fade out of the material that asks for it, and none out of the one that does not', () => {
    expect(SOURCE_DECAL_FOG_FADE.forAtlas('decals/decals_bulletsheet')).toEqual({
      start: 0, end: 0.5, scale: 1, exponent: 0.4, neutral: 0.5});
    expect(SOURCE_DECAL_FOG_FADE.forAtlas('decals/decals_mod2x')).toBeNull();
    expect(SOURCE_DECAL_FOG_FADE.forAtlas('decals/does_not_ship')).toBeNull();
    expect(report.reachableAtlases['decals/decals_bulletsheet'].stated).toEqual({fogfadeend: 0.5});
    expect(report.reachableAtlases['decals/decals_mod2x'].stated).toEqual({});
    // Every shipped material that uses the fade states exactly the bound the arithmetic needs.
    expect(report.fadeMaterials).toHaveLength(14);
    expect(report.fadeMaterials.every((row) => row.stated.fogfadeend === 0.5)).toBe(true);
    expect(report.sources.sheets['decals/decals_bulletsheet'].named).toContain('sRGB');
  });

  it('states what it did not read rather than filling the gap in', () => {
    expect(SOURCE_DECAL_FOG_FADE.limitations.length).toBeGreaterThanOrEqual(4);
    expect(SOURCE_DECAL_FOG_FADE.limitations.join(' ')).toContain('static combo key was not read');
    expect(report.boundary).toContain('static combo key was not read');
    expect(report.reading).toContain('distance from the eye');
  });

  it('draws the shipped arithmetic rather than a resemblance of it', () => {
    // `add r1.xyz, -a1.xyzw, c11.xyzw` ... `rcp`: the distance from the eye to the fragment, which
    // the vertex stage hands the fragment stage.
    expect(SOURCE_DECAL_PROGRAM.vertex).toContain('vDecalDistance = length(view.xyz)');
    const fragment = SOURCE_DECAL_PROGRAM.fragment;
    const ordered = [
      // `mad r1.x_sat, r1.xxxx, c12.wwww, c12.xxxx` then `min r2.w, r1.xxxx, c12.zzzz`.
      'min(clamp(vDecalDistance * fogRamp.w + fogRamp.x, 0.0, 1.0), fogRamp.z)',
      // `mul r1.x_sat, r2.wwww, c0.yyyy` / `pow r2.x, r1.xxxx, c0.xxxx` / `mul r1.x, r2.xxxx, r2.xxxx`.
      'float tint = pow(clamp(fogAmount * fade.z, 0.0, 1.0), fade.w)',
      'tint *= tint',
      // `add r1.y, r2.wwww, -c0.zzzz` / `add r1.z, -c0.zzzz, c0.wwww` / `rcp` / `mul r1.y_sat`.
      'clamp((fogAmount - fade.x) / (fade.y - fade.x), 0.0, 1.0)',
      // `lrp r2.xyz, r1.yyyy, c1.xxxx, r0.xyzw`: the texel toward the neutral value the sheet uses.
      'texel = mix(texel, vec3(0.5), amount)',
      // `lrp r0.xyz, r1.xxxx, c29.xyzw, r2.xyzw`.
      'texel = mix(texel, fogColor, tint)',
      // `mov oc0.xyzw, r0.xyzw`, and the doubling the blend carries rather than the program.
      'gl_FragColor = vec4(2.0 * texel, 1.0)',
    ];
    let at = -1;
    for (const step of ordered) {
      const next = fragment.indexOf(step, at + 1);
      expect(next, step).toBeGreaterThan(at);
      at = next;
    }
    // The fade is a branch, because the shipped plain program has no fade arithmetic at all.
    expect(fragment).toContain('if (fade.y > fade.x) {');
    // The mesh is a decal quad: no vertex colour, so the shipped VERTEXALPHA factor is one.
    expect(SOURCE_DECAL_PROGRAM.vertex).not.toContain('color');
  });

  it('fades a decal out where the map states its fade, using the map\'s own fog numbers', () => {
    const fade = SOURCE_DECAL_FOG_FADE.forAtlas('decals/decals_bulletsheet')!;
    const fog = SOURCE_DUST2_ENVIRONMENT.fog;
    const span = fog.farMetres - fog.nearMetres;
    const amountAt = (metres: number) =>
      Math.min(Math.max((metres * (1 / span)) + (-fog.nearMetres / span), 0), fog.maxDensity);
    // A mark at the start of the ramp takes no fade; one at the map's own cap takes 80% of it,
    // because the map caps its fog at 40% and the sheet ends its fade at 50%.
    expect(amountAt(fog.nearMetres)).toBeCloseTo(0, 12);
    expect(amountAt(fog.farMetres)).toBeCloseTo(fog.maxDensity, 12);
    expect(Math.min(Math.max((amountAt(fog.farMetres) - fade.start) / (fade.end - fade.start), 0), 1))
      .toBeCloseTo(0.8, 12);
    // The tint at that cap: `(saturate(fog * scale) ^ exponent) ^ 2`.
    const tint = Math.pow(Math.min(Math.max(amountAt(fog.farMetres) * fade.scale, 0), 1), fade.exponent) ** 2;
    expect(amountAt(fog.farMetres)).toBeCloseTo(0.4, 12);
    expect(tint).toBeCloseTo(0.48045, 5);
    // The program saturates its ramp, so a fragment nearer than `fogstart` reads no fog at all
    // rather than a negative amount.
    expect(amountAt(fog.nearMetres / 2)).toBe(0);
  });

  it('refuses a table that says anything else', () => {
    for (const bad of [
      {...base, format: 'source-decal-fog-fade-v2'},
      {...base, shaderSha256: 'nope'},
      {...base, neutral: 0.4},
      withDeclared({scale: '2.0'}),
      withDeclared({fadeEnd: '0.5'}),
      withDeclared({exponent: '0'}),
      withProgram('fade', ['mov oc0.xyzw, r0.xyzw']),
      withProgram('plain', ['lrp r2.xyz, r1.yyyy, c1.xxxx, r0.xyzw']),
      withProgram('fade', ['lrp r2.xyz, r1.yyyy, c1.xxxx, r0.xyzw']),
      withProgram('vertexAlpha', []),
      withAtlas('decals/decals_bulletsheet', {fadeStart: 0, fadeEnd: 0, scale: 1, exponent: 0.4}),
      withAtlas('decals/decals_bulletsheet', {fadeStart: -0.5, fadeEnd: 2, scale: 1, exponent: 0.4}),
      withAtlas('decals/decals_bulletsheet', {fadeStart: 0, fadeEnd: 0.5, scale: 0, exponent: 0.4}),
      withAtlas('decals/decals_bulletsheet', null),
      {...base, limitations: []},
    ]) {
      expect(() => createSourceDecalFogFade(bad)).toThrow(/Source decal fog fade/);
    }
    // Each refusal names what it refused.
    expect(() => createSourceDecalFogFade({...base, format: 'source-decal-fog-fade-v2'}))
      .toThrow(/unknown format/);
    expect(() => createSourceDecalFogFade(withDeclared({fadeEnd: '0.5'}))).toThrow(/FADEEND/);
    expect(() => createSourceDecalFogFade(withProgram('fade', ['mov oc0.xyzw, r0.xyzw'])))
      .toThrow(/no longer lerps/);
    expect(() => createSourceDecalFogFade(withProgram('plain', ['lrp r2.xyz, r1.yyyy, c1.xxxx, r0.xyzw'])))
      .toThrow(/plain program carries the fade/);
    expect(() => createSourceDecalFogFade(withAtlas('decals/decals_bulletsheet', {fadeStart: 0, fadeEnd: 0, scale: 1, exponent: 0.4})))
      .toThrow(/not a range of fog/);
    // And the shipped table itself is what the runtime uses.
    expect(SOURCE_DECAL_FOG_FADE.forAtlas('decals/decals_bulletsheet')!.end).toBe(0.5);
  });
});
