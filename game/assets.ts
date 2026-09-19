import * as T from 'three';
import { shareEquivalentSkeletons } from './share-skeleton';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { isFalconViewmodel, updateFalconViewmodel } from './falcon-viewmodel';
import { WEAPONS, type Player, type WeaponId, type Team } from './types';
import { characterBlend } from './character-contract';
import { FalconCombatPose, sampleFalconCombatPose } from './falcon-combat-pose';
import { bindDeathPresentation, markLivingPose, updateDeathPresentation, unbindDeathPresentation } from './death-presentation';
import type { SourceMagazineDropSource } from './source-magazine-drop';
import { isSourceViewmodel, updateSourceViewmodel,disposeSourceViewmodel,sourceViewmodelPlayback,sourceViewmodelFireVariants } from './source-viewmodel';
import {loadSourceCharacter,type SourceCharacterActor} from './source-character';
import {applySourceFootIK,sourceFootIKChains,sourceFootIKTeam} from './source-foot-ik';
import {loadSourceIKRules,type SourceIKRules} from './source-ik-rules';
import type {SourceCharacterPoseIndex,SourceCharacterPoseInput} from './source-character-pose';
import type {SourceDeagleCharacterPoseInput} from './source-deagle-character-pose';
import {loadSourceCTViewmodel} from './source-ct-viewmodel';
import {loadSourceTViewmodel} from './source-t-viewmodel';
import {loadSourceM4A4Viewmodel} from './source-m4a4-viewmodel';
import {loadSourceM4A4TViewmodel} from './source-m4a4-t-viewmodel';
import m4SoundTimeline from './source-m4a4-sound-timeline.json';
import akSoundTimeline from './source-ak47-sound-timeline.json';
import {advanceSourceSoundEvents,type SourceSoundCursor} from './source-sound-timeline';
import {loadSourcePistolCharacter,type SourcePistolCharacterActor} from './source-pistol-character';
import {isSourcePistolViewmodel} from './source-owned-pistol-viewmodel';
import {loadSourceDeagleViewmodel} from './source-deagle-viewmodel';
import {loadSourceDeagleCharacter,type SourceDeagleCharacterActor} from './source-deagle-character';
import {loadSourceAWPViewmodel,isSourceAWPViewmodel} from './source-awp-viewmodel';
import {loadSourceAWPCharacter,type SourceAWPCharacterActor} from './source-awp-character';
import {updateSourceAWPPlayback,resetSourceAWPPlayback} from './source-awp-playback';
import deagleAudio from './source-deagle-audio.json';
import awpAudio from './source-awp-audio.json';
import {loadSourcePistolViewmodel} from './source-pistol-viewmodel';
import {updateSourcePistolPlayback,resetSourcePistolPlayback} from './source-pistol-playback';
import pistolAudio from './source-pistol-audio.json';
const QUADRANTS: Record<string, [number, number]> = {
  'Anodized receiver': [0, 0],
  'Phosphate steel': [0, 0],
  'Textured polymer': [1, 0],
  'Rubber grip': [1, 0],
  'Tactical glove': [1, 1],
  'Ripstop sleeve': [0, 1],
  'Woven sling': [0, 1],
};

// Exact C02 bytes are checked by the build/handoff receipt. LAN HTTP may not expose
// crypto.subtle, so the runtime uses normal GLTF loading with explicit fallback.
const FALCON_C02_URL = '/models/web-w01/falcon-combat-actions.glb';
type FalconState = {
  body: T.Object3D;
  mixer: T.AnimationMixer;
  actions: Map<string, T.AnimationAction>;
  current: string;
  idleTime: number;
  pose: FalconCombatPose;
};

export class GameAssets {
  /** The original collision's surface under a world column, supplied by the
   * runtime that owns the original level. Presentation-only poses (the dropped
   * magazine prop, the original foot IK) sample it. */
  resolveGround: ((x: number, z: number, fromY: number) => number | null) | null = null;
  resolveGroundNormal: ((x:number,z:number,fromY:number)=>{x:number;y:number;z:number}|null)|null=null;
  /** The one staged original IK rule set every original character rig shares. */
  footIKRules: SourceIKRules | null = null;
  sourceCharacter:Awaited<ReturnType<typeof loadSourceCharacter>>|null=null;
  sourceCT:Awaited<ReturnType<typeof loadSourceCharacter>>|null=null;
  sourceCTViewmodel:Awaited<ReturnType<typeof loadSourceCTViewmodel>>|null=null;
  sourceTViewmodel:Awaited<ReturnType<typeof loadSourceTViewmodel>>|null=null;
  sourceTM4:Awaited<ReturnType<typeof loadSourceCharacter>>|null=null;
  sourceCTM4:Awaited<ReturnType<typeof loadSourceCharacter>>|null=null;
  sourceM4Viewmodel:Awaited<ReturnType<typeof loadSourceM4A4Viewmodel>>|null=null;
  sourceM4TViewmodel:Awaited<ReturnType<typeof loadSourceM4A4TViewmodel>>|null=null;
  sourceGlockCharacters:Partial<Record<Team,Awaited<ReturnType<typeof loadSourcePistolCharacter>>>>={};
  sourceGlockViewmodels:Partial<Record<Team,Awaited<ReturnType<typeof loadSourcePistolViewmodel>>>>={};
  sourceDeagleCharacters:Partial<Record<Team,Awaited<ReturnType<typeof loadSourceDeagleCharacter>>>>={};
  sourceDeagleViewmodels:Partial<Record<Team,Awaited<ReturnType<typeof loadSourceDeagleViewmodel>>>>={};
  sourceAWPCharacters:Partial<Record<Team,Awaited<ReturnType<typeof loadSourceAWPCharacter>>>>={};
  sourceAWPViewmodels:Partial<Record<Team,Awaited<ReturnType<typeof loadSourceAWPViewmodel>>>>={};
  private sourceDeagleActors=new Map<T.Group,{actor:SourceDeagleCharacterActor;owner:Awaited<ReturnType<typeof loadSourceDeagleCharacter>>}>();
  private sourceAWPActors=new Map<T.Group,{actor:SourceAWPCharacterActor;owner:Awaited<ReturnType<typeof loadSourceAWPCharacter>>}>();
  private sourceAWPSoundCursors=new WeakMap<T.Group,Map<string,SourceSoundCursor>>();
  onSourceAWPBrass?:()=>void;
  sourceUSPCharacters:Partial<Record<Team,Awaited<ReturnType<typeof loadSourcePistolCharacter>>>>={};
  sourceUSPViewmodels:Partial<Record<Team,Awaited<ReturnType<typeof loadSourcePistolViewmodel>>>>={};
  private sourcePistolActors=new Map<T.Group,{actor:SourcePistolCharacterActor;owner:Awaited<ReturnType<typeof loadSourcePistolCharacter>>}>();
  private sourceActors=new Map<T.Group,{actor:SourceCharacterActor;owner:Awaited<ReturnType<typeof loadSourceCharacter>>}>();
  private sourceFootRest=new WeakMap<T.Group,{bone:T.Bone;position:T.Vector3;quaternion:T.Quaternion;scale:T.Vector3}[]>();
  private sourceAbort=new AbortController();
  private sourceSoundCursors=new WeakMap<T.Group,SourceSoundCursor>();
  /** The local first-person rifle's playback and its model's own fire sequences: read-only
   * evidence that a shot drew between them, not a second source of truth. */
  sourceRifleViewAudit:{weapon:string;pose:string;time:number;generation:number;shotIdle:number|null;
    fireVariants:{pose:string;sequence:string;weight:number}[]}|null=null;
  private sourcePistolSoundCursors=new WeakMap<T.Group,Map<string,SourceSoundCursor>>();
  onSourceSound?:(event:string)=>void;
  onSourcePistolSound?:(weapon:'glock'|'usp'|'deagle'|'awp',event:string)=>void;
  models = new Map<string, GLTF>();
  disposed = false;
  atlases: T.Texture[] = [];
  falconStatus: 'loading' | 'ready' | 'fallback' = 'loading';
  falconLoadError: string | null = null;
  private falconActors = new Set<T.Group>();
  async load(originalDust2=false) {
    const loader = new GLTFLoader();
    // One copy of the original IK rules backs every character rig, and the
    // character loaders are given it rather than fetching their own.
    if(originalDust2)this.footIKRules=await loadSourceIKRules({signal:this.sourceAbort.signal});
    await Promise.all([
      ...(originalDust2?(['amber','blue']as const).flatMap(team=>{
        const sourceTeam=team==='amber'?'t':'ct';
        return [loadSourceDeagleCharacter({team:sourceTeam,signal:this.sourceAbort.signal}).then(owner=>{if(this.disposed){owner.dispose();return;}this.sourceDeagleCharacters[team]=owner;}),
          loadSourceDeagleViewmodel({team:sourceTeam,signal:this.sourceAbort.signal}).then(owner=>{if(this.disposed){owner.dispose();return;}this.sourceDeagleViewmodels[team]=owner;}),
          loadSourceAWPCharacter({team:sourceTeam,signal:this.sourceAbort.signal}).then(owner=>{if(this.disposed){owner.dispose();return;}this.sourceAWPCharacters[team]=owner;}),
          loadSourceAWPViewmodel({team:sourceTeam,signal:this.sourceAbort.signal}).then(owner=>{if(this.disposed){owner.dispose();return;}this.sourceAWPViewmodels[team]=owner;}),
          loadSourcePistolCharacter({team:sourceTeam,weapon:'glock',signal:this.sourceAbort.signal}).then(owner=>{if(this.disposed){owner.dispose();return;}this.sourceGlockCharacters[team]=owner;}),
          loadSourcePistolViewmodel({team:sourceTeam,weapon:'glock',signal:this.sourceAbort.signal}).then(owner=>{if(this.disposed){owner.dispose();return;}this.sourceGlockViewmodels[team]=owner;}),
          loadSourcePistolCharacter({team:sourceTeam,weapon:'usp',signal:this.sourceAbort.signal}).then(owner=>{if(this.disposed){owner.dispose();return;}this.sourceUSPCharacters[team]=owner;}),
          loadSourcePistolViewmodel({team:sourceTeam,weapon:'usp',signal:this.sourceAbort.signal}).then(owner=>{if(this.disposed){owner.dispose();return;}this.sourceUSPViewmodels[team]=owner;})];
      }):[]),
      originalDust2?loadSourceCharacter({ikRules:this.footIKRules??undefined,signal:this.sourceAbort.signal}).then(owner=>{
        if(this.disposed){owner.dispose();return;}this.sourceCharacter=owner;
      }):this.loadFalcon(loader),
      originalDust2?loadSourceCharacter({baseUrl:'/source/csgo-12426148/character-ct-ak/',ikRules:this.footIKRules??undefined,signal:this.sourceAbort.signal}).then(owner=>{
        if(this.disposed){owner.dispose();return;}this.sourceCT=owner;
      }):Promise.resolve(),
      loadSourceTViewmodel({signal:this.sourceAbort.signal}).then(owner=>{
        if(this.disposed){owner.dispose();return;}this.sourceTViewmodel=owner;
      }),
      originalDust2?loadSourceCTViewmodel({signal:this.sourceAbort.signal}).then(owner=>{
        if(this.disposed){owner.dispose();return;}this.sourceCTViewmodel=owner;
      }):Promise.resolve(),
      originalDust2?loadSourceCharacter({baseUrl:'/source/csgo-12426148/character-t-m4/',ikRules:this.footIKRules??undefined,signal:this.sourceAbort.signal}).then(owner=>{
        if(this.disposed){owner.dispose();return;}this.sourceTM4=owner;
      }):Promise.resolve(),
      originalDust2?loadSourceCharacter({baseUrl:'/source/csgo-12426148/character-ct-m4/',ikRules:this.footIKRules??undefined,signal:this.sourceAbort.signal}).then(owner=>{
        if(this.disposed){owner.dispose();return;}this.sourceCTM4=owner;
      }):Promise.resolve(),
      originalDust2?loadSourceM4A4Viewmodel({signal:this.sourceAbort.signal}).then(owner=>{
        if(this.disposed){owner.dispose();return;}this.sourceM4Viewmodel=owner;
      }):Promise.resolve(),
      originalDust2?loadSourceM4A4TViewmodel({signal:this.sourceAbort.signal}).then(owner=>{
        if(this.disposed){owner.dispose();return;}this.sourceM4TViewmodel=owner;
      }):Promise.resolve(),
      ...(originalDust2?[]:[
        ['sidearm', '/models/web-w02/weapon/falcon-p12.glb'],
        ['marshal', '/models/web-w02/weapon/falcon-dmr.glb'],
      ] as const).map(async ([name, url]) => {
        const gltf = await loader.loadAsync(url);
        if (this.disposed) { this.release(gltf.scene); return; }
        gltf.scene.traverse(object => {
          if (!(object instanceof T.Mesh)) return;
          object.castShadow = object.receiveShadow = true;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (material instanceof T.MeshStandardMaterial && material.map) material.map.anisotropy = 8;
          }
        });
        this.models.set(name, gltf);
      }),
    ]);
  }
  private async loadFalcon(loader: GLTFLoader) {
    let gltf: GLTF | undefined;
    try {
      gltf = await loader.loadAsync(FALCON_C02_URL);
      for (const name of ['Bip01_R_Hand', 'Bip01_L_Hand', 'Weapon_Root', 'Magazine_Root', 'Socket_Muzzle']) {
        if (!gltf.scene.getObjectByName(name)) throw new Error(`C02 missing ${name}`);
      }
      for (const name of ['Rifle_Idle', 'Rifle_Fire', 'Rifle_Reload']) {
        if (!gltf.animations.some((clip) => clip.name === name)) throw new Error(`C02 missing ${name}`);
      }
      if (this.disposed) {
        this.release(gltf.scene);
        return;
      }
      // Preserve embedded PBR and complete skin/weapon hierarchy. No legacy atlas or tint.
      this.models.set('falconC02', gltf);
      this.falconStatus = 'ready';
    } catch (error) {
      if (gltf) this.release(gltf.scene);
      this.falconStatus = 'fallback';
      this.falconLoadError = String(error);
      throw new Error('Required approved FALCON C02 asset could not load: ' + String(error));
    }
  }
  weapon(id: WeaponId,team:Team='amber') {
    if(id==='knife'){
      // No original knife model is staged yet. Keep the gameplay path visible with
      // a deliberately generic low-poly blade; this must not be mistaken for Source
      // knife asset parity.
      const root=new T.Group();root.name='Port_Generic_Knife';root.userData.approvedStaticWeapon=true;
      const blade=new T.Mesh(new T.BoxGeometry(.045,.12,.7),new T.MeshStandardMaterial({color:'#9da8ad',metalness:.8,roughness:.28}));
      blade.position.z=-.32;blade.rotation.y=.06;blade.castShadow=blade.receiveShadow=true;
      const grip=new T.Mesh(new T.CylinderGeometry(.055,.06,.3,8),new T.MeshStandardMaterial({color:'#20262a',roughness:.75}));
      grip.rotation.x=Math.PI/2;grip.position.z=.16;grip.castShadow=grip.receiveShadow=true;root.add(blade,grip);return root;
    }
    if(id==='awp'){const owner=this.sourceAWPViewmodels[team];if(!owner)throw Error('Original AWP team viewmodel did not load');return owner.createViewmodel();}
    if(id==='glock'||id==='usp'||id==='deagle'){const owner=(id==='deagle'?this.sourceDeagleViewmodels:id==='glock'?this.sourceGlockViewmodels:this.sourceUSPViewmodels)[team];if(!owner)throw Error('Original pistol team viewmodel did not load');return owner.createViewmodel();}
    if(id==='m4a4'){
      const owner=team==='blue'?this.sourceM4Viewmodel:this.sourceM4TViewmodel;
      if(!owner)throw Error('Original M4A4 team viewmodel did not load');
      return owner.createViewmodel();
    }
    if (id === 'vandal') {
      if(team==='blue'){
        if(!this.sourceCTViewmodel)throw Error('Original CT first-person arms did not load');
        return this.sourceCTViewmodel.createViewmodel();
      }
      return this.sourceTViewmodel?.createViewmodel()??null;
    }
    const asset = this.models.get(id);
    if (!asset) return null;
    const root = clone(asset.scene) as T.Group;
    root.name = `Approved_${id}`;
    root.userData.approvedStaticWeapon = true;
    root.userData.animationGaps = ['fitted_hands', 'reload'];
    return root;
  }
  releaseSourceWeapon(root:T.Group){
    if(root.userData.approvedStaticWeapon){this.release(root);return;}
    this.sourceSoundCursors.delete(root);
    this.sourcePistolSoundCursors.delete(root);
    this.sourceAWPSoundCursors.delete(root);
    if(isSourceAWPViewmodel(root)){this.sourceAWPViewmodels[root.userData.sourceArmsProfile==='ct_arms_idf'?'blue':'amber']?.disposeViewmodel(root);return;}
    if(isSourcePistolViewmodel(root)){const owners=root.userData.sourceWeapon==='deagle'?this.sourceDeagleViewmodels:root.userData.sourceWeapon==='usp'?this.sourceUSPViewmodels:this.sourceGlockViewmodels;owners[root.userData.sourceArmsProfile==='ct_arms_idf'?'blue':'amber']?.disposeViewmodel(root);return;}
    if(root.userData.sourceWeapon==='m4a4'){
      (root.userData.sourceArmsProfile==='ct_arms_idf'?this.sourceM4Viewmodel:this.sourceM4TViewmodel)?.disposeViewmodel(root);
    }
    else if(root.userData.sourceArmsProfile==='ct_arms_idf')this.sourceCTViewmodel?.disposeViewmodel(root);
    else if(root.userData.sourceArmsProfile==='t_arms')this.sourceTViewmodel?.disposeViewmodel(root);
    else disposeSourceViewmodel(root);
  }
  resetSourceWeaponPlayback(root:T.Group){if(isSourcePistolViewmodel(root)){resetSourcePistolPlayback(root);this.sourcePistolSoundCursors.delete(root);}if(isSourceAWPViewmodel(root)){resetSourceAWPPlayback(root);this.sourceAWPSoundCursors.delete(root);}}
  animateWeapon(root: T.Group, p: Player | undefined, kick: number, dt = 0,sourceRound=0) {
    if(isSourceAWPViewmodel(root)){
      const current=updateSourceAWPPlayback(root,p,dt,sourceRound).sound,timeline=awpAudio.weapons.awp.timeline as Record<string,{time:number;event:string}[]>;
      let cursors=this.sourceAWPSoundCursors.get(root);if(!cursors){cursors=new Map();this.sourceAWPSoundCursors.set(root,cursors);}
      const next=advanceSourceSoundEvents(cursors.get(current.key),current,current.events??timeline[current.pose]??[],{sourceCycleWindow:current.cycleWindow});
      cursors.set(current.key,next.cursor);while(cursors.size>8)cursors.delete(cursors.keys().next().value!);
      next.events.forEach(event=>event==='AE_CLIENT_EJECT_BRASS'?this.onSourceAWPBrass?.():this.onSourcePistolSound?.('awp',event));return;
    }
    if(isSourcePistolViewmodel(root)){
      const weapon=root.userData.sourceWeapon as 'glock'|'usp'|'deagle',current=updateSourcePistolPlayback(root,p,dt,sourceRound).sound,timeline=(weapon==='deagle'?deagleAudio.weapons.deagle.timeline:pistolAudio.weapons[weapon].timeline) as Record<string,{time:number;event:string}[]>;
      let cursors=this.sourcePistolSoundCursors.get(root);if(!cursors){cursors=new Map();this.sourcePistolSoundCursors.set(root,cursors);}
      const next=advanceSourceSoundEvents(cursors.get(current.key),current,current.events??timeline[current.pose]??[],{sourceCycleWindow:current.cycleWindow});
      cursors.set(current.key,next.cursor);while(cursors.size>8)cursors.delete(cursors.keys().next().value!);
      next.events.forEach(event=>this.onSourcePistolSound?.(weapon,event));return;
    }
    if(isSourceViewmodel(root)){
      updateSourceViewmodel(root,p,dt);
      {
        const current=sourceViewmodelPlayback(root);
        // What the local first-person rifle is playing, and the fire sequences its own
        // model gave it, so a shot's variant can be read rather than inferred.
        this.sourceRifleViewAudit={weapon:root.userData.sourceWeapon as string,pose:current.pose,time:current.time,generation:current.generation,
          shotIdle:p?.shotIdle??null,fireVariants:sourceViewmodelFireVariants(root).map(row=>({pose:row.pose,sequence:row.sequence,weight:row.weight}))};
        const timeline:Partial<Record<typeof current.pose,{time:number;event:string}[]>>=root.userData.sourceWeapon==='m4a4'?m4SoundTimeline:akSoundTimeline;
        const next=advanceSourceSoundEvents(this.sourceSoundCursors.get(root),current,timeline[current.pose]??[]);
        this.sourceSoundCursors.set(root,next.cursor);next.events.forEach(event=>this.onSourceSound?.(event));
      }
      return;
    }
    if (isFalconViewmodel(root)) {
      updateFalconViewmodel(root, {
        dt, kick, reloadRemaining: p?.reload ?? 0,
        reloadDuration: p ? WEAPONS[p.weapon].reload : 2.25,
      });
    }
    // Static P12/DMR sources have no authored animation; never merge inspection clips.
  }
  operator(p: Player) {
    if(this.sourceCharacter&&p.weapon==='awp'){const owner=this.sourceAWPCharacters[p.team];if(!owner)throw Error('Original AWP character did not load');const actor=owner.createActor();this.sourceAWPActors.set(actor.root,{actor,owner});Object.assign(actor.root.userData,{sourceCharacter:actor,sourceTeam:p.team,sourceWeaponId:p.weapon,assetRelease:owner.manifest.poseVersion,visualWeapon:WEAPONS[p.weapon].name,weaponPresentationMatches:true});owner.updateActor(actor,p);return actor.root;}
    if(this.sourceCharacter&&p.weapon==='deagle'){const owner=this.sourceDeagleCharacters[p.team];if(!owner)throw Error('Original Deagle character did not load');const actor=owner.createActor();this.sourceDeagleActors.set(actor.root,{actor,owner});Object.assign(actor.root.userData,{sourceCharacter:actor,sourceTeam:p.team,sourceWeaponId:p.weapon,assetRelease:owner.manifest.poseVersion,visualWeapon:WEAPONS[p.weapon].name,weaponPresentationMatches:true});owner.updateActor(actor,p);return actor.root;}
    if(this.sourceCharacter&&(p.weapon==='glock'||p.weapon==='usp')){
      const owner=(p.weapon==='glock'?this.sourceGlockCharacters:this.sourceUSPCharacters)[p.team];if(!owner)throw Error('Original pistol team character did not load');
      const actor=owner.createActor();this.sourcePistolActors.set(actor.root,{actor,owner});
      Object.assign(actor.root.userData,{sourceCharacter:actor,sourceTeam:p.team,sourceWeaponId:p.weapon,assetRelease:owner.manifest.poseVersion,visualWeapon:WEAPONS[p.weapon].name,weaponPresentationMatches:true});
      owner.updateActor(actor,p);return actor.root;
    }
    if(this.sourceCharacter){
      const owner=p.weapon==='m4a4'?(p.team==='blue'?this.sourceCTM4:this.sourceTM4):(p.team==='blue'?this.sourceCT:this.sourceCharacter);
      if(!owner)throw Error('Required original team character did not load');
      const actor=owner.createActor();this.sourceActors.set(actor.root,{actor,owner});
      actor.root.userData.sourceCharacter=actor;
      actor.root.userData.sourceTeam=p.team;
      actor.root.userData.sourceWeaponId=p.weapon;
      actor.root.userData.assetRelease=owner.manifest.poseVersion;
      actor.root.userData.visualWeapon=p.weapon==='m4a4'?'M4A4':'AK47';actor.root.userData.weaponPresentationMatches=p.weapon==='vandal'||p.weapon==='m4a4';
      owner.updateActor(actor,p);return actor.root;
    }
    const falcon = this.models.get('falconC02');
    if (falcon) return this.falconOperator(falcon, p);
    const asset = this.models.get('operator');
    if (!asset) return null;
    const root = new T.Group(),
      body = clone(asset.scene);
    body.name = 'OperatorBody';
    // Asset is authored in metres and faces +Z. Gameplay faces -Z.
    // Source root already converts centimetres to metres. Normalize once,
    // outside the animated rig; bind-pose boxes are not a scale contract.
    body.scale.setScalar(0.94);
    body.position.y = 0;
    body.rotation.y = Math.PI;
    root.add(body);
    body.traverse((o) => {
      if (o instanceof T.Mesh) {
        const originals = Array.isArray(o.material) ? o.material : [o.material];
        const materials = originals.map((m) => {
          const copy = m.clone() as T.MeshStandardMaterial;
          copy.color.multiply(
            new T.Color(p.team === 'amber' ? '#9d9174' : '#698994'),
          );
          copy.roughness = 0.8;
          copy.metalness = 0.05;
          return copy;
        });
        o.material = Array.isArray(o.material) ? materials : materials[0];
      }
    });
    const mixer = new T.AnimationMixer(body);
    const actions = new Map<string, T.AnimationAction>();
    for (const clip of asset.animations) {
      const key = clip.name.replace('soldier_', '');
      if (key === 'tpose') continue;
      const action = mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(key === 'idle' ? 1 : 0);
      action.play();
      if (key.startsWith('death')) {
        action.setLoop(T.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      actions.set(key, action);
    }
    root.userData.mixer = mixer;
    root.userData.actions = actions;
    root.userData.body = body;
    root.userData.dead = false;
    root.userData.baseY = body.position.y;
    const weaponAsset = this.models.get('vandal');
    if (weaponAsset) {
      const weapon = weaponAsset.scene.clone(true);
      const arms = weapon.getObjectByName('arms');
      arms?.removeFromParent();
      weapon.traverse((o) => {
        if (o instanceof T.SkinnedMesh) o.visible = false;
      });
      weapon.scale.setScalar(0.9);
      weapon.position.set(0.18, 1.14, -0.34);
      weapon.name = 'HeldWeapon';
      root.add(weapon);
    }
    return root;
  }
  private falconOperator(asset: GLTF, p: Player) {
    const root = new T.Group();
    const body = clone(asset.scene);
    shareEquivalentSkeletons(body);
    root.name = 'FalconC02Operator';
    root.position.set(p.x, p.y, p.z);
    root.rotation.y = p.yaw;
    body.name = 'FalconC02Body';
    // scene.ts owns root yaw/position. Rotate this outer scene container only:
    // glTF +Z character forward -> gameplay -Z, retaining metre scale and bone TRS.
    body.rotation.y = Math.PI;
    root.add(body);
    bindDeathPresentation(root, body);
    body.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o instanceof T.SkinnedMesh) o.frustumCulled = false;
      }
    });
    const mixer = new T.AnimationMixer(body);
    const actions = new Map<string, T.AnimationAction>();
    for (const clip of asset.animations) {
      const action = mixer.clipAction(clip);
      action.setLoop(T.LoopOnce, 1);
      action.clampWhenFinished = true;
      actions.set(clip.name, action);
    }
    const state: FalconState = { body, mixer, actions, current: '', idleTime: 0,
      pose: new FalconCombatPose(body) };
    root.userData.falconC02 = state;
    root.userData.mixer = mixer; // existing Art.updateActors dispatch contract
    root.userData.assetRelease = 'C02/c02-combat-actions-v1';
    root.userData.visualWeapon = 'W01_M4';
    root.userData.animationGaps = ['locomotion', 'jump', 'ADS', 'authored-death-or-ragdoll', 'reload-cancel-transition'];
    this.falconActors.add(root);
    this.animateFalcon(root, state, p, 0);
    return root;
  }
  private animateFalcon(root: T.Group, state: FalconState, p: Player, dt: number) {
    state.body.visible = true;
    root.userData.weaponPresentationMatches = false; // Original AK FP currently retains a C02/M4 third-person proxy.
    // Late-joining dead actors still need their initial authoritative stance/aim pose.
    // Once sampled, ordinary death updates freeze that complete original pose.
    if (!p.alive && state.current !== '') return;
    const idle = state.actions.get('Rifle_Idle')!;
    const fire = state.actions.get('Rifle_Fire')!;
    const reload = state.actions.get('Rifle_Reload')!;
    state.idleTime = (state.idleTime + Math.max(0, Math.min(dt, 0.1))) % idle.getClip().duration;
    let name = 'Rifle_Idle', time = state.idleTime;
    // Both clocks originate in Simulation, not input buttons or ammo guesses.
    // Other weapon types retain a W01 visual proxy; this is not a fitted pistol/SMG rig.
    if (p.reload > 0) {
      name = 'Rifle_Reload';
      time = T.MathUtils.clamp(1 - p.reload / WEAPONS[p.weapon].reload, 0, 1) * reload.getClip().duration;
    } else if (p.shotIdle >= 0 && p.shotIdle < fire.getClip().duration) {
      name = 'Rifle_Fire';
      time = p.shotIdle;
    }
    const action = state.actions.get(name)!;
    root.userData.poseReport = sampleFalconCombatPose(state.pose, () => {
      if (state.current !== name) {
        state.mixer.stopAllAction();
        action.reset().play();
        state.current = name;
      }
      action.paused = true;
      action.time = time;
      state.mixer.update(0);
    }, { yaw:p.yaw, pitch:p.pitch, crouch:characterBlend(p), grounded:p.grounded,
      stridePhase:p.stridePhase,strideWeight:p.strideWeight,strideSpeed:p.strideSpeed,
      strideX:p.strideX,strideZ:p.strideZ });
    markLivingPose(root);
    root.userData.sampledClip = name;
    root.userData.sampledClipTime = time;
    // The shared authority blend drives the original full rig; no local stance clock.
  }
  animateOperator(root: T.Group, p: Player, dt: number) {
    // Owners cache identical authority poses. Undo only last frame's visual
    // leg solve before asking the owner for this frame, otherwise repeated
    // snapshots accumulate the same slope tilt and height displacement.
    const previousIK=this.sourceFootRest.get(root);
    if(previousIK){for(const row of previousIK){row.bone.position.copy(row.position);row.bone.quaternion.copy(row.quaternion);row.bone.scale.copy(row.scale);}root.updateMatrixWorld(true);this.sourceFootRest.delete(root);}
    const awp=this.sourceAWPActors.get(root);
    if(awp){awp.owner.updateActor(awp.actor,p);this.applySourceFootIK(awp.owner.poseIndex.body,awp.actor.bodyBones,awp.actor.root,p.sourceAWPPose?.body,p,awp.owner.manifest.metersPerSourceUnit);return;}
    const deagle=this.sourceDeagleActors.get(root);
    if(deagle){deagle.owner.updateActor(deagle.actor,p);this.applySourceFootIK(deagle.owner.poseIndex.body,deagle.actor.bodyBones,deagle.actor.root,(p.sourcePistolPose as SourceDeagleCharacterPoseInput|undefined)?.body,p,deagle.owner.manifest.metersPerSourceUnit);return;}
    const pistol=this.sourcePistolActors.get(root);
    if(pistol){pistol.owner.updateActor(pistol.actor,p);this.applySourceFootIK(pistol.owner.poseIndex.body,pistol.actor.bodyBones,pistol.actor.root,p.sourcePistolPose?.body,p,pistol.owner.manifest.metersPerSourceUnit);return;}
    const source=this.sourceActors.get(root);
    if(source){source.owner.updateActor(source.actor,p);this.applySourceFootIK(source.owner.poseIndex,source.actor.characterBones,source.actor.root,p.sourcePose,p,source.owner.manifest.metersPerSourceUnit);return;}
    const falcon = root.userData.falconC02 as FalconState | undefined;
    if (falcon) {
      this.animateFalcon(root, falcon, p, dt);
      return;
    }
    const mixer = root.userData.mixer as T.AnimationMixer;
    const actions = root.userData.actions as Map<string, T.AnimationAction>;
    if (!mixer || !actions) return;
    const speed = Math.hypot(p.vx, p.vz);
    const localX = p.vx * Math.cos(p.yaw) - p.vz * Math.sin(p.yaw);
    const forward = -p.vx * Math.sin(p.yaw) - p.vz * Math.cos(p.yaw);
    const total = Math.max(0.001, Math.abs(localX) + Math.abs(forward));
    const move = p.grounded ? Math.min(1, speed / 2) : 0;
    const weights: Record<string, number> = {
      idle: 1 - move,
      forward: (Math.max(0, forward) / total) * move,
      backward: (Math.max(0, -forward) / total) * move,
      left: (Math.max(0, -localX) / total) * move,
      right: (Math.max(0, localX) / total) * move,
    };
    if (!p.alive && !root.userData.dead) {
      root.userData.dead = true;
      actions.get('death1')?.reset().play();
    } else if (p.alive && root.userData.dead) {
      root.userData.dead = false;
    }
    for (const [key, action] of actions) {
      const weight = p.alive ? (weights[key] ?? 0) : key === 'death1' ? 1 : 0;
      action.setEffectiveWeight(
        T.MathUtils.damp(action.getEffectiveWeight(), weight, 16, dt),
      );
      action.setEffectiveTimeScale(
        ['forward', 'backward', 'left', 'right'].includes(key)
          ? Math.max(0.45, speed / 3.6)
          : 1,
      );
    }
    mixer.update(dt);
    const body = root.userData.body as T.Object3D;
    body.position.y = root.userData.baseY - (p.crouch ? 0.38 : 0);
    const gun = root.getObjectByName('HeldWeapon');
    if (gun) {
      gun.visible = p.alive;
      gun.position.y = p.crouch ? 0.89 : 1.14;
      gun.rotation.x = p.pitch;
    }
  }
  /** The original foot IK of one rendered actor: the player animations declare a
   * GROUND rule per foot, and each foot follows the original collision's surface
   * under it while that rule's window is open. Every original weapon family shares
   * the same body rig, pose index and rule set, so one helper serves them all; on
   * flat ground the correction is exactly zero and the authored pose is untouched,
   * and without the shared rules or a surface query nothing runs at all. */
  private applySourceFootIK(index: SourceCharacterPoseIndex | undefined, bones: readonly T.Bone[] | undefined,
    root: T.Group, pose: SourceCharacterPoseInput | undefined, p: Player, metersPerSourceUnit: number) {
    const ground = this.resolveGround, rules = this.footIKRules;
    if (!p.alive || !ground || !rules || !index || !bones || !pose) return;
    const legs=[...new Set(sourceFootIKChains(index,rules,sourceFootIKTeam(index)).flatMap(chain=>[chain.hip,chain.knee,chain.foot]))]
      .map(slot=>bones[slot]).filter((bone):bone is T.Bone=>!!bone);
    const rest=legs.map(bone=>({bone,position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()}));
    const result = applySourceFootIK({ index, bones, rules, origin: { x: p.x, y: p.y, z: p.z },
      metersPerSourceUnit, ground,groundNormal:this.resolveGroundNormal??undefined, state: pose.state, cycle: pose.cycle, parameters: pose.parameters, blendMode: pose.blendMode });
    if (result.moved){this.sourceFootRest.set(root,rest);root.updateMatrixWorld(true);}
    // Reported for the LAN harness: the original rule windows the renderer found
    // open on this frame and the correction it used, in world metres.
    root.userData.sourceFootIK = { applied: result.applied, moved: result.moved, state: pose.state,
      deltas: result.chains.map(chain => +chain.delta.toFixed(5)) };
  }
  /** One original attachment of a rendered world weapon, in world space. The AWP,
   * Deagle and pistol rigs publish their world weapon's attachments; the rifle
   * character owner does not, so it reports null rather than a substitute. */
  sourceAttachment(root: T.Object3D, name: string): T.Matrix4 | null {
    const group = root as T.Group;
    const awp = this.sourceAWPActors.get(group); if (awp) return awp.owner.attachment(awp.actor, name);
    const deagle = this.sourceDeagleActors.get(group); if (deagle) return deagle.owner.attachment(deagle.actor, name);
    const pistol = this.sourcePistolActors.get(group); if (pistol) return pistol.owner.attachment(pistol.actor, name);
    const source = this.sourceActors.get(group); if (source) return source.owner.attachment(source.actor, name);
    return null;
  }
  /** The original magazine prop that left this actor's world weapon on the last
   * authoritative pose, if any. Dispatches to whichever original rig owns the
   * actor; a non-Source actor never drops one. */
  takeMagazineDrop(root: T.Object3D): SourceMagazineDropSource | null {
    const awp=this.sourceAWPActors.get(root as T.Group);if(awp)return awp.owner.takeMagazineDrop(awp.actor);
    const deagle=this.sourceDeagleActors.get(root as T.Group);if(deagle)return deagle.owner.takeMagazineDrop(deagle.actor);
    const pistol=this.sourcePistolActors.get(root as T.Group);if(pistol)return pistol.owner.takeMagazineDrop(pistol.actor);
    const source=this.sourceActors.get(root as T.Group);if(source)return source.owner.takeMagazineDrop(source.actor);
    return null;
  }
  updateDeath(root: T.Group, p: Player, dt: number) {
    // Source actors play the authoritative original Death1 corpse pose through
    // updateActor; the corpse stays visible until revival or round reset.
    if(this.sourceAWPActors.has(root))return true;
    if(this.sourceDeagleActors.has(root))return true;
    if(this.sourcePistolActors.has(root))return true;
    if(this.sourceActors.has(root))return true;
    const state = root.userData.falconC02 as FalconState | undefined;
    if (!state) return p.alive || p.respawn > .5;
    if (p.alive && !root.userData.deathPresentation) return true;
    const result = updateDeathPresentation(state.body, root, p.alive, dt);
    if (p.alive) delete root.userData.deathPresentation;
    else root.userData.deathPresentation = result;
    return result.visible;
  }
  release(root: T.Object3D) {
    root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const value of Object.values(m))
          if (value instanceof T.Texture) value.dispose();
        m.dispose();
      }
    });
  }
  releaseActor(actor: T.Group): boolean {
    this.sourceFootRest.delete(actor);
    const awp=this.sourceAWPActors.get(actor);if(awp){awp.owner.disposeActor(awp.actor);this.sourceAWPActors.delete(actor);delete actor.userData.sourceCharacter;return true;}
    const deagle=this.sourceDeagleActors.get(actor);if(deagle){deagle.owner.disposeActor(deagle.actor);this.sourceDeagleActors.delete(actor);delete actor.userData.sourceCharacter;return true;}
    const pistol=this.sourcePistolActors.get(actor);if(pistol){pistol.owner.disposeActor(pistol.actor);this.sourcePistolActors.delete(actor);delete actor.userData.sourceCharacter;return true;}
    const source=this.sourceActors.get(actor);
    if(source){source.owner.disposeActor(source.actor);this.sourceActors.delete(actor);delete actor.userData.sourceCharacter;return true;}
    if (!this.falconActors.delete(actor)) return false;
    const state = actor.userData.falconC02 as FalconState;
    unbindDeathPresentation(actor);
    state.pose.dispose();
    state.mixer.stopAllAction();
    state.mixer.uncacheRoot(state.body);
    const skeletons = new Set<T.Skeleton>();
    state.body.traverse(o => { if (o instanceof T.SkinnedMesh) skeletons.add(o.skeleton); });
    skeletons.forEach((skeleton) => skeleton.dispose());
    delete actor.userData.falconC02;
    delete actor.userData.mixer;
    delete actor.userData.poseReport;
    actor.removeFromParent();
    return true;
  }
  dispose() {
    this.disposed = true;
    this.sourceAbort.abort();for(const actor of [...this.sourceActors.keys()])this.releaseActor(actor);
    for(const actor of [...this.sourceDeagleActors.keys()])this.releaseActor(actor);
    Object.values(this.sourceDeagleCharacters).forEach(owner=>owner.dispose());this.sourceDeagleCharacters={};
    Object.values(this.sourceDeagleViewmodels).forEach(owner=>owner.dispose());this.sourceDeagleViewmodels={};
    for(const actor of [...this.sourceAWPActors.keys()])this.releaseActor(actor);
    Object.values(this.sourceAWPCharacters).forEach(owner=>owner.dispose());this.sourceAWPCharacters={};
    Object.values(this.sourceAWPViewmodels).forEach(owner=>owner.dispose());this.sourceAWPViewmodels={};
    for(const actor of [...this.sourcePistolActors.keys()])this.releaseActor(actor);
    Object.values(this.sourceGlockCharacters).forEach(owner=>owner.dispose());this.sourceGlockCharacters={};
    Object.values(this.sourceUSPCharacters).forEach(owner=>owner.dispose());this.sourceUSPCharacters={};
    Object.values(this.sourceUSPViewmodels).forEach(owner=>owner.dispose());this.sourceUSPViewmodels={};
    Object.values(this.sourceGlockViewmodels).forEach(owner=>owner.dispose());this.sourceGlockViewmodels={};
    this.sourceCharacter?.dispose();this.sourceCharacter=null;
    this.sourceCT?.dispose();this.sourceCT=null;
    this.sourceCTViewmodel?.dispose();this.sourceCTViewmodel=null;
    this.sourceTViewmodel?.dispose();this.sourceTViewmodel=null;
    this.sourceTM4?.dispose();this.sourceTM4=null;this.sourceCTM4?.dispose();this.sourceCTM4=null;
    this.sourceM4Viewmodel?.dispose();this.sourceM4Viewmodel=null;this.sourceM4TViewmodel?.dispose();this.sourceM4TViewmodel=null;
    for (const actor of [...this.falconActors]) this.releaseActor(actor);
    for (const asset of this.models.values()) this.release(asset.scene);
    this.models.clear();
    this.atlases.forEach((t) => t.dispose());
  }
}
