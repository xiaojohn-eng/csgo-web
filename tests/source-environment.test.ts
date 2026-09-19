import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  createSourceEnvironment,
  environmentColor,
  environmentFogColor,
  environmentSunDirection,
  SOURCE_DUST2_ENVIRONMENT,
} from '../game/source-environment';
import { SOURCE_DUST2_ENVIRONMENT_DATA, SOURCE_DUST2_ENVIRONMENT_SOURCES } from '../game/source-environment-data';
import {
  applySourceFog,
  installSourceFog,
  setSourceFogMaxDensity,
  sourceFogMaxDensity,
  SOURCE_FOG_MAX_DENSITY,
} from '../game/source-fog';

const report = JSON.parse(readFileSync(resolve(__dirname, '..', 'research/source-environment.json'), 'utf8')) as {
  format: string; id: string; sourceBspSha256: string; metersPerSourceUnit: number;
  entityLump: {entities: number};
  lightEnvironment: {sunColor: number[]; sunBrightness: number; ambientColor: number[]; ambientBrightness: number;
    lightScaleHDR: number};
  fogController: {color: number[]; sourceStart: number; sourceEnd: number; maxDensity: number;
    nearMetres: number; farMetres: number; enabled: boolean};
  tonemapController: {onMapSpawn: Record<string, number>};
  postProcess: {allStrengthsZero: boolean};
  shadowControl: {color: number[]; distance: number; disableAllShadows: boolean};
  sun: {material: string; size: number; renderColor: number[]};
  colorCorrection: {filename: string; maxWeight: number; lut: {sha256: string;
    againstNeutral: {maxChannelDelta: number; channelsMoved: number}}};
  sources: Record<string, string>;
};

const serial = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('Original Dust2 environment', () => {
  it('is generated from the probe report, so the table cannot drift from the measurement', () => {
    expect(report.format).toBe('source-environment-v1');
    const generated = SOURCE_DUST2_ENVIRONMENT;
    expect(generated.sourceBspSha256).toBe(report.sourceBspSha256);
    expect(generated.metersPerSourceUnit).toBe(report.metersPerSourceUnit);
    expect(serial(generated.fog)).toEqual({
      enabled: report.fogController.enabled, color: report.fogController.color,
      sourceStart: report.fogController.sourceStart, sourceEnd: report.fogController.sourceEnd,
      maxDensity: report.fogController.maxDensity, nearMetres: report.fogController.nearMetres,
      farMetres: report.fogController.farMetres,
    });
    expect(serial(generated.light).sunColor).toEqual(report.lightEnvironment.sunColor);
    expect(serial(generated.light).ambientColor).toEqual(report.lightEnvironment.ambientColor);
    expect(generated.light.lightScaleHDR).toBe(report.lightEnvironment.lightScaleHDR);
    expect(serial(generated.shadow.color)).toEqual(report.shadowControl.color);
    expect(serial(generated.sun.renderColor)).toEqual(report.sun.renderColor);
    expect(generated.colorCorrection.filename).toBe(report.colorCorrection.filename);
    expect(generated.colorCorrection.maxChannelDeltaVsNeutral)
      .toBe(report.colorCorrection.lut.againstNeutral.maxChannelDelta);
    expect(generated.colorCorrection.channelsMovedVsNeutral)
      .toBe(report.colorCorrection.lut.againstNeutral.channelsMoved);
    expect(generated.colorCorrection.lutSha256).toBe(report.colorCorrection.lut.sha256);
    expect(generated.postProcess.allStrengthsZero).toBe(report.postProcess.allStrengthsZero);
    // The exposure range the map pushes on spawn, not a renderer default.
    expect(serial(generated.tonemap).autoExposureMin).toBe(report.tonemapController.onMapSpawn.SetAutoExposureMin);
    expect(generated.tonemap.autoExposureMax).toBe(report.tonemapController.onMapSpawn.SetAutoExposureMax);
    expect(generated.tonemap.percentTarget).toBe(report.tonemapController.onMapSpawn.SetTonemapPercentTarget);
    expect(generated.tonemap.percentBrightPixels).toBe(report.tonemapController.onMapSpawn.SetTonemapPercentBrightPixels);
    expect(generated.tonemap.rate).toBe(report.tonemapController.onMapSpawn.SetTonemapRate);
    expect(generated.tonemap.bloomScale).toBe(report.tonemapController.onMapSpawn.SetBloomScale);
  });

  it('names the sources it was generated from', () => {
    expect(SOURCE_DUST2_ENVIRONMENT_SOURCES.sourceBspSha256).toBe(report.sourceBspSha256);
    expect(SOURCE_DUST2_ENVIRONMENT_SOURCES.entitiesJsonSha256).toBe(report.sources.entitiesJsonSha256);
    expect(SOURCE_DUST2_ENVIRONMENT_SOURCES.serverDllSha256).toBe(report.sources.serverDllSha256);
    expect(SOURCE_DUST2_ENVIRONMENT_SOURCES.serverClientSoSha256).toBe(report.sources.serverClientSoSha256);
    expect(SOURCE_DUST2_ENVIRONMENT_SOURCES.clientDllSha256).toBe(report.sources.clientDllSha256);
    expect(SOURCE_DUST2_ENVIRONMENT_SOURCES.colorCorrectionLutSha256).toBe(report.colorCorrection.lut.sha256);
    expect(SOURCE_DUST2_ENVIRONMENT_DATA).toEqual(SOURCE_DUST2_ENVIRONMENT);
  });

  it('keeps the map\'s own fog colour and the number the sky programs read as cLightScale', () => {
    expect(environmentFogColor(SOURCE_DUST2_ENVIRONMENT)).toBe('#d5cbac');
    // The cloud layer's program ends with `rgb * cLightScale`; the map states 1, so the port's
    // product is already the original's and the factor cannot be "close enough" at some other value.
    expect(SOURCE_DUST2_ENVIRONMENT.light.lightScaleHDR).toBe(1);
    // The sun direction is a unit vector pointing from the map toward the sun.
    const [x, y, z] = SOURCE_DUST2_ENVIRONMENT.light.sunSourceDirection;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
  });

  it('states the sun sprite\'s member table, and which of its keys no shipped binary reads', () => {
    const sun = SOURCE_DUST2_ENVIRONMENT.sun;
    // The map's own values, as it wrote them.
    expect(sun.material).toBe('sprites/light_glow02_add_noz');
    expect(sun.size).toBe(32);
    expect(sun.renderColor).toEqual([255, 245, 217]);
    expect(sun.overlaySize).toBe(-1);
    expect(sun.overlayColor).toEqual([0, 0, 0]);
    expect(sun.sourceAngles).toEqual([0, 47, 0]);
    expect(sun.sourcePitch).toBe(-43);
    // Where the build's own datamap puts each key, read through its relocations rather than guessed
    // from the names. `angle` (singular) is the sun's own yaw; the map's `angles` is the entity's.
    expect(sun.members['size']).toEqual({member: 'm_nSize', offset: 0x4FC});
    expect(sun.members['angle']).toEqual({member: 'm_flYaw', offset: 0x4F8});
    expect(sun.members['pitch']).toEqual({member: 'm_flPitch', offset: 0x4F4});
    expect(sun.members['overlaysize']).toEqual({member: 'm_nOverlaySize', offset: 0x500});
    expect(sun.members['material']).toEqual({member: 'm_strMaterial', offset: 0x4E0});
    expect(sun.membersFrom).toBe('csgo/bin/linux64/server_client.so');
    // The one key nothing in the install can match, kept as the file writes it and named as such.
    expect(sun.glowDistanceScaleAsWritten).toBe(0.1);
    expect(sun.note).toMatch(/carried by none of the shipped binaries/);
    expect(sun.note).toMatch(/authoring metadata/);
  });

  it('carries the map\'s sun into the world frame and states its colours as the map wrote them', () => {
    const direction = environmentSunDirection(SOURCE_DUST2_ENVIRONMENT);
    const [sx, sy, sz] = SOURCE_DUST2_ENVIRONMENT.light.sunSourceDirection;
    // The port's frame is the map's rotated by (x, y, z) -> (x, z, -y).
    expect(direction).toEqual([sx, sz, -sy]);
    expect(Math.hypot(...direction)).toBeCloseTo(1, 9);
    // Round-trip: the converted direction has to reproduce the map's own yaw and pitch, which is
    // the check that the frame change did not silently turn the sun.
    const [x, y, z] = direction;
    const elevation = Math.asin(y);
    const yaw = Math.atan2(-z, x);
    expect(elevation * 180 / Math.PI).toBeCloseTo(-SOURCE_DUST2_ENVIRONMENT.light.sunSourcePitch, 6);
    expect(yaw * 180 / Math.PI).toBeCloseTo(SOURCE_DUST2_ENVIRONMENT.light.sunSourceAngles[1], 6);
    // The colours the scene takes, in the bytes the map wrote.
    expect(environmentColor(SOURCE_DUST2_ENVIRONMENT.light.sunColor)).toBe('#fee6c5');
    expect(environmentColor(SOURCE_DUST2_ENVIRONMENT.light.ambientColor)).toBe('#d3e2f8');
  });

  it('rejects a descriptor that does not say what the map says', () => {
    const base = SOURCE_DUST2_ENVIRONMENT as unknown as Record<string, unknown>;
    const withFog = (fog: Record<string, unknown>) => ({...base, fog: {...(base['fog'] as object), ...fog}});
    const withLight = (light: Record<string, unknown>) => ({...base, light: {...(base['light'] as object), ...light}});
    const sun = base['sun'] as Record<string, unknown>;
    const withSun = (patch: Record<string, unknown>) => ({...base, sun: {...sun, ...patch}});
    const members = sun['members'] as Record<string, unknown>;
    for (const bad of [
      withFog({sourceStart: 9000, sourceEnd: 512}),
      withFog({maxDensity: 1.4}),
      withFog({maxDensity: -0.1}),
      // The metre pair is the conversion of the Source pair, never an independent reading.
      withFog({farMetres: 228.7}),
      withLight({lightScaleHDR: 0}),
      withLight({sunSourceDirection: [1, 1, 1]}),
      // The sun's member table has to keep saying where the build puts each key.
      withSun({members: {...members, extra: {member: 'm_nX', offset: 4}}}),
      withSun({members: {...members, size: {member: 'nSize', offset: 0x4FC}}}),
      withSun({members: {...members, size: {member: 'm_nSize', offset: 0x4FD}}}),
      withSun({members: {...members, size: {member: 'm_nSize', offset: 0}}}),
      {...base, postProcess: {targetname: 'pp_dust', allStrengthsZero: false}},
      {...base, declaredButUnapplied: []},
      {...base, metersPerSourceUnit: 0.02},
      {...base, sourceBspSha256: 'nope'},
    ]) {
      expect(() => createSourceEnvironment(bad)).toThrow(/environment contract differs/);
    }
  });
});

describe('Original Source fog', () => {
  it('replaces three\'s smoothstep ramp with the original\'s capped linear one', () => {
    installSourceFog();
    expect(T.ShaderChunk.fog_fragment).toMatch(/min\( fogMaxDensity\.x,/);
    expect(T.ShaderChunk.fog_fragment).toMatch(/clamp\( \( vFogDepth - fogNear \) \/ max\( fogFar - fogNear, 1e-6 \), 0\.0, 1\.0 \)/);
    expect(T.ShaderChunk.fog_fragment).not.toMatch(/smoothstep/);
    expect(T.ShaderChunk.fog_pars_fragment).toMatch(/uniform vec2 fogMaxDensity;/);
    // The exponential branch is still three's, so a map that uses it is unaffected.
    expect(T.ShaderChunk.fog_fragment).toMatch(/1\.0 - exp\( - fogDensity \* fogDensity \* vFogDepth \* vFogDepth \)/);
    expect(T.ShaderChunk.fog_pars_vertex).toMatch(/varying float vFogDepth;/);
  });

  it('gives every fogged material one shared cap, so the cap is a scene value and not per material', () => {
    installSourceFog();
    expect(SOURCE_FOG_MAX_DENSITY.isVector2).toBe(true);
    // Three clones each material's uniform set out of ShaderLib when it builds a program. The
    // cap survives that clone as the same object, which is the only reason a scene-wide cap works.
    const first = T.UniformsUtils.clone(T.ShaderLib.basic.uniforms).fogMaxDensity.value;
    const second = T.UniformsUtils.clone(T.ShaderLib.standard.uniforms).fogMaxDensity.value;
    expect(first).toBe(SOURCE_FOG_MAX_DENSITY);
    expect(second).toBe(first);
    expect(Object.values(T.ShaderLib).filter(library =>
      (library as {uniforms?: Record<string, unknown>}).uniforms?.fogColor).length).toBe(11);
  });

  it('writes the map\'s numbers onto the scene fog and refuses a range that does not rise', () => {
    const scene = new T.Scene();
    applySourceFog(scene, {color: '#d5cbac', nearMetres: 13.0048, farMetres: 228.6, maxDensity: 0.4,
      from: 'test'});
    const fog = scene.fog as T.Fog;
    expect(fog.isFog).toBe(true);
    // three's own exponential fog is not what the map states, so the scene must not be carrying it.
    expect(fog instanceof T.FogExp2).toBe(false);
    expect((fog as unknown as {isFogExp2?: boolean}).isFogExp2).toBeUndefined();
    expect(fog.near).toBe(13.0048);
    expect(fog.far).toBe(228.6);
    expect('#' + fog.color.getHexString()).toBe('#d5cbac');
    expect(sourceFogMaxDensity()).toBe(0.4);
    // The port's own smoke state is the same ramp at full strength.
    applySourceFog(scene, {color: '#91988f', nearMetres: 0, farMetres: 1.2, maxDensity: 1, from: 'port smoke'});
    expect(sourceFogMaxDensity()).toBe(1);
    expect(() => applySourceFog(scene, {color: '#000', nearMetres: 10, farMetres: 10, maxDensity: 1, from: 'test'}))
      .toThrow(/must rise/);
    expect(() => setSourceFogMaxDensity(1.5)).toThrow(/fraction/);
    expect(() => setSourceFogMaxDensity(Number.NaN)).toThrow(/fraction/);
    // A scene that already carries a three linear fog keeps its object rather than churning one.
    const before = scene.fog;
    applySourceFog(scene, {color: '#d5cbac', nearMetres: 13.0048, farMetres: 228.6, maxDensity: 0.4, from: 'test'});
    expect(scene.fog).toBe(before);
  });

  it('names the map value the port still does not apply, with the reason', () => {
    const unapplied = SOURCE_DUST2_ENVIRONMENT.declaredButUnapplied.join(' ');
    expect(unapplied).toMatch(/auto-exposes/);
    expect(unapplied).toMatch(/colour-correction/);
    expect(SOURCE_DUST2_ENVIRONMENT.declaredButUnapplied.length).toBe(4);
  });
});
