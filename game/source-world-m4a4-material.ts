import * as T from 'three';
import {createSourceWorldMaterial} from './source-character-materials';
import {createSourceDefaultWeaponMaterial} from './source-materials';
/** Default world M4 keeps its own VMT identity and texture views. */
export function createSourceWorldM4A4Material(textures:{base:T.Texture;exponent:T.Texture}){
 return createSourceWorldMaterial(textures,(base,exponent)=>createSourceDefaultWeaponMaterial('m4a4',base,exponent,true),
  'materials/models/weapons/w_models/w_rif_m4a1/rif_m4a1.vmt');
}
