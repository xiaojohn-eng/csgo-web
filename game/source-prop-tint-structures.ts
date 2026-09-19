import {loadSourcePropTint, type SourcePropTintAssets} from './source-prop-tint-loader';
import {sourceSha256} from './source-sha256';

const prefix = 'models/props/de_dust/hr_dust/';
/** These four original VMTs have precisely the already verified bumped tint
 * branch. Their original VHV remaps contain no ambiguous primitive. */
export const SOURCE_STRUCTURAL_TINT_MATERIALS = [
  prefix + 'dust_doorframes/dust_doorframes_01',
  prefix + 'dust_doorframes/dust_doorframes_02',
  prefix + 'dust_doorframes/dust_doorframes_03',
  prefix + 'dust_wires/dust_wire_attachments_01',
] as const;
const rgbaSha256 = '5323c2eacc6979ae682b9a821cce569f14c1f827b720bbbfbc28b06e33a001df';

/** Adds the bounded doorframe/wire-attachment texture registry to borrowed R4
 * assets. The owner never disposes or mutates borrowed materials, textures, or
 * instance bytes. Pass this registry to prepareSourcePropLightingData, using
 * the existing sourcePropTintCandidate/geometry/SHA gates without widening any
 * shader whitelist. Default integration remains the caller's explicit choice. */
export async function loadSourcePropStructuralTint(options: {
  baseURL:string; borrowedTint:SourcePropTintAssets; signal?:AbortSignal;
  maxTextureSize?:number;
}) {
  const borrowed = options.borrowedTint;
  if(await sourceSha256(borrowed.rgba,options.signal)!==rgbaSha256)
    throw Error('Borrowed structural tint instance identity differs');
  const owner = await loadSourcePropTint({...options,maxTextureBytes:5*1024*1024});
  try {
    if(owner.materials.size!==SOURCE_STRUCTURAL_TINT_MATERIALS.length || owner.audit.textures!==4 ||
      await sourceSha256(owner.rgba,options.signal)!==rgbaSha256)
      throw Error('Original structural tint scope differs');
    const materials = new Map(borrowed.materials);
    for(const source of SOURCE_STRUCTURAL_TINT_MATERIALS) {
      const item = owner.materials.get(source);
      if(!item || item.source!=='materials/'+source+'_tint.vtf' || materials.has(source))
        throw Error('Original structural tint material identity differs');
      materials.set(source,item);
    }
    options.signal?.throwIfAborted();
    return {
      materials,rgba:borrowed.rgba,
      audit:{...owner.audit,branch:'four original doorframe and wire-attachment bumped tint materials',
        additionalMaterialCount:4,borrowedMaterialCount:borrowed.materials.size,
        candidateMeshes:181,candidateTriangles:204543},
      dispose:owner.dispose,
    };
  } catch(error) {owner.dispose();throw error;}
}
