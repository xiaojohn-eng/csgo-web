/** The original tracers, drawn along the shot's own line.
 *
 * `items_game.txt` gives every weapon a `tracer_effect`, and the three systems it names ship
 * in `particles/weapons/cs_weapon_fx.pcf`: `weapon_tracers_assrifle` for the rifles,
 * `weapon_tracers_rifle` for the AWP and `weapon_tracers_pistol` for the pistols. Each carries
 * one particle that `move particles between 2 control points` sweeps down the shot's line at
 * 13000 units a second while `render_sprite_trail` draws a streak behind it, textured with
 * `particle_spark.vmt` additively.
 *
 * Because the particle's own path **is** the shot's line, the streak is drawn as a ribbon along
 * that line rather than by stepping a particle and remembering where it has been: the two are
 * the same curve, and the ribbon is the exact one. What the streak's length, width, colour and
 * alpha are comes from the systems' own operators, through the table the stager writes.
 *
 * Not reproduced, and declared in the table's own `limitations`: `$splinetype 2`'s smoothing
 * (the path is already straight), the four fade times' arithmetic (they are read as fractions
 * of the flight, and the reading is stated rather than measured), the direction of the texture
 * along the trail, and `aggregation radius` batching.
 */
import * as T from 'three';
import { configureSourceParticleTexture } from './source-sprite-card';
import { sourceSha256 } from './source-sha256';
import { sourceTracerDraws } from './source-tracer-draw';
import table from './source-tracers.json';
import resources from './source-tracer-resources.json';
import type { WeaponId } from './types';

export type SourceTracerSystem = {
  material: string; shader: string; maxParticles: number;
  maximumDrawDistanceUnits: number; aggregationRadiusUnits: number; emitCount: number;
  speedUnitsPerSecond: number[]; endControlPoint: number; endSpread: number;
  startOffsetUnits: number; endOffsetUnits: number; biasLifetimeByTrailLength: boolean;
  radiusUnits: number[]; radiusExponent: number;
  trailLengthSeconds: number[]; trailLengthExponent: number;
  renderLengthUnits: number[]; lengthFadeInSeconds: number; constrainRadiusToLength: boolean;
  animationRate: number; tailColorAlphaScale: number[];
  alphaRange: number[]; alphaExponent: number;
  color1: number[]; color2: number[];
  gravityUnitsPerSecondSquared: number[]; drag: number;
  fade: { startAlpha: number; endAlpha: number; start_fade_in_time: number; end_fade_in_time: number;
    start_fade_out_time: number; end_fade_out_time: number };
  offsetUnits: number[]; offsetUnitsMax: number[]; offsetInLocalSpace: boolean; offsetControlPoint: number;
  sphereDistanceUnits?: number[]; sphereSpeedUnitsPerSecond?: number[][];
};
export type SourceTracerTable = {
  format: string; build: number; sourceUnitsToMetres: number;
  material: { path: string; shader: string; additive: boolean; splineType: number;
    texture: { parameter: string; source: string; width: number; height: number; vtfFlags: number; png: string } };
  systems: Record<string, SourceTracerSystem>;
  weapons: Record<string, string>;
  fadeTimeBasis: { 'read as': string; evidence: string[]; boundary: string };
  limitations: string[];
};
export type SourceTracerOutcome = {
  drawn: boolean;
  reason: 'drawn' | 'no-system' | 'unusable-line' | 'beyond-draw-distance' | 'pool-full' | 'already-drawn';
  system: string | null; material: string | null;
  /** The shot this streak belongs to, as `shooter:sequence`. */
  shot: string | null;
  from: [number, number, number] | null; to: [number, number, number] | null;
  lengthMetres: number | null; sideOffsetMetres: number | null;
  halfWidthMetres: number | null; alpha: number | null; color: [number, number, number] | null;
  speedMetresPerSecond: number | null; flightSeconds: number | null;
  trailLengthMetres: number | null; fadeAtHead: number | null; fadeAtTail: number | null;
  /** What the ribbon the port built actually spans, measured from its own vertices: the
   * distance between the first and last cross-section's midpoints, the width of the first
   * cross-section, and the ribbon's own longest diagonal. */
  drawnLengthMetres: number | null; drawnHalfWidthMetres: number | null; drawnDiagonalMetres: number | null;
};
export type SourceTracers = {
  group: T.Group;
  table: SourceTracerTable;
  /** One tracer along a shot's own line, from where the bullet started to where it stopped. */
  spawn(shot: { weapon: WeaponId; from: readonly [number, number, number];
    to: readonly [number, number, number]; by: string; seq: number }): SourceTracerOutcome;
  update(deltaSeconds: number, camera: T.Camera): void;
  audit(): {
    source: string; tableBuild: number; unitScale: { sourceUnitsToMetres: number };
    material: { path: string; shader: string; additive: boolean; url: string; bytes: number;
      sha256: string; verified: boolean; width: number; height: number; pathSource: string };
    systems: Record<string, SourceTracerSystem>;
    weapons: Record<string, string>;
    spawned: number; refused: Record<string, number>; live: number; finished: number;
    liveTracers: { system: string; shot: string; age: number; headMetres: number; trailMetres: number;
      halfWidthMetres: number; alpha: number; drawn: boolean;
      /** What this streak's own ribbon spans, measured from the vertices it was written with. */
      drawnLengthMetres: number; drawnWidthMetres: number;
      head: [number, number, number]; tail: [number, number, number] }[];
    lastShot: SourceTracerOutcome | null;
    fadeTimeBasis: SourceTracerTable['fadeTimeBasis'];
    limitations: string[];
  };
  dispose(): void;
};

const SEGMENTS = 12;
const MAX_LIVE = 24;
const raw = table as unknown as SourceTracerTable;
const receipts = resources as unknown as { kind: string; name: string; path: string; bytes: number; sha256: string }[];

/** `Alpha Fade and Decay for Tracers`' envelope over the particle's own flight.
 *
 * The four times are read as fractions of that flight. Read as absolute seconds they would be
 * longer than the whole flight of any real shot — a rifle tracer crosses 30 m in 0.09 s while
 * the windows run to 0.3 s and 1.0 s — so the streak could never be visible, and this build's
 * own default for `end_fade_out_time` is exactly 1. The reading is stated in the table beside
 * its evidence because the operator's own arithmetic was not executed. */
export function sourceTracerFade(fade: SourceTracerSystem['fade'], t: number): number {
  const { startAlpha, endAlpha } = fade;
  const inStart = fade.start_fade_in_time, inEnd = fade.end_fade_in_time;
  const outStart = fade.start_fade_out_time, outEnd = fade.end_fade_out_time;
  if (!(t > 0)) return startAlpha;
  if (t <= inStart) return startAlpha;
  if (t < inEnd) return startAlpha + (1 - startAlpha) * ((t - inStart) / (inEnd - inStart));
  if (t <= outStart) return 1;
  if (t < outEnd) return 1 + (endAlpha - 1) * ((t - outStart) / (outEnd - outStart));
  return endAlpha;
}

/** The three.js recipe the original's `spritecard` shader needs for these materials: the
 * shipped texture read clamped and unfiltered, sampled with the particle's own tint, added to
 * the frame when `$additive` is set, and never tone mapped. */
const vertexShader = `
attribute vec4 tracerTint;
varying vec4 tint;
void main(){
  tint=tracerTint;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;
const fragmentShader = `
uniform sampler2D originalTexture;
varying vec4 tint;
void main(){
  vec4 texel=texture2D(originalTexture,vUv);
  texel*=tint;
  if(texel.a<=.01)discard;
  gl_FragColor=texel;
  #include <colorspace_fragment>
}`;
// The fragment above needs the ribbon's own uv, which the vertex shader passes through.
const fragmentWithUv = fragmentShader.replace('void main(){', 'varying vec2 vUv;\nvoid main(){');
const vertexWithUv = vertexShader
  .replace('attribute vec4 tracerTint;', 'attribute vec4 tracerTint;\nattribute vec2 ribbonUv;')
  .replace('varying vec4 tint;', 'varying vec4 tint;\nvarying vec2 vUv;')
  .replace('tint=tracerTint;', 'tint=tracerTint;\nvUv=ribbonUv;');

function loadTable(expected: { build: number }): SourceTracerTable {
  if (raw.format !== 'source-tracers-v1') throw Error('Unsupported original tracer table');
  if (raw.build !== expected.build) throw Error('Original tracer table build differs');
  if (!(raw.sourceUnitsToMetres > 0)) throw Error('Original tracer table has no unit scale');
  if (!raw.material || !raw.material.texture) throw Error('Original tracer table names no material');
  const named = new Set(Object.values(raw.weapons ?? {}));
  for (const [name, row] of Object.entries(raw.systems ?? {})) {
    if (!named.has(name)) throw Error('Original tracer system is named by no weapon: ' + name);
    if (!Number.isInteger(row.emitCount) || row.emitCount < 1)
      throw Error('Original tracer system emits nothing: ' + name);
    if (!(row.speedUnitsPerSecond[0] > 0) || row.speedUnitsPerSecond[1] < row.speedUnitsPerSecond[0])
      throw Error('Original tracer system has no flight speed: ' + name);
    if (!(row.radiusUnits[0] > 0) || row.radiusUnits[1] < row.radiusUnits[0])
      throw Error('Original tracer system has no radius: ' + name);
    if (!(row.trailLengthSeconds[0] > 0) || row.trailLengthSeconds[1] < row.trailLengthSeconds[0])
      throw Error('Original tracer system has no trail length: ' + name);
    if (!(row.renderLengthUnits[1] > 0) || row.renderLengthUnits[0] > row.renderLengthUnits[1])
      throw Error('Original tracer system has no drawn length: ' + name);
    if (!(row.lengthFadeInSeconds >= 0)) throw Error('Original tracer length fade is negative: ' + name);
    if (!(row.alphaRange[0] >= 0) || row.alphaRange[1] < row.alphaRange[0])
      throw Error('Original tracer alpha range is not a range: ' + name);
    if (!(row.maximumDrawDistanceUnits > 0)) throw Error('Original tracer system has no draw distance: ' + name);
    for (const axis of [0, 1, 2]) {
      if (row.offsetUnits[axis] !== row.offsetUnitsMax[axis])
        throw Error('Original tracer offset is random on an axis this port does not carry: ' + name);
    }
    if (row.offsetUnits[1] !== 0 || row.offsetUnits[2] !== 0)
      throw Error('Original tracer offsets off the shot\'s own line: ' + name);
    const fade = row.fade;
    const ordered = fade.start_fade_in_time <= fade.end_fade_in_time
      && fade.end_fade_in_time <= fade.start_fade_out_time
      && fade.start_fade_out_time <= fade.end_fade_out_time;
    if (!ordered || fade.end_fade_out_time > 1 || fade.start_fade_in_time < 0)
      throw Error('Original tracer fade windows are out of order: ' + name);
    if (!(fade.startAlpha >= 0 && fade.startAlpha <= 1 && fade.endAlpha >= 0 && fade.endAlpha <= 1))
      throw Error('Original tracer fade alpha is not a scale: ' + name);
    if (row.tailColorAlphaScale.length !== 4)
      throw Error('Original tracer tail scale is not a colour: ' + name);
  }
  return raw;
}

type Live = {
  mesh: T.Mesh; system: SourceTracerSystem; name: string; key: string;
  origin: T.Vector3; direction: T.Vector3; totalMetres: number;
  speedMetresPerSecond: number; halfWidthMetres: number; maxTrailMetres: number;
  alpha: number; color: T.Color; tailScale: number[];
  age: number; flightSeconds: number;
  geometry: T.BufferGeometry; measuredCentre: number; measuredWidth: number;
};

export async function loadSourceTracers(options: { build: number; signal?: AbortSignal }): Promise<SourceTracers> {
  const mode = loadTable({ build: options.build });
  const { signal } = options;
  signal?.throwIfAborted();
  const textureReceipt = receipts.find(row => row.kind === 'texture');
  if (!textureReceipt) throw Error('Original tracer texture is not staged');
  const response = await fetch('/source/csgo-12426148/tracers/' + textureReceipt.path, { cache: 'no-cache', signal });
  if (!response.ok) throw Error(`Original tracer texture HTTP ${response.status}: ${textureReceipt.path}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== textureReceipt.bytes || await sourceSha256(bytes, signal) !== textureReceipt.sha256)
    throw Error('Original tracer texture differs from its receipt: ' + textureReceipt.path);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  let texture: T.Texture;
  try {
    texture = await new T.TextureLoader().loadAsync(url);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  configureSourceParticleTexture(texture, T.SRGBColorSpace);
  const image = texture.image as { width?: number; height?: number } | undefined;
  if (image && (image.width !== mode.material.texture.width
    || image.height !== mode.material.texture.height)) {
    URL.revokeObjectURL(url);
    texture.dispose();
    throw Error('Original tracer texture is not its own size: ' + textureReceipt.path);
  }
  signal?.throwIfAborted();

  const group = new T.Group();
  group.name = 'SourceTracers12426148';
  const owned: (() => void)[] = [() => { URL.revokeObjectURL(url); texture.dispose(); }];
  const material = new T.ShaderMaterial({
    vertexShader: vertexWithUv, fragmentShader: fragmentWithUv,
    uniforms: { originalTexture: { value: texture } },
    transparent: true, depthWrite: false, depthTest: true, side: T.DoubleSide,
    blending: mode.material.additive ? T.AdditiveBlending : T.NormalBlending,
    toneMapped: false,
  });
  owned.push(() => material.dispose());

  const indices: number[] = [];
  for (let segment = 0; segment < SEGMENTS; segment++) {
    const lower = segment * 2;
    indices.push(lower, lower + 1, lower + 2, lower + 1, lower + 3, lower + 2);
  }
  const pool: Live[] = [];
  for (let index = 0; index < MAX_LIVE; index++) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(new Float32Array((SEGMENTS + 1) * 2 * 3), 3));
    geometry.setAttribute('ribbonUv', new T.BufferAttribute(new Float32Array((SEGMENTS + 1) * 2 * 2), 2));
    geometry.setAttribute('tracerTint', new T.BufferAttribute(new Float32Array((SEGMENTS + 1) * 2 * 4), 4));
    geometry.setIndex(indices);
    const mesh = new T.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.name = `SourceTracer12426148-${index}`;
    group.add(mesh);
    pool.push({ mesh, geometry, system: null as unknown as SourceTracerSystem, name: '', key: '',
      origin: new T.Vector3(), direction: new T.Vector3(), totalMetres: 0,
      speedMetresPerSecond: 0, halfWidthMetres: 0, maxTrailMetres: 0, alpha: 1,
      color: new T.Color(), tailScale: [1, 1, 1, 1], age: 0, flightSeconds: 0,
      measuredCentre: 0, measuredWidth: 0 });
    owned.push(() => geometry.dispose());
  }

  const free = [...pool];
  const live: Live[] = [];
  const refused: Record<string, number> = {};
  let spawned = 0;
  let finished = 0;
  let disposed = false;
  let lastShot: SourceTracerOutcome | null = null;

  const refuse = (reason: SourceTracerOutcome['reason'], system: string | null): SourceTracerOutcome => {
    refused[reason] = (refused[reason] ?? 0) + 1;
    return { drawn: false, reason, system, material: null, shot: null, from: null, to: null, lengthMetres: null,
      sideOffsetMetres: null, halfWidthMetres: null, alpha: null, color: null,
      speedMetresPerSecond: null, flightSeconds: null, trailLengthMetres: null,
      fadeAtHead: null, fadeAtTail: null, drawnLengthMetres: null, drawnHalfWidthMetres: null,
      drawnDiagonalMetres: null };
  };

  function spawn(shot: { weapon: WeaponId; from: readonly [number, number, number];
    to: readonly [number, number, number]; by: string; seq: number }): SourceTracerOutcome {
    if (disposed) throw Error('Original tracers are disposed');
    const name = mode.weapons?.[shot.weapon];
    const system = name ? mode.systems[name] : undefined;
    if (!name || !system) return refuse('no-system', null);
    // A shot reaches a client twice — once as its own prediction and once as the authority's
    // answer — and it is one shot, so it draws one streak.
    const key = `${shot.by}:${shot.seq}`;
    if (live.some(entry => entry.key === key)) return refuse('already-drawn', name);
    const from = new T.Vector3(shot.from[0], shot.from[1], shot.from[2]);
    const to = new T.Vector3(shot.to[0], shot.to[1], shot.to[2]);
    if (![from.x, from.y, from.z, to.x, to.y, to.z].every(Number.isFinite))
      return refuse('unusable-line', name);
    const span = new T.Vector3().subVectors(to, from);
    const spanMetres = span.length();
    if (!(spanMetres > 1e-4)) return refuse('unusable-line', name);
    const direction = span.clone().divideScalar(spanMetres);
    const sideOffsetMetres = system.offsetUnits[0] * mode.sourceUnitsToMetres + system.startOffsetUnits;
    const totalMetres = spanMetres - sideOffsetMetres;
    if (!(totalMetres > 1e-4)) return refuse('unusable-line', name);
    const entry = free.shift();
    if (!entry) return refuse('pool-full', name);
    const draws = sourceTracerDraws(shot.by, shot.seq);
    const withExponent = (range: number[], unitValue: number, exponent: number) =>
      range[0] + (range[1] - range[0]) * Math.pow(unitValue, exponent);
    const speedUnits = withExponent(system.speedUnitsPerSecond, draws.speed, 1);
    const speedMetresPerSecond = speedUnits * mode.sourceUnitsToMetres;
    const halfWidthMetres = withExponent(system.radiusUnits, draws.radius, system.radiusExponent)
      * mode.sourceUnitsToMetres;
    const alpha = withExponent(system.alphaRange, draws.alpha, system.alphaExponent) / 255;
    const color = new T.Color(
      system.color1[0] / 255 + (system.color2[0] - system.color1[0]) / 255 * draws.color,
      system.color1[1] / 255 + (system.color2[1] - system.color1[1]) / 255 * draws.color,
      system.color1[2] / 255 + (system.color2[2] - system.color1[2]) / 255 * draws.color);
    const trailSeconds = withExponent(system.trailLengthSeconds, draws.trail, system.trailLengthExponent);
    const maxTrailMetres = Math.min(
      Math.max(trailSeconds * speedMetresPerSecond, system.renderLengthUnits[0] * mode.sourceUnitsToMetres),
      system.renderLengthUnits[1] * mode.sourceUnitsToMetres);

    entry.system = system;
    entry.name = name;
    entry.key = key;
    entry.origin = from.clone().addScaledVector(direction, sideOffsetMetres);
    entry.direction = direction;
    entry.totalMetres = totalMetres;
    entry.speedMetresPerSecond = speedMetresPerSecond;
    entry.halfWidthMetres = halfWidthMetres;
    entry.maxTrailMetres = maxTrailMetres;
    entry.alpha = alpha;
    entry.color = color;
    entry.tailScale = system.tailColorAlphaScale.slice();
    entry.age = 0;
    entry.flightSeconds = totalMetres / speedMetresPerSecond;
    entry.mesh.visible = false;
    live.push(entry);
    spawned++;
    lastShot = { drawn: true, reason: 'drawn', system: name, material: mode.material.path, shot: key,
      from: [entry.origin.x, entry.origin.y, entry.origin.z], to: [to.x, to.y, to.z],
      lengthMetres: totalMetres, sideOffsetMetres, halfWidthMetres, alpha,
      color: [color.r, color.g, color.b], speedMetresPerSecond, flightSeconds: entry.flightSeconds,
      trailLengthMetres: maxTrailMetres, fadeAtHead: sourceTracerFade(system.fade, 0),
      fadeAtTail: sourceTracerFade(system.fade, 0), drawnLengthMetres: null, drawnHalfWidthMetres: null,
      drawnDiagonalMetres: null };
    return lastShot;
  }

  // The draws belong to the shot, not to this module: `sourceTracerDraws` derives them from the
  // shooter and the shot's sequence, so every client that received the same shot draws the same
  // streak.
  const position = new T.Vector3();
  const side = new T.Vector3();
  const toCamera = new T.Vector3();
  const cross = new T.Vector3();
  const vertex = new T.Vector3();

  function writeRibbon(entry: Live, cameraPosition: T.Vector3, drawn: boolean) {
    const geometry = entry.geometry;
    const positions = geometry.getAttribute('position') as T.BufferAttribute;
    const uvs = geometry.getAttribute('ribbonUv') as T.BufferAttribute;
    const tints = geometry.getAttribute('tracerTint') as T.BufferAttribute;
    const sweptMetres = Math.min(entry.speedMetresPerSecond * entry.age, entry.totalMetres);
    const ramp = entry.system.lengthFadeInSeconds > 0
      ? Math.min(1, entry.age / entry.system.lengthFadeInSeconds) : 1;
    let trailMetres = Math.min(entry.maxTrailMetres * ramp, sweptMetres);
    let halfWidth = entry.halfWidthMetres;
    // `constrain radius to length` keeps a short trail from being wider than it is long.
    if (entry.system.constrainRadiusToLength) halfWidth = Math.min(halfWidth, trailMetres / 2);
    const head = entry.origin.clone().addScaledVector(entry.direction, sweptMetres);
    const tail = head.clone().addScaledVector(entry.direction, -trailMetres);
    const t = entry.flightSeconds > 0 ? entry.age / entry.flightSeconds : 1;
    const headFade = sourceTracerFade(entry.system.fade, t);
    for (let index = 0; index <= SEGMENTS; index++) {
      const along = index / SEGMENTS;
      position.copy(head).lerp(tail, along);
      // Each cross-section faces the camera, which is what makes the strip a ribbon seen from
      // anywhere rather than a flat plank.
      toCamera.subVectors(cameraPosition, position);
      if (toCamera.lengthSq() > 0) toCamera.normalize(); else toCamera.set(0, 1, 0);
      cross.crossVectors(entry.direction, toCamera);
      if (cross.lengthSq() > 1e-12) side.copy(cross).normalize(); else side.set(0, 1, 0);
      // `tail color and alpha scale factor` is the scale the tail end gets; the original
      // states (1,1,1,1) for these systems, so the streak is uniform along its length.
      const tailMix = along;
      const scale = entry.tailScale;
      const tint = [entry.color.r * (1 + (scale[0] - 1) * tailMix),
        entry.color.g * (1 + (scale[1] - 1) * tailMix),
        entry.color.b * (1 + (scale[2] - 1) * tailMix),
        entry.alpha * headFade * (1 + (scale[3] - 1) * tailMix)];
      for (const which of [0, 1]) {
        vertex.copy(position).addScaledVector(side, which === 0 ? -halfWidth : halfWidth);
        const at = (index * 2 + which) * 3;
        positions.array[at] = vertex.x;
        positions.array[at + 1] = vertex.y;
        positions.array[at + 2] = vertex.z;
        const uvAt = (index * 2 + which) * 2;
        uvs.array[uvAt] = which;
        // The texture's own direction along the trail is not stated by the PCF; the port runs
        // v from the tail to the head, which is declared in the table's limitations.
        uvs.array[uvAt + 1] = along;
        const tintAt = (index * 2 + which) * 4;
        for (let channel = 0; channel < 4; channel++) tints.array[tintAt + channel] = tint[channel];
      }
    }
    positions.needsUpdate = true;
    uvs.needsUpdate = true;
    tints.needsUpdate = true;
    geometry.computeBoundingSphere();
    entry.mesh.visible = drawn;
    if (!drawn) return { head, tail, trailMetres, halfWidth, headFade, longest: 0, measuredWidth: 0,
      measuredCentre: 0 };
    // What the ribbon actually spans, read back from its own vertices rather than assumed: the
    // distance between the first and last cross-section's midpoints, the width of the first
    // cross-section, and the ribbon's own longest diagonal (which the per-section billboarding
    // makes slightly longer than the line it runs along).
    const spans = positions.array as Float32Array;
    const mid = (index: number) => [
      (spans[index * 6] + spans[index * 6 + 3]) / 2,
      (spans[index * 6 + 1] + spans[index * 6 + 4]) / 2,
      (spans[index * 6 + 2] + spans[index * 6 + 5]) / 2];
    const first = mid(0), last_ = mid(SEGMENTS);
    let longest = 0;
    for (let index = 0; index < (SEGMENTS + 1) * 2; index++) {
      for (let other = index + 1; other < (SEGMENTS + 1) * 2; other++) {
        const distance = Math.hypot(spans[index * 3] - spans[other * 3],
          spans[index * 3 + 1] - spans[other * 3 + 1], spans[index * 3 + 2] - spans[other * 3 + 2]);
        if (distance > longest) longest = distance;
      }
    }
    return { head, tail, trailMetres, halfWidth, headFade, longest,
      measuredWidth: Math.hypot(spans[0] - spans[3], spans[1] - spans[4], spans[2] - spans[5]),
      measuredCentre: Math.hypot(first[0] - last_[0], first[1] - last_[1], first[2] - last_[2]) };
  }

  function update(deltaSeconds: number, camera: T.Camera) {
    if (disposed || !live.length || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const cameraPosition = new T.Vector3().setFromMatrixPosition(camera.matrixWorld);
    for (let index = live.length - 1; index >= 0; index--) {
      const entry = live[index];
      entry.age += deltaSeconds;
      const reach = entry.system.maximumDrawDistanceUnits * mode.sourceUnitsToMetres;
      const headPosition = entry.origin.clone()
        .addScaledVector(entry.direction, Math.min(entry.speedMetresPerSecond * entry.age, entry.totalMetres));
      const drawn = headPosition.distanceTo(cameraPosition) <= reach;
      const written = writeRibbon(entry, cameraPosition, drawn);
      entry.measuredCentre = drawn ? written.measuredCentre : 0;
      entry.measuredWidth = drawn ? written.measuredWidth : 0;
      // Only the shot this streak belongs to is written back: two streaks of the same system can
      // be in the air at once, and each one's own measured ribbon is its own.
      if (drawn && lastShot && lastShot.shot === entry.key) {
        lastShot.drawnLengthMetres = written.measuredCentre;
        lastShot.drawnHalfWidthMetres = written.measuredWidth / 2;
        lastShot.drawnDiagonalMetres = written.longest;
        lastShot.fadeAtHead = written.headFade;
        lastShot.fadeAtTail = written.headFade;
      }
      if (entry.age >= entry.flightSeconds) {
        entry.mesh.visible = false;
        live.splice(index, 1);
        free.push(entry);
        finished++;
      }
    }
  }

  return {
    group, table: mode, spawn, update,
    audit: () => ({
      source: 'source-tracers-runtime-v1', tableBuild: mode.build,
      unitScale: { sourceUnitsToMetres: mode.sourceUnitsToMetres },
      material: { path: mode.material.path, shader: mode.material.shader, additive: mode.material.additive,
        url: textureReceipt.path, bytes: textureReceipt.bytes, sha256: textureReceipt.sha256,
        verified: true, width: mode.material.texture.width, height: mode.material.texture.height,
        pathSource: mode.material.texture.source },
      systems: mode.systems, weapons: mode.weapons,
      spawned, refused: { ...refused }, live: live.length, finished,
      liveTracers: live.map(entry => {
        const swept = Math.min(entry.speedMetresPerSecond * entry.age, entry.totalMetres);
        const head = entry.origin.clone().addScaledVector(entry.direction, swept);
        const ramp = entry.system.lengthFadeInSeconds > 0
          ? Math.min(1, entry.age / entry.system.lengthFadeInSeconds) : 1;
        const trail = Math.min(entry.maxTrailMetres * ramp, swept);
        const t = entry.flightSeconds > 0 ? entry.age / entry.flightSeconds : 1;
        return { system: entry.name, shot: entry.key, age: +entry.age.toFixed(4), headMetres: +swept.toFixed(4),
          trailMetres: +trail.toFixed(4), halfWidthMetres: entry.halfWidthMetres,
          alpha: +(entry.alpha * sourceTracerFade(entry.system.fade, t)).toFixed(5),
          drawn: entry.mesh.visible,
          drawnLengthMetres: entry.measuredCentre, drawnWidthMetres: entry.measuredWidth,
          head: [head.x, head.y, head.z] as [number, number, number],
          tail: [head.x - entry.direction.x * trail, head.y - entry.direction.y * trail,
            head.z - entry.direction.z * trail] as [number, number, number] };
      }),
      lastShot,
      fadeTimeBasis: mode.fadeTimeBasis,
      limitations: mode.limitations,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      live.length = 0;
      for (const dispose of owned) dispose();
      owned.length = 0;
      group.removeFromParent();
    },
  };
}
