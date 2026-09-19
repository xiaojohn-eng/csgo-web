/** Independent Deagle owner derived from the audited pistol owner. Shared
 * gameplay/assets entry points remain unchanged; all 9 original FP clips retained. */
import * as T from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {createSourceDefaultWeaponMaterial,createSourceArmsMaterial,type SourceSurfaceTextures} from './source-materials';
import {createSourceCTArmMaterial,type SourceCTArmTextures} from './source-ct-viewmodel-materials';
import {SOURCE_DEAGLE_ASSETS} from './source-deagle-contracts';
import {sourceSha256} from './source-sha256';

export type SourceDeagleWeapon='deagle';
export type SourceDeagleTeam='t'|'ct';
type Bone={name:string;parent:number;position:number[];quaternion:number[];inverseBind:number[][]};
type Rig={format:'source-pistol-rig-v1';weaponBones:Bone[];armsBones:Bone[];matchingBoneNames:string[];weightedArmsBones:string[];silencerMeshName:string|null};
type Event={cycle:number;event:number;type:number;name:string;options:string};
export type SourceDeagleClip={sourceSequence:string;name:string;fps:number;frames:number;duration:number;activity:string;events:Event[]};
export type SourceDeagleManifest={format:'source-pistol-viewmodel-v1';sourceApp:740;build:12426148;weaponId:SourceDeagleWeapon;team:SourceDeagleTeam;itemDefinition:number;sourceArms:string;sourceWeapon:string;armsProfile:string;weaponBoneCount:number;armsBoneCount:number;matchedBoneCount:number;weightedArmsBoneCount:number;clips:Record<string,SourceDeagleClip>;files:{path:string;bytes:number;sha256:string}[]};
export type SourceDeagleSample={sequence:string;timeSeconds:number;silencerAttached?:boolean};
export type SourceDeagleLoadOptions={baseUrl?:string;signal?:AbortSignal;loadingManager?:T.LoadingManager};
type Handle={material:T.Material;dispose:()=>void};
type State={body:T.Object3D;weapon:SourceDeagleWeapon;team:SourceDeagleTeam;mixer:T.AnimationMixer;actions:Map<string,T.AnimationAction>;clips:Map<string,SourceDeagleClip>;attachments:Map<string,T.Object3D>;silencer?:T.Object3D;afterSample:()=>void;handles:Handle[];skeletons:Set<T.Skeleton>;sequence:string;time:number};
const KEY='sourceDeagleViewmodel';
const C=new T.Matrix4().set(1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1),Ci=C.clone().invert();
const exactNames={deagle:['idle1','shoot1','shoot2','shoot3','shoot_empty','reload','draw','lookat01','lookat02']} as const;
function state(root:T.Object3D):State{const s=root.userData[KEY]as State|undefined;if(!s)throw Error('Not a Source pistol viewmodel');return s;}
export const isSourceDeagleViewmodel=(root:T.Object3D)=>!!root.userData[KEY];

/** Original Deagle VMT includes albedo boost 40 and cubemap tint .4. */
export function createSourceDeagleMaterial(weapon:SourceDeagleWeapon,base:T.Texture,exponent:T.Texture):Handle{
 return createSourceDefaultWeaponMaterial(weapon,base,exponent);
}
function prepare(gltf:GLTF,rig:Rig,weapon:SourceDeagleWeapon,team:SourceDeagleTeam){
 const doc=gltf.parser.json as {nodes:{name?:string}[];skins:{name?:string;joints:number[]}[]};
 const armName=team==='t'?'t_arms_ARM':'ct_arms_idf_ARM',parent='v_weapon.deagle_parent';
 const arms=doc.skins.find(s=>s.name===armName),gun=doc.skins.find(s=>s.joints.some(n=>doc.nodes[n].name===parent));
 if(rig.format!=='source-pistol-rig-v1'||doc.skins.length!==2||arms===gun||arms?.joints.length!==48||gun?.joints.length!==57||rig.matchingBoneNames.length!==47||rig.weightedArmsBones.length!==34)throw Error('Frozen original pistol rig identity mismatch');
 const nodes=new Map<number,T.Object3D>();for(const [o,a]of gltf.parser.associations)if(a.nodes!==undefined)nodes.set(a.nodes,o as T.Object3D);
 for(const [role,skin,bones]of [['arms',arms,rig.armsBones],['weapon',gun,rig.weaponBones]]as const){
  const names=new Map(bones.map(b=>[b.name,b]));if(names.size!==skin.joints.length)throw Error('Pistol original bone count changed');
  for(const n of skin.joints){const bone=nodes.get(n),name=doc.nodes[n].name;if(!(bone instanceof T.Bone)||!name||!names.has(name))throw Error('Pistol original joint missing');bone.userData.sourceFPBoneName=name;bone.userData.sourceFPSkin=role;}
 }
 let silencerCount=0;const weighted=new Set<string>();
 gltf.scene.traverse(o=>{
  if(o.name&&gltf.parser.associations.get(o)?.nodes!==undefined){const originalName=doc.nodes[gltf.parser.associations.get(o)!.nodes!].name;if(originalName===rig.silencerMeshName){o.userData.sourcePistolSilencer=true;silencerCount++;}}
  if(!(o instanceof T.SkinnedMesh))return;
  const role=o.skeleton.bones[0]?.userData.sourceFPSkin,bones=role==='arms'?rig.armsBones:rig.weaponBones,byName=new Map(bones.map(b=>[b.name,b]));
  for(let i=0;i<o.skeleton.bones.length;i++){const b=byName.get(o.skeleton.bones[i].userData.sourceFPBoneName);if(!b)throw Error('Pistol skin joint identity mismatch');const expected=new T.Matrix4().set(...b.inverseBind.flat() as Parameters<T.Matrix4['set']>).multiply(Ci);if(expected.elements.some((v,j)=>Math.fround(v)!==o.skeleton.boneInverses[i].elements[j]))throw Error('Pistol raw inverse bind changed');}
  if(role==='arms'){const indices=o.geometry.getAttribute('skinIndex'),weights=o.geometry.getAttribute('skinWeight');for(let i=0;i<weights.count;i++)for(let j=0;j<4;j++)if(weights.getComponent(i,j)>0)weighted.add(o.skeleton.bones[indices.getComponent(i,j)].userData.sourceFPBoneName);}
 });
 if(silencerCount!==0||weighted.size!==34||rig.weightedArmsBones.some(n=>!weighted.has(n)))throw Error('Pistol bodygroup or weighted arm contract changed');
 for(const name of rig.matchingBoneNames)if(!rig.armsBones.some(b=>b.name===name)||!rig.weaponBones.some(b=>b.name===name))throw Error('Pistol matching bone contract changed');
}
function bindArms(body:T.Object3D,rig:Rig){
 const gun=new Map<string,T.Bone>(),arms:T.Bone[]=[];body.traverse(o=>{if(o instanceof T.Bone){if(o.userData.sourceFPSkin==='weapon')gun.set(o.userData.sourceFPBoneName,o);else if(o.userData.sourceFPSkin==='arms')arms.push(o);}});
 const pairs=arms.filter(b=>gun.has(b.userData.sourceFPBoneName)).map(b=>[b,gun.get(b.userData.sourceFPBoneName)!]as const);
 if(gun.size!==rig.weaponBones.length||arms.length!==48||pairs.length!==rig.matchingBoneNames.length||pairs.some(([b])=>!rig.matchingBoneNames.includes(b.userData.sourceFPBoneName)))throw Error('Pistol clone exact bone merge mismatch');
 const local=new T.Matrix4();return()=>{for(const [arm,weapon]of pairs){if(!arm.parent)throw Error('Pistol arm parent missing');arm.parent.updateWorldMatrix(true,false);local.copy(arm.parent.matrixWorld).invert().multiply(weapon.matrixWorld);local.decompose(arm.position,arm.quaternion,arm.scale);arm.matrixAutoUpdate=false;arm.matrix.copy(local);arm.matrixWorldNeedsUpdate=true;arm.updateWorldMatrix(false,false);}};
}
/** Stateless source-time sampling. It never schedules burst shots, commits ammo,
 * changes authoritative silencer mode, or invents an animation completion time. */
export function sampleSourceDeagleViewmodel(root:T.Group,input:SourceDeagleSample){
 const s=state(root),clip=s.clips.get(input.sequence),action=s.actions.get(input.sequence);if(!clip||!action||!Number.isFinite(input.timeSeconds))throw Error('Invalid original pistol sequence/time');

 if(s.sequence!==input.sequence||!action.isScheduled()){s.mixer.stopAllAction();action.reset().play();}
 action.paused=true;action.time=T.MathUtils.clamp(input.timeSeconds,0,clip.duration);s.mixer.update(0);root.updateMatrixWorld(true);s.afterSample();root.updateMatrixWorld(true);
 if(s.silencer){let visible=input.silencerAttached!;for(const event of clip.events)if(event.cycle*clip.duration<=action.time+1e-9){if(event.name==='AE_CL_SHOW_SILENCER')visible=true;else if(event.name==='AE_CL_HIDE_SILENCER')visible=false;}s.silencer.visible=visible;}
 s.sequence=input.sequence;s.time=action.time;return{sequence:s.sequence,time:s.time,activity:clip.activity,silencerVisible:s.silencer?.visible??null};
}
export function sourceDeagleAttachment(root:T.Group,name:string,relativeTo:T.Object3D){const s=state(root),attachment=s.attachments.get(name);if(!attachment)throw Error('Original pistol attachment missing: '+name);root.updateWorldMatrix(true,true);relativeTo.updateWorldMatrix(true,false);return new T.Matrix4().copy(relativeTo.matrixWorld).invert().multiply(attachment.matrixWorld);}
export function inspectSourceDeagleViewmodel(root:T.Group){const s=state(root);return{weapon:s.weapon,team:s.team,profile:root.userData.sourceArmsProfile,sequence:s.sequence,time:s.time,silencerVisible:s.silencer?.visible??null,clips:[...s.clips.values()],attachments:[...s.attachments.keys()],boneCounts:[...new Map([...s.skeletons].map(v=>[v.bones[0].uuid,v.bones.length])).values()],skinBindings:s.skeletons.size};}
export function disposeSourceDeagleViewmodel(root:T.Group){if(!isSourceDeagleViewmodel(root))return;const s=state(root);s.mixer.stopAllAction();s.mixer.uncacheRoot(s.body);s.handles.forEach(h=>h.dispose());s.skeletons.forEach(v=>v.dispose());delete root.userData[KEY];}

export async function loadSourceDeagleViewmodel(options:SourceDeagleLoadOptions&{team:SourceDeagleTeam}){
 const {team,signal}=options,weapon:SourceDeagleWeapon='deagle',frozen=SOURCE_DEAGLE_ASSETS[`${weapon}-${team}`];if(!frozen)throw Error('Unknown original pistol profile');
 const baseUrl=(options.baseUrl??`/source/csgo-12426148/${weapon}-${team}`).replace(/\/$/,'');
 const response=await fetch(baseUrl+'/manifest.json',{signal,cache:'no-cache'});if(!response.ok)throw Error('Pistol manifest HTTP '+response.status);const raw=new Uint8Array(await response.arrayBuffer());
 if(await sourceSha256(raw,signal)!==frozen.manifestSha256)throw Error('Pistol manifest SHA mismatch');const manifest=JSON.parse(new TextDecoder().decode(raw))as SourceDeagleManifest;
 if(manifest.format!=='source-pistol-viewmodel-v1'||manifest.sourceApp!==740||manifest.build!==12426148||manifest.weaponId!==weapon||manifest.team!==team||manifest.itemDefinition!==1||manifest.sourceWeapon!==`models/weapons/v_pist_deagle.mdl`||manifest.sourceArms!==`models/weapons/${team==='t'?'t_arms':'ct_arms_idf'}.mdl`||manifest.weaponBoneCount!==57||manifest.armsBoneCount!==48||manifest.matchedBoneCount!==47)throw Error('Frozen pistol manifest identity mismatch');
 const files=new Map(manifest.files.map(f=>[f.path,f]));if(files.size!==manifest.files.length||manifest.files.some(f=>f.path.includes('..')||f.path.startsWith('/')||f.path.includes('\\'))||files.get('viewmodel.glb')?.sha256!==frozen.glbSha256||files.get('rig.json')?.sha256!==frozen.rigSha256)throw Error('Pistol frozen asset contract changed');
 const textures=new Map<string,T.Texture>(),instances=new Set<T.Group>();let gltf:GLTF|undefined,rig:Rig|undefined,disposed=false;
 async function bytes(path:string){if(disposed)throw Error('Pistol owner disposed');const row=files.get(path);if(!row)throw Error('Pistol manifest file absent: '+path);const r=await fetch(baseUrl+'/'+path,{signal,cache:'no-cache'});if(!r.ok)throw Error('Pistol HTTP '+r.status+' '+path);const b=new Uint8Array(await r.arrayBuffer());if(b.byteLength!==row.bytes||await sourceSha256(b,signal)!==row.sha256)throw Error('Pistol SHA mismatch: '+path);return b;}
 const gltfLoader=new GLTFLoader(options.loadingManager),textureLoader=new T.TextureLoader(options.loadingManager);
 async function texture(path:string){const b=await bytes(path),url=URL.createObjectURL(new Blob([b as Uint8Array<ArrayBuffer>],{type:'image/png'}));try{const t=await textureLoader.loadAsync(url);textures.set(path,t);signal?.throwIfAborted();t.flipY=false;t.colorSpace=/exponent|_exp-|normal|skin_gradient/.test(path)?T.NoColorSpace:T.SRGBColorSpace;t.wrapS=t.wrapT=path.includes('skin_gradient')?T.ClampToEdgeWrapping:T.RepeatWrapping;t.anisotropy=8;t.needsUpdate=true;return t;}finally{URL.revokeObjectURL(url);}}
 function release(){if(disposed)return;disposed=true;for(const g of instances){disposeSourceDeagleViewmodel(g);g.removeFromParent();}instances.clear();const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),allTextures=new Set(textures.values()),skeletons=new Set<T.Skeleton>();gltf?.scene.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const value of Object.values(m))if(value instanceof T.Texture)allTextures.add(value);}}if(o instanceof T.SkinnedMesh)skeletons.add(o.skeleton);});skeletons.forEach(s=>s.dispose());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());allTextures.forEach(t=>t.dispose());}
 const texturePaths=manifest.files.filter(f=>f.path.startsWith('textures/')&&f.path.endsWith('.png')).map(f=>f.path);
 try{
  const results=await Promise.allSettled([bytes('viewmodel.glb').then(async b=>gltf=await gltfLoader.parseAsync(b.buffer as ArrayBuffer,baseUrl+'/')),bytes('rig.json').then(b=>rig=JSON.parse(new TextDecoder().decode(b))as Rig),...texturePaths.map(texture)]);
  const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;signal?.throwIfAborted();prepare(gltf!,rig!,weapon,team);
  const clips=new Map(Object.values(manifest.clips).map(c=>[c.sourceSequence,c]));if(clips.size!==exactNames[weapon].length||exactNames[weapon].some(n=>!clips.has(n)))throw Error('Original pistol sequence set changed');
  for(const c of clips.values()){const clip=gltf!.animations.find(a=>a.name===c.name);if(!clip||Math.abs(clip.duration-c.duration)>1e-5)throw Error('Original pistol clip timing changed');}
  const tex=(stem:string)=>{const t=textures.get('textures/'+stem+'-rgba.png');if(!t)throw Error('Pistol original texture missing: '+stem);return t;};
  function createViewmodel(){if(disposed)throw Error('Pistol owner disposed');const root=new T.Group(),body=clone(gltf!.scene),handles:Handle[]=[],skeletons=new Set<T.Skeleton>();root.name=`CSGO_12426148_${weapon}_${team}_FP`;root.userData.sourceWeapon=weapon;root.userData.sourceArmsProfile=manifest.armsProfile;root.rotation.y=Math.PI/2;root.scale.setScalar(.0254);root.add(body);
   try{const materialName='pist_deagle',pistol=createSourceDeagleMaterial(weapon,tex(materialName),tex(materialName+'_exponent'));handles.push(pistol);const materials=new Map<string,Handle>([[materialName,pistol]]);
    if(team==='t'){const skin:SourceSurfaceTextures={base:tex('v_model_base_arms_color'),normal:tex('v_model_base_arms_normal'),exponent:tex('v_model_base_arms_exp'),warp:tex('skin_gradient')},glove:SourceSurfaceTextures={base:tex('t_base_fingerless_glove_color'),normal:tex('t_base_fingerless_glove_normal'),exponent:tex('t_base_fingerless_glove_exp')};const a=createSourceArmsMaterial('skin',skin),b=createSourceArmsMaterial('glove',glove);handles.push(a,b);materials.set('models/weapons/v_models/arms/v_model_base_arms',a);materials.set('models/weapons/v_models/arms/t_base_fingerless_glove',b);}else{const arms:SourceCTArmTextures={sleeve:{base:tex('ct_arms_idf'),normal:tex('ct_arms_normal')},glove:{base:tex('ct_base_glove_color'),normal:tex('ct_base_glove_normal'),exponent:tex('ct_base_glove_exp')}};const a=createSourceCTArmMaterial('sleeve',arms),b=createSourceCTArmMaterial('glove',arms);handles.push(a,b);materials.set('ct_arms_idf',a);materials.set('models/weapons/v_models/arms/ct_base_glove',b);}
    const replaced=new Set<string>(),attachments=new Map<string,T.Object3D>();let silencer:T.Object3D|undefined;
    body.traverse(o=>{if(o.userData.sourcePistolSilencer)silencer=o;const a=o.userData.source_attachment;if(a){if(attachments.has(a.name))throw Error('Duplicate pistol attachment');attachments.set(a.name,o);}if(o instanceof T.SkinnedMesh){skeletons.add(o.skeleton);o.frustumCulled=false;}if(o instanceof T.Mesh){const replace=(m:T.Material)=>{const h=materials.get(m.name);if(!h)throw Error('Unadapted original pistol material: '+m.name);replaced.add(m.name);return h.material;};o.material=Array.isArray(o.material)?o.material.map(replace):replace(o.material);}});
    if(replaced.size!==3||attachments.size!==2)throw Error('Original pistol material/attachment set changed');
    const mixer=new T.AnimationMixer(body),actions=new Map<string,T.AnimationAction>();for(const c of clips.values()){const a=mixer.clipAction(gltf!.animations.find(a=>a.name===c.name)!);a.setLoop(T.LoopOnce,1);a.clampWhenFinished=true;actions.set(c.sourceSequence,a);}
    root.userData[KEY]={body,weapon,team,mixer,actions,clips,attachments,silencer,afterSample:bindArms(body,rig!),handles,skeletons,sequence:'',time:0}satisfies State;
    sampleSourceDeagleViewmodel(root,{sequence:'idle1',timeSeconds:0,silencerAttached:true});instances.add(root);return root;
   }catch(error){if(isSourceDeagleViewmodel(root))disposeSourceDeagleViewmodel(root);else{handles.forEach(h=>h.dispose());skeletons.forEach(s=>s.dispose());}throw error;}
  }
  return{gltf:gltf!,manifest,weaponId:weapon,team,profile:manifest.armsProfile,hashVerified:true,createViewmodel,sampleViewmodel:sampleSourceDeagleViewmodel,fetchFile:bytes,disposeViewmodel(root:T.Group){if(instances.delete(root)){disposeSourceDeagleViewmodel(root);root.removeFromParent();}},dispose:release};
 }catch(error){release();throw error;}
}
