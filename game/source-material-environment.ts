import * as T from 'three';

export type SourceEnvmapParameters = {
  tint: [number, number, number];
  fresnel: boolean;
  mask: 'baseAlpha' | 'normalAlpha' | 'phongMask';
  invertMask?: boolean;
};
export type SourceEnvironmentSample = {
  cube: T.CubeTexture;
  /** View-space direction -> the original Source cubemap axes. */
  viewToSource: T.Matrix3;
  probeId: string;
  /** Original shader cLightScale.z; decoded linear probe data uses 1. */
  scale: number;
};
type Uniforms = Record<string, T.IUniform>;
const states = new WeakMap<T.Material, {uniforms: Uniforms}>();

/** Uniform state belongs to one draw material; original probe textures remain
 * borrowed. The scene selects actual map probes, never an invented room map. */
export function createSourceMaterialEnvironment(material: T.Material, parameters: SourceEnvmapParameters) {
  if (parameters.tint.some(value => !Number.isFinite(value) || value < 0)) throw Error('Invalid Source envmap tint');
  const uniforms: Uniforms = {
    sourceEnvMap: {value: null}, sourceEnvEnabled: {value: 0},
    sourceEnvTint: {value: new T.Vector3(...parameters.tint)},
    sourceEnvFresnel: {value: parameters.fresnel ? 1 : 0},
    sourceEnvInvertMask: {value: parameters.invertMask ? 1 : 0},
    sourceEnvScale: {value: 1}, sourceViewToCube: {value: new T.Matrix3()},
  };
  states.set(material, {uniforms});
  material.userData.sourceEnvironment = {status: 'waiting_for_original_map_probe', parameters: {...parameters}};
  return uniforms;
}

/** Call before drawing a root in its camera context. This does not own the cube
 * or silently substitute scene.environment. Returns false for unrelated materials. */
export function setSourceMaterialEnvironment(material: T.Material, sample: SourceEnvironmentSample | null) {
  const state = states.get(material);
  if (!state) return false;
  if (sample && (!Number.isFinite(sample.scale) || sample.scale < 0 || !sample.probeId
    || sample.viewToSource.elements.some(value => !Number.isFinite(value)))) throw Error('Invalid Source map probe sample');
  state.uniforms.sourceEnvEnabled.value = sample ? 1 : 0;
  state.uniforms.sourceEnvMap.value = sample?.cube ?? null;
  state.uniforms.sourceEnvScale.value = sample?.scale ?? 1;
  if (sample) state.uniforms.sourceViewToCube.value.copy(sample.viewToSource);
  material.userData.sourceEnvironment = {...material.userData.sourceEnvironment,
    status: sample ? 'original_map_probe_bound' : 'waiting_for_original_map_probe', probeId: sample?.probeId ?? null};
  return true;
}

export const SOURCE_ENVIRONMENT_UNIFORMS = `
uniform samplerCube sourceEnvMap;
uniform float sourceEnvEnabled;
uniform vec3 sourceEnvTint;
uniform float sourceEnvFresnel;
uniform float sourceEnvInvertMask;
uniform float sourceEnvScale;
uniform mat3 sourceViewToCube;
`;

/** Installed phong_ps30 diagnostic token slice 732..859. The original envmap
 * mask, Fresnel and albedo-tint formulas are distinct from the direct-light lobe.
 * Native sampler/filter and final runtime selector remain separate evidence. */
export function sourceEnvironmentFragment(parameters: SourceEnvmapParameters, albedoTint: boolean) {
  const mask = parameters.mask === 'baseAlpha' ? 'texture2D(map,vMapUv).a'
    : parameters.mask === 'normalAlpha' ? 'texture2D(normalMap,vNormalMapUv).a' : 'sourceMask';
  return `
if (sourceEnvEnabled > 0.5) {
  vec3 sourceCubeDirection=sourceViewToCube*reflect(-normalize(vViewPosition),normal);
  float sourceCubeMask=${mask};
  sourceCubeMask=mix(sourceCubeMask,1.0-sourceCubeMask,sourceEnvInvertMask);
  vec3 sourceCubeColor=textureCube(sourceEnvMap,sourceCubeDirection).rgb*sourceEnvScale*sourceEnvTint;
  sourceCubeColor*=mix(1.0,sourceFresnel,sourceEnvFresnel)*sourceCubeMask;
  ${albedoTint ? 'sourceCubeColor*=mix(vec3(1.0),diffuseColor.rgb*sourceAlbedoBoost,sourceParameters.g)*sourceParameters.r;' : ''}
  reflectedLight.indirectSpecular+=sourceCubeColor;
}
`;
}
