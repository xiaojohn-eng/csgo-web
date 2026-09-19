import * as T from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {createSourceAKMaterial,createSourceArmsMaterial,type SourceSurfaceTextures} from './source-materials';
import {drawSourceActivityVariant} from './source-weapon-fire-draw';
import {SOURCE_WEAPON_FIRE_VARIANTS} from './source-weapon-fire-variants';
import type {Player} from './types';

const KEY = 'sourceViewmodel';
const CLIPS = {idle:'idle__ak47_idle',fire:'fire__ak47_fire1',reload:'reload__ak47_reload',inspect:'inspect__lookat01'} as const;
type Pose = keyof typeof CLIPS|'draw'|'fire2'|'fire3';
/** The poses one fire activity's remaining sequences occupy. A model this port ships
 * gives its fire activity three sequences at most, so the table is that size. */
const FIRE_POSES = ['fire','fire2','fire3'] as const satisfies readonly Pose[];
/** One of the sequences the original model gives an activity, with the model's `actweight`. */
export type SourceViewmodelFireVariant = {name:string;weight:number};
export type SourceViewmodelWeaponContract={id:string;clips:Record<keyof typeof CLIPS,string>&{draw?:string};
  /** The model's own sequences for the fire activity, in the model's order and with the
   * model's weights. The first is the one `clips.fire` already names; a shot draws
   * between them instead of always starting the first. Absent, the activity keeps its
   * single sequence exactly as before. */
  fireVariants?:readonly SourceViewmodelFireVariant[];
  materialName:string;createMaterial:(base:T.Texture,exponent:T.Texture)=>{material:T.Material;dispose:()=>void};muzzleBone:string;ejectionBone:string};
const AK_WEAPON:SourceViewmodelWeaponContract={id:'ak47',clips:CLIPS,materialName:'ak47',createMaterial:createSourceAKMaterial,
  fireVariants:SOURCE_WEAPON_FIRE_VARIANTS.vandal,
  muzzleBone:'v_weapon.AK47_flash',ejectionBone:'v_weapon.AK47_shelleject'};
export const SOURCE_AK47_DRAW_WEAPON:SourceViewmodelWeaponContract={...AK_WEAPON,clips:{...CLIPS,draw:'draw__ak47_draw'}};
export type SourceViewmodelArmsProfile = {id:string;createMaterials:()=>Map<string,{material:T.Material;dispose:()=>void}>;bind?:(body:T.Object3D)=>()=>void};
type State = {body:T.Object3D;mixer:T.AnimationMixer;actions:Map<Pose,T.AnimationAction>;current:Pose;time:number;elapsed:number;
  inspect:number;draw:number;generation:number;muzzle:T.Object3D;ejection:T.Object3D;disposeMaterial:()=>void;skeletons:Set<T.Skeleton>;
  fire:Pose;shotIdle:number;fireVariants:readonly {pose:Pose;sequence:string;clip:string;weight:number}[];random:()=>number;afterSample?:()=>void};
function state(root:T.Object3D):State {const value=root.userData[KEY] as State;if(!value)throw new Error('Not a Source viewmodel');return value;}
export function isSourceViewmodel(root:T.Object3D) {return !!root.userData[KEY];}
export function hasSourceDraw(root:T.Object3D){return isSourceViewmodel(root)&&state(root).actions.has('draw');}
/** Which of the fire activity's own sequences this model carries, in the model's order.
 *
 * The contract names them as the original model does, so the clip is found by the
 * model's own suffix rather than by a prefix this asset happens to use. The first one
 * has to be the sequence `clips.fire` already names: a table that disagreed with the
 * mapping about the default would mean one of the two reads the model wrongly.
 * A sequence the model does not carry is left out, so a reduced fixture still plays;
 * the owner of a shipped model asserts the whole set is there. */
function resolveSourceFireVariants(gltf:GLTF,weapon:SourceViewmodelWeaponContract){
  const declared=weapon.fireVariants??[];
  const resolved=[] as {pose:Pose;sequence:string;clip:string;weight:number}[];
  declared.forEach((row,index)=>{
    if(index>=FIRE_POSES.length)throw new Error('Original fire activity has more sequences than this port models');
    if(!Number.isInteger(row.weight)||row.weight<0)throw new Error('Invalid original fire activity weight for '+row.name);
    const matches=gltf.animations.filter(c=>c.name.endsWith('__'+row.name));
    if(matches.length>1)throw new Error('Original model names more than one clip for fire sequence '+row.name);
    if(!matches.length){
      if(index===0)throw new Error('Original fire activity default is missing from the model: '+row.name);
      return;
    }
    if(index===0&&matches[0].name!==weapon.clips.fire)throw new Error('Original fire activity default differs from its variant table');
    resolved.push({pose:FIRE_POSES[index],sequence:row.name,clip:matches[0].name,weight:row.weight});
  });
  if(declared.length>1&&!(resolved.reduce((sum,row)=>sum+row.weight,0)>0))throw new Error('Original fire activity variant weights sum to nothing');
  return resolved;
}
/** The fire variants a created viewmodel actually carries, for the owner that has to
 * know the shipped model kept all of its own sequences. */
export function sourceViewmodelFireVariants(root:T.Object3D){return state(root).fireVariants.map(row=>({...row}));}
/** The owner of a shipped model has to see that model's whole fire variant set. A
 * sequence that quietly went missing would leave the port playing one variant forever,
 * which is what this closes. */
export function assertSourceFireVariants(root:T.Object3D,expected:readonly SourceViewmodelFireVariant[],weapon:string){
  const found=sourceViewmodelFireVariants(root).map(row=>({name:row.sequence,weight:row.weight}));
  const same=found.length===expected.length&&found.every((row,index)=>row.name===expected[index].name&&row.weight===expected[index].weight);
  if(!same)throw new Error(`Original ${weapon} fire variant set changed: ${found.map(row=>row.name).join(',')} instead of ${expected.map(row=>row.name).join(',')}`);
}

export function createSourceViewmodel(gltf:GLTF,base:T.Texture,exponent:T.Texture,arms?:{skin:SourceSurfaceTextures;glove:SourceSurfaceTextures},profile?:SourceViewmodelArmsProfile,weapon:SourceViewmodelWeaponContract=AK_WEAPON,random:()=>number=Math.random):T.Group {
  if(arms&&profile)throw new Error('Choose one Source arms profile');
  const root=new T.Group(),body=clone(gltf.scene);
  root.name=profile?'CSGO_12426148_AK47_'+profile.id:'CSGO_12426148_AK47_T_Arms';
  root.userData.sourceArmsProfile=profile?.id??(arms?'t_arms':'none');
  root.userData.sourceWeapon=weapon.id;if(weapon.id!=='ak47')root.name='CSGO_12426148_'+weapon.id+'_'+(profile?.id??'arms');
  // Source exporter already maps XYZ to (X,Z,-Y). A single outer yaw makes
  // Source +X face camera -Z; this uniform scale is not a per-bone correction.
  root.rotation.y=Math.PI/2;root.scale.setScalar(.0254);root.add(body);
  const mixer=new T.AnimationMixer(body),actions=new Map<Pose,T.AnimationAction>();
  for(const key of Object.keys(weapon.clips) as (keyof typeof CLIPS|'draw')[]) {
    const clip=gltf.animations.find(c=>c.name===weapon.clips[key]);
    if(!clip)throw new Error('Required original animation missing: '+weapon.clips[key]);
    const action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;actions.set(key,action);
  }
  const fireVariants=resolveSourceFireVariants(gltf,weapon);
  for(const row of fireVariants.slice(1)){
    const clip=gltf.animations.find(c=>c.name===row.clip)!;
    const action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;actions.set(row.pose,action);
  }
  let muzzle:T.Object3D|undefined,ejection:T.Object3D|undefined;
  const adapted=weapon.createMaterial(base,exponent),skeletons=new Set<T.Skeleton>();
  const skin=arms?createSourceArmsMaterial('skin',arms.skin):undefined,glove=arms?createSourceArmsMaterial('glove',arms.glove):undefined;
  const custom=profile?.createMaterials(),customReplaced=new Set<string>();
  const replaced=new Set<string>();
  body.traverse(o=>{
    const attachment=o.userData.source_attachment;
    if(attachment?.bone===weapon.muzzleBone)muzzle=o;
    if(attachment?.bone===weapon.ejectionBone)ejection=o;
    if(o instanceof T.SkinnedMesh){o.frustumCulled=false;skeletons.add(o.skeleton);}
    if(o instanceof T.Mesh){
      const replace=(m:T.Material)=>{
        const customHandle=custom?.get(m.name);
        if(customHandle)customReplaced.add(m.name);
        const replacement=customHandle?.material??(m.name===weapon.materialName?adapted.material:
          m.name==='models/weapons/v_models/arms/v_model_base_arms'?skin?.material:
          m.name==='models/weapons/v_models/arms/t_base_fingerless_glove'?glove?.material:undefined);
        if(replacement)replaced.add(replacement.name);
        return replacement??m;
      };
      o.material=Array.isArray(o.material)?o.material.map(replace):replace(o.material);
    }
  });
  const disposeMaterial=()=>{adapted.dispose();skin?.dispose();glove?.dispose();custom?.forEach(handle=>handle.dispose());};
  if(custom&&(custom.size===0||customReplaced.size!==custom.size||!replaced.has(adapted.material.name))){disposeMaterial();throw new Error('Original AK/custom arms material identity mismatch');}
  if(arms&&replaced.size!==3){disposeMaterial();throw new Error('Original AK/skin/glove material identity mismatch');}
  if(!muzzle||!ejection){disposeMaterial();throw new Error('Original animated muzzle/ejection attachment missing');}
  root.userData[KEY]={body,mixer,actions,current:'idle',time:0,elapsed:0,inspect:Infinity,draw:Infinity,generation:0,muzzle,ejection,disposeMaterial,skeletons,
    fire:'fire',shotIdle:Infinity,fireVariants,random,afterSample:profile?.bind?.(body)} satisfies State;
  sampleSourceViewmodel(root,'idle',0);
  return root;
}

export function sampleSourceViewmodel(root:T.Group,pose:Pose,seconds:number) {
  const s=state(root),action=s.actions.get(pose);if(!action)throw new Error('Source weapon has no '+pose+' clip');
  if(s.current!==pose||!action.isScheduled()) {s.mixer.stopAllAction();action.reset().play();}
  action.paused=true;action.time=T.MathUtils.clamp(seconds,0,action.getClip().duration);
  s.mixer.update(0);root.updateMatrixWorld(true);
  if(s.afterSample){s.afterSample();root.updateMatrixWorld(true);}
  s.current=pose;s.time=action.time;
}
export function startSourceInspection(root:T.Group) {const s=state(root);s.inspect=0;s.generation++;}
export function cancelSourceInspection(root:T.Group) {state(root).inspect=Infinity;}
export function startSourceDraw(root:T.Group) {const s=state(root);if(!s.actions.has('draw'))throw new Error('Source weapon has no draw clip');s.draw=0;s.inspect=Infinity;s.generation++;sampleSourceViewmodel(root,'draw',0);}
export function sourceViewmodelPlayback(root:T.Group){const s=state(root);return{pose:s.current,time:s.time,generation:s.generation};}
export function updateSourceViewmodel(root:T.Group,p:Player|undefined,dt:number,interrupted=false) {
  const s=state(root),step=Math.max(0,Math.min(.1,dt));s.elapsed+=step;
  // A shot is the shot clock starting over. The activity's own sequences are drawn
  // between at that moment, so the whole shot plays one variant rather than switching.
  const shotIdle=p?.shotIdle??Infinity;
  if(shotIdle<s.shotIdle&&s.fireVariants.length>1)s.fire=s.fireVariants[drawSourceActivityVariant(s.fireVariants.map(row=>row.weight),s.random)].pose;
  s.shotIdle=shotIdle;
  if(interrupted||p?.reload||(p&&!p.alive)||((p?.shotIdle??Infinity)<.1))s.inspect=Infinity;
  s.inspect+=step;
  if(interrupted||p?.reload||(p&&!p.alive)||((p?.shotIdle??Infinity)<.1))s.draw=Infinity;
  s.draw+=step;
  if(p&&p.reload>0)sampleSourceViewmodel(root,'reload',s.actions.get('reload')!.getClip().duration-p.reload);
  else if(s.inspect<s.actions.get('inspect')!.getClip().duration)sampleSourceViewmodel(root,'inspect',s.inspect);
  else if(p&&p.shotIdle<s.actions.get(s.fire)!.getClip().duration)sampleSourceViewmodel(root,s.fire,p.shotIdle);
  else if(s.draw<(s.actions.get('draw')?.getClip().duration??0))sampleSourceViewmodel(root,'draw',s.draw);
  else sampleSourceViewmodel(root,'idle',s.elapsed%s.actions.get('idle')!.getClip().duration);
}
export function sourceAttachment(root:T.Group,kind:'muzzle'|'ejection',relativeTo:T.Object3D):T.Matrix4 {
  root.updateWorldMatrix(true,true);relativeTo.updateWorldMatrix(true,false);
  return new T.Matrix4().copy(relativeTo.matrixWorld).invert().multiply(state(root)[kind].matrixWorld);
}
export function inspectSourceViewmodel(root:T.Group) {
  const s=state(root),materials=new Set<T.Material>();
  s.body.traverse(o=>{if(o instanceof T.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});
  return {source:'CSGO App740 build12426148',weapon:root.userData.sourceWeapon,armsProfile:root.userData.sourceArmsProfile,pose:s.current,time:s.time,inspect:s.inspect,
    surfaces:[...materials].map(m=>({name:m.name,type:m.type,detail:m.userData})),
    clips:[...s.actions.entries()].map(([name,a])=>({name,duration:a.getClip().duration})),
    sourceToCamera:'Source (x,y,z) -> (-.0254*y,.0254*z,-.0254*x)',
    muzzle:s.muzzle.getWorldPosition(new T.Vector3()).toArray(),ejection:s.ejection.getWorldPosition(new T.Vector3()).toArray()};
}
export function disposeSourceViewmodel(root:T.Group) {
  if(!isSourceViewmodel(root))return;const s=state(root);s.mixer.stopAllAction();s.mixer.uncacheRoot(s.body);s.disposeMaterial();s.skeletons.forEach(v=>v.dispose());delete root.userData[KEY];
}
