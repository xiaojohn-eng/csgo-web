/** Private AK draw candidate adapter. Does not replace either production owner. */
import * as T from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {createSourceViewmodel,disposeSourceViewmodel,type SourceViewmodelWeaponContract} from '../game/source-viewmodel';
import {createSourceAKMaterial} from '../game/source-materials';
import {prepareSourceCTViewmodel,bindSourceCTArms} from '../game/source-ct-viewmodel';
import {validateSourceTViewmodel} from '../game/source-t-viewmodel';
import {sourceCTArmsProfile} from '../game/source-ct-viewmodel-materials';
import {sourceSha256} from '../game/source-sha256';
export const AK_DRAW_CANDIDATES={t:{manifest:'provenance.json',manifestSHA:'470da3b7046651a266c2433290bf2edb9f8f71b82ce56ac4ec69877f340fdaaf',glbSHA:'c5da61dcea3fbd81312efcad3edf45d4f7ec8ff891bd2cae3e317e34912f5d65'},ct:{manifest:'manifest.json',manifestSHA:'6e19aecab6484e665b98b725cfb3d0b78ca2df5e20dff6fcfc260ac470619af1',glbSHA:'d7812ebb628f6c178c134b8ab53536ae312a0ba9de955ce3533f5b04af7c0bf1'}} as const;
export type AKDrawTeam=keyof typeof AK_DRAW_CANDIDATES;
export type AKDrawManifest={files:{path:string;bytes:number;sha256:string}[];drawSoundEvents:{timeSeconds:number;options:string}[]};
const clips={idle:'idle__ak47_idle',fire:'fire__ak47_fire1',reload:'reload__ak47_reload',inspect:'inspect__lookat01'};
export const AK_DRAW_WEAPON:SourceViewmodelWeaponContract={id:'ak47',clips:{...clips,draw:'draw__ak47_draw'},materialName:'ak47',createMaterial:createSourceAKMaterial,muzzleBone:'v_weapon.AK47_flash',ejectionBone:'v_weapon.AK47_shelleject'};
export function tagAKDrawBones(gltf:GLTF,team:AKDrawTeam){
 if(team==='ct')return prepareSourceCTViewmodel(gltf);validateSourceTViewmodel(gltf);
 const doc=gltf.parser.json as {nodes:{name:string}[];skins:{joints:number[]}[]};
 const nodes=new Map<number,T.Object3D>();for(const[obj,ref]of gltf.parser.associations)if(ref.nodes!==undefined)nodes.set(ref.nodes,obj as T.Object3D);
 for(const skin of doc.skins)for(const i of skin.joints){const bone=nodes.get(i)!;bone.userData.sourceFPBoneName=doc.nodes[i].name;bone.userData.sourceFPSkin=skin.joints.length===58?'weapon':'arms';}return gltf;
}
export function createAKDrawCandidate(gltf:GLTF,team:AKDrawTeam,maps:Record<string,T.Texture>,includeDraw=true){
 tagAKDrawBones(gltf,team);const weapon=includeDraw?AK_DRAW_WEAPON:{...AK_DRAW_WEAPON,clips};
 if(team==='ct')return createSourceViewmodel(gltf,maps.ak47,maps.ak47_exponent,undefined,{...sourceCTArmsProfile({sleeve:{base:maps.ct_arms_idf,normal:maps.ct_arms_normal},glove:{base:maps.ct_base_glove_color,normal:maps.ct_base_glove_normal,exponent:maps.ct_base_glove_exp}}),bind:bindSourceCTArms},weapon);
 return createSourceViewmodel(gltf,maps.ak47,maps.ak47_exponent,{skin:{base:maps.v_model_base_arms_color,normal:maps.v_model_base_arms_normal,exponent:maps.v_model_base_arms_exp,warp:maps.skin_gradient},glove:{base:maps.t_base_fingerless_glove_color,normal:maps.t_base_fingerless_glove_normal,exponent:maps.t_base_fingerless_glove_exp}},undefined,weapon);
}
export const AK_DRAW_TEXTURES={t:['ak47','ak47_exponent','v_model_base_arms_color','v_model_base_arms_normal','v_model_base_arms_exp','skin_gradient','t_base_fingerless_glove_color','t_base_fingerless_glove_normal','t_base_fingerless_glove_exp'],ct:['ak47','ak47_exponent','ct_arms_idf','ct_arms_normal','ct_base_glove_color','ct_base_glove_normal','ct_base_glove_exp']};
export async function loadAKDrawCandidate(team:AKDrawTeam){
 const base='/assets/source-exports/ak47-draw-candidates/'+team,pin=AK_DRAW_CANDIDATES[team];
 const request=async(path:string)=>{const r=await fetch(base+'/'+path,{cache:'no-cache'});if(!r.ok)throw Error('Candidate HTTP '+r.status);return new Uint8Array(await r.arrayBuffer());};
 const manifestBytes=await request(pin.manifest);if(await sourceSha256(manifestBytes)!==pin.manifestSHA)throw Error('Candidate manifest SHA');const manifest=JSON.parse(new TextDecoder().decode(manifestBytes))as AKDrawManifest;
 const files=new Map(manifest.files.map(f=>[f.path,f]));if(files.get('viewmodel.glb')?.sha256!==pin.glbSHA)throw Error('Candidate model identity');
 async function bytes(path:string){const row=files.get(path),b=await request(path);if(!row||b.length!==row.bytes||await sourceSha256(b)!==row.sha256)throw Error('Candidate file SHA: '+path);return b;}
 let gltf:GLTF|undefined,disposed=false;const maps:Record<string,T.Texture>={},roots=new Set<T.Group>(),textures=new Set<T.Texture>();
 const release=()=>{if(disposed)return;disposed=true;for(const r of roots){disposeSourceViewmodel(r);r.removeFromParent();}roots.clear();const geo=new Set<T.BufferGeometry>(),mats=new Set<T.Material>(),skeletons=new Set<T.Skeleton>();gltf?.scene.traverse(o=>{if(o instanceof T.Mesh){geo.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){mats.add(m);for(const v of Object.values(m))if(v instanceof T.Texture)textures.add(v);}}if(o instanceof T.SkinnedMesh)skeletons.add(o.skeleton);});geo.forEach(x=>x.dispose());mats.forEach(x=>x.dispose());skeletons.forEach(x=>x.dispose());textures.forEach(x=>x.dispose());};
 try{
 const results=await Promise.allSettled([bytes('viewmodel.glb').then(async b=>{gltf=await new GLTFLoader().parseAsync(b.buffer as ArrayBuffer,base+'/');tagAKDrawBones(gltf,team);}),...AK_DRAW_TEXTURES[team].map(async name=>{const b=await bytes('textures/'+name+'-rgba.png'),url=URL.createObjectURL(new Blob([b as Uint8Array<ArrayBuffer>],{type:'image/png'}));try{const t=await new T.TextureLoader().loadAsync(url);textures.add(t);maps[name]=t;t.flipY=false;t.colorSpace=name==='ak47'||name==='ct_arms_idf'||name.endsWith('_color')?T.SRGBColorSpace:T.NoColorSpace;t.wrapS=t.wrapT=name==='skin_gradient'?T.ClampToEdgeWrapping:T.RepeatWrapping;t.anisotropy=8;t.needsUpdate=true;}finally{URL.revokeObjectURL(url);}})]);
 const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
 return{team,gltf:gltf!,manifest,hashVerified:true,glbSHA:pin.glbSHA,bytes,createViewmodel(){if(disposed)throw Error('Candidate disposed');const root=createAKDrawCandidate(gltf!,team,maps);roots.add(root);return root;},dispose:release};
 }catch(e){release();throw e;}
}
