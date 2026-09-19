import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from '@noble/hashes/sha2.js';
import { sourceTracerDraws } from '../game/source-tracer-draw';
import { sourceTracerFade } from '../game/source-tracers';
import table from '../game/source-tracers.json';
import resources from '../game/source-tracer-resources.json';
import effects from '../public/source/csgo-12426148/weapon-effects/effect-map.json';

const digest = (bytes: Uint8Array) => Array.from(sha256(bytes), value => value.toString(16).padStart(2, '0')).join('');
const read = (relative: string) => readFileSync(resolve(relative));

type System = {
  material: string; shader: string; maxParticles: number; maximumDrawDistanceUnits: number;
  aggregationRadiusUnits: number; emitCount: number; speedUnitsPerSecond: number[];
  endControlPoint: number; endSpread: number; startOffsetUnits: number; endOffsetUnits: number;
  biasLifetimeByTrailLength: boolean; radiusUnits: number[]; radiusExponent: number;
  trailLengthSeconds: number[]; trailLengthExponent: number;
  renderLengthUnits: number[]; lengthFadeInSeconds: number; constrainRadiusToLength: boolean;
  animationRate: number; tailColorAlphaScale: number[]; alphaRange: number[]; alphaExponent: number;
  color1: number[]; color2: number[]; gravityUnitsPerSecondSquared: number[]; drag: number;
  fade: { startAlpha: number; endAlpha: number; start_fade_in_time: number; end_fade_in_time: number;
    start_fade_out_time: number; end_fade_out_time: number };
  offsetUnits: number[]; offsetUnitsMax: number[]; offsetInLocalSpace: boolean; offsetControlPoint: number;
};
const staged = table as unknown as {
  format: string; build: number; sourceUnitsToMetres: number;
  material: { path: string; shader: string; additive: boolean; splineType: number;
    texture: { parameter: string; source: string; width: number; height: number; vtfFlags: number; png: string } };
  systems: Record<string, System>; weapons: Record<string, string>;
  fadeTimeBasis: { 'read as': string; evidence: string[]; boundary: string };
  limitations: string[];
};
const research = JSON.parse(read('research/source-tracers.json').toString()) as {
  format: string; build: number; effects: Record<string, { max_particles: number; material: string;
    'maximum draw distance': number; 'aggregation radius': number;
    operators: Record<string, Record<string, unknown>>; collections: Record<string, string[]> }>;
  materials: Record<string, { shader: string; body: Record<string, string>;
    textures: { parameter: string; source: string; width: number; height: number; vtfFlags: number;
      vtfMipCount: number; png: { path: string; bytes: number; sha256: string } }[] }>;
  nativeSchemas: Record<string, { fields: { name: string; default: string }[] }>;
  operatorResolutions: Record<string, string>;
  nativeUndocumented: string[];
};

const TRAIL = 'move particles between 2 control points';

describe('original tracer systems', () => {
  it('is cut from this build and names a system for every weapon', () => {
    expect(staged.format).toBe('source-tracers-v1');
    expect(staged.build).toBe(12426148);
    expect(research.format).toBe('source-tracers-v1');
    expect(staged.weapons).toEqual({
      vandal: 'weapon_tracers_assrifle', m4a4: 'weapon_tracers_assrifle', awp: 'weapon_tracers_rifle',
      glock: 'weapon_tracers_pistol', usp: 'weapon_tracers_pistol', deagle: 'weapon_tracers_pistol',
    });
    // The mapping is the shipped effect table's own, not a copy made by hand.
    for (const [weapon, row] of Object.entries(effects.weapons))
      expect(staged.weapons[weapon]).toBe(row.tracer_effect);
    expect(staged.sourceUnitsToMetres).toBeCloseTo(0.0254, 12);
  });

  it('carries each system\'s own numbers, not a shared set', () => {
    const rifle = staged.systems.weapon_tracers_assrifle;
    expect(rifle.material).toBe('particle\\particle_spark.vmt');
    expect(rifle.maxParticles).toBe(1);
    expect(rifle.emitCount).toBe(1);
    expect(rifle.maximumDrawDistanceUnits).toBe(10000);
    expect(rifle.aggregationRadiusUnits).toBe(1024);
    expect(rifle.speedUnitsPerSecond).toEqual([13000, 13000]);
    expect(rifle.radiusUnits).toEqual([3, 3]);
    expect(rifle.alphaRange).toEqual([160, 175]);
    expect(rifle.trailLengthSeconds[0]).toBeCloseTo(0.084, 6);
    expect(rifle.trailLengthSeconds[1]).toBeCloseTo(0.093, 6);
    expect(rifle.renderLengthUnits).toEqual([0, 500]);
    expect(rifle.lengthFadeInSeconds).toBeCloseTo(0.101, 6);
    expect(rifle.offsetUnits).toEqual([20, 0, 0]);
    expect(rifle.offsetInLocalSpace).toBe(true);

    const awp = staged.systems.weapon_tracers_rifle;
    expect(awp.speedUnitsPerSecond).toEqual([13000, 14000]);
    expect(awp.radiusUnits).toEqual([4, 7]);
    expect(awp.alphaRange).toEqual([140, 180]);
    expect(awp.offsetUnits).toEqual([80, 0, 0]);
    expect(awp.trailLengthSeconds[0]).toBeCloseTo(0.19, 6);

    const pistol = staged.systems.weapon_tracers_pistol;
    expect(pistol.speedUnitsPerSecond).toEqual([12000, 13000]);
    expect(pistol.radiusUnits).toEqual([2, 3]);
    expect(pistol.alphaRange).toEqual([140, 205]);
    // The pistol system carries no offset operator at all, so its streak starts on the line.
    expect(pistol.offsetUnits).toEqual([0, 0, 0]);
    expect(pistol.color1).toEqual([247, 213, 94, 255]);

    // Every number the table carries is the shipped PCF's own value, and every field the PCF
    // leaves empty is this build's own default rather than a guess.
    for (const [name, system] of Object.entries(staged.systems)) {
      const original = research.effects[name];
      expect(system.maxParticles, name).toBe(original.max_particles);
      expect(system.maximumDrawDistanceUnits, name).toBeCloseTo(original['maximum draw distance'], 6);
      expect(system.aggregationRadiusUnits, name).toBeCloseTo(original['aggregation radius'], 6);
      expect(system.material, name).toBe(original.material);
      expect(system.speedUnitsPerSecond, name).toEqual([
        original.operators[TRAIL]['minimum speed'], original.operators[TRAIL]['maximum speed']]);
      expect(system.radiusUnits, name).toEqual([
        original.operators['Radius Random'].radius_min, original.operators['Radius Random'].radius_max]);
      expect(system.alphaRange, name).toEqual([
        original.operators['Alpha Random'].alpha_min, original.operators['Alpha Random'].alpha_max]);
      expect(system.color1, name).toEqual(original.operators['Color Random'].color1);
      expect(system.color2, name).toEqual(original.operators['Color Random'].color2);
      expect(system.constrainRadiusToLength, name)
        .toBe(Boolean(original.operators['render_sprite_trail']['constrain radius to length']));
      // `Movement Basic` states nothing for these systems: the streak has no ballistic flight.
      expect(system.gravityUnitsPerSecondSquared, name)
        .toEqual(original.operators['Movement Basic'].gravity ?? [0, 0, 0]);
      expect(system.gravityUnitsPerSecondSquared).toEqual([0, 0, 0]);
      expect(system.drag).toBe(0);
    }
  });

  it('covers every operator the systems use with this build\'s own schema', () => {
    // The PCF spells one operator in lower case while this build registers it capitalised; the
    // client's own table records the pair, so the resolution is read from it and not guessed.
    expect(research.nativeUndocumented).toEqual([]);
    expect(research.operatorResolutions[TRAIL]).toBe('Move Particles Between 2 Control Points');
    expect(Object.keys(research.nativeSchemas)).toContain(TRAIL);
    for (const name of ['render_sprite_trail', 'Alpha Fade and Decay for Tracers', 'Trail Length Random',
      'Alpha Random', 'Color Random', 'Radius Random', 'Position Modify Offset Random', 'Movement Basic',
      'emit_instantaneously', TRAIL])
      expect(Object.keys(research.nativeSchemas), name).toContain(name);
    // The fields the systems leave empty are filled from these very tables; two of them are the
    // ones a tracer cannot be drawn without.
    const fade = research.nativeSchemas['Alpha Fade and Decay for Tracers'].fields;
    const endAlpha = fade.find(field => field.name === 'end_alpha');
    const endOut = fade.find(field => field.name === 'end_fade_out_time');
    expect(endAlpha?.default).toBe('0');
    expect(endOut?.default).toBe('1');
    // The sphere initialiser places the particle and gives it its own speed; both are zero here,
    // which is why the streak starts on the control point and has no speed of its own.
    const sphere = research.nativeSchemas['Position Within Sphere Random'].fields;
    expect(sphere.find(field => field.name === 'distance_min')?.default).toBe('0');
    expect(sphere.find(field => field.name === 'speed_in_local_coordinate_system_min')?.default).toBe('0 0 0');
  });

  it('reads the four fade times as a fraction of the particle\'s own flight, and says so', () => {
    expect(staged.fadeTimeBasis['read as']).toMatch(/fraction of the particle's own flight/);
    expect(staged.fadeTimeBasis.evidence.join(' ')).toMatch(/absolute seconds/);
    expect(staged.fadeTimeBasis.evidence.join(' ')).toMatch(/end_fade_out_time.*is exactly 1/);
    expect(staged.fadeTimeBasis.boundary).toMatch(/not executed|stated rather than measured/);

    // The envelope the four windows describe, at each of its own points, for the shipped
    // `weapon_tracers_assrifle`: 0 until 20% of the flight, up to 1 by 30%, held to 95%, then
    // back to 0 at the end.
    const fade = staged.systems.weapon_tracers_assrifle.fade;
    expect(fade.startAlpha).toBe(0);
    expect(fade.endAlpha).toBe(0);
    expect(sourceTracerFade(fade, 0)).toBeCloseTo(0, 12);
    expect(sourceTracerFade(fade, 0.2)).toBeCloseTo(0, 12);
    expect(sourceTracerFade(fade, 0.25)).toBeCloseTo(0.5, 6);
    // The windows come out of the table as 32-bit floats, so a point sitting exactly on one is
    // held to the precision the shipped file itself has.
    expect(sourceTracerFade(fade, 0.3)).toBeCloseTo(1, 6);
    expect(sourceTracerFade(fade, 0.6)).toBeCloseTo(1, 12);
    expect(sourceTracerFade(fade, 0.95)).toBeCloseTo(1, 5);
    expect(sourceTracerFade(fade, 0.975)).toBeCloseTo(0.5, 6);
    expect(sourceTracerFade(fade, 1)).toBeCloseTo(0, 12);
    expect(sourceTracerFade(fade, 1.4)).toBeCloseTo(0, 12);
    // Which means a streak is invisible for the first fifth of its flight and dims before it
    // arrives: the windows are what make that true, not a choice made here.
    expect(fade.start_fade_in_time).toBeCloseTo(0.2, 6);
    expect(fade.end_fade_in_time).toBeCloseTo(0.3, 6);
    expect(fade.start_fade_out_time).toBeCloseTo(0.95, 6);
    expect(fade.end_fade_out_time).toBe(1);
  });

  it('states what it deliberately does not reproduce', () => {
    const text = staged.limitations.join(' ');
    expect(text).toMatch(/shot's own line/);
    expect(text).toMatch(/fractions of the particle's flight/);
    expect(text).toMatch(/local offset/);
    expect(text).toMatch(/splinetype 2/);
    expect(text).toMatch(/aggregation radius/);
    expect(text).toMatch(/no gravity and no drag/);
    expect(text).toMatch(/maximum draw distance/);
    expect(new Set(staged.limitations).size).toBe(staged.limitations.length);
    // The material is the shipped one, not a stand-in.
    expect(staged.material.path).toBe('materials/particle/particle_spark.vmt');
    expect(staged.material.shader).toBe('spritecard');
    expect(staged.material.additive).toBe(true);
    expect(staged.material.splineType).toBe(2);
    expect(research.materials['materials/particle/particle_spark.vmt'].body['$additive']).toBe('1');
    expect(research.materials['materials/particle/particle_spark.vmt'].body['$splinetype']).toBe('2');
    expect(staged.material.texture.source).toBe('materials/effects/spark.vtf');
    expect(staged.material.texture.width).toBe(32);
    expect(staged.material.texture.height).toBe(64);
    // Both texture axes clamp, so a streak samples its own sprite and never tiles.
    expect(staged.material.texture.vtfFlags & 0x4).toBe(0x4);
    expect(staged.material.texture.vtfFlags & 0x8).toBe(0x8);
  });

  it('ships the spark texture the receipt names', () => {
    const rows = resources as unknown as { kind: string; name: string; path: string; bytes: number; sha256: string }[];
    expect(rows.filter(row => row.kind === 'texture')).toHaveLength(1);
    for (const row of rows) {
      const path = `public/source/csgo-12426148/tracers/${row.path}`;
      expect(existsSync(resolve(path)), row.path).toBe(true);
      const bytes = read(path);
      expect(bytes.byteLength, row.path).toBe(row.bytes);
      expect(digest(bytes), row.path).toBe(row.sha256);
    }
    // The staged PNG is the PNG the export decoded, byte for byte.
    const exported = research.materials['materials/particle/particle_spark.vmt'].textures[0];
    const stagedTexture = rows.find(row => row.kind === 'texture')!;
    expect(stagedTexture.sha256).toBe(exported.png.sha256);
    expect(stagedTexture.bytes).toBe(exported.png.bytes);
    // A VTF with mipmaps states how many it stores; the decode pairs must agree.
    expect(exported.vtfMipCount).toBe(7);
    // The provenance keeps the material and the texture it was decoded from.
    const provenance = JSON.parse(read('public/source/csgo-12426148/tracers/provenance.json').toString()) as {
      pcf: { source: string; bytes: number; sha256: string }; material: string; shader: string;
      body: Record<string, string>; texture: { source: string; vtfFlags: number; rgbaSha256: string };
      operatorResolutions: Record<string, string>; limitations: string[];
    };
    expect(provenance.pcf.source).toBe('particles/weapons/cs_weapon_fx.pcf');
    expect(provenance.material).toBe('materials/particle/particle_spark.vmt');
    expect(provenance.shader).toBe('spritecard');
    expect(provenance.texture.source).toBe('materials/effects/spark.vtf');
    expect(provenance.texture.rgbaSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance.operatorResolutions[TRAIL]).toBe('Move Particles Between 2 Control Points');
  });

  it('draws one tracer per shot from the shot\'s own identity', () => {
    // The same shot draws the same streak on every client, and a different shot draws a
    // different one; each draw is a unit value the table's own ranges are read with.
    const first = sourceTracerDraws('player-7', 41);
    expect(sourceTracerDraws('player-7', 41)).toEqual(first);
    expect(sourceTracerDraws('player-8', 41)).not.toEqual(first);
    expect(sourceTracerDraws('player-7', 42)).not.toEqual(first);
    for (const value of Object.values(first)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    // A shot's five draws are independent, so a streak is not forced to be both wide and bright.
    expect(new Set(Object.values(first)).size).toBeGreaterThan(1);
    // The draws land inside each system's own ranges once they are read with them.
    const rifle = staged.systems.weapon_tracers_assrifle;
    const lerp = (range: number[], unit: number, exponent: number) =>
      range[0] + (range[1] - range[0]) * Math.pow(unit, exponent);
    const speed = lerp(rifle.speedUnitsPerSecond, first.speed, 1);
    const radius = lerp(rifle.radiusUnits, first.radius, rifle.radiusExponent);
    const alpha = lerp(rifle.alphaRange, first.alpha, rifle.alphaExponent);
    expect(speed).toBeGreaterThanOrEqual(rifle.speedUnitsPerSecond[0]);
    expect(speed).toBeLessThanOrEqual(rifle.speedUnitsPerSecond[1]);
    expect(radius).toBeCloseTo(3, 9);
    expect(radius).toBeGreaterThanOrEqual(rifle.radiusUnits[0]);
    expect(alpha).toBeGreaterThanOrEqual(rifle.alphaRange[0]);
    expect(alpha).toBeLessThanOrEqual(rifle.alphaRange[1]);
    // A rifle tracer crosses a 30 m shot in a tenth of a second, which is why the shipped fade
    // windows can only be fractions: as seconds they would outlast the whole flight.
    const flightSeconds = 30 / (speed * staged.sourceUnitsToMetres);
    expect(flightSeconds).toBeLessThan(0.12);
    expect(flightSeconds).toBeLessThan(rifle.fade.end_fade_in_time);
    expect(flightSeconds).toBeLessThan(rifle.fade.start_fade_out_time);
    // And its streak is the system's own length, capped by the renderer's own maximum.
    const trailMetres = Math.min(
      lerp(rifle.trailLengthSeconds, first.trail, rifle.trailLengthExponent)
        * speed * staged.sourceUnitsToMetres,
      rifle.renderLengthUnits[1] * staged.sourceUnitsToMetres);
    expect(trailMetres).toBeCloseTo(500 * staged.sourceUnitsToMetres, 6);
    expect(trailMetres).toBeGreaterThan(10);
  });
});
