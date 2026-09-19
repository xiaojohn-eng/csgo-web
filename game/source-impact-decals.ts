/** The original bullet-hole decal a shot leaves on the surface it hit.
 *
 * The shipped decals are `Subrect` materials: one atlas texture plus a rectangle in it,
 * drawn with the shipped `DecalModulate` recipe — the atom the atlas is built around is
 * mid grey, and `2 * texel * framebuffer` leaves the surface untouched there and darkens
 * it where the decal is. That recipe is what this renderer applies, so a decal fades out
 * by returning to the neutral value rather than by alpha blending, exactly as the shipped
 * sheet's own encoding allows.
 *
 * The fade the original gives a decal as the fog thickens is drawn too, and it is the shipped
 * program's own arithmetic rather than a resemblance of it: `probe-source-decal-fog-fade.py` reads
 * the `DecalModulate` parameter declarations, the four `ps_2_b` static combos and the materials this
 * map's impacts reach, and `game/source-decal-fog-fade.ts` validates the staged numbers. A sheet
 * that states `$fogfadeend` gets the fade; the other sheet this map draws from states none, and the
 * shipped program for that case has no fade arithmetic at all, which is what this renderer draws
 * for it. Both cases take the same fog amount the whole scene takes - the map's own capped ramp -
 * measured the way the program measures it, as the distance from the eye.
 *
 * Still a stated difference: this renderer keeps its own smaller decal budget and recycles the
 * oldest, because it draws one quad per mark and would otherwise pay a draw call for every decal,
 * where the engine counts up to `r_decals` (2048 by default) permanent plus dynamic marks.
 * The shipped `VERTEXALPHA` variant of the program is not drawn separately: this renderer's decal
 * quads carry no vertex colour, so its factor is one.
 */
import * as T from 'three';
import { sourceSha256 } from './source-sha256';
import {
  loadSourceImpactTable, sourceImpactDecalPick, sourceImpactDecalSize,
  type SourceImpactDecalMaterial, type SourceImpactTable,
} from './source-impact-table';
import { SOURCE_IMPACT_TABLE } from './source-impact-table-data';
import {SOURCE_DECAL_FOG_FADE} from './source-decal-fog-fade.js';
import type {SourceFogState} from './source-fog.js';

/**
 * The shipped `DecalModulate` program, transcribed instruction for instruction (the listing it was
 * read from is staged beside the numbers and compared by `tests/source-decal-fog-fade.test.ts`):
 *
 *   add r1.xyz, -a1.xyzw, c11.xyzw / dp3 / rsq / rcp   the distance from the eye to the fragment
 *   mad r1.x_sat, r1.xxxx, c12.wwww, c12.xxxx          the map's own fog ramp, saturated
 *   min r2.w, r1.xxxx, c12.zzzz                        capped at the map's `fogmaxdensity`
 *   mul r1.x_sat, r2.wwww, c0.yyyy / pow / mul          the tint, scaled, powered and squared
 *   add / add / rcp / mul r1.y_sat                      the fade, from the two bounds
 *   lrp r2.xyz, r1.yyyy, c1.xxxx, r0.xyzw               the texel lerped toward the neutral 0.5
 *   lrp r0.xyz, r1.xxxx, c29.xyzw, r2.xyzw              the result lerped toward the fog colour
 *   mov oc0.xyzw, r0.xyzw                               written as it is; the blend doubles it
 *
 * The fragment distance is `length(view.xyz)`, which is the same eye-to-fragment distance the
 * program's `c11.xyz - worldPosition.xyz` measures. The fade branch is the static the fade program
 * carries and the plain one does not: a sheet that states no `$fogfadeend` gets no fade arithmetic,
 * exactly as the shipped plain program has none.
 */
const DECAL_VERTEX = [
  'varying vec2 vDecalUv;',
  'varying float vDecalDistance;',
  'void main(){',
  '  vDecalUv = uv;',
  '  vec4 view = modelViewMatrix * vec4(position, 1.0);',
  '  vDecalDistance = length(view.xyz);',
  '  gl_Position = projectionMatrix * view;',
  '}',
].join('\n');
const DECAL_FRAGMENT = [
  'uniform sampler2D map;',
  // x = -near / (far - near), z = the map's cap, w = 1 / (far - near): the ramp's own constants.
  'uniform vec4 fogRamp;',
  'uniform vec3 fogColor;',
  // x = $FOGFADESTART, y = $FOGFADEEND, z = $FOGSCALE, w = $FOGEXPONENT.
  'uniform vec4 fade;',
  'varying vec2 vDecalUv;',
  'varying float vDecalDistance;',
  'void main(){',
  '  vec3 texel = texture2D(map, vDecalUv).rgb;',
  '  float fogAmount = min(clamp(vDecalDistance * fogRamp.w + fogRamp.x, 0.0, 1.0), fogRamp.z);',
  '  float tint = pow(clamp(fogAmount * fade.z, 0.0, 1.0), fade.w);',
  '  tint *= tint;',
  '  if (fade.y > fade.x) {',
  '    float amount = clamp((fogAmount - fade.x) / (fade.y - fade.x), 0.0, 1.0);',
  '    texel = mix(texel, vec3(0.5), amount);',
  '  }',
  '  texel = mix(texel, fogColor, tint);',
  '  gl_FragColor = vec4(2.0 * texel, 1.0);',
  '}',
].join('\n');

/** The decal program this renderer draws, so a test can hold it to the shipped listing it was read
 * from (`research/source-decal-fog-fade.json`). The listing is the measurement; this is the
 * transcription of it, and the in-game run measures the pixels it produces. */
export const SOURCE_DECAL_PROGRAM = {vertex: DECAL_VERTEX, fragment: DECAL_FRAGMENT};

export type SourceImpactMark = {
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  surface: string;
  /** Which decal in the surface's shipped group, and how large inside its own
   * `$decalScaleVariation`. Both come from the caller so one shot is one decal. */
  draw: number;
  scaleDraw: number;
  /** Rotation around the surface normal, in radians. Presentation-only. */
  roll: number;
};
export type SourceImpactOutcome = {
  drawn: boolean;
  reason: 'drawn' | 'unknown-surface' | 'no-decal-group' | 'no-decal' | 'unusable-normal';
  material: string | null;
  surfaceProp: string | null;
  gameMaterial: string | null;
  sizeMetres: number | null;
  /** Where the quad sits and which way it faces, so an acceptance run can check the mark
   * landed on the surface the shot reported rather than near it. */
  position: [number, number, number] | null;
  surfacePoint: [number, number, number] | null;
  normal: [number, number, number] | null;
};
export type SourceImpactAudit = {
  source: string;
  tableBuild: number;
  atlases: { name: string; url: string; bytes: number; sha256: string; width: number; height: number;
    verified: boolean }[];
  decalMaterials: number;
  surfaces: number;
  budget: number;
  live: number;
  drawn: number;
  refused: Record<string, number>;
  lastDecal: (SourceImpactOutcome & { atlas: string; atlasRect: [number, number, number, number] }) | null;
  /** The last marks drawn, so an acceptance run can read each one instead of the newest. */
  marks: (SourceImpactOutcome & { atlas: string; atlasRect: [number, number, number, number] })[];
  /** The fade the live decals fade in, with the numbers each sheet's material asked for. */
  fogFade: {
    applied: boolean;
    nearMetres: number | null;
    farMetres: number | null;
    maxDensity: number | null;
    color: string | null;
    /** What the shared uniforms were told, so the run measures the live values, not the intent. */
    ramp: number[];
    uniformColor: number[];
    neutral: number;
    /** What each sheet this map draws from asks for, straight out of the staged table. */
    requested: Record<string, { fadeStart: number; fadeEnd: number; scale: number; exponent: number } | null>;
    limitations: readonly string[];
  };
};
export type SourceImpactDecals = {
  group: T.Group;
  table: SourceImpactTable;
  add(mark: SourceImpactMark): SourceImpactOutcome;
  /** The fog the marks fade in. The original's decals take the map's own fog, so this is the
   * map's own state - not the stronger wash this port substitutes while the camera is in smoke. */
  applyFog(state: SourceFogState): void;
  audit(): SourceImpactAudit;
  dispose(): void;
};

const DEFAULT_BUDGET = 512;
const NORMAL_BIAS_UNITS = 0.01;

async function loadAtlas(url: string, sheet: { bytes: number; sha256: string }, signal?: AbortSignal) {
  const response = await fetch(url, { cache: 'no-cache', signal });
  if (!response.ok) throw Error(`Original impact atlas HTTP ${response.status}: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== sheet.bytes || await sourceSha256(bytes, signal) !== sheet.sha256)
    throw Error(`Original impact atlas differs from its receipt: ${url}`);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const texture = new T.Texture(bitmap);
  // The sheet is sampled as it is stored, not decoded: the decal is a *multiplier* against the
  // framebuffer (`2 * texel * destination`), so the texel has to be in the encoding the framebuffer
  // holds, where the sheet's own mid grey is the neutral value it is authored around. The VTF does
  // carry the sRGB flag, and DX9 has no sRGB sampler decode for the DXT formats these sheets ship
  // as - and the shipped program carries no conversion of its own - so the original multiplies the
  // stored texel too.
  texture.colorSpace = T.NoColorSpace;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Loads the shipped decal sheets and returns the system that draws them.
 * Every sheet is verified against the receipt the table carries before it is used.
 */
export async function loadSourceImpactDecals(options: {
  build: number; sourceBspSha256: string; metresPerSourceUnit: number;
  budget?: number; signal?: AbortSignal;
}): Promise<SourceImpactDecals> {
  const table = loadSourceImpactTable(SOURCE_IMPACT_TABLE, {
    build: options.build, sourceBspSha256: options.sourceBspSha256,
  });
  const budget = options.budget ?? DEFAULT_BUDGET;
  if (!Number.isInteger(budget) || budget < 1) throw Error('Original impact decal budget is invalid');
  const textures = new Map<string, T.Texture>();
  const atlasAudit = [] as SourceImpactAudit['atlases'];
  const base = new URL(table.atlasBaseUrl, globalThis.location?.href ?? undefined).href;
  // The fog and the fade are scene-wide rather than per-mark, so every decal material shares one
  // object per uniform: one write reaches every mark this system has drawn or will draw.
  const fogRamp = new T.Vector4(0, 0, 0, 0);
  const fogColor = new T.Vector3(0, 0, 0);
  const fadeByAtlas = new Map<string, T.Vector4>();
  let fogApplied: SourceFogState | null = null;
  try {
    for (const [name, sheet] of Object.entries(table.atlases)) {
      const url = new URL(sheet.url, base).href;
      textures.set(name, await loadAtlas(url, sheet, options.signal));
      atlasAudit.push({ name, url, bytes: sheet.bytes, sha256: sheet.sha256, width: sheet.width,
        height: sheet.height, verified: true });
    }
  } catch (error) {
    for (const texture of textures.values()) texture.dispose();
    throw error;
  }

  const group = new T.Group();
  group.name = 'SourceBulletImpacts12426148';
  const live: { mesh: T.Mesh; material: T.ShaderMaterial; geometry: T.PlaneGeometry }[] = [];
  const refused: Record<string, number> = {};
  let drawn = 0;
  let disposed = false;
  let lastDecal: SourceImpactAudit['lastDecal'] = null;
  const marks: SourceImpactAudit['marks'] = [];

  const refuse = (reason: SourceImpactOutcome['reason'], surfaceProp: string | null,
    extra: Partial<SourceImpactOutcome> = {}): SourceImpactOutcome => {
    refused[reason] = (refused[reason] ?? 0) + 1;
    return { drawn: false, reason, material: null, surfaceProp, gameMaterial: null, sizeMetres: null,
      position: null, surfacePoint: null, normal: null, ...extra };
  };

  /** Draws one decal. Returns what it drew and why, so an acceptance run can read the
   * decision out of the live page instead of inferring it from pixels. */
  function add(mark: SourceImpactMark): SourceImpactOutcome {
    if (disposed) throw Error('Original impact decal system is disposed');
    const row = table.impact[mark.surface];
    if (!row) return refuse('unknown-surface', null);
    const gameMaterial = row.gameMaterial;
    if (!row.decalGroup || !row.decals.length) return refuse('no-decal-group', mark.surface, { gameMaterial });
    const material = sourceImpactDecalPick(row, mark.draw);
    const definition: SourceImpactDecalMaterial | undefined = material ? table.decalMaterials[material] : undefined;
    if (!material || !definition) return refuse('no-decal', mark.surface, { gameMaterial });
    const normal = new T.Vector3(mark.nx, mark.ny, mark.nz);
    if (normal.lengthSq() < 1e-12) return refuse('unusable-normal', mark.surface, { gameMaterial });
    normal.normalize();
    const size = sourceImpactDecalSize(definition, options.metresPerSourceUnit, mark.scaleDraw);
    const texture = textures.get(definition.atlas)!;
    const [u0, v0] = definition.pos;
    const [width, height] = definition.size;
    const sheet = table.atlases[definition.atlas];
    // Source's VMT rectangle is measured from the top-left of the sheet, and the sheet reaches the
    // sampler the same way up: this renderer hands three an `ImageBitmap`, and three only sets
    // `UNPACK_FLIP_Y_WEBGL` for a source that is not one, so the sheet's first row is the texture's
    // first row and the rectangle's top edge takes the smaller V. The pairs are in the order three's
    // own `PlaneGeometry` lays its four corners down - top-left, top-right, bottom-left, bottom-right
    // - because that is the order the positions come in: pairing them in any other order draws the
    // sheet's halves against each other.
    const uv = new Float32Array([
      u0 / sheet.width, v0 / sheet.height,
      (u0 + width) / sheet.width, v0 / sheet.height,
      u0 / sheet.width, (v0 + height) / sheet.height,
      (u0 + width) / sheet.width, (v0 + height) / sheet.height,
    ]);
    const geometry = new T.PlaneGeometry(size, size);
    geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    // The fade this sheet's own material asks for, or none: the shipped plain program for a sheet
    // that states no bound, which still tints with the shader's own declared scale and exponent.
    // One object per atlas, shared by every mark drawn from it.
    const requested = SOURCE_DECAL_FOG_FADE.forAtlas(definition.atlas);
    let fade = fadeByAtlas.get(definition.atlas);
    if (!fade) {
      fade = new T.Vector4(requested ? requested.start : 0, requested ? requested.end : 0,
        requested ? requested.scale : SOURCE_DECAL_FOG_FADE.defaults.scale,
        requested ? requested.exponent : SOURCE_DECAL_FOG_FADE.defaults.exponent);
      fadeByAtlas.set(definition.atlas, fade);
    }
    const shader = new T.ShaderMaterial({
      uniforms: { map: { value: texture }, fade: { value: fade },
        fogRamp: { value: fogRamp }, fogColor: { value: fogColor } },
      vertexShader: DECAL_VERTEX,
      fragmentShader: DECAL_FRAGMENT,
      blending: T.CustomBlending,
      blendSrc: T.DstColorFactor,
      blendDst: T.ZeroFactor,
      blendEquation: T.AddEquation,
      depthWrite: false,
      depthTest: true,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const mesh = new T.Mesh(geometry, shader);
    const bias = NORMAL_BIAS_UNITS * options.metresPerSourceUnit;
    mesh.position.set(mark.x + normal.x * bias, mark.y + normal.y * bias, mark.z + normal.z * bias);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), normal);
    mesh.rotateZ(mark.roll);
    group.add(mesh);
    live.push({ mesh, material: shader, geometry });
    while (live.length > budget) {
      const oldest = live.shift()!;
      group.remove(oldest.mesh);
      oldest.geometry.dispose();
      oldest.material.dispose();
    }
    drawn++;
    lastDecal = { drawn: true, reason: 'drawn', material, surfaceProp: mark.surface, gameMaterial,
      sizeMetres: size, position: [mesh.position.x, mesh.position.y, mesh.position.z],
      surfacePoint: [mark.x, mark.y, mark.z],
      normal: [normal.x, normal.y, normal.z], atlas: definition.atlas,
      atlasRect: [definition.pos[0], definition.pos[1], definition.size[0], definition.size[1]] };
    marks.push(lastDecal);
    if (marks.length > 64) marks.shift();
    return lastDecal;
  }

  /** Puts the map's own fog into the decal shader, in the form the shipped program's constants take:
   * `c12.x` a bias, `c12.w` a scale and `c12.z` the cap, exactly as it multiplies and adds them. */
  function applyFog(state: SourceFogState) {
    const span = state.farMetres - state.nearMetres;
    if (!(span > 0) || !(state.maxDensity > 0)) throw Error('Original decal fog state is unusable');
    fogRamp.set(-state.nearMetres / span, 0, state.maxDensity, 1 / span);
    const channel = (at: number) => parseInt(state.color.slice(at, at + 2), 16) / 255;
    // The fog colour the program mixes toward is the map's own colour as stored: the decal output is
    // a multiplier against the framebuffer, so its terms share the framebuffer's encoding.
    fogColor.set(channel(1), channel(3), channel(5));
    if (![fogColor.x, fogColor.y, fogColor.z].every((value) => Number.isFinite(value) && value >= 0 && value <= 1))
      throw Error('Original decal fog colour is not a colour: ' + state.color);
    fogApplied = state;
  }

  // Every sheet this map's impacts can draw from, and what its own material asks for: the fade, or
  // the shipped plain program when it states no bound.
  const sheets = [...new Set(Object.values(table.decalMaterials).map((row) => row.atlas))].sort();
  const requested = Object.fromEntries(sheets.map((atlas) => {
    const fade = SOURCE_DECAL_FOG_FADE.forAtlas(atlas);
    return [atlas, fade && {fadeStart: fade.start, fadeEnd: fade.end, scale: fade.scale,
      exponent: fade.exponent}];
  }));

  return {
    group, table, add, applyFog,
    audit: () => ({ source: 'source-impact-decals-v1', tableBuild: table.build, atlases: atlasAudit,
      decalMaterials: Object.keys(table.decalMaterials).length, surfaces: Object.keys(table.impact).length,
      budget, live: live.length, drawn, refused: { ...refused }, lastDecal, marks: [...marks],
      fogFade: { applied: fogApplied !== null,
        nearMetres: fogApplied?.nearMetres ?? null, farMetres: fogApplied?.farMetres ?? null,
        maxDensity: fogApplied?.maxDensity ?? null, color: fogApplied?.color ?? null,
        ramp: fogRamp.toArray(), uniformColor: fogColor.toArray(),
        neutral: SOURCE_DECAL_FOG_FADE.neutral, requested,
        limitations: SOURCE_DECAL_FOG_FADE.limitations }}),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const item of live) {
        group.remove(item.mesh);
        item.geometry.dispose();
        item.material.dispose();
      }
      live.length = 0;
      group.removeFromParent();
      for (const texture of textures.values()) texture.dispose();
      textures.clear();
    },
  };
}
