import * as T from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {createSourceViewmodel,disposeSourceViewmodel,isSourceViewmodel,assertSourceFireVariants,type SourceViewmodelArmsProfile,type SourceViewmodelWeaponContract} from './source-viewmodel';
import {sourceCTArmsProfile,type SourceCTArmTextures} from './source-ct-viewmodel-materials';
import {sourceSha256} from './source-sha256';
import {bindSourceCTArms} from './source-ct-viewmodel';
import {createSourceDefaultWeaponMaterial} from './source-materials';
import {SOURCE_WEAPON_FIRE_VARIANTS} from './source-weapon-fire-variants';

export const SOURCE_M4A4_VIEWMODEL_SHA256='d65e99f748cd53f13af8497bc556a5c995082153ef7be38e277b84d8ad6e4f9d';
type Manifest={sourceApp:740;build:12426148;weaponId:'m4a4';itemDefinition:16;sourceWeapon:string;armsProfile:'ct_arms_idf';sourceArms:string;weaponBoneCount:57;armsBoneCount:48;
  files:{path:string;bytes:number;sha256:string}[];clips:Record<string,{action_name:string;duration_seconds:number;fps:number;frame_count:number}>};


/** Original M4 VMT: boost 2, albedo tint/boost 25 and env_cubemap tint .15. */
export function createSourceM4A4Material(base:T.Texture,exponent:T.Texture){
 return createSourceDefaultWeaponMaterial('m4a4',base,exponent);
}
export const M4A4_VIEWMODEL_CONTRACT:SourceViewmodelWeaponContract={id:'m4a4',
 clips:{idle:'idle__idle',fire:'fire__shoot1',reload:'reload__reload',inspect:'inspect__lookat01',draw:'draw__draw'},
 fireVariants:SOURCE_WEAPON_FIRE_VARIANTS.m4a4,
 materialName:'rif_m4a1',createMaterial:createSourceM4A4Material,muzzleBone:'v_weapon.flash',ejectionBone:'v_weapon.shelleject'};

/** Tag source names before cloning; glTFLoader sanitizes bone names and suffixes
 * duplicates. Never infer correspondence from those display names. */
export function prepareSourceM4A4Viewmodel(gltf:GLTF){
  const doc=gltf.parser.json as {nodes:{name?:string}[];skins:{name?:string;joints:number[]}[]};
  if(doc.skins.length!==2)throw Error('M4A4 CT viewmodel requires two original skins');
  const nodes=new Map<number,T.Object3D>();
  for(const [obj,ref]of gltf.parser.associations)if(ref.nodes!==undefined)nodes.set(ref.nodes,obj as T.Object3D);
  const arms=doc.skins.find(s=>s.name==='ct_arms_idf_ARM'),weapon=doc.skins.find(s=>s.joints.some(i=>doc.nodes[i].name==='v_weapon.M4A1_Parent'));
  if(arms?.joints.length!==48||weapon?.joints.length!==57)throw Error('CT 48 / M4A4 57 source skin identity mismatch');
  for(const [role,skin]of [['arms',arms],['weapon',weapon]]as const)for(const joint of skin.joints){
    const bone=nodes.get(joint);if(!(bone instanceof T.Bone))throw Error('Original M4A4/CT joint is missing');
    bone.userData.sourceFPBoneName=doc.nodes[joint].name;bone.userData.sourceFPSkin=role;
  }
  return gltf;
}
export function createSourceM4A4Viewmodel(gltf:GLTF,base:T.Texture,exponent:T.Texture,textures:SourceCTArmTextures){
  prepareSourceM4A4Viewmodel(gltf);
  const profile:SourceViewmodelArmsProfile={...sourceCTArmsProfile(textures),bind:body=>bindSourceCTArms(body,57)};
  return createSourceViewmodel(gltf,base,exponent,undefined,profile,M4A4_VIEWMODEL_CONTRACT);
}

/** Team-independent owner; caller chooses this owner for original Dust2 CTs.
 * Instances use the existing Source animation/input/attachment API unchanged. */
export async function loadSourceM4A4Viewmodel(options:{baseUrl?:string;signal?:AbortSignal;loadingManager?:T.LoadingManager}={}){
  const baseUrl=(options.baseUrl??'/source/csgo-12426148/m4a4').replace(/\/$/,''),signal=options.signal;
  const response=await fetch(baseUrl+'/manifest.json',{signal,cache:'no-cache'});if(!response.ok)throw Error('M4A4 CT viewmodel manifest HTTP '+response.status);
  const manifest=await response.json() as Manifest;
  if(manifest.weaponId!=='m4a4'||manifest.itemDefinition!==16||manifest.sourceWeapon!=='models/weapons/v_rif_m4a1.mdl'||manifest.sourceApp!==740||manifest.build!==12426148||manifest.armsProfile!=='ct_arms_idf'||manifest.sourceArms!=='models/weapons/ct_arms_idf.mdl'||manifest.armsBoneCount!==48||manifest.weaponBoneCount!==57)throw Error('Unrecognized original M4A4 CT viewmodel manifest');
  const files=new Map(manifest.files.map(f=>[f.path,f]));
  if(files.size!==manifest.files.length||files.get('viewmodel.glb')?.sha256!==SOURCE_M4A4_VIEWMODEL_SHA256)throw Error('M4A4 CT viewmodel frozen source identity changed');
  const loaded:T.Texture[]=[],instances=new Set<T.Group>();let gltf:GLTF|undefined,disposed=false;
  const loader=new GLTFLoader(options.loadingManager),textureLoader=new T.TextureLoader(options.loadingManager);
  async function bytes(path:string){
    const row=files.get(path);if(!row)throw Error('CT manifest file missing: '+path);
    const res=await fetch(baseUrl+'/'+path,{signal,cache:'no-cache'});if(!res.ok)throw Error('M4A4 CT viewmodel HTTP '+res.status+' '+path);
    const data=new Uint8Array(await res.arrayBuffer());if(data.byteLength!==row.bytes||await sourceSha256(data,signal)!==row.sha256)throw Error('M4A4 CT viewmodel SHA mismatch: '+path);
    return data;
  }
  async function texture(name:string,color=false){
    const data=await bytes('textures/'+name+'-rgba.png'),url=URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>],{type:'image/png'}));
    try{const result=await textureLoader.loadAsync(url);loaded.push(result);signal?.throwIfAborted();result.flipY=false;result.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;
      result.wrapS=result.wrapT=T.RepeatWrapping;result.anisotropy=8;result.needsUpdate=true;return result;
    }finally{URL.revokeObjectURL(url);}
  }
  function release(){
    if(disposed)return;disposed=true;
    instances.forEach(g=>{if(isSourceViewmodel(g))disposeSourceViewmodel(g);g.removeFromParent();});instances.clear();
    const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>(loaded),skeletons=new Set<T.Skeleton>();
    gltf?.scene.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const value of Object.values(m))if(value instanceof T.Texture)textures.add(value);}}if(o instanceof T.SkinnedMesh)skeletons.add(o.skeleton);});
    skeletons.forEach(s=>s.dispose());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
  }
  try{
    const results=await Promise.allSettled([
      bytes('viewmodel.glb').then(async b=>{gltf=await loader.parseAsync(b.buffer as ArrayBuffer,baseUrl+'/');prepareSourceM4A4Viewmodel(gltf);return gltf;}),
      texture('rif_m4a1',true),texture('rif_m4a1_exponent'),texture('ct_arms_idf',true),texture('ct_arms_normal'),
      texture('ct_base_glove_color',true),texture('ct_base_glove_normal'),texture('ct_base_glove_exp'),
    ]);
    const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
    signal?.throwIfAborted();
    const [,base,exponent,sleeveBase,sleeveNormal,gloveBase,gloveNormal,gloveExponent]=results.map(r=>(r as PromiseFulfilledResult<unknown>).value) as [GLTF,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture];
    const textures:SourceCTArmTextures={sleeve:{base:sleeveBase,normal:sleeveNormal},glove:{base:gloveBase,normal:gloveNormal,exponent:gloveExponent}};
    return {gltf:gltf!,manifest,weaponId:'m4a4' as const,hashVerified:true,profile:'ct_arms_idf' as const,
      createViewmodel(){if(disposed)throw Error('M4A4 CT viewmodel owner disposed');const model=createSourceM4A4Viewmodel(gltf!,base,exponent,textures);assertSourceFireVariants(model,SOURCE_WEAPON_FIRE_VARIANTS.m4a4,'m4a4');instances.add(model);return model;},
      disposeViewmodel(model:T.Group){if(instances.delete(model)){if(isSourceViewmodel(model))disposeSourceViewmodel(model);model.removeFromParent();}},dispose:release};
  }catch(error){release();throw error;}
}
