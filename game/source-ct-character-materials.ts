import type * as T from 'three';
import { createSourceCharacterMaterial, type SourceCharacterPart } from './source-character-materials';
import type { SourceSurfaceTextures } from './source-materials';

const names: Record<SourceCharacterPart, string> = { upperbody: 'ctm_IDF_UpperBody', lowerbody: 'ctm_IDF_LowerBody', head: 'ctm_IDF_Head_variantA' };
/** Exact observed IDF VMT differences over the already-tested common Source
 * character Phong implementation. All three IDF parts use boost65, rim1/exponent2;
 * T remains boost25 and keeps its head rim disabled. Ambient rim uses the
 * original IDF boost1 when the map's original ambient cube is bound.
 */
export function createSourceCTCharacterMaterial(part: SourceCharacterPart, textures: SourceSurfaceTextures) {
  const handle = createSourceCharacterMaterial(part, textures), material = handle.material;
  const original = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer: T.WebGLRenderer) => {
    original(shader, renderer);
    shader.uniforms.sourceCharacterBoost.value = 65;
    shader.uniforms.sourceCharacterRimEnabled.value = 1;
    shader.uniforms.sourceCharacterRimExponent.value = 2;
    shader.uniforms.sourceCharacterRimBoost.value = 1;
  };
  material.name = 'Source_' + names[part];
  material.userData = { ...material.userData, sourceVMT: 'materials/models/player/ct_idf/' + names[part] + '.vmt',
    sourceParameters: { phongboost: 65, phongfresnelranges: [0, .1, 1], phongdisablehalflambert: 1,
      rimlight: 1, rimmask: 1, rimlightexponent: 2, rimlightboost: 1, phongalbedotint: 0 },
    exponentChannels: { r: '1 + 149 * R', g: 'unused: no phongalbedotint', a: 'rim mask for all original IDF parts' } };
  material.customProgramCacheKey = () => 'source-ct-idf-phong-v2';
  return handle;
}
