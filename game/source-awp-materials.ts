import * as T from 'three';
import {createSourcePhongMaterial,createSourceDefaultWeaponMaterial} from './source-materials';
type Handle={material:T.MeshPhongMaterial;dispose:()=>void};
/** Raw AWP weapon VMT: FP boost 2, world boost 1, shared Fresnel [.8,.8,1]. */
export function createSourceAWPMaterial(weapon:'awp',base:T.Texture,exponent:T.Texture,world=false):Handle{
 return createSourceDefaultWeaponMaterial(weapon,base,exponent,world);
}
/** Original scope_awp.vmt is a normal-mapped opaque material with constant
 * exponent 200 and tint [.8,1,.9]. This is the weapon surface, not zoom optics. */
export function createSourceAWPScopeMaterial(base:T.Texture,normal:T.Texture):Handle{
 const h=createSourcePhongMaterial(base,null,{name:'Source_AWP_Scope_VertexLitGeneric',normal,
  boost:1,fresnel:[.2,.2,1],tint:[.8,1,.9],exponentConstant:200,
  envmap:{tint:[.16,.2,.16],fresnel:true,mask:'baseAlpha'}});
 h.material.userData.sourceParameters={...h.material.userData.sourceParameters,exponent:200,
  envmapTint:[.16,.2,.16],baseAlphaEnvmapMask:true};
 h.material.userData.scopeOptics='Original surface only; scope HUD/FOV and render target are separate';
 return h;
}
