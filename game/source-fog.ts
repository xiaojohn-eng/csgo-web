/**
 * The original's fog, on three's fog uniforms.
 *
 * Source fades the frame linearly toward `fogcolor`: nothing at `fogstart`, then
 * `fogmaxdensity` reached at `fogend`, and that cap held beyond. three's linear fog instead
 * runs `smoothstep( fogNear, fogFar, depth )` all the way to 1, so the two agree at neither
 * the start nor the cap: Dust2's `fogstart 512`/`fogend 9000`/`fogmaxdensity .4` would be
 * drawn as a curve that is roughly half as strong as the original inside the range and twice
 * as strong past it. The ramp is therefore replaced with the original's own.
 *
 * `fogColor`, `fogNear` and `fogFar` are written by the renderer every frame from
 * `scene.fog`, so start/end/colour need nothing new. The cap does: three has no uniform for
 * it. It is carried by `fogMaxDensity`, added to every shader library that has fog. three
 * clones each material's uniform set out of `ShaderLib` when it builds a program
 * (`UniformsUtils.clone`), which would give every material its own copy of the value; the
 * uniform's value is a `Vector2` whose `clone()` returns itself, so every material ends up
 * sharing the one object and a scene-wide cap is a single write. That property, and the two
 * shader chunks this module replaces, are asserted rather than assumed.
 */
import * as T from 'three';

/** The scene-wide fog cap. Shared by every fogged material; see the module comment. */
export const SOURCE_FOG_MAX_DENSITY = new T.Vector2(0, 0);
(SOURCE_FOG_MAX_DENSITY as unknown as {clone(): T.Vector2}).clone = () => SOURCE_FOG_MAX_DENSITY;

/** three's own chunks, collapsed to one space. The override refuses to install over a change. */
const THREE_FOG_PARS_FRAGMENT =
  '#ifdef USE_FOG uniform vec3 fogColor; varying float vFogDepth; #ifdef FOG_EXP2 uniform float fogDensity; #else uniform float fogNear; uniform float fogFar; #endif #endif';
const THREE_FOG_FRAGMENT =
  '#ifdef USE_FOG #ifdef FOG_EXP2 float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth ); #else float fogFactor = smoothstep( fogNear, fogFar, vFogDepth ); #endif gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor ); #endif';

export const SOURCE_FOG_PARS_FRAGMENT = `#ifdef USE_FOG
	uniform vec3 fogColor;
	uniform vec2 fogMaxDensity;
	varying float vFogDepth;

	#ifdef FOG_EXP2

		uniform float fogDensity;

	#else

		uniform float fogNear;
		uniform float fogFar;

	#endif

#endif
`;

/** The original's ramp. The exponential branch stays three's: this port has no map that uses it. */
export const SOURCE_FOG_FRAGMENT = `#ifdef USE_FOG

	#ifdef FOG_EXP2

		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );

	#else

		// Source's fog: nothing at fogNear, then a straight ramp to the cap at fogFar, held
		// beyond. fogMaxDensity.x is the map's own $fogmaxdensity.
		float fogFactor = min( fogMaxDensity.x,
			clamp( ( vFogDepth - fogNear ) / max( fogFar - fogNear, 1e-6 ), 0.0, 1.0 ) );

	#endif

	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );

#endif
`;

const collapse = (glsl: string) => glsl.replace(/\s+/g, ' ').trim();

let installed = false;

/** Replace three's fog ramp with the original's and register the shared cap. Idempotent. */
export function installSourceFog(): void {
  if (installed) return;
  if (collapse(T.ShaderChunk.fog_pars_fragment) !== THREE_FOG_PARS_FRAGMENT) {
    throw new Error('three changed fog_pars_fragment; re-read it before overriding the original fog');
  }
  if (collapse(T.ShaderChunk.fog_fragment) !== THREE_FOG_FRAGMENT) {
    throw new Error('three changed fog_fragment; re-read it before overriding the original fog');
  }
  let registered = 0;
  for (const library of Object.values(T.ShaderLib)) {
    const uniforms = (library as {uniforms?: Record<string, unknown>}).uniforms;
    if (!uniforms?.fogColor) continue;
    uniforms.fogMaxDensity = {value: SOURCE_FOG_MAX_DENSITY};
    registered++;
  }
  if (registered !== 11) throw new Error(`expected 11 fog-capable three shader libraries, found ${registered}`);
  T.ShaderChunk.fog_pars_fragment = SOURCE_FOG_PARS_FRAGMENT;
  T.ShaderChunk.fog_fragment = SOURCE_FOG_FRAGMENT;
  installed = true;
}

export function sourceFogMaxDensity(): number {
  return SOURCE_FOG_MAX_DENSITY.x;
}

export function setSourceFogMaxDensity(density: number): void {
  if (!Number.isFinite(density) || density < 0 || density > 1) {
    throw new Error(`Original Source fog density must be a fraction, read ${density}`);
  }
  SOURCE_FOG_MAX_DENSITY.x = density;
}

export type SourceFogState = {
  /** The colour the frame fades toward, as a CSS colour string. */
  readonly color: string;
  readonly nearMetres: number;
  readonly farMetres: number;
  /** The map's `$fogmaxdensity`: how far the ramp is allowed to go. */
  readonly maxDensity: number;
  /** Where this state came from, for the render audit. */
  readonly from: string;
};

/** Point a scene's fog at one Source state and write the shared cap. */
export function applySourceFog(scene: T.Scene, state: SourceFogState): T.Fog {
  if (!(state.nearMetres >= 0) || !(state.farMetres > state.nearMetres)) {
    throw new Error(`Original Source fog range must rise, read ${state.nearMetres}..${state.farMetres}`);
  }
  const fog = scene.fog instanceof T.Fog && !(scene.fog instanceof T.FogExp2)
    ? scene.fog
    : new T.Fog('#000000', state.nearMetres, state.farMetres);
  fog.color.set(state.color);
  fog.near = state.nearMetres;
  fog.far = state.farMetres;
  scene.fog = fog;
  setSourceFogMaxDensity(state.maxDensity);
  return fog;
}

installSourceFog();
