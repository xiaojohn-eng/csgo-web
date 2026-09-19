/** The six original model_dropped meshes, rigid in their original right-hand
 * root frame. Reuses the same original world material factories/finish names as
 * held weapons; geometry/texture ownership stays with this asset cache. */
import * as T from 'three';
import {sourceSha256} from './source-sha256';
import {createSourceWorldAKMaterial} from './source-character-materials';
import {createSourceWorldM4A4Material} from './source-world-m4a4-material';
import {createSourceAWPMaterial,createSourceAWPScopeMaterial} from './source-awp-materials';
import {createSourceWorldPistolMaterial} from './source-pistol-character-surfaces';
import {createSourceWorldDeagleMaterial} from './source-deagle-character-surfaces';
import type {SourceDroppedWeaponState,SourceDroppedWeaponId} from './source-dropped-weapons';
import resources from './source-dropped-weapon-resources.json';
export const SOURCE_DROPPED_WEAPON_ASSET_PATH='/source/csgo-12426148/dropped-weapons-20260913/';
type View={byteOffset:number;byteLength:number;count:number};
type MeshDef={name:string;bodygroup:string;bodygroupIndex:number;visibleByDefault:boolean;material:number;position:View;normal:View;uv:View;indices:View};
type TextureDef={file:{path:string;bytes:number;sha256:string};source:string;width:number;height:number};
type MaterialDef={index:number;name:string;source:string;parameters:Record<string,string>;textures:Record<string,TextureDef>};
type ModelDef={weapon:SourceDroppedWeaponId;source:string;checksum:number;mesh:{path:string;bytes:number;sha256:string};meshes:MeshDef[];materials:MaterialDef[]};
export async function loadSourceDroppedWeaponRenderer(baseUrl=SOURCE_DROPPED_WEAPON_ASSET_PATH,options:{signal?:AbortSignal;onCreate?:(root:T.Group,state:SourceDroppedWeaponState)=>void;onRemove?:(root:T.Group)=>void}={}){
 const signal=options.signal,base=baseUrl.endsWith('/')?baseUrl:baseUrl+'/',verified:Record<string,boolean>={};
 const bytes=async(path:string)=>{const file=resources.find(r=>r.path===path);if(!file)throw Error('Unverified original dropped weapon file '+path);const response=await fetch(base+path,{signal});if(!response.ok)throw Error('Original dropped weapon HTTP '+response.status+' '+path);const data=new Uint8Array(await response.arrayBuffer());if(data.length!==file.bytes||await sourceSha256(data,signal)!==file.sha256)throw Error('Original dropped weapon SHA mismatch '+path);verified[path]=true;return data;};
 const metadata=JSON.parse(new TextDecoder().decode(await bytes('models.json')))as{format:string;build:number;models:ModelDef[]};
 if(metadata.format!=='source-dropped-weapon-models-v1'||metadata.build!==12426148||metadata.models.length!==6)throw Error('Original dropped weapon model identity differs');
 const textures=new Map<string,T.Texture>(),geometries:T.BufferGeometry[]=[],surfaces:{material:T.Material;dispose:()=>void}[]=[],models=new Map<SourceDroppedWeaponId,{definition:ModelDef;mesh:{definition:MeshDef;geometry:T.BufferGeometry;material:T.Material}[]}>();
 const group=new T.Group();group.name='original-dropped-weapons';let disposed=false;
 const actors=new Map<string,{root:T.Group;state:SourceDroppedWeaponState}>();
 function releaseAssets(){surfaces.forEach(s=>s.dispose());geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());}
 async function texture(entry:TextureDef,colour:boolean){const key=entry.file.path+(colour?':srgb':':linear'),existing=textures.get(key);if(existing)return existing;
  const data=await bytes(entry.file.path),url=URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>],{type:'image/png'}));let texture:T.Texture;
  try{texture=await new T.TextureLoader().loadAsync(url);}finally{URL.revokeObjectURL(url);}
  texture.colorSpace=colour?T.SRGBColorSpace:T.NoColorSpace;texture.flipY=false;texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.anisotropy=8;texture.needsUpdate=true;textures.set(key,texture);return texture;
 }
 try{for(const definition of metadata.models){
  const raw=await bytes(definition.mesh.path),active=definition.meshes.filter(m=>m.visibleByDefault||m.bodygroup==='silencer'),materials=new Map<number,T.Material>();
  for(const m of definition.materials.filter(m=>active.some(mesh=>mesh.material===m.index))){
   const base=await texture(m.textures.$basetexture,true),exponent=m.textures.$phongexponenttexture?await texture(m.textures.$phongexponenttexture,false):null,normal=m.textures.$bumpmap?await texture(m.textures.$bumpmap,false):null;
   let handle:{material:T.Material;dispose:()=>void};
   if(m.name==='scope_awp'&&normal)handle=createSourceAWPScopeMaterial(base,normal);
   else if(exponent){switch(definition.weapon){case'vandal':handle=createSourceWorldAKMaterial({base,exponent});break;case'm4a4':handle=createSourceWorldM4A4Material({base,exponent});break;case'awp':handle=createSourceAWPMaterial('awp',base,exponent,true);break;case'glock':case'usp':handle=createSourceWorldPistolMaterial(definition.weapon,{base,exponent});break;case'deagle':handle=createSourceWorldDeagleMaterial('deagle',{base,exponent});break;}}
   else throw Error('Unsupported original dropped weapon material '+m.name);
   handle!.material.userData.sourceVMT=m.source;handle!.material.userData.sourceDroppedWeapon=true;surfaces.push(handle!);materials.set(m.index,handle!.material);
  }
  const mesh=active.map(m=>{const geometry=new T.BufferGeometry();geometries.push(geometry);
   for(const [name,size]of [['position',3],['normal',3],['uv',2]]as const){const view=m[name];if(view.byteOffset%4||view.byteLength!==view.count*size*4||view.byteOffset+view.byteLength>raw.length)throw Error('Invalid original dropped mesh view');geometry.setAttribute(name,new T.BufferAttribute(new Float32Array(raw.buffer.slice(raw.byteOffset+view.byteOffset,raw.byteOffset+view.byteOffset+view.byteLength)),size));}
   const view=m.indices;if(view.byteOffset%4||view.byteLength!==view.count*4||view.byteOffset+view.byteLength>raw.length)throw Error('Invalid original dropped index view');geometry.setIndex(new T.BufferAttribute(new Uint32Array(raw.buffer.slice(raw.byteOffset+view.byteOffset,raw.byteOffset+view.byteOffset+view.byteLength)),1));geometry.computeBoundingBox();geometry.computeBoundingSphere();
   const material=materials.get(m.material);if(!material)throw Error('Original dropped mesh material missing');return{definition:m,geometry,material};
  });models.set(definition.weapon,{definition,mesh});
 }signal?.throwIfAborted();}catch(error){releaseAssets();throw error;}
 function remove(id:string){const actor=actors.get(id);if(!actor)return false;options.onRemove?.(actor.root);actor.root.removeFromParent();actors.delete(id);return true;}
 return{group,metadata,verified,
  sync(states:readonly SourceDroppedWeaponState[]){if(disposed)throw Error('Dropped weapon renderer disposed');const seen=new Set<string>();
   for(const state of states){if(seen.has(state.id))throw Error('Duplicate rendered dropped weapon');seen.add(state.id);const asset=models.get(state.weapon);if(!asset)throw Error('Unknown original dropped model');
    if(![...state.position,...state.quaternion].every(Number.isFinite)||state.position.length!==3||state.quaternion.length!==4)throw Error('Invalid dropped weapon render transform');
    let actor=actors.get(state.id);if(actor&&actor.state.weapon!==state.weapon)throw Error('Dropped weapon identity changed');
    if(!actor){const root=new T.Group(),model=new T.Group();root.name='Dropped_'+state.weapon+'_'+state.id;root.userData.sourceDroppedWeapon=state.id;root.userData.sourceWeaponId=state.weapon;model.rotation.x=-Math.PI/2;model.scale.setScalar(.0254);root.add(model);for(const part of asset.mesh){const mesh=new T.Mesh(part.geometry,part.material);mesh.name=part.definition.name;mesh.userData.sourceDroppedBodygroup=part.definition.bodygroup;mesh.castShadow=mesh.receiveShadow=true;model.add(mesh);}actor={root,state:structuredClone(state)};actors.set(state.id,actor);group.add(root);root.position.fromArray(state.position);root.quaternion.fromArray(state.quaternion).normalize();root.updateMatrixWorld(true);options.onCreate?.(root,state);}
    actor.state=structuredClone(state);actor.root.position.fromArray(state.position);actor.root.quaternion.fromArray(state.quaternion).normalize();actor.root.traverse(o=>{if(o.userData.sourceDroppedBodygroup==='mag')o.visible=state.magazineVisible;if(o.userData.sourceDroppedBodygroup==='silencer')o.visible=state.silencerVisible;});actor.root.updateMatrixWorld(true);
   }
   for(const id of actors.keys())if(!seen.has(id))remove(id);return [...actors.values()].map(a=>({id:a.state.id,weapon:a.state.weapon,root:a.root}));
  },
  root(id:string){return actors.get(id)?.root??null;},
  clear(){for(const id of actors.keys())remove(id);},
  dispose(){if(disposed)return;for(const id of actors.keys())remove(id);releaseAssets();group.removeFromParent();disposed=true;},
 };
}
const heldVisibility=new WeakMap<T.Object3D,T.Group[]>();
/** Wrap only weapon-skinned meshes in identity visibility groups. The wrappers
 * leave bones, local transforms and original magazine/silencer visibility alone,
 * so hiding a corpse's gun cannot erase a reload or resurrect a detached mag. */
export function setSourceHeldWeaponVisible(actor:{model:T.Object3D;worldBones?:readonly T.Bone[];weaponBones?:readonly T.Bone[]},visible:boolean){
 let wrappers=heldVisibility.get(actor.model);if(!wrappers){const bones=new Set(actor.worldBones??actor.weaponBones??[]),meshes:T.SkinnedMesh[]=[];if(!bones.size)throw Error('Original held weapon bones absent');actor.model.traverse(o=>{if(o instanceof T.SkinnedMesh&&o.skeleton.bones.some(b=>bones.has(b)))meshes.push(o);});if(!meshes.length)throw Error('Original held weapon meshes absent');
  wrappers=meshes.map(mesh=>{const parent=mesh.parent;if(!parent)throw Error('Detached original held weapon mesh');const wrapper=new T.Group();wrapper.name='SourceHeldWeaponVisibility';parent.add(wrapper);wrapper.add(mesh);return wrapper;});heldVisibility.set(actor.model,wrappers);
 }for(const wrapper of wrappers)wrapper.visible=visible;return wrappers.length;
}
