import * as T from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {createSourceViewmodel,disposeSourceViewmodel,isSourceViewmodel,assertSourceFireVariants} from './source-viewmodel';
import {createSourceArmsMaterial,type SourceSurfaceTextures} from './source-materials';
import {bindSourceCTArms} from './source-ct-viewmodel';
import {M4A4_VIEWMODEL_CONTRACT} from './source-m4a4-viewmodel';
import {SOURCE_WEAPON_FIRE_VARIANTS} from './source-weapon-fire-variants';
import {sourceSha256} from './source-sha256';

export const SOURCE_M4A4_T_VIEWMODEL_SHA256='4312033d946dca9948bc0fdac1ee0b2fc198f9e887f2fd981e38f62c3f26745a';
type Manifest={sourceApp:740;build:12426148;sourceArms:string;weaponId:'m4a4';itemDefinition:16;weaponBoneCount:57;armsBoneCount:48;files:{path:string;bytes:number;sha256:string}[];
  clips:Record<string,{action_name:string;duration_seconds:number;fps:number;frame_count:number}>};
export function prepareSourceM4A4TViewmodel(gltf:GLTF){
  const doc=gltf.parser.json as {nodes:{name?:string}[];skins:{name?:string;joints:number[]}[]};
  const arms=doc.skins.find(s=>s.name==='t_arms_ARM'),weapon=doc.skins.find(s=>s.joints.some(i=>doc.nodes[i].name==='v_weapon.M4A1_Parent'));
  if(doc.skins.length!==2||arms?.joints.length!==48||weapon?.joints.length!==57)throw Error('Original T 48 / M4A4 57 skin identity mismatch');
  const nodes=new Map<number,T.Object3D>();for(const [o,a]of gltf.parser.associations)if(a.nodes!==undefined)nodes.set(a.nodes,o as T.Object3D);
  for(const [role,skin]of [['arms',arms],['weapon',weapon]]as const)for(const i of skin.joints){const bone=nodes.get(i);if(!(bone instanceof T.Bone))throw Error('Original M4/T joint missing');bone.userData.sourceFPBoneName=doc.nodes[i].name;bone.userData.sourceFPSkin=role;}

}
export function createSourceM4A4TViewmodel(gltf:GLTF,base:T.Texture,exponent:T.Texture,arms:{skin:SourceSurfaceTextures;glove:SourceSurfaceTextures}){
 prepareSourceM4A4TViewmodel(gltf);
 return createSourceViewmodel(gltf,base,exponent,undefined,{id:'t_arms',bind:body=>bindSourceCTArms(body,57),
  createMaterials:()=>new Map([
   ['models/weapons/v_models/arms/v_model_base_arms',createSourceArmsMaterial('skin',arms.skin)],
   ['models/weapons/v_models/arms/t_base_fingerless_glove',createSourceArmsMaterial('glove',arms.glove)],
  ])},M4A4_VIEWMODEL_CONTRACT);
}
/** Frozen original T owner: shares the existing T shader/animation implementation;
 * all fetched GLB/PNG bytes are SHA-checked even on insecure HTTP LAN origins. */
export async function loadSourceM4A4TViewmodel(options:{baseUrl?:string;signal?:AbortSignal;loadingManager?:T.LoadingManager}={}){
  const baseUrl=(options.baseUrl??'/source/csgo-12426148/m4a4-t').replace(/\/$/,''),signal=options.signal;
  const response=await fetch(baseUrl+'/manifest.json',{signal,cache:'no-cache'});if(!response.ok)throw Error('T viewmodel manifest HTTP '+response.status);
  const manifest=await response.json()as Manifest;
  if(manifest.sourceApp!==740||manifest.build!==12426148||manifest.weaponId!=='m4a4'||manifest.itemDefinition!==16||manifest.sourceArms!=='models/weapons/t_arms.mdl'||manifest.weaponBoneCount!==57||manifest.armsBoneCount!==48)throw Error('Unrecognized original T viewmodel manifest');
  const files=new Map(manifest.files.map(f=>[f.path,f]));
  if(files.size!==manifest.files.length||files.get('viewmodel.glb')?.sha256!==SOURCE_M4A4_T_VIEWMODEL_SHA256)throw Error('T viewmodel frozen source identity changed');
  const loaded:T.Texture[]=[],instances=new Set<T.Group>();let gltf:GLTF|undefined,disposed=false;
  const loader=new GLTFLoader(options.loadingManager),textureLoader=new T.TextureLoader(options.loadingManager);
  async function bytes(path:string){
    const row=files.get(path);if(!row)throw Error('T manifest file missing: '+path);
    const response=await fetch(baseUrl+'/'+path,{signal,cache:'no-cache'});if(!response.ok)throw Error('T viewmodel HTTP '+response.status+' '+path);
    const data=new Uint8Array(await response.arrayBuffer());
    if(data.byteLength!==row.bytes||await sourceSha256(data,signal)!==row.sha256)throw Error('T viewmodel SHA mismatch: '+path);
    return data;
  }
  async function texture(name:string,color=false,warp=false){
    const data=await bytes('textures/'+name+'-rgba.png'),url=URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>],{type:'image/png'}));
    try{const value=await textureLoader.loadAsync(url);loaded.push(value);signal?.throwIfAborted();value.flipY=false;value.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;
      value.wrapS=value.wrapT=warp?T.ClampToEdgeWrapping:T.RepeatWrapping;value.anisotropy=8;value.needsUpdate=true;return value;
    }finally{URL.revokeObjectURL(url);}
  }
  function release(){
    if(disposed)return;disposed=true;instances.forEach(g=>{if(isSourceViewmodel(g))disposeSourceViewmodel(g);g.removeFromParent();});instances.clear();
    const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>(loaded),skeletons=new Set<T.Skeleton>();
    gltf?.scene.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const value of Object.values(m))if(value instanceof T.Texture)textures.add(value);}}if(o instanceof T.SkinnedMesh)skeletons.add(o.skeleton);});
    skeletons.forEach(s=>s.dispose());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
  }
  try{
    const results=await Promise.allSettled([
      bytes('viewmodel.glb').then(async b=>{gltf=await loader.parseAsync(b.buffer as ArrayBuffer,baseUrl+'/');prepareSourceM4A4TViewmodel(gltf);return gltf;}),
      texture('rif_m4a1',true),texture('rif_m4a1_exponent'),texture('v_model_base_arms_color',true),texture('v_model_base_arms_normal'),texture('v_model_base_arms_exp'),texture('skin_gradient',false,true),
      texture('t_base_fingerless_glove_color',true),texture('t_base_fingerless_glove_normal'),texture('t_base_fingerless_glove_exp'),
    ]);
    const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
    signal?.throwIfAborted();
    const [,base,exponent,skinBase,skinNormal,skinExponent,warp,gloveBase,gloveNormal,gloveExponent]=results.map(r=>(r as PromiseFulfilledResult<unknown>).value)as [GLTF,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture];
    const arms:{skin:SourceSurfaceTextures;glove:SourceSurfaceTextures}={skin:{base:skinBase,normal:skinNormal,exponent:skinExponent,warp},glove:{base:gloveBase,normal:gloveNormal,exponent:gloveExponent}};
    return {gltf:gltf!,manifest,weaponId:'m4a4' as const,hashVerified:true,profile:'t_arms' as const,
      createViewmodel(){if(disposed)throw Error('T viewmodel owner disposed');const model=createSourceM4A4TViewmodel(gltf!,base,exponent,arms);assertSourceFireVariants(model,SOURCE_WEAPON_FIRE_VARIANTS.m4a4,'m4a4');instances.add(model);return model;},
      disposeViewmodel(model:T.Group){if(instances.delete(model)){if(isSourceViewmodel(model))disposeSourceViewmodel(model);model.removeFromParent();}},dispose:release};
  }catch(error){release();throw error;}
}
