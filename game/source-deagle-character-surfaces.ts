import * as T from 'three';
import type{GLTF}from'three/addons/loaders/GLTFLoader.js';
import {createSourceDefaultWeaponMaterial}from'./source-materials';
import {createSourceCharacterMaterial}from'./source-character-materials';
import {createSourceCTCharacterMaterial}from'./source-ct-character-materials';
const parts={t:[['upperbody','tm_leet_upperbody_variantA','tm_leet_upperbody_varianta'],['lowerbody','tm_leet_lowerbody_variantA','tm_leet_lowerbody_varianta'],['head','tm_elite_head_variantA','tm_elite_head_varianta']],ct:[['upperbody','ctm_IDF_UpperBody','ctm_idf_upperbody'],['lowerbody','ctm_IDF_LowerBody','ctm_idf_lowerbody'],['head','ctm_IDF_Head_variantA','ctm_idf_head_varianta']]}as const;
/** Original world Deagle VMT has the same direct Phong parameters as its FP VMT. */
export function createSourceWorldDeagleMaterial(weapon:'deagle',textures:{base:T.Texture;exponent:T.Texture}){
 const base=textures.base.clone();base.colorSpace=T.SRGBColorSpace;base.flipY=false;base.needsUpdate=true;
 const h=createSourceDefaultWeaponMaterial(weapon,base,textures.exponent,true);
 h.material.userData.sourceVMT='materials/models/weapons/w_models/w_pist_deagle/pist_deagle.vmt';
 let disposed=false;return{material:h.material,dispose(){if(disposed)return;disposed=true;h.dispose();base.dispose();}};
}
/** Receives already SHA-verified texture bytes from the owning loader. */
export function applySourceDeagleCharacterSurfaces(gltf:GLTF,team:'t'|'ct',weapon:'deagle',textures:ReadonlyMap<string,T.Texture>){
 const handles=new Map<string,{material:T.Material;dispose:()=>void}>(),bindings:{mesh:T.Mesh;original:T.Material|T.Material[];assigned:T.Material|T.Material[]}[]=[],seen=new Set<string>();let disposed=false;
 const get=(name:string)=>{const t=textures.get('textures/'+name+'.png');if(!t)throw Error('Original pistol character texture missing: '+name);return t;};
 function dispose(){if(disposed)return;disposed=true;for(const b of bindings)if(b.mesh.material===b.assigned)b.mesh.material=b.original;handles.forEach(h=>h.dispose());}
 try{for(const[part,name,stem]of parts[team])handles.set(name,(team==='t'?createSourceCharacterMaterial:createSourceCTCharacterMaterial)(part,{base:get(stem),normal:get(stem+'_normal'),exponent:get(stem+'_exponent')}));const stem='pist_deagle';handles.set(stem,createSourceWorldDeagleMaterial(weapon,{base:get(stem),exponent:get(stem+'_exponent')}));
 gltf.scene.traverse(o=>{if(!(o instanceof T.Mesh))return;const replacement=(m:T.Material)=>{const h=handles.get(m.name);if(!h)throw Error('Unexpected original pistol character material: '+m.name);seen.add(m.name);return h.material;};const original=o.material,assigned=Array.isArray(original)?original.map(replacement):replacement(original);bindings.push({mesh:o,original,assigned});});if(seen.size!==4)throw Error('Original pistol character material set incomplete');for(const b of bindings)b.mesh.material=b.assigned;
 return{materials:[...handles.values()].map(h=>({name:h.material.name,vmt:h.material.userData.sourceVMT,parameters:h.material.userData.sourceParameters})),limitations:['Original ambient/cubemap lighting requires active map-probe binding; original-client pixels remain unverified','Actual shader compilation and visual comparison require GPU acceptance'],dispose};
 }catch(error){dispose();throw error;}
}
