import * as T from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {createSourceCharacterMaterial,createSourceWorldAKMaterial,type SourceCharacterPart} from './source-character-materials';
import {createSourceCTCharacterMaterial} from './source-ct-character-materials';
import {createSourceWorldM4A4Material} from './source-world-m4a4-material';

export type SourceCharacterProfile='tm_leet_varianta'|'ctm_idf';
const tParts=[
  {part:'upperbody',name:'tm_leet_upperbody_variantA',stem:'tm_leet_upperbody_varianta'},
  {part:'lowerbody',name:'tm_leet_lowerbody_variantA',stem:'tm_leet_lowerbody_varianta'},
  {part:'head',name:'tm_elite_head_variantA',stem:'tm_elite_head_varianta'},
] as const;
const ctParts=[
  {part:'upperbody',name:'ctm_IDF_UpperBody',stem:'ctm_idf_upperbody'},
  {part:'lowerbody',name:'ctm_IDF_LowerBody',stem:'ctm_idf_lowerbody'},
  {part:'head',name:'ctm_IDF_Head_variantA',stem:'ctm_idf_head_varianta'},
] as const;
const installed=new WeakSet<T.Object3D>();
type Handle=ReturnType<typeof createSourceCharacterMaterial>;

/** Shared original material installation. base is the character-ak
 * directory URL; no GLB reload, bone edit, lights or color adjustments occur.
 * The returned audit owns its 11 raw texture handles and four material handles.
 * Call audit.dispose() on preview unload to restore original GLTF materials.
 */
export async function applySourceCharacterSurfaces(gltf:GLTF,directoryBase:string,profile:SourceCharacterProfile='tm_leet_varianta',weaponId:'ak47'|'m4a4'='ak47'){
  if(profile!=='tm_leet_varianta'&&profile!=='ctm_idf')throw new Error('Unknown original Source character surface profile');
  if(weaponId!=='ak47'&&weaponId!=='m4a4')throw new Error('Unknown original Source world weapon');
  const weaponStem=weaponId==='m4a4'?'rif_m4a1':'ak47';
  const parts=profile==='ctm_idf'?ctParts:tParts,names=[...parts.map(p=>p.name),weaponStem];
  if(installed.has(gltf.scene))throw new Error('Source character preview is already installed or loading');
  if(!directoryBase.trim())throw new Error('Source character preview requires its original texture directory');
  const bindings:Array<{mesh:T.Mesh;original:T.Material|T.Material[];source:T.Material[];assigned?:T.Material|T.Material[]}>=[];
  const matched=new Map<string,number>();
  gltf.scene.traverse(object=>{
    if(!(object as T.Mesh).isMesh)return;
    const mesh=object as T.Mesh,source=Array.isArray(mesh.material)?[...mesh.material]:[mesh.material];
    for(const material of source){
      if(!material||!names.includes(material.name))throw new Error('Source preview requires exact original material names; unexpected '+(material?.name??'<null>'));
      matched.set(material.name,(matched.get(material.name)??0)+1);
    }
    bindings.push({mesh,original:mesh.material,source});
  });
  const missing=names.filter(name=>!matched.has(name));
  if(missing.length)throw new Error('Source preview missing exact original materials: '+missing.join(', '));
  installed.add(gltf.scene);
  const files=[...parts.flatMap(p=>[p.stem+'.png',p.stem+'_normal.png',p.stem+'_exponent.png']),weaponStem+'.png',weaponStem+'_exponent.png'];
  const base=directoryBase.replace(/\/+$/,'')+'/',loader=new T.TextureLoader(),owned:T.Texture[]=[],handles=new Map<string,Handle>();
  const materials:Array<{originalName:string;replacementName:string;slots:number;sourceVMT:string;parameters:unknown}>=[];
  let disposed=false;
  const dispose=()=>{
    if(disposed)return;disposed=true;
    for(const binding of bindings)if(binding.assigned&&binding.mesh.material===binding.assigned)binding.mesh.material=binding.original;
    for(const handle of handles.values())handle.dispose();for(const texture of owned)texture.dispose();
    installed.delete(gltf.scene);
  };
  try{
    // Wait for every request even after a failure, so late successful texture
    // objects also enter the cleanup set. Never leave a half-replaced character.
    const loaded=await Promise.allSettled(files.map(file=>loader.loadAsync(base+'textures/'+file)));
    for(const result of loaded)if(result.status==='fulfilled')owned.push(result.value);
    const failures=loaded.flatMap((r,i)=>r.status==='rejected'?[files[i]]:[]);
    if(failures.length)throw new Error('Source preview could not load original texture files: '+failures.join(', '));
    const textures=new Map(files.map((file,i)=>[file,(loaded[i] as PromiseFulfilledResult<T.Texture>).value]));
    for(const p of parts){
      const stem=p.stem;handles.set(p.name,(profile==='ctm_idf'?createSourceCTCharacterMaterial:createSourceCharacterMaterial)(p.part as SourceCharacterPart,
        {base:textures.get(stem+'.png')!,normal:textures.get(stem+'_normal.png')!,exponent:textures.get(stem+'_exponent.png')!}));
    }
    handles.set(weaponStem,(weaponId==='m4a4'?createSourceWorldM4A4Material:createSourceWorldAKMaterial)({base:textures.get(weaponStem+'.png')!,exponent:textures.get(weaponStem+'_exponent.png')!}));
    for(const binding of bindings)if(binding.mesh.material!==binding.original)throw new Error('Source preview scene materials changed while loading');
    for(const binding of bindings){
      const replacements=binding.source.map(material=>handles.get(material.name)!.material);
      binding.assigned=Array.isArray(binding.original)?replacements:replacements[0];binding.mesh.material=binding.assigned;
    }
    for(const name of names){
      const material=handles.get(name)!.material;
      materials.push({originalName:name,replacementName:material.name,slots:matched.get(name)!,sourceVMT:material.userData.sourceVMT,parameters:material.userData.sourceParameters});
    }
    return {status:'source_phong_candidate_applied_gpu_review_pending',characterProfile:profile,weaponId,textureCount:owned.length,materialCount:handles.size,
      meshCount:bindings.length,materials,textureURLs:files.map(file=>base+'textures/'+file),
      colorCompensation:false,bonesModified:false,sourceUnitsPreserved:true,
      limitations:['Original Source ambient cube, ambient rim, cubemap and tone mapping remain incomplete',
        'Original hand IK is not applied; measured left grip gaps remain',
        'Material shader compilation and actual appearance require GPU review'],dispose};
  }catch(error){dispose();throw error;}
}
