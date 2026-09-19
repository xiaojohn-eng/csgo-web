import * as T from 'three';
import type{GLTF}from'three/addons/loaders/GLTFLoader.js';
import {createSourceAWPMaterial,createSourceAWPScopeMaterial}from'./source-awp-materials';
import {createSourceCharacterMaterial}from'./source-character-materials';
import {createSourceCTCharacterMaterial}from'./source-ct-character-materials';
const parts={t:[['upperbody','tm_leet_upperbody_variantA','tm_leet_upperbody_varianta'],['lowerbody','tm_leet_lowerbody_variantA','tm_leet_lowerbody_varianta'],['head','tm_elite_head_variantA','tm_elite_head_varianta']],ct:[['upperbody','ctm_IDF_UpperBody','ctm_idf_upperbody'],['lowerbody','ctm_IDF_LowerBody','ctm_idf_lowerbody'],['head','ctm_IDF_Head_variantA','ctm_idf_head_varianta']]}as const;
/** Receives already SHA-verified texture bytes from the owning loader. */
export function applySourceAWPCharacterSurfaces(gltf:GLTF,team:'t'|'ct',weapon:'awp',textures:ReadonlyMap<string,T.Texture>){
 const handles=new Map<string,{material:T.Material;dispose:()=>void}>(),bindings:{mesh:T.Mesh;original:T.Material|T.Material[];assigned:T.Material|T.Material[]}[]=[],seen=new Set<string>();let disposed=false;
 const get=(name:string)=>{const t=textures.get('textures/'+name+'.png');if(!t)throw Error('Original AWP character texture missing: '+name);return t;};
 function dispose(){if(disposed)return;disposed=true;for(const b of bindings)if(b.mesh.material===b.assigned)b.mesh.material=b.original;handles.forEach(h=>h.dispose());}
 try{for(const[part,name,stem]of parts[team])handles.set(name,(team==='t'?createSourceCharacterMaterial:createSourceCTCharacterMaterial)(part,{base:get(stem),normal:get(stem+'_normal'),exponent:get(stem+'_exponent')}));const stem='awp';handles.set(stem,createSourceAWPMaterial(weapon,get(stem),get(stem+'_exponent'),true));handles.set('scope_awp',createSourceAWPScopeMaterial(get('scope'),get('scope_normal')));
 gltf.scene.traverse(o=>{if(!(o instanceof T.Mesh))return;const replacement=(m:T.Material)=>{const h=handles.get(m.name);if(!h)throw Error('Unexpected original AWP character material: '+m.name);seen.add(m.name);return h.material;};const original=o.material,assigned=Array.isArray(original)?original.map(replacement):replacement(original);bindings.push({mesh:o,original,assigned});});if(seen.size!==5)throw Error('Original AWP character material set incomplete');for(const b of bindings)b.mesh.material=b.assigned;
 return{materials:[...handles.values()].map(h=>({name:h.material.name,vmt:h.material.userData.sourceVMT,parameters:h.material.userData.sourceParameters})),limitations:['Source ambient cube, ambient rim, environment cubemap and client light/tone mapping remain incomplete','AWP original phongalbedoboost 40 remains unimplemented','Actual shader compilation and visual comparison require GPU acceptance'],dispose};
 }catch(error){dispose();throw error;}
}
