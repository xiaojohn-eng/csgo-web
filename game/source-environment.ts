/**
 * The environment the map declares for itself.
 *
 * Dust2 does not leave lighting, haze or exposure to the renderer: it ships one
 * `light_environment`, one `env_fog_controller`, one `shadow_control`, one `env_sun`, one
 * `color_correction` and a `logic_auto` that pushes an exposure range into an
 * `env_tonemap_controller` on spawn. `scripts/probe-source-environment.py` reads every one of
 * those numbers out of the frozen BSP's own entity lump (twice, against the reviewed export)
 * and out of the shipped build's own key tables; `scripts/stage-source-environment.py` copies
 * the numbers the runtime acts on into `game/source-environment-data.ts`.
 *
 * This module only validates. Nothing here is defaulted, guessed or clamped into range: a
 * descriptor that does not say exactly what the map says is rejected, so a wrong table stops
 * the map instead of lighting it differently.
 */
import {SOURCE_DUST2_ENVIRONMENT_DATA} from './source-environment-data.js';

export type Triple = readonly [number, number, number];

export type SourceEnvironment = {
  readonly id: string;
  readonly sourceBspSha256: string;
  readonly metersPerSourceUnit: number;
  readonly fog: {
    readonly enabled: boolean;
    readonly color: Triple;
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly maxDensity: number;
    readonly nearMetres: number;
    readonly farMetres: number;
  };
  readonly light: {
    readonly sunColor: Triple;
    readonly sunBrightness: number;
    readonly ambientColor: Triple;
    readonly ambientBrightness: number;
    readonly lightScaleHDR: number;
    readonly sunSourceAngles: Triple;
    readonly sunSourcePitch: number;
    readonly sunSpreadAngle: number;
    readonly sunSourceDirection: Triple;
  };
  readonly tonemap: {
    readonly targetname: string;
    readonly percentTarget: number;
    readonly percentBrightPixels: number;
    readonly rate: number;
    readonly bloomScale: number;
    readonly autoExposureMin: number;
    readonly autoExposureMax: number;
  };
  readonly sun: {
    readonly material: string;
    readonly size: number;
    readonly renderColor: Triple;
    readonly overlayMaterial: string;
    readonly overlaySize: number;
    readonly overlayColor: Triple;
    readonly sourceAngles: Triple;
    readonly sourcePitch: number;
    readonly hdrColorScale: number;
    /** The value the map writes. The build carries no such key, so this is authoring metadata. */
    readonly glowDistanceScaleAsWritten: number;
    /** Where the build's own datamap puts each of those keys, member name and offset. */
    readonly members: Readonly<Record<string, { readonly member: string; readonly offset: number }>>;
    readonly membersFrom: string;
    readonly note: string;
  };
  readonly shadow: {
    readonly color: Triple;
    readonly distance: number;
    readonly disableAllShadows: boolean;
    readonly sourceAngles: Triple;
  };
  readonly colorCorrection: {
    readonly filename: string;
    readonly maxWeight: number;
    readonly maxChannelDeltaVsNeutral: number;
    readonly channelsMovedVsNeutral: number;
    readonly lutSha256: string;
  };
  readonly postProcess: {readonly targetname: string; readonly allStrengthsZero: boolean};
  /** Values the map states that this port does not apply, each with the reason. */
  readonly declaredButUnapplied: readonly string[];
};

function fail(what: string): never {
  throw new Error(`Original Source environment contract differs: ${what}`);
}

const record = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(what);
  return value as Record<string, unknown>;
};

const finite = (value: unknown, what: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(what);
  return value;
};

const bounded = (value: unknown, low: number, high: number, what: string): number => {
  const number = finite(value, what);
  if (number < low || number > high) fail(what);
  return number;
};

const text = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || !value) fail(what);
  return value;
};

const hex64 = (value: unknown, what: string): string => {
  const digest = text(value, what);
  if (!/^[0-9a-f]{64}$/.test(digest)) fail(what);
  return digest;
};

const boolean = (value: unknown, what: string): boolean => {
  if (typeof value !== 'boolean') fail(what);
  return value;
};

/**
 * The sun's member table: which of the map's keys the build's own datamap binds, and to where.
 *
 * A key with no entry would mean the map writes something the entity does not have, and an offset
 * outside the entity would mean the two readings disagree, so both are refused rather than carried.
 */
const sunMembers = (value: unknown): Record<string, { member: string; offset: number }> => {
  const rows = record(value, 'sun.members');
  const out: Record<string, { member: string; offset: number }> = {};
  for (const [key, row] of Object.entries(rows)) {
    const fields = record(row, `sun.members.${key}`);
    const name = text(fields['member'], `sun.members.${key}.member`);
    if (!/^m_[A-Za-z]+$/.test(name)) fail(`sun.members.${key}.member is not a member name`);
    const offset = finite(fields['offset'], `sun.members.${key}.offset`);
    if (offset <= 0 || offset > 0x10000 || offset % 4 !== 0) fail(`sun.members.${key}.offset`);
    out[key] = { member: name, offset };
  }
  if (Object.keys(out).length !== 8) fail('sun.members should hold the entity\'s eight bound keys');
  return out;
};

const triple = (value: unknown, what: string): Triple => {
  if (!Array.isArray(value) || value.length !== 3) fail(what);
  return [finite(value[0], what), finite(value[1], what), finite(value[2], what)] as const;
};

const color = (value: unknown, what: string): Triple => {
  const value3 = triple(value, what);
  for (const channel of value3) if (!Number.isInteger(channel) || channel < 0 || channel > 255) fail(what);
  return value3;
};

/** Validate one map's environment descriptor. Throws on anything the map did not say. */
export function createSourceEnvironment(data: unknown): SourceEnvironment {
  const root = record(data, 'root');
  if (root['id'] !== 'de_dust2' || root['metersPerSourceUnit'] !== 0.0254) fail('identity');

  const fogData = record(root['fog'], 'fog');
  const sourceStart = finite(fogData['sourceStart'], 'fog.sourceStart');
  const sourceEnd = finite(fogData['sourceEnd'], 'fog.sourceEnd');
  const maxDensity = bounded(fogData['maxDensity'], 0, 1, 'fog.maxDensity');
  const nearMetres = finite(fogData['nearMetres'], 'fog.nearMetres');
  const farMetres = finite(fogData['farMetres'], 'fog.farMetres');
  if (sourceEnd <= sourceStart) fail('fog range');
  // The metre pair is the unit conversion of the Source pair, not a second reading of it.
  if (Math.abs(nearMetres - sourceStart * 0.0254) > 1e-9 || Math.abs(farMetres - sourceEnd * 0.0254) > 1e-9) {
    fail('fog metres');
  }

  const lightData = record(root['light'], 'light');
  const lightScaleHDR = finite(lightData['lightScaleHDR'], 'light.lightScaleHDR');
  if (lightScaleHDR <= 0) fail('light.lightScaleHDR');
  const sunDirection = triple(lightData['sunSourceDirection'], 'light.sunSourceDirection');
  const directionLength = Math.hypot(...sunDirection);
  if (Math.abs(directionLength - 1) > 1e-6) fail('light.sunSourceDirection is not a unit vector');

  const tonemapData = record(root['tonemap'], 'tonemap');
  const autoExposureMin = finite(tonemapData['autoExposureMin'], 'tonemap.autoExposureMin');
  const autoExposureMax = finite(tonemapData['autoExposureMax'], 'tonemap.autoExposureMax');
  if (autoExposureMax <= autoExposureMin) fail('tonemap exposure range');
  const percentTarget = bounded(tonemapData['percentTarget'], 0, 100, 'tonemap.percentTarget');
  const percentBrightPixels = bounded(tonemapData['percentBrightPixels'], 0, 100, 'tonemap.percentBrightPixels');
  const rate = finite(tonemapData['rate'], 'tonemap.rate');
  const bloomScale = finite(tonemapData['bloomScale'], 'tonemap.bloomScale');

  const sunData = record(root['sun'], 'sun');
  const shadowData = record(root['shadow'], 'shadow');
  const correctionData = record(root['colorCorrection'], 'colorCorrection');
  const postData = record(root['postProcess'], 'postProcess');
  if (postData['allStrengthsZero'] !== true) fail('postProcess.allStrengthsZero');

  const unapplied = root['declaredButUnapplied'];
  if (!Array.isArray(unapplied) || !unapplied.length || unapplied.some((line) => typeof line !== 'string' || !line)) {
    fail('declaredButUnapplied');
  }

  return {
    id: 'de_dust2',
    sourceBspSha256: hex64(root['sourceBspSha256'], 'sourceBspSha256'),
    metersPerSourceUnit: 0.0254,
    fog: {
      enabled: boolean(fogData['enabled'], 'fog.enabled'),
      color: color(fogData['color'], 'fog.color'),
      sourceStart,
      sourceEnd,
      maxDensity,
      nearMetres,
      farMetres,
    },
    light: {
      sunColor: color(lightData['sunColor'], 'light.sunColor'),
      sunBrightness: finite(lightData['sunBrightness'], 'light.sunBrightness'),
      ambientColor: color(lightData['ambientColor'], 'light.ambientColor'),
      ambientBrightness: finite(lightData['ambientBrightness'], 'light.ambientBrightness'),
      lightScaleHDR,
      sunSourceAngles: triple(lightData['sunSourceAngles'], 'light.sunSourceAngles'),
      sunSourcePitch: finite(lightData['sunSourcePitch'], 'light.sunSourcePitch'),
      sunSpreadAngle: finite(lightData['sunSpreadAngle'], 'light.sunSpreadAngle'),
      sunSourceDirection: sunDirection,
    },
    tonemap: {
      targetname: text(tonemapData['targetname'], 'tonemap.targetname'),
      percentTarget,
      percentBrightPixels,
      rate,
      bloomScale,
      autoExposureMin,
      autoExposureMax,
    },
    sun: {
      material: text(sunData['material'], 'sun.material'),
      size: finite(sunData['size'], 'sun.size'),
      renderColor: color(sunData['renderColor'], 'sun.renderColor'),
      overlayMaterial: text(sunData['overlayMaterial'], 'sun.overlayMaterial'),
      overlaySize: finite(sunData['overlaySize'], 'sun.overlaySize'),
      overlayColor: color(sunData['overlayColor'], 'sun.overlayColor'),
      sourceAngles: triple(sunData['sourceAngles'], 'sun.sourceAngles'),
      sourcePitch: finite(sunData['sourcePitch'], 'sun.sourcePitch'),
      hdrColorScale: finite(sunData['hdrColorScale'], 'sun.hdrColorScale'),
      glowDistanceScaleAsWritten:
        finite(sunData['glowDistanceScaleAsWritten'], 'sun.glowDistanceScaleAsWritten'),
      members: sunMembers(sunData['members']),
      membersFrom: text(sunData['membersFrom'], 'sun.membersFrom'),
      note: text(sunData['note'], 'sun.note'),
    },
    shadow: {
      color: color(shadowData['color'], 'shadow.color'),
      distance: finite(shadowData['distance'], 'shadow.distance'),
      disableAllShadows: boolean(shadowData['disableAllShadows'], 'shadow.disableAllShadows'),
      sourceAngles: triple(shadowData['sourceAngles'], 'shadow.sourceAngles'),
    },
    colorCorrection: {
      filename: text(correctionData['filename'], 'colorCorrection.filename'),
      maxWeight: bounded(correctionData['maxWeight'], 0, 1, 'colorCorrection.maxWeight'),
      maxChannelDeltaVsNeutral: bounded(
        correctionData['maxChannelDeltaVsNeutral'], 0, 2, 'colorCorrection.maxChannelDeltaVsNeutral'),
      channelsMovedVsNeutral: finite(correctionData['channelsMovedVsNeutral'], 'colorCorrection.channelsMovedVsNeutral'),
      lutSha256: hex64(correctionData['lutSha256'], 'colorCorrection.lutSha256'),
    },
    postProcess: {targetname: text(postData['targetname'], 'postProcess.targetname'), allStrengthsZero: true},
    declaredButUnapplied: unapplied as readonly string[],
  };
}

/** '#rrggbb' for a colour the map states in bytes. */
export function environmentColor(color: Triple): string {
  return `#${color.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** '#d5cbac' for the map's own fog colour, in the byte order the map states it. */
export function environmentFogColor(environment: SourceEnvironment): string {
  return environmentColor(environment.fog.color);
}

/**
 * Where the map's own sun is, in this port's world frame.
 *
 * `light_environment` states the sun as Source's yaw/pitch pair, whose direction vector is
 * `(cos p cos y, cos p sin y, -sin p)` in Source's frame (x forward, y left, z up). The port's
 * world frame is the same map rotated by `(x, y, z) -> (x, z, -y)` (the convention the world,
 * collision and animations all share), which is a rotation, so a direction carries over
 * unchanged in length.
 */
export function environmentSunDirection(environment: SourceEnvironment): Triple {
  const [x, y, z] = environment.light.sunSourceDirection;
  const direction: Triple = [x, z, -y];
  const length = Math.hypot(...direction);
  if (Math.abs(length - 1) > 1e-6) fail('light.sunSourceDirection does not survive the world frame');
  return direction;
}

/** The original Dust2 environment, validated at import so a bad table cannot light a map. */
export const SOURCE_DUST2_ENVIRONMENT: SourceEnvironment =
  createSourceEnvironment(SOURCE_DUST2_ENVIRONMENT_DATA);
