import * as T from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {createSourceViewmodel,disposeSourceViewmodel,isSourceViewmodel,assertSourceFireVariants,SOURCE_AK47_DRAW_WEAPON,type SourceViewmodelWeaponContract,type SourceViewmodelArmsProfile} from './source-viewmodel';
import {SOURCE_WEAPON_FIRE_VARIANTS} from './source-weapon-fire-variants';
import {sourceCTArmsProfile,type SourceCTArmTextures} from './source-ct-viewmodel-materials';
import {sourceSha256} from './source-sha256';

export const SOURCE_CT_VIEWMODEL_SHA256='8a8a31f668a54255eeea1556859878910828ad84001f670b566c5e43b5a43e55';
export const SOURCE_CT_DRAW_VIEWMODEL_SHA256='72230f3bdbde976eb63e92d6d87bd5be770efe8f244e806c8efc8afe55080844';
export const SOURCE_CT_DRAW_MANIFEST_SHA256='437ca88b68c2f1bb4b029350870c36283c6b62c554adf95d03fba2b86a7a9762';
type Manifest={sourceApp:740;build:12426148;armsProfile:'ct_arms_idf';sourceArms:string;weaponBoneCount:58;armsBoneCount:48;
  files:{path:string;bytes:number;sha256:string}[];clips:Record<string,{action_name:string;duration_seconds:number;fps:number;frame_count:number}>};

/** Tag source names before cloning; glTFLoader sanitizes bone names and suffixes
 * duplicates. Never infer correspondence from those display names. */
export function prepareSourceCTViewmodel(gltf:GLTF){
  const doc=gltf.parser.json as {nodes:{name?:string}[];skins:{name?:string;joints:number[]}[]};
  if(doc.skins.length!==2)throw Error('CT viewmodel requires two original skins');
  const nodes=new Map<number,T.Object3D>();
  for(const [obj,ref]of gltf.parser.associations)if(ref.nodes!==undefined)nodes.set(ref.nodes,obj as T.Object3D);
  const arms=doc.skins.find(s=>s.name==='ct_arms_idf_ARM'),weapon=doc.skins.find(s=>s.joints.some(i=>doc.nodes[i].name==='v_weapon.ak47_parent'));
  if(arms?.joints.length!==48||weapon?.joints.length!==58)throw Error('CT 48 / AK 58 source skin identity mismatch');
  for(const [role,skin]of [['arms',arms],['weapon',weapon]]as const)for(const joint of skin.joints){
    const bone=nodes.get(joint);if(!(bone instanceof T.Bone))throw Error('Original CT joint is missing');
    bone.userData.sourceFPBoneName=doc.nodes[joint].name;bone.userData.sourceFPSkin=role;
  }
  return gltf;
}
export function bindSourceCTArms(body:T.Object3D,weaponBoneCount=58){
  const weapon=new Map<string,T.Bone>(),arms:T.Bone[]=[];
  body.traverse(o=>{if(o instanceof T.Bone){if(o.userData.sourceFPSkin==='weapon')weapon.set(o.userData.sourceFPBoneName,o);else if(o.userData.sourceFPSkin==='arms')arms.push(o);}});
  if(weapon.size!==weaponBoneCount||arms.length!==48)throw Error('Original CT clone bone identity changed');
  const pairs=arms.filter(b=>weapon.has(b.userData.sourceFPBoneName)).map(b=>[b,weapon.get(b.userData.sourceFPBoneName)!]as const);
  if(pairs.length!==47||arms.filter(b=>!weapon.has(b.userData.sourceFPBoneName)).some(b=>b.userData.sourceFPBoneName!=='Bip01'))throw Error('Original CT matching-bone set changed');
  // Traversal is parent before child. Copy shared world pose and derive local
  // matrices while keeping the CT skin's own original inverse-bind matrices.
  const local=new T.Matrix4();
  return ()=>{
    for(const [arm,gun]of pairs){
      if(!arm.parent)throw Error('CT arm joint lost its parent');
      // Bip01 is an unmatched intermediate parent beneath matched v_weapon;
      // refresh it after that parent's copied world pose, before taking inverse.
      arm.parent.updateWorldMatrix(true,false);
      local.copy(arm.parent.matrixWorld).invert().multiply(gun.matrixWorld);
      local.decompose(arm.position,arm.quaternion,arm.scale);
      // Source bone merge copies matrices. Preserve the small exporter basis
      // rounding too, instead of losing it through a second TRS decomposition.
      arm.matrixAutoUpdate=false;arm.matrix.copy(local);arm.matrixWorldNeedsUpdate=true;arm.updateWorldMatrix(false,false);
    }
  };
}
export function createSourceCTViewmodel(gltf:GLTF,base:T.Texture,exponent:T.Texture,textures:SourceCTArmTextures,weapon?:SourceViewmodelWeaponContract){
  prepareSourceCTViewmodel(gltf);
  const profile:SourceViewmodelArmsProfile={...sourceCTArmsProfile(textures),bind:bindSourceCTArms};
  return createSourceViewmodel(gltf,base,exponent,undefined,profile,weapon);
}

/** Team-independent owner; caller chooses this owner for original Dust2 CTs.
 * Instances use the existing Source animation/input/attachment API unchanged. */
export async function loadSourceCTViewmodel(options:{baseUrl?:string;signal?:AbortSignal;loadingManager?:T.LoadingManager}={}){
  const baseUrl=(options.baseUrl??'/source/csgo-12426148/ak47-ct-draw').replace(/\/$/,''),signal=options.signal;
  const response=await fetch(baseUrl+'/manifest.json',{signal,cache:'no-cache'});if(!response.ok)throw Error('CT viewmodel manifest HTTP '+response.status);
  const raw=new Uint8Array(await response.arrayBuffer());
  if(await sourceSha256(raw,signal)!==SOURCE_CT_DRAW_MANIFEST_SHA256)throw Error('CT viewmodel manifest SHA mismatch');
  const manifest=JSON.parse(new TextDecoder().decode(raw))as Manifest;
  if(manifest.sourceApp!==740||manifest.build!==12426148||manifest.armsProfile!=='ct_arms_idf'||manifest.sourceArms!=='models/weapons/ct_arms_idf.mdl'||manifest.armsBoneCount!==48||manifest.weaponBoneCount!==58)throw Error('Unrecognized original CT viewmodel manifest');
  const files=new Map(manifest.files.map(f=>[f.path,f]));
  if(files.size!==manifest.files.length||files.get('viewmodel.glb')?.sha256!==SOURCE_CT_DRAW_VIEWMODEL_SHA256)throw Error('CT viewmodel frozen source identity changed');
  const loaded:T.Texture[]=[],instances=new Set<T.Group>();let gltf:GLTF|undefined,disposed=false;
  const loader=new GLTFLoader(options.loadingManager),textureLoader=new T.TextureLoader(options.loadingManager);
  async function bytes(path:string){
    const row=files.get(path);if(!row)throw Error('CT manifest file missing: '+path);
    const res=await fetch(baseUrl+'/'+path,{signal,cache:'no-cache'});if(!res.ok)throw Error('CT viewmodel HTTP '+res.status+' '+path);
    const data=new Uint8Array(await res.arrayBuffer());if(data.byteLength!==row.bytes||await sourceSha256(data,signal)!==row.sha256)throw Error('CT viewmodel SHA mismatch: '+path);
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
      bytes('viewmodel.glb').then(async b=>{gltf=await loader.parseAsync(b.buffer as ArrayBuffer,baseUrl+'/');prepareSourceCTViewmodel(gltf);return gltf;}),
      texture('ak47',true),texture('ak47_exponent'),texture('ct_arms_idf',true),texture('ct_arms_normal'),
      texture('ct_base_glove_color',true),texture('ct_base_glove_normal'),texture('ct_base_glove_exp'),
    ]);
    const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
    signal?.throwIfAborted();
    const [,base,exponent,sleeveBase,sleeveNormal,gloveBase,gloveNormal,gloveExponent]=results.map(r=>(r as PromiseFulfilledResult<unknown>).value) as [GLTF,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture];
    const textures:SourceCTArmTextures={sleeve:{base:sleeveBase,normal:sleeveNormal},glove:{base:gloveBase,normal:gloveNormal,exponent:gloveExponent}};
    return {gltf:gltf!,manifest,hashVerified:true,profile:'ct_arms_idf' as const,
      createViewmodel(){if(disposed)throw Error('CT viewmodel owner disposed');const model=createSourceCTViewmodel(gltf!,base,exponent,textures,SOURCE_AK47_DRAW_WEAPON);assertSourceFireVariants(model,SOURCE_WEAPON_FIRE_VARIANTS.vandal,'ak47');instances.add(model);return model;},
      disposeViewmodel(model:T.Group){if(instances.delete(model)){if(isSourceViewmodel(model))disposeSourceViewmodel(model);model.removeFromParent();}},dispose:release};
  }catch(error){release();throw error;}
}
