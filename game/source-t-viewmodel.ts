import * as T from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {createSourceViewmodel,disposeSourceViewmodel,isSourceViewmodel,assertSourceFireVariants,SOURCE_AK47_DRAW_WEAPON} from './source-viewmodel';
import {SOURCE_WEAPON_FIRE_VARIANTS} from './source-weapon-fire-variants';
import type {SourceSurfaceTextures} from './source-materials';
import {sourceSha256} from './source-sha256';

export const SOURCE_T_VIEWMODEL_SHA256='8e93eb7f575bcf4ae7cd05cfce32d374fd8d114d9993e76dd5f1adc5182b0baa';
export const SOURCE_T_DRAW_VIEWMODEL_SHA256='2bb9a3be6f863a8cbe42820355c6c20c5e5fac3baf6b093eff1d6b68fe6cd1e4';
export const SOURCE_T_DRAW_MANIFEST_SHA256='fe662149184218413be6e6ff8271850a9d876b6035ed4a95c3da098a0773f8d0';
type Manifest={sourceApp:740;build:12426148;arms:string;files:{path:string;bytes:number;sha256:string}[];
  clips:Record<string,{action_name:string;duration_seconds:number;fps:number;frame_count:number}>};
export function validateSourceTViewmodel(gltf:GLTF){
  const doc=gltf.parser.json as {nodes:{name?:string}[];skins:{name?:string;joints:number[]}[]};
  const arms=doc.skins.find(s=>s.name==='t_arms_ARM'),weapon=doc.skins.find(s=>s.joints.some(i=>doc.nodes[i].name==='v_weapon.ak47_parent'));
  if(doc.skins.length!==2||arms?.joints.length!==48||weapon?.joints.length!==58)throw Error('Original T 48 / AK 58 skin identity mismatch');
}
/** Frozen original T owner: shares the existing T shader/animation implementation;
 * all fetched GLB/PNG bytes are SHA-checked even on insecure HTTP LAN origins. */
export async function loadSourceTViewmodel(options:{baseUrl?:string;signal?:AbortSignal;loadingManager?:T.LoadingManager}={}){
  const baseUrl=(options.baseUrl??'/source/csgo-12426148/ak47-draw').replace(/\/$/,''),signal=options.signal;
  const response=await fetch(baseUrl+'/provenance.json',{signal,cache:'no-cache'});if(!response.ok)throw Error('T viewmodel manifest HTTP '+response.status);
  const raw=new Uint8Array(await response.arrayBuffer());
  if(await sourceSha256(raw,signal)!==SOURCE_T_DRAW_MANIFEST_SHA256)throw Error('T viewmodel manifest SHA mismatch');
  const manifest=JSON.parse(new TextDecoder().decode(raw))as Manifest;
  if(manifest.sourceApp!==740||manifest.build!==12426148||!manifest.arms.startsWith('models/weapons/t_arms.mdl;'))throw Error('Unrecognized original T viewmodel manifest');
  const files=new Map(manifest.files.map(f=>[f.path,f]));
  if(files.size!==manifest.files.length||files.get('viewmodel.glb')?.sha256!==SOURCE_T_DRAW_VIEWMODEL_SHA256)throw Error('T viewmodel frozen source identity changed');
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
      bytes('viewmodel.glb').then(async b=>{gltf=await loader.parseAsync(b.buffer as ArrayBuffer,baseUrl+'/');validateSourceTViewmodel(gltf);return gltf;}),
      texture('ak47',true),texture('ak47_exponent'),texture('v_model_base_arms_color',true),texture('v_model_base_arms_normal'),texture('v_model_base_arms_exp'),texture('skin_gradient',false,true),
      texture('t_base_fingerless_glove_color',true),texture('t_base_fingerless_glove_normal'),texture('t_base_fingerless_glove_exp'),
    ]);
    const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
    signal?.throwIfAborted();
    const [,base,exponent,skinBase,skinNormal,skinExponent,warp,gloveBase,gloveNormal,gloveExponent]=results.map(r=>(r as PromiseFulfilledResult<unknown>).value)as [GLTF,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture,T.Texture];
    const arms:{skin:SourceSurfaceTextures;glove:SourceSurfaceTextures}={skin:{base:skinBase,normal:skinNormal,exponent:skinExponent,warp},glove:{base:gloveBase,normal:gloveNormal,exponent:gloveExponent}};
    return {gltf:gltf!,manifest,hashVerified:true,profile:'t_arms' as const,
      createViewmodel(){if(disposed)throw Error('T viewmodel owner disposed');const model=createSourceViewmodel(gltf!,base,exponent,arms,undefined,SOURCE_AK47_DRAW_WEAPON);assertSourceFireVariants(model,SOURCE_WEAPON_FIRE_VARIANTS.vandal,'ak47');instances.add(model);return model;},
      disposeViewmodel(model:T.Group){if(instances.delete(model)){if(isSourceViewmodel(model))disposeSourceViewmodel(model);model.removeFromParent();}},dispose:release};
  }catch(error){release();throw error;}
}
