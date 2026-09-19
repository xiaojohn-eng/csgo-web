import { loadPortSeleneMap } from './port-selene';
import {loadSourceDust2} from './source-dust2';
import {SourceSkinnedBounds} from './source-skinned-bounds';
import {loadSourceLightingTrace} from './source-lighting-trace';
import {createSourceParticleLighting} from './source-particle-lighting';
import {loadSourceDroppedWeaponRenderer,setSourceHeldWeaponVisible} from './source-dropped-weapon-renderer';
import type {SourceDroppedWeaponState} from './source-dropped-weapons';
import {SOURCE_DUST2_ENVIRONMENT,environmentColor,environmentFogColor,environmentSunDirection,type SourceEnvironment} from './source-environment.js';
import {applySourceFog,sourceFogMaxDensity,type SourceFogState} from './source-fog.js';
import {createSourceProjectedShadows,type SourceProjectedShadowCaster,type SourceProjectedShadows} from './source-projected-shadows.js';
import { WorldComposite } from './world-composite';
import { eyeOrigin } from './character-contract.js';
import { isFalconViewmodel, updateFalconMuzzle, disposeFalconViewmodel, inspectFalconViewmodel } from './falcon-viewmodel';
import {isSourceViewmodel,startSourceInspection,cancelSourceInspection,sourceAttachment,inspectSourceViewmodel,startSourceDraw,hasSourceDraw} from './source-viewmodel';
import {isSourcePistolViewmodel,inspectSourcePistolViewmodel,sourcePistolAttachment} from './source-owned-pistol-viewmodel';
import {isSourceAWPViewmodel,inspectSourceAWPViewmodel,sourceAWPAttachment} from './source-awp-viewmodel';
import {startSourceAWPInspection,cancelSourceAWPInspection} from './source-awp-playback';
import {sourceAWPFov} from './source-awp-fov';
import {sourceAWPScaleFov} from './source-awp-scope';
import {SOURCE_AWP_SCOPE_TEXTURES} from './source-awp-scope-assets';
import {loadSourceAWPScopeRenderer} from './source-awp-scope-renderer';
import {sourceAWPInaccuracy,SOURCE_AWP_ACCURACY_PROFILES} from './source-awp-accuracy';
import {sourcePlayerAccuracyContext} from './source-player-handling';
import {sourcePistolFxAttachments,sourcePistolParticleSystemForShot} from './source-pistol-fx';
import {validSourceWeaponFinish,sourceWeaponFinishKey,type SourceFinishWeaponId,type SourceWeaponFinish} from './source-weapon-finish';
import type {SourceRedlineFinishOwner} from './source-redline-finish';
import {loadSourcePistolParticleRenderer} from './source-pistol-particles-renderer';
import {loadSourceRifleMuzzleRenderer} from './source-rifle-muzzle-renderer';
import {loadSourceAwpMuzzleRenderer} from './source-awp-muzzle-renderer';
import {loadSourceWeaponEffectMap,sourceWeaponEffects,type SourceWeaponEffectMap} from './source-weapon-effects';
import {SOURCE_PISTOL_WORLD_MUZZLE_SYSTEM,SOURCE_AWP_WORLD_MUZZLE_SYSTEM,SOURCE_WORLD_MUZZLE_ATTACHMENT,sourceWorldMuzzleFlash,sourceWorldMuzzleFlashSeeds,sourceWorldMuzzleTrigger,sourceWorldRifleMuzzleSeeds,sourceWorldAwpMuzzleSeeds,type SourceWorldMuzzleFlashCursor} from './source-world-muzzle-flash';
import {SOURCE_RIFLE_MUZZLE_ROOT,SOURCE_AWP_MUZZLE_ROOT} from './source-rifle-muzzle-particles';
import {sourceFirstPersonMuzzleSystem} from './source-first-person-muzzle';
import {startSourcePistolInspection,cancelSourcePistolInspection} from './source-pistol-playback';
import { smokeRadius, smokeBlocks, type Smoke } from './tactics';
import { buildPortDetails } from './environment';
import { GameAssets } from './assets';
import { applyWeaponSkin, disposeWeaponSkin, validSkinId, type SkinId } from './skins';
import { WeaponInspect } from './weapon-inspect';
import { CombatEffects } from './combat-effects';
import { SourceMagazineDrops, SOURCE_MAGAZINE_DROP_BUDGET } from './source-magazine-drop';
import {loadSourceImpactDecals,type SourceImpactDecals,type SourceImpactOutcome} from './source-impact-decals';
import {SOURCE_IMPACT_BUILD,sourceImpactDraws} from './source-impact-table';
import {loadSourceShellCasings,type ShellTrace,type SourceShellCasings} from './source-shell-casings';
import {loadSourceSun} from './source-sun';
import {loadSourceGrenadeSmokeRenderer} from './source-grenade-smoke-renderer';
import {sourceAWPWorldBrass,sourceBrassDraws,type SourceWorldBrassCursor} from './source-world-brass';
import {SourceViewmodelShadow} from './source-viewmodel-shadow';
import {loadSourceGrenadeModels,type SourceGrenadeModels} from './source-grenade-models';
import {SourceAutoExposure} from './source-autoexposure';
import {loadSourceEnvCubemaps} from './source-env-cubemaps';
import {loadSourceTracers,type SourceTracerOutcome,type SourceTracers} from './source-tracers';
import { recoilOffset } from './handling';
import {sourceBrowserCameraBasis} from './source-aim';
import type {SourcePunchState} from './source-punch';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOXES, SITES } from './map';
import type { Player, WeaponId,Team,GrenadeSnapshot } from './types';
/** One sprite one of the viewmodel-scene flash renderers wrote: where it was drawn, how big
 * and how bright, and the anchor and forward axis of the burst it belongs to, so a row can
 * be measured against the muzzle it was actually drawn at rather than the latest one. */
type SourceViewSpriteRow={id:number;age:number;position:number[];radius:number;alpha:number;
  anchor:number[];forward:number[];rotation?:number;color?:number[];distance?:number};
/** Dust2's own fog: the map's colour, range and cap, on the original's linear ramp. */
const SOURCE_DUST2_FOG: SourceFogState={color:environmentFogColor(SOURCE_DUST2_ENVIRONMENT),
  nearMetres:SOURCE_DUST2_ENVIRONMENT.fog.nearMetres,farMetres:SOURCE_DUST2_ENVIRONMENT.fog.farMetres,
  maxDensity:SOURCE_DUST2_ENVIRONMENT.fog.maxDensity,from:'map env_fog_controller'};
/** The port's own smoke is a sprite cloud, not the original's particle volume; while the camera
 * is inside one it stands in for the view being filled, which is a full-strength wash. */
const PORT_SMOKE_FOG: SourceFogState={color:'#91988f',nearMetres:0,farMetres:1.2,maxDensity:1,from:'port smoke'};
/** How far the key light sits from its own target. The shadow camera's near/far were chosen for
 * this distance, so the map's sun direction replaces the offset's direction and keeps its length. */
const SOURCE_SUN_DISTANCE=Math.hypot(30,48,15);
export class Art {
  assets = new GameAssets();
  ready: Promise<void>;
  disposed = false;
  portMap: Awaited<ReturnType<typeof loadPortSeleneMap>> | null = null;
  sourceMap: Awaited<ReturnType<typeof loadSourceDust2>> | null = null;
  /** Everything Dust2 states about its own light, haze and exposure. Validated at import from
   * the generated table; see game/source-environment.ts. */
  readonly sourceEnvironment: SourceEnvironment = SOURCE_DUST2_ENVIRONMENT;
  /** The map's fog state, and the port's own smoke state, both on the original's ramp. */
  sourceFogState: SourceFogState = SOURCE_DUST2_FOG;
  /** Which of those two the last frame was drawn with. */
  private sourceFogApplied: SourceFogState = SOURCE_DUST2_FOG;
  /** The original bullet-hole decals a shot leaves on the world, and the surface table
   * that decides which one. Null until the map's own sheets have been verified. */
  sourceImpacts: SourceImpactDecals | null = null;
  /** The map's own projected shadows, and the radii its silhouettes are sampled at. */
  sourceProjectedShadows: SourceProjectedShadows | null = null;
  private shadowRadii = new WeakMap<T.Object3D, number>();
  /** The original shell casings the weapons eject on every shot, drawn at the weapon's own
   * shell-eject attachment. Null until the shipped models have been verified. */
  sourceShells: SourceShellCasings | null = null;
  /** The original tracers, drawn along each shot's own line. Null until the shipped spark
   * texture has been verified. */
  sourceTracers: SourceTracers | null = null;
  /** The level's own answer for one casing's step. `Collision via traces` collides with the
   * world's brushes, so a casing that meets a wall is answered by the wall rather than flying
   * through it; the same trace the decals and the bullets make, against the shipped BSP. The
   * runtime supplies it from the original level, so it is null until that level exists. */
  sourceShellTrace: ShellTrace | null = null;
  sourceVisibility: ReturnType<Awaited<ReturnType<typeof loadSourceDust2>>['updateVisibility']> | null = null;
  sourceSkyView:ReturnType<Awaited<ReturnType<typeof loadSourceDust2>>['updateSky']>|null=null;
  private mapAbort = new AbortController();
  resolveEye: (p:Player)=>{x:number;y:number;z:number} = eyeOrigin;
  /** The original collision's surface under a world column, when the runtime can
   * supply one (it owns the original level used for prediction). Presentation
   * props that fall sample it instead of a single spawn-time plane. */
  resolveGround: ((x:number,z:number,fromY:number)=>number|null) | null = null;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(78, 1, 0.08, 450);
  sourceViewAudit:{yaw:number;pitch:number;punch:SourcePunchState}|null=null;
  /** The local first-person rifle's own playback, and the fire sequences its model carries:
   * read-only evidence of which variant a shot drew, mirrored from the assets layer. */
  sourceRifleViewAudit:{weapon:string;pose:string;time:number;generation:number;shotIdle:number|null;
    fireVariants:{pose:string;sequence:string;weight:number}[]}|null=null;
  private sourceWindGeneration=0;
  private sourceWindEpoch='';
  private sourceWindTime=0;
  private sourceDrawActorKey:string|null=null;
  private sourceViewMatrix=new T.Matrix4();
  private sourceViewRight=new T.Vector3();
  private sourceViewUp=new T.Vector3();
  private sourceViewBack=new T.Vector3();
  renderer: T.WebGLRenderer;
  worldComposite = new WorldComposite();
  gunScene = new T.Scene();
  effects = new CombatEffects(this.scene, this.gunScene);
  /** Original magazines that left a reloading weapon, drawn with the original
   * magazine geometry the character asset owner already loaded. */
  magazineDrops = new SourceMagazineDrops(this.scene);
  gunCamera = new T.PerspectiveCamera(62, 1, 0.015, 10);
  gun = new T.Group();
  gunId: WeaponId = 'vandal';
  gunTeam:Team='amber';
  weaponCache = new Map<WeaponId, T.Group>();
  private ejectionPorts = new Map<WeaponId, T.Mesh>();
  skin: SkinId = 'default';
  sourceWeaponFinish:SourceWeaponFinish|null=null;
  // One owner per weapon, because a weapon's own sampled textures are fixed when its
  // compositor is built. A weapon with no finish selected never builds one. The ready map
  // holds the ones that have resolved, so an already-dressed root is restored without
  // waiting a microtask.
  private sourceFinishOwners=new Map<string,Promise<SourceRedlineFinishOwner>>();
  private sourceFinishReady=new Map<string,SourceRedlineFinishOwner>();
  private sourceFinishRequests=new Map<T.Object3D,{key:string;status:'default'|'loading'|'ready'|'error';error?:string}>();
  inspection = new WeaponInspect();
  grenadeMeshes = new Map<number, T.Group|T.Mesh>();
  private sourceGrenadeModels:SourceGrenadeModels|null=null;
  private sourceActorBounds=new SourceSkinnedBounds();
  private sourceParticleLighting:ReturnType<typeof createSourceParticleLighting>|null=null;
  private sourceLightingTrace:Awaited<ReturnType<typeof loadSourceLightingTrace>>|null=null;
  private sourceLightingEpoch=0;
  sourceParticleLightingReady:Promise<void>=Promise.resolve();
  sourceParticleLightingError:string|null=null;
  private sourceDroppedWeapons:Awaited<ReturnType<typeof loadSourceDroppedWeaponRenderer>>|null=null;
  private sourceProbes:Awaited<ReturnType<typeof loadSourceEnvCubemaps>>|null=null;
  private sourceProbeBindings:ReturnType<Awaited<ReturnType<typeof loadSourceEnvCubemaps>>['bindScene']>[]=[];
  smokeMeshes = new Map<number, T.Group>();
  clouds: Smoke[] = [];
  private sourceGrenadeSmoke:Awaited<ReturnType<typeof loadSourceGrenadeSmokeRenderer>>|null=null;
  private sourceGrenadeSmokeFrame:ReturnType<Awaited<ReturnType<typeof loadSourceGrenadeSmokeRenderer>>['update']>|null=null;
  private sourceSmokeRound:number|null=null;
  private sourceViewmodelShadow:SourceViewmodelShadow|null=null;
  smokeMaterial: T.SpriteMaterial | null = null;
  sun: T.DirectionalLight;
  weaponSun: T.DirectionalLight;
  /** The ambient fill of each lit scene. The original's map states its own colour. */
  ambient: T.HemisphereLight;
  gunAmbient: T.HemisphereLight;
  /** Where the key light sits relative to its own target: the map's sun direction, kept as an
   * offset so the target can follow the view without the direction drifting. */
  private sunOffset = new T.Vector3(-30, 48, 15);
  private inverseView = new T.Quaternion();
  private environmentOrientation = new T.Quaternion();
  private lightingDirection = new T.Vector3();
  actors = new Map<string, T.Group>();
  batches = new Map<T.Material, T.BufferGeometry[]>();
  materials: T.Material[] = [];
  textures: T.Texture[] = [];
  geometries: T.BufferGeometry[] = [];
  muzzle = new T.Group();
  private sourceAWPScope:Awaited<ReturnType<typeof loadSourceAWPScopeRenderer>>|null=null;
  private sourceAWPScopeKey='';
  private sourceAWPBrass=0;
  private sourceAWPProjection:{referenceFov:number;horizontalFov:number;verticalFov:number;aspect:number}|null=null;
  private sourcePistolParticles:Awaited<ReturnType<typeof loadSourcePistolParticleRenderer>>|null=null;
  /** The same original pistol muzzle graph, but anchored in the world so other
   * players' weapons can show the original third-person flash. */
  private sourceWorldPistolParticles:Awaited<ReturnType<typeof loadSourcePistolParticleRenderer>>|null=null;
  /** The original rifle third-person flash (`weapon_muzzle_flash_assaultrifle`),
   * a different original system with its own graph, material and texture. */
  private sourceWorldRifleParticles:Awaited<ReturnType<typeof loadSourceRifleMuzzleRenderer>>|null=null;
  /** The AWP's own third-person dispatcher: the hunting rifle's continuous flame and
   * that flame's glow, a different original chain with its own graph and textures. */
  private sourceWorldAwpParticles:Awaited<ReturnType<typeof loadSourceAwpMuzzleRenderer>>|null=null;
  /** The rifle family's own system, in the viewmodel's own scene and anchored on the
   * viewmodel's own muzzle attachment: the shooter's own first-person flash. It is the same
   * shipped name the world instance draws, as a separate program. */
  private sourceViewRifleParticles:Awaited<ReturnType<typeof loadSourceRifleMuzzleRenderer>>|null=null;
  private sourceViewRifleBursts=0;
  private sourceViewRifleVentSprites=0;
  private sourceViewRifleGlowSprites=0;
  private sourceViewRifleFlameSprites=0;
  private sourceViewRifleContinuousSprites=0;
  /** Each kept frame carries the anchor and forward axis of the burst its own rows were
   * drawn for, so a row can be measured against the muzzle it was actually drawn at. */
  private sourceViewRifleFrames:{vent:SourceViewSpriteRow[];glow:SourceViewSpriteRow[];
    flame:SourceViewSpriteRow[];continuous:SourceViewSpriteRow[];bursts:number}[]=[];
  private sourceViewRifleLast:{at:number[];forward:number[];shooter:string;weapon:WeaponId;shot:number;
    system:string;attachment:string}|null=null;
  /** The same original AWP system, but in the viewmodel's own scene and anchored on the
   * viewmodel's own muzzle attachment: this is the shooter's own first-person flash. The
   * world instance above is what other players see, and the two are separate programs. */
  private sourceViewAwpParticles:Awaited<ReturnType<typeof loadSourceAwpMuzzleRenderer>>|null=null;
  private sourceViewAwpBursts=0;
  private sourceViewAwpFlameSprites=0;
  private sourceViewAwpGlowSprites=0;
  /** The frames this instance actually drew inside the viewmodel scene, each with the
   * sprites it wrote, so what was drawn can be read back rather than assumed. A frame is
   * kept only when it drew something, and only the last few are. */
  private sourceViewAwpFrames:{flame:SourceViewSpriteRow[];glow:SourceViewSpriteRow[];bursts:number}[]=[];
  private sourceViewAwpLast:{at:number[];forward:number[];shooter:string;weapon:WeaponId;shot:number;
    system:string;attachment:string}|null=null;
  private sourceWeaponEffects:SourceWeaponEffectMap|null=null;
  private sourceWorldMuzzleCursors=new Map<T.Object3D,SourceWorldMuzzleFlashCursor>();
  private sourceWorldPistolBursts=0;
  private sourceWorldRifleBursts=0;
  /** The original rifle system's glow and flame sprites: the running total each
   * subsystem has drawn, plus what the most recent frame drew. */
  private sourceWorldRifleGlowSprites=0;
  private sourceWorldRifleGlowFrame=0;
  private sourceWorldRifleFlameSprites=0;
  private sourceWorldRifleFlameFrame=0;
  /** The dispatcher's other flame (`..._assualtrifle_flame`), its own original system. */
  private sourceWorldRifleContinuousSprites=0;
  private sourceWorldAwpBursts=0;
  private sourceWorldAwpFlameSprites=0;
  private sourceWorldAwpGlowSprites=0;
  private sourceWorldMuzzleReasons:Record<string,number>={};
  private sourceWorldLastBurst:{at:number[];shooter:string;weapon:string;system:string;shot:number}|null=null;
  /** Shots the actor pass published for the frame being rendered. The original
   * emits and samples on one clock; this client advances the clock inside
   * `frame()`, so a shot published before it would be stamped one frame early and
   * a subsystem whose original life is shorter than a frame (the rifle glow is
   * 0.015 s) would expire between the actor pass and the render that draws it.
   * The emission is therefore deferred to the render tick that samples it, the
   * same way the first-person pistol flash already is. */
  private pendingWorldMuzzleShots:({position:T.Vector3;forward:T.Vector3;up:T.Vector3;seeds:{main:number;core:number}}
    |{position:T.Vector3;forward:T.Vector3;up:T.Vector3;seeds:{vent:number}}
    |{position:T.Vector3;forward:T.Vector3;up:T.Vector3;seeds:{awp:number}})[]=[];
  /** Every weapon family's own first-person flash, queued by the accepted shot. The
   * pistol's own field is drawn by `sourcePistolParticles` in the viewmodel scene; the
   * AWP's own system by a second instance of `weapon_muzzle_flash_awp`, in the same
   * scene, anchored on the viewmodel's own muzzle attachment. */
  private pendingFirstPersonFlashes:{weapon:WeaponId;mode:number;shot:number;shooter:string}[]=[];
  private sourcePistolParticleBursts=0;
  private sourceWorldBrassCursors=new WeakMap<T.Group,SourceWorldBrassCursor>();
  private sourceWorldBrassCount=0;
  /** The original third-person muzzle flash: other players see it on their world
   * weapon, at the weapon's own `muzzle_flash` attachment, driven by their
   * authoritative fire pose and the original per-weapon system. The shooter's own
   * first-person system is a separate original choice and is never reused here. */
  private fireWorldMuzzleFlash(root:T.Group,p:Player){
    const map=this.sourceWeaponEffects;
    // The fire state of whichever original rig owns this actor, in the form that
    // rig publishes it, so every weapon family is observed even when its original
    // effect is not staged.
    const trigger=sourceWorldMuzzleTrigger(p.weapon,p);
    if(!map||!trigger)return;
    const decision=sourceWorldMuzzleFlash(trigger,sourceWeaponEffects(map,p.weapon),
      p.weapon==='usp'&&p.sourceUSP?.command.silencerAttached===true,this.sourceWorldMuzzleCursors.get(root));
    this.sourceWorldMuzzleCursors.set(root,decision.cursor);
    let brass=decision.shot&&p.weapon!=='awp';
    if(p.weapon==='awp'){
      const event=sourceAWPWorldBrass(p,this.sourceWorldBrassCursors.get(root));brass=event.fire;
      if(event.cursor)this.sourceWorldBrassCursors.set(root,event.cursor);else this.sourceWorldBrassCursors.delete(root);
    }
    if(brass&&this.sourceShells){
      const shell=this.assets.sourceAttachment(root,'shell_eject');
      if(shell&&this.sourceShells.spawn(p.weapon,shell,sourceBrassDraws(p.id,decision.cursor.shots)).spawned)this.sourceWorldBrassCount++;
    }
    if(decision.shot)this.sourceWorldMuzzleReasons[decision.reason]=(this.sourceWorldMuzzleReasons[decision.reason]??0)+1;
    if(!decision.system)return;
    // Each original system keeps its own staged graph, material and texture; a
    // shot draws only with the renderer of its own original system.
    const pistol=decision.system===SOURCE_PISTOL_WORLD_MUZZLE_SYSTEM?this.sourceWorldPistolParticles:null;
    const rifle=decision.system===SOURCE_RIFLE_MUZZLE_ROOT?this.sourceWorldRifleParticles:null;
    const awp=decision.system===SOURCE_AWP_WORLD_MUZZLE_SYSTEM?this.sourceWorldAwpParticles:null;
    if(!pistol&&!rifle&&!awp)return;
    const matrix=this.assets.sourceAttachment(root,SOURCE_WORLD_MUZZLE_ATTACHMENT);
    if(!matrix)return;
    const position=new T.Vector3().setFromMatrixPosition(matrix);
    const forward=new T.Vector3(1,0,0).transformDirection(matrix);
    // The AWP's chain sweeps its flame along the effect's local axes, so it is given the
    // attachment's own up axis as well and does not have to assume the world's.
    const up=new T.Vector3(0,1,0).transformDirection(matrix);
    // The emission itself happens in the render tick, so the original subsystem is
    // sampled at its own emission instant rather than a frame later.
    if(pistol)this.pendingWorldMuzzleShots.push({position,forward,up,seeds:sourceWorldMuzzleFlashSeeds(p.id,decision.cursor.shots)});
    else if(rifle)this.pendingWorldMuzzleShots.push({position,forward,up,seeds:sourceWorldRifleMuzzleSeeds(p.id,decision.cursor.shots)});
    else this.pendingWorldMuzzleShots.push({position,forward,up,seeds:sourceWorldAwpMuzzleSeeds(p.id,decision.cursor.shots)});
    // Evidence for the LAN harness: where the flash was anchored, which original
    // system drew it and which shot of that shooter it belongs to.
    this.sourceWorldLastBurst={at:[+position.x.toFixed(4),+position.y.toFixed(4),+position.z.toFixed(4)],shooter:p.id,
      weapon:p.weapon,system:decision.system,shot:decision.cursor.shots};
  }
  private sourcePistolParticleCurrent:ReturnType<Awaited<ReturnType<typeof loadSourcePistolParticleRenderer>>['update']>|null=null;
  private sourcePistolParticleFrames:ReturnType<Awaited<ReturnType<typeof loadSourcePistolParticleRenderer>>['update']>[]=[];
  sourcePistolFx: {version:string;weapon:string;muzzleAttachment:string;muzzlePosition:number[];muzzleForward:number[];shellAttachment:string;particleRenderer:string}|null=null;
  clock = 0;
  kick = 0;
  damage = 0;
  hit = 0;
  quality = 'high';
  tracers: { mesh: T.Mesh; life: number }[] = [];
  debris: { mesh: T.Mesh; life: number; v: T.Vector3 }[] = [];
  constructor(public canvas: HTMLCanvasElement, public originalDust2 = false) {
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    if(originalDust2)this.worldComposite.autoExposure=new SourceAutoExposure(this.sourceEnvironment.tonemap,.98);
    this.renderer.info.autoReset = false;
    const pmrem = new T.PMREMGenerator(this.renderer);
    const studio = new RoomEnvironment();
    const env = pmrem.fromScene(studio, 0.04).texture;
    this.scene.environment = env;
    this.gunScene.environment = env;
    this.scene.environmentIntensity = 0.45;
    this.gunScene.environmentIntensity = 0.75;
    this.textures.push(env);
    studio.dispose();
    pmrem.dispose();
    this.scene.background = new T.Color('#90a9b7');
    this.scene.fog = new T.FogExp2('#95acb7', 0.008);
    // Keep the sun as the key light; excessive ambient fill erases surface depth. The port's own
    // map keeps these; the original map replaces the colours and the direction with what it
    // states for itself (`applyMapLighting`).
    this.ambient = new T.HemisphereLight('#cfdef0', '#6e634c', 0.35);
    this.scene.add(this.ambient);
    this.sun = new T.DirectionalLight('#ffdfb3', 3.1);
    this.sun.position.set(-30, 48, 15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -42,
      right: 42,
      top: 42,
      bottom: -42,
      near: 1,
      far: 130,
    });
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.015;
    this.scene.add(this.sun);
    // The light's own target has to be in the graph, because the port moves it every frame to
    // keep the shadow volume on the view the way the original's does.
    this.scene.add(this.sun.target);
    this.gunAmbient = new T.HemisphereLight('#cfdef0', '#6e634c', 0.35);
    this.gunScene.add(this.gunAmbient);
    this.weaponSun = new T.DirectionalLight('#ffdfb3', this.sun.intensity);
    this.weaponSun.castShadow = true;
    this.weaponSun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.weaponSun.shadow.camera, {left:-1.2,right:1.2,top:1.2,bottom:-1.2,near:0.1,far:8});
    this.weaponSun.shadow.bias = -0.0001;
    this.weaponSun.shadow.normalBias = 0.001;
    this.weaponSun.target.position.set(0, -0.35, -0.65);
    this.gunScene.add(this.weaponSun, this.weaponSun.target);
    this.gunScene.add(this.gun);
    this.assets.onSourceAWPBrass=()=>{
      const model=this.weaponCache.get(this.gunId);
      if(!model||!isSourceAWPViewmodel(model))return;
      // The bolt-action's own ejection moment, spent on the system the weapon's own
      // `eject_brass_effect` names: `weapon_shell_casing_50cal`'s model, falling under its own
      // gravity and drag, spinning at its own rates and answered by its own collision response.
      // The port's own brass is only for when that system is not staged.
      const attachment=sourceAWPAttachment(model,'2',this.gunScene);
      if(this.sourceShells&&this.sourceShells.table.weapons.awp){
        this.sourceShells.spawn('awp',new T.Matrix4().multiplyMatrices(this.camera.matrixWorld,attachment),
          [Math.random(),Math.random(),Math.random()]);
        this.sourceAWPBrass++;
        return;
      }
      this.effects.eject(attachment);this.sourceAWPBrass++;
    };
    const flashMaterial = new T.MeshBasicMaterial({
      color: '#ffe4a0',
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.materials.push(flashMaterial);
    const flash = this.mesh(
      new T.ConeGeometry(0.055, 0.23, 6),
      flashMaterial,
      0,
      0,
      0,
      this.muzzle,
    );
    flash.rotation.x = -Math.PI / 2;
    this.gun.add(this.muzzle);
    this.muzzle.visible = false;
    // The approved map is required; no legacy procedural map is drawn while loading.
    this.setWeapon('vandal');
    this.resize();
    this.ready = Promise.all([
      this.assets.load(originalDust2),
      originalDust2?loadSourceAWPScopeRenderer(SOURCE_AWP_SCOPE_TEXTURES,'/source/csgo-12426148/awp-scope',this.mapAbort.signal).then(scope=>{
        if(this.disposed){scope.dispose();return;}this.sourceAWPScope=scope;
      }):Promise.resolve(),
      originalDust2?loadSourcePistolParticleRenderer('/source/csgo-12426148/pistol-particles/',{signal:this.mapAbort.signal}).then(fx=>{
        if(this.disposed){fx.dispose();return;}this.sourcePistolParticles=fx;this.gunScene.add(fx.group);
      }):Promise.resolve(),
      originalDust2?loadSourcePistolParticleRenderer('/source/csgo-12426148/pistol-particles/',{signal:this.mapAbort.signal}).then(fx=>{
        if(this.disposed){fx.dispose();return;}this.sourceWorldPistolParticles=fx;this.scene.add(fx.group);
      }):Promise.resolve(),
      originalDust2?loadSourceRifleMuzzleRenderer('/source/csgo-12426148/muzzle-particles/',{signal:this.mapAbort.signal}).then(fx=>{
        if(this.disposed){fx.dispose();return;}this.sourceWorldRifleParticles=fx;this.scene.add(fx.group);
      }):Promise.resolve(),
      originalDust2?loadSourceRifleMuzzleRenderer('/source/csgo-12426148/muzzle-particles/',{signal:this.mapAbort.signal}).then(fx=>{
        if(this.disposed){fx.dispose();return;}this.sourceViewRifleParticles=fx;this.gunScene.add(fx.group);
      }):Promise.resolve(),
      originalDust2?loadSourceAwpMuzzleRenderer('/source/csgo-12426148/muzzle-particles/',{signal:this.mapAbort.signal}).then(fx=>{
        if(this.disposed){fx.dispose();return;}this.sourceWorldAwpParticles=fx;this.scene.add(fx.group);
      }):Promise.resolve(),
      originalDust2?loadSourceAwpMuzzleRenderer('/source/csgo-12426148/muzzle-particles/',{signal:this.mapAbort.signal}).then(fx=>{
        if(this.disposed){fx.dispose();return;}this.sourceViewAwpParticles=fx;this.gunScene.add(fx.group);
      }):Promise.resolve(),
      originalDust2?loadSourceWeaponEffectMap({signal:this.mapAbort.signal}).then(map=>{
        if(this.disposed)return;this.sourceWeaponEffects=map;
      }):Promise.resolve(),
      originalDust2?loadSourceShellCasings({build:SOURCE_IMPACT_BUILD,signal:this.mapAbort.signal}).then(shells=>{
        if(this.disposed){shells.dispose();return;}this.sourceShells=shells;this.scene.add(shells.group);
      }):Promise.resolve(),
      originalDust2?loadSourceGrenadeModels({signal:this.mapAbort.signal}).then(models=>{
        if(this.disposed){models.dispose();return;}this.sourceGrenadeModels=models;
      }):Promise.resolve(),
      originalDust2?loadSourceDroppedWeaponRenderer(undefined,{signal:this.mapAbort.signal,
        onCreate:(root,state)=>this.applySourceFinish(root,state.sourceWeaponFinish??null),
        onRemove:root=>this.releaseSourceFinish(root),
      }).then(owner=>{if(this.disposed){owner.dispose();return;}this.sourceDroppedWeapons=owner;this.scene.add(owner.group);}):Promise.resolve(),
      originalDust2?loadSourceEnvCubemaps('/source/csgo-12426148/environment-probes',this.mapAbort.signal).then(probes=>{
        if(this.disposed){probes.dispose();return;}this.sourceProbes=probes;
        this.sourceProbeBindings=[probes.bindScene(this.scene),probes.bindScene(this.gunScene,{worldCamera:()=>this.camera})];
        this.bindSourceRopeLighting();
      }):Promise.resolve(),
      originalDust2?loadSourceSun(this.sourceEnvironment,this.mapAbort.signal).then(sun=>{
        if(this.disposed){sun.dispose();return;}this.worldComposite.sun=sun;
      }):Promise.resolve(),
      originalDust2?loadSourceGrenadeSmokeRenderer(undefined,{signal:this.mapAbort.signal}).then(smoke=>{
        if(this.disposed){smoke.dispose();return;}this.sourceGrenadeSmoke=smoke;this.scene.add(smoke.group);
        this.worldComposite.softParticles.sceneColor=binding=>smoke.setSceneColor(binding);
      }):Promise.resolve(),
      originalDust2?loadSourceTracers({build:SOURCE_IMPACT_BUILD,signal:this.mapAbort.signal}).then(tracers=>{
        if(this.disposed){tracers.dispose();return;}this.sourceTracers=tracers;this.scene.add(tracers.group);
      }):Promise.resolve(),
      originalDust2 ? loadSourceDust2({signal:this.mapAbort.signal,sky:true,enablePropBatch:!new URLSearchParams(globalThis.location?.search??'').has('nobatch'),enablePlainPropBatch:!new URLSearchParams(globalThis.location?.search??'').has('noplainbatch'),enableWorldBatch:!new URLSearchParams(globalThis.location?.search??'').has('noworldbatch'),enableSkyBatch:!new URLSearchParams(globalThis.location?.search??'').has('noskybatch'),propLighting:{maxTextureSize:this.renderer.capabilities.maxTextureSize,enablePlainUnbumped:true,enableDecalMultiply:true,enableTintMask:true,enableTintDecal:true,enableStructuralTint:true,enableOlive:true}}).then(async map=>{
        if(this.disposed){map.dispose();return;}
        this.sourceMap=map;this.scene.add(map.root);
        this.bindSourceRopeLighting();
        this.scene.background=new T.Color('#d5cbac');
        // The map states its own fog; the scene fades with the original's ramp, not three's
        // smoothstep, and the cap comes from the map. See game/source-fog.ts.
        this.applyMapFog();
        // And its own sun and ambient, for every lit scene it feeds. See game/source-environment.ts.
        this.applyMapLighting();
        if(map.sky){
          map.sky.scene.background=new T.Color('#d5cbac');
          // Remaining legacy-material sky props share the current world lights.
          // Original unlit dome materials and baked VHV do not use these lights. The clone's own
          // target never enters the sky scene's graph, so its direction is set by its position
          // alone: putting it on the map's own sun axis lights those props from the map's sun
          // rather than from wherever the player's view happens to be.
          const sun=this.sun.clone();sun.castShadow=false;
          sun.position.copy(this.sunOffset);
          map.sky.scene.add(sun,new T.HemisphereLight(this.gunAmbient.color,this.gunAmbient.groundColor,
            this.gunAmbient.intensity));
        }
        this.camera.far=1000;
        this.camera.updateProjectionMatrix();
        // The decal sheets are verified against the receipt they ship with, and the table
        // against this exact map, before a single shot can leave a mark.
        const impacts=await loadSourceImpactDecals({build:SOURCE_IMPACT_BUILD,
          sourceBspSha256:map.level.sourceBspSha256,metresPerSourceUnit:map.level.metersPerSourceUnit,
          signal:this.mapAbort.signal});
        if(this.disposed){impacts.dispose();return;}
        this.sourceImpacts=impacts;this.scene.add(impacts.group);
        // The original fades a decal out as the map's fog thickens, measured as the distance from
        // the eye. It takes the map's own fog - not the wash this port stands in for smoke - so the
        // decal keeps the state the map states even while the camera is inside a cloud.
        impacts.applyFog(this.sourceFogState);
        // And the map's own shadows: this map declares no cascade light, so the original casts no
        // shadow along the sun - every actor's shadow is a silhouette projected straight down by
        // `shadow_control`. The renderer's own sun shadow therefore comes off for this map.
        this.sun.castShadow=false;
        this.sourceProjectedShadows=createSourceProjectedShadows({
          renderer:this.renderer,scene:this.scene,environment:this.sourceEnvironment,
          metresPerSourceUnit:map.level.metersPerSourceUnit,
          ground:(x,z,fromY)=>this.resolveGround?.(x,z,fromY)??null});
        this.scene.add(this.sourceProjectedShadows.group);
        this.sourceViewmodelShadow=new SourceViewmodelShadow(this.scene);
      }) : loadPortSeleneMap().then(map => {
        if (this.disposed) { map.dispose(); return; }
        this.portMap = map;
        this.scene.add(map.root);
      }),
      originalDust2 ? Promise.resolve() : new HDRLoader()
        .loadAsync('/textures/kloofendal_48d_partly_cloudy_puresky.hdr')
        .then((hdr) => {
          if (this.disposed) {
            hdr.dispose();
            return;
          }
          const generator = new T.PMREMGenerator(this.renderer);
          const light = generator.fromEquirectangular(hdr).texture;
          hdr.mapping = T.EquirectangularReflectionMapping;
          this.scene.background = hdr;
          this.scene.backgroundRotation.y = 0.8;
          this.scene.environmentRotation.copy(this.scene.backgroundRotation);
          this.scene.environment = this.gunScene.environment = light;
          this.scene.environmentIntensity = 0.55;
          this.gunScene.environmentIntensity = 0.55;
          this.textures.push(hdr, light);
          generator.dispose();
          this.scene.getObjectByName('PlaceholderSky')?.removeFromParent();
        }),
    ]).then(() => {
      if (this.disposed) return;
      this.weaponCache.clear();
      this.setWeapon(this.gunId);
    });
  }
  mat(color: T.ColorRepresentation, metalness = 0, roughness = 0.8) {
    const m = new T.MeshStandardMaterial({ color, metalness, roughness });
    this.materials.push(m);
    return m;
  }
  texture(draw: (ctx: CanvasRenderingContext2D) => void, w = 256, h = 256) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    this.textures.push(t);
    return t;
  }
  staticBox(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    m: T.Material,
    ry = 0,
  ) {
    const g = new T.BoxGeometry(w, h, d);
    const positions = g.getAttribute('position'),
      normals = g.getAttribute('normal'),
      uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(normals.getX(i)),
        ny = Math.abs(normals.getY(i));
      uv.setXY(
        i,
        (nx > 0.5 ? positions.getZ(i) : positions.getX(i)) / 4,
        (ny > 0.5 ? positions.getZ(i) : positions.getY(i)) / 4,
      );
    }
    g.rotateY(ry);
    g.translate(x, y, z);
    if (!this.batches.has(m)) this.batches.set(m, []);
    this.batches.get(m)!.push(g);
  }
  mesh(
    g: T.BufferGeometry,
    m: T.Material,
    x = 0,
    y = 0,
    z = 0,
    parent: T.Object3D = this.scene,
  ) {
    const mesh = new T.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    this.geometries.push(g);
    return mesh;
  }
  label(
    text: string,
    x: number,
    y: number,
    z: number,
    w = 3,
    h = 1,
    ry = 0,
    bg = '#ded6c1',
    fg = '#253a42',
  ) {
    const texture = this.texture(
      (c) => {
        c.fillStyle = bg;
        c.fillRect(0, 0, 512, 128);
        c.fillStyle = fg;
        c.font = 'bold 66px Arial';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(text, 256, 66);
      },
      512,
      128,
    );
    const m = new T.MeshStandardMaterial({
      map: texture,
      roughness: 0.8,
      side: T.DoubleSide,
    });
    this.materials.push(m);
    const a = this.mesh(new T.PlaneGeometry(w, h), m, x, y, z);
    a.rotation.y = ry;
    a.castShadow = false;
    return a;
  }
  pbr(material: T.MeshStandardMaterial, asset: string, repeat = 1) {
    const loader = new T.TextureLoader();
    for (const [suffix, key] of [
      ['Diffuse', 'map'],
      ['nor_gl', 'normalMap'],
      ['Rough', 'roughnessMap'],
    ] as const) {
      const t = loader.load('/textures/' + asset + '_' + suffix + '.jpg');
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.anisotropy = 4;
      if (key === 'map') t.colorSpace = T.SRGBColorSpace;
      material[key] = t;
      this.textures.push(t);
    }
    material.normalScale.set(0.45, 0.45);
    material.needsUpdate = true;
  }
  buildMap() {
    const concrete = this.mat('#888a83'),
      edge = this.mat('#52646a'),
      steel = this.mat('#26383f', 0.65, 0.4),
      dark = this.mat('#23343a'),
      yellow = this.mat('#d6a551'),
      crate = this.mat('#ffffff'),
      paint = this.mat('#b9beb4');
    this.pbr(concrete, 'concrete_floor_worn_001');
    const brick = this.mat('#cbc4b4');
    this.pbr(brick, 'brick_wall_003', 1.7);
    this.pbr(crate, 'wooden_planks', 2);
    concrete.color.set('#c6c5b9');
    const groundTex = this.texture(
      (c) => {
        c.fillStyle = '#6b7777';
        c.fillRect(0, 0, 512, 512);
        let n = 739;
        for (let i = 0; i < 16000; i++) {
          n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
          const x = n % 512;
          n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
          const y = n % 512;
          c.fillStyle = i % 2 ? '#65716f' : '#75807a';
          c.fillRect(x, y, 1.5, 1.5);
        }
        c.strokeStyle = '#5a6767';
        c.lineWidth = 1;
        c.strokeRect(0, 0, 512, 512);
      },
      512,
      512,
    );
    groundTex.wrapS = groundTex.wrapT = T.RepeatWrapping;
    groundTex.repeat.set(12, 12);
    const ground = new T.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.94,
    });
    this.pbr(ground, 'asphalt_02', 24);
    ground.color.set('#9faaa8');
    this.materials.push(ground);
    const floor = this.mesh(new T.PlaneGeometry(130, 130), ground, 0, -0.02, 0);
    floor.rotation.x = -Math.PI / 2;
    // Soft contact shadows retain depth even at the low graphics preset.
    const aoTex = this.texture((c) => {
      const g = c.createRadialGradient(128, 128, 30, 128, 128, 128);
      g.addColorStop(0, 'rgba(3,12,16,.75)');
      g.addColorStop(1, 'rgba(3,12,16,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 256, 256);
    });
    const ao = new T.MeshBasicMaterial({
      map: aoTex,
      transparent: true,
      depthWrite: false,
    });
    this.materials.push(ao);
    for (const b of BOXES) {
      const m =
        b.kind === 'container'
          ? this.mat(b.color ?? '#537080', 0.35, 0.63)
          : b.kind === 'crate'
            ? crate
            : b.kind === 'building'
              ? brick
              : concrete;
      if (b.kind === 'container') {
        const loader = new T.TextureLoader();
        const rough = loader.load('/textures/rusty_metal_02_Rough.jpg'),
          normal = loader.load('/textures/rusty_metal_02_nor_gl.jpg');
        for (const t of [rough, normal]) {
          t.wrapS = t.wrapT = T.RepeatWrapping;
          this.textures.push(t);
        }
        m.roughnessMap = rough;
        m.normalMap = normal;
        m.normalScale.set(0.16, 0.16);
      }
      this.staticBox(b.x, b.y, b.z, b.w, b.h, b.d, m);
      const shadow = this.mesh(
        new T.PlaneGeometry(b.w + 3, b.d + 3),
        ao,
        b.x,
        0.005,
        b.z,
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.castShadow = false;
      if (b.kind === 'container') {
        for (let x = -b.w / 2 + 0.25; x < b.w / 2; x += 0.42) {
          this.staticBox(
            b.x + x,
            b.h / 2,
            b.z + b.d / 2 + 0.045,
            0.075,
            b.h - 0.25,
            0.09,
            m,
          );
          this.staticBox(
            b.x + x,
            b.h / 2,
            b.z - b.d / 2 - 0.045,
            0.075,
            b.h - 0.25,
            0.09,
            m,
          );
        }
        for (const z of [-1, 1]) {
          this.staticBox(
            b.x,
            0.13,
            b.z + (z * b.d) / 2,
            b.w,
            0.18,
            0.16,
            steel,
          );
          this.staticBox(
            b.x,
            b.h - 0.12,
            b.z + (z * b.d) / 2,
            b.w,
            0.18,
            0.16,
            steel,
          );
        }
        this.label(
          'BL / CARGO',
          b.x,
          b.h * 0.65,
          b.z + b.d / 2 + 0.1,
          Math.min(3, b.w * 0.5),
          0.5,
        );
        this.label(
          '07 — PORT AUTHORITY',
          b.x,
          b.h * 0.35,
          b.z + b.d / 2 + 0.1,
          2.5,
          0.3,
          0,
          '#263c46',
          '#d3d3bd',
        );
      } else if (b.kind === 'building') {
        this.staticBox(
          b.x,
          b.h + 0.08,
          b.z,
          b.w + 0.45,
          0.25,
          b.d + 0.45,
          edge,
        );
        for (let z = -b.d / 2 + 1; z < b.d / 2; z += 2.5) {
          for (const side of [-1, 1]) {
            this.staticBox(
              b.x + side * (b.w / 2 + 0.015),
              3.8,
              b.z + z,
              0.04,
              1.35,
              1.75,
              dark,
            );
            this.staticBox(
              b.x + side * (b.w / 2 + 0.03),
              3.8,
              b.z + z,
              0.06,
              0.06,
              1.8,
              paint,
            );
          }
        }
        this.staticBox(b.x, b.h + 0.4, b.z, 1.8, 0.6, 2.1, steel);
        for (const s of [-1, 1])
          this.staticBox(
            b.x + s * (b.w / 2 + 0.03),
            0.45,
            b.z,
            0.07,
            0.85,
            b.d,
            edge,
          );
      } else if (b.kind === 'crate') {
        for (const dx of [-1, 1])
          this.staticBox(
            b.x + dx * (b.w / 2 - 0.2),
            b.y,
            b.z,
            0.16,
            b.h + 0.05,
            b.d + 0.04,
            steel,
          );
        for (const z of [-1, 1]) {
          this.staticBox(b.x, 0.18, b.z + (z * b.d) / 2, b.w, 0.2, 0.07, dark);
          this.staticBox(
            b.x,
            b.h - 0.18,
            b.z + (z * b.d) / 2,
            b.w,
            0.2,
            0.07,
            dark,
          );
        }
      } else if (b.kind === 'barrier') {
        for (let x = -b.w / 2 + 0.25; x < b.w / 2; x += 0.7)
          this.staticBox(b.x + x, b.h + 0.01, b.z, 0.33, 0.025, b.d, yellow);
      } else if (b.kind === 'wall') {
        this.staticBox(b.x, b.h + 0.1, b.z, b.w + 0.12, 0.2, b.d + 0.12, edge);
      }
    }
    buildPortDetails(this);
    // Lane markings and objective pads.
    for (const s of SITES) {
      const tex = this.texture((c) => {
        c.fillStyle = 'rgba(225,169,70,.15)';
        c.fillRect(0, 0, 256, 256);
        c.strokeStyle = '#e4b05f';
        c.lineWidth = 7;
        c.strokeRect(5, 5, 246, 246);
        c.fillStyle = '#e4b05f';
        c.font = 'bold 145px Arial';
        c.textAlign = 'center';
        c.fillText(s.name, 128, 183);
      });
      const m = new T.MeshStandardMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        roughness: 1,
      });
      this.materials.push(m);
      const pad = this.mesh(new T.PlaneGeometry(7.5, 7.5), m, s.x, 0.015, s.z);
      pad.rotation.x = -Math.PI / 2;
      pad.castShadow = false;
      this.label(
        `${s.name} / SECTOR`,
        s.x,
        1.85,
        s.name === 'A' ? -31.95 : 31.95,
        5,
        1,
        s.name === 'A' ? 0 : Math.PI,
        '#d8a45c',
        '#1e313b',
      );
    }
    for (let z = -29; z < 30; z += 5) {
      this.staticBox(-7, 0.007, z, 0.12, 0.013, 2, yellow);
      this.staticBox(8, 0.007, z, 0.12, 0.013, 2, yellow);
    }
    for (let x = -29; x < 31; x += 7) {
      this.staticBox(x, 0.01, 26, 3.4, 0.02, 0.11, paint);
      this.staticBox(x, 0.01, -26, 3.4, 0.02, 0.11, paint);
    }
    // Industrial utility details: ducts, pipes, cable reels, lamps, air units.
    for (const x of [-30, 30])
      for (const z of [-25, -5, 18]) {
        this.staticBox(x, 4, z, 0.12, 8, 0.12, steel);
        this.staticBox(
          x + (x < 0 ? 0.7 : -0.7),
          7.9,
          z,
          1.5,
          0.12,
          0.12,
          steel,
        );
        const lightMat = this.mat('#ffe1a2');
        (lightMat as T.MeshStandardMaterial).emissive.set('#ffcc76');
        (lightMat as T.MeshStandardMaterial).emissiveIntensity = 1;
        this.staticBox(
          x + (x < 0 ? 1.3 : -1.3),
          7.8,
          z,
          0.65,
          0.12,
          0.4,
          lightMat,
        );
      }
    for (const [x, z] of [
      [-29, -8],
      [29, 6],
      [-8, 12],
      [8, -14],
    ]) {
      for (let i = 0; i < 3; i++) {
        this.mesh(
          new T.CylinderGeometry(0.38, 0.38, 1.05, 12),
          i % 2 ? yellow : dark,
          x + i * 0.83,
          0.53,
          z,
        );
        this.staticBox(x + i * 0.83, 1.02, z, 0.2, 0.02, 0.1, steel);
      }
    }
    // Distant port skyline gives the compact arena a believable setting.
    for (let i = 0; i < 15; i++) {
      const x = -100 + i * 14,
        h = 9 + ((i * 17) % 14);
      this.staticBox(
        x,
        h / 2,
        -55 - (i % 3) * 8,
        9,
        h,
        12,
        i % 2 ? edge : concrete,
      );
      for (let y = 4; y < h; y += 3)
        for (let k = -3; k <= 3; k += 2)
          this.staticBox(x + k, y, -48 - (i % 3) * 8, 1, 0.9, 0.06, dark);
    }
    for (const x of [-43, 43]) {
      this.staticBox(x, 15, -36, 1.1, 30, 1.1, yellow);
      this.staticBox(x, 29, -36, 2, 1, 30, yellow);
      this.staticBox(x, 23, -23, 0.14, 12, 0.14, steel);
      this.staticBox(x, 18, -24, 4, 0.8, 4, steel);
    }
    const skyG = new T.SphereGeometry(180, 32, 16);
    const skyM = new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new T.Color('#619bc3') },
        bottom: { value: new T.Color('#d3d7c5') },
      },
      vertexShader:
        'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:
        'varying vec3 v;uniform vec3 top;uniform vec3 bottom;void main(){float h=clamp(normalize(v).y*.9,0.,1.);gl_FragColor=vec4(mix(bottom,top,pow(h,.6)),1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    });
    this.materials.push(skyM);
    const sky = this.mesh(skyG, skyM, 0, 0, 0);
    sky.castShadow = false;
    sky.name = 'PlaceholderSky';
    for (const [mat, gs] of this.batches) {
      const merged = mergeGeometries(gs);
      this.mesh(merged, mat);
      gs.forEach((g) => g.dispose());
    }
    this.batches.clear();
  }
  part(
    parent: T.Object3D,
    m: T.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    rx = 0,
  ) {
    const mesh = this.mesh(
      new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.12),
      m,
      x,
      y,
      z,
      parent,
    );
    mesh.rotation.x = rx;
    return mesh;
  }
  createWeapon(id: WeaponId) {
    const group = new T.Group(),
      body = this.mat('#33434b', 0.8, 0.35),
      black = this.mat('#172129', 0.6, 0.43),
      steel = this.mat('#52636b', 0.72, 0.4),
      accent = this.mat('#b59a71', 0.55, 0.5);
    const pistol = id === 'sidearm',
      sniper = id === 'marshal',
      smg = id === 'spectre',
      len = pistol ? 0.23 : sniper ? 0.58 : smg ? 0.35 : 0.46;
    this.part(group, body, 0.095, 0.12, len, 0, 0, -0.15);
    this.part(group, black, 0.07, 0.1, 0.18, 0, -0.115, 0.015, 0.3);
    this.part(
      group,
      black,
      0.065,
      pistol ? 0.06 : 0.21,
      0.08,
      0,
      -0.15,
      -0.15,
      -0.14,
    );
    const barrel = this.mesh(
      new T.CylinderGeometry(0.019, 0.019, pistol ? 0.14 : 0.3, 12),
      steel,
      0,
      0.012,
      -0.15 - len / 2 - 0.1,
      group,
    );
    barrel.rotation.x = Math.PI / 2;
    const suppressor = this.mesh(
      new T.CylinderGeometry(0.027, 0.027, 0.085, 12),
      black,
      0,
      0.012,
      -0.15 - len / 2 - 0.25,
      group,
    );
    suppressor.rotation.x = Math.PI / 2;
    if (!pistol) {
      this.part(group, black, 0.1, 0.13, 0.2, 0, -0.02, 0.19);
      this.part(group, body, 0.085, 0.11, 0.25, 0, 0, -0.36);
      for (let z = -0.42; z < 0.1; z += 0.032)
        this.part(group, black, 0.1, 0.012, 0.014, 0, 0.075, z);
      for (let z = -0.4; z < -0.2; z += 0.045)
        this.part(group, black, 0.102, 0.027, 0.018, 0, 0.018, z);
      this.part(group, accent, 0.01, 0.035, 0.12, 0.05, -0.01, -0.14);
      this.part(group, black, 0.017, 0.05, 0.018, 0, 0.11, -0.36);
      this.part(group, black, 0.014, 0.065, 0.025, -0.026, 0.11, 0.06);
      this.part(group, black, 0.014, 0.065, 0.025, 0.026, 0.11, 0.06);
      this.mesh(
        new T.TorusGeometry(0.021, 0.006, 6, 12),
        black,
        0,
        0.124,
        0.06,
        group,
      );
      this.part(group, steel, 0.018, 0.009, 0.018, 0, 0.138, -0.36);
    } else {
      this.part(group, steel, 0.098, 0.06, 0.24, 0, 0.055, -0.15);
      this.part(group, black, 0.015, 0.022, 0.017, 0, 0.097, -0.25);
    }
    if (sniper) {
      const scope = this.mesh(
        new T.CylinderGeometry(0.037, 0.037, 0.23, 16),
        black,
        0,
        0.15,
        -0.09,
        group,
      );
      scope.rotation.x = Math.PI / 2;
      const glass = this.mat('#368c9b', 0.8, 0.12);
      this.mesh(new T.CircleGeometry(0.03, 16), glass, 0, 0.15, 0.028, group);
    }
    // Gloves, cuffs and forearms; weapon animation moves as one coherent rig.
    const glove = this.mat('#444e4c'),
      sleeve = this.mat('#58686a');
    this.part(group, glove, 0.095, 0.1, 0.12, 0.015, -0.155, 0.06, 0.25);
    this.part(group, sleeve, 0.115, 0.13, 0.26, 0.04, -0.24, 0.18, -0.45);
    if (!pistol) {
      this.part(group, glove, 0.12, 0.07, 0.13, -0.025, -0.1, -0.3);
      this.part(group, sleeve, 0.12, 0.12, 0.36, -0.12, -0.2, -0.19, -0.5);
    }
    this.part(group, accent, 0.005, 0.015, 0.09, 0.052, 0.032, -0.16);
    return group;
  }
  setWeapon(id: WeaponId,team:Team=this.gunTeam) {
    const changed=id!==this.gunId||team!==this.gunTeam;
    const teamChanged=this.originalDust2&&team!==this.gunTeam;
    if (id !== this.gunId||teamChanged) {this.inspection.cancel();const previous=this.weaponCache.get(this.gunId);if(previous&&isSourceViewmodel(previous))cancelSourceInspection(previous);}
    if(changed){const previous=this.weaponCache.get(this.gunId);if(previous&&isSourcePistolViewmodel(previous))cancelSourcePistolInspection(previous);if(previous&&isSourceAWPViewmodel(previous))cancelSourceAWPInspection(previous);}
    if(teamChanged){
      for(const id of ['vandal','m4a4','glock','usp','deagle','awp']as const){const previous=this.weaponCache.get(id);
        if(previous){previous.removeFromParent();this.releaseSourceFinish(previous);disposeWeaponSkin(previous);this.assets.releaseSourceWeapon(previous);this.weaponCache.delete(id);this.ejectionPorts.delete(id);}}
      this.gunTeam=team;
    }
    const old = this.gun.children.find((c) => c !== this.muzzle);
    if (old) {
      this.gun.remove(old);
    }
    this.gunId = id;
    let model = this.weaponCache.get(id);
    if (!model) {
      const approved = this.assets.weapon(id,this.originalDust2?this.gunTeam:'amber');
      if (!approved) return;
      model = approved;
      model.traverse(object => {
        if (object instanceof T.Mesh) object.castShadow = object.receiveShadow = true;
      });
      this.weaponCache.set(id, model);
      const name = id === 'vandal' ? /^Static_07_Recess_Black$/ : id === 'sidearm'
        ? /^Weapon.*P12.*phosphated_exterior_steel$/ : /^Bolt.*DMR.*phosphated_exterior_steel$/;
      model.traverse(o => { if (o instanceof T.Mesh && name.test(o.name)) this.ejectionPorts.set(id, o); });
    }
    applyWeaponSkin(model, this.skin);
    this.applySourceFinish(model,this.sourceWeaponFinish?.weapon===id?this.sourceWeaponFinish:null);
    this.gun.add(model);
    if(changed&&hasSourceDraw(model))startSourceDraw(model);
  }
  setSkin(value: unknown) {
    this.skin = validSkinId(value);
    for (const model of this.weaponCache.values()) applyWeaponSkin(model, this.skin);
  }
  setSourceWeaponFinish(value:unknown){
    const finish=validSourceWeaponFinish(value);if(value!==null&&!finish)return;
    this.sourceWeaponFinish=finish;
    for(const [weapon,root]of this.weaponCache){
      // Explicit selection can retry; actor updates must keep failed keys
      // deduplicated so a persistent resource error cannot retry every frame.
      if(this.sourceFinishRequests.get(root)?.status==='error')this.sourceFinishRequests.delete(root);
      this.applySourceFinish(root,finish&&finish.weapon===weapon?finish:null);
    }
  }
  sourceFinishStatus():{status:'default'|'loading'|'ready'|'error';key:string;error?:string}{
    const finish=this.sourceWeaponFinish;
    if(!this.originalDust2||!finish||this.gunId!==finish.weapon)return{status:'default',key:'default'};
    const root=this.weaponCache.get(this.gunId),state=root?this.sourceFinishRequests.get(root):undefined;
    return{status:state?.status??'loading',key:sourceWeaponFinishKey(finish),...(state?.error?{error:state.error}:{})};
  }
  /** All six weapons use their own staged inputs and original shader branch.
   * The fixed Redline receipt remains a separate numerical reference. */
  private prepareSourceFinish(weapon:SourceFinishWeaponId){
    const existing=this.sourceFinishOwners.get(weapon);if(existing)return existing;
    const promise=(async()=>{
      const m=await import('./source-redline-finish');
      const catalogueBaseURL='/source/csgo-12426148/skins/';
      let owner:SourceRedlineFinishOwner;
      {
        const kit=await import('./source-kit-finishes');
        const originalWeapon=kit.sourceKitOriginalWeapon(weapon);
        if(!originalWeapon)throw Error(`This port ships no original weapon for ${weapon}`);
        const assetBase=kit.SOURCE_KIT_INPUT_BASE+originalWeapon+'/';
        // The owner's Phong values and its sampled textures are the weapon's own original
        // data, so they come from the staged receipt rather than from a constant here.
        const {loadSourceKitWeapon}=await import('./source-kit-inputs');
        const loaded=await loadSourceKitWeapon(originalWeapon,assetBase,{signal:this.mapAbort.signal});
        const spec=kit.sourceKitFinishWeapon(weapon,loaded.weapon.kit.phong);
        if(!spec)throw Error(`No original composition inputs are staged for ${weapon}`);
        owner=await m.createSourceRedlineFinishOwner({inputBaseURL:assetBase,patternBaseURL:assetBase,
          weaponInputs:loaded.weapon.kit.inputs,
          resolve:kit.createSourceKitFinishResolver({weapon:originalWeapon,catalogueBaseURL,
            kitBaseURL:kit.SOURCE_KIT_INPUT_BASE,signal:this.mapAbort.signal}),
          weapon:spec,signal:this.mapAbort.signal});
      }
      if(this.disposed){owner.dispose();throw Error('Source finish scene disposed');}
      this.sourceFinishReady.set(weapon,owner);
      return owner;
    })().catch(error=>{this.sourceFinishOwners.delete(weapon);this.sourceFinishReady.delete(weapon);throw error;});
    this.sourceFinishOwners.set(weapon,promise);
    return promise;
  }
  /** Gives a root back to its own material. Every owner is asked because a root may have
   * been dressed by any of them; an owner that never bound it restores nothing. */
  private releaseFinishRoot(root:T.Object3D){
    for(const [weapon,pending]of this.sourceFinishOwners){
      const ready=this.sourceFinishReady.get(weapon);
      if(ready)ready.releaseRoot(root);else pending.then(owner=>owner.releaseRoot(root),()=>undefined);
    }
  }
  private applySourceFinish(root:T.Object3D,value:SourceWeaponFinish|null){
    if(!this.originalDust2)return;
    const finish=value?{...value}:null,key=sourceWeaponFinishKey(finish);
    if(this.sourceFinishRequests.get(root)?.key===key)return;
    const request={key,status:finish?'loading' as const:'default' as const};this.sourceFinishRequests.set(root,request);
    // Invalidate an older per-root request immediately, even while the next
    // parameters wait for the single compositor or its initial resource load.
    this.releaseFinishRoot(root);
    if(!finish)return;
    this.prepareSourceFinish(finish.weapon).then(async owner=>{
      if(this.disposed||this.sourceFinishRequests.get(root)!==request)return;
      await owner.apply(root,finish);
      if(this.sourceFinishRequests.get(root)===request)this.sourceFinishRequests.set(root,{key,status:'ready'});
    }).catch(error=>{if(!this.disposed&&this.sourceFinishRequests.get(root)===request)this.sourceFinishRequests.set(root,{key,status:'error',error:String(error)});});
  }
  private releaseSourceFinish(root:T.Object3D){
    this.sourceFinishRequests.delete(root);
    this.releaseFinishRoot(root);
  }
  private sourceFinishAudit(root?:T.Object3D){
    const found=new Map<T.Material,unknown>();root?.traverse(o=>{if(o instanceof T.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.userData.sourceFinish)found.set(m,{finish:m.userData.sourceFinish,evidence:m.userData.sourceFinishEvidence,sourceParameters:m.userData.sourceParameters});});
    return [...found.values()];
  }
  inspectWeapon() { const model=this.weaponCache.get(this.gunId);if(model&&isSourcePistolViewmodel(model))startSourcePistolInspection(model);else if(model&&isSourceViewmodel(model))startSourceInspection(model);else this.inspection.start(); }
  clearEffects() { this.sourceDroppedWeapons?.clear();this.sourceGrenadeSmoke?.clear();this.effects.clear();this.magazineDrops.clear();this.sourceDrawActorKey=null;this.sourceWindGeneration++;for(const root of this.weaponCache.values())this.assets.resetSourceWeaponPlayback(root); }
  private retireActor(id:string,root:T.Group){
    if(!root.userData.falconC02&&!root.userData.sourceCharacter){root.visible=false;return;}
    disposeWeaponSkin(root);
    this.releaseSourceFinish(root);
    const marker=root.getObjectByName('TeamMarker') as T.Mesh|undefined;
    if(marker){marker.geometry.dispose();for(const material of Array.isArray(marker.material)?marker.material:[marker.material])material.dispose();marker.removeFromParent();}
    this.assets.releaseActor(root);this.actors.delete(id);
  }
  actor(p: Player) {
    let root = this.actors.get(p.id);
    if(root?.userData.sourceCharacter&&(root.userData.sourceTeam!==p.team||root.userData.sourceWeaponId!==p.weapon)){this.retireActor(p.id,root);root=undefined;}
    if (root) return root;
    const operator = this.assets.operator(p);
    if (operator) {
      // Team identification belongs to the game layer; preserve the frozen body materials.
      const marker = new T.Mesh(
        new T.OctahedronGeometry(0.09, 0),
        new T.MeshBasicMaterial({ color: p.team === 'amber' ? '#efb667' : '#78d7f2' }),
      );
      marker.name = 'TeamMarker';
      marker.position.y = 2.05;
      operator.add(marker);
      this.scene.add(operator);
      this.actors.set(p.id, operator);
      return operator;
    }
    root = new T.Group();
    const suit = this.mat(p.team === 'amber' ? '#645e4e' : '#3d5260'),
      vest = this.mat('#263539'),
      helmet = this.mat(p.team === 'amber' ? '#8d7b60' : '#466b7d'),
      visor = this.mat('#182d33', 0.7, 0.2);
    const torso = this.mesh(
      new T.CapsuleGeometry(0.22, 0.27, 5, 10),
      suit,
      0,
      1.03,
      0,
      root,
    );
    torso.scale.z = 0.72;
    this.part(root, vest, 0.51, 0.4, 0.34, 0, 1.06, -0.01);
    for (const x of [-0.16, 0, 0.16])
      this.part(root, suit, 0.12, 0.16, 0.09, x, 1.04, -0.21);
    const head = this.mesh(
      new T.SphereGeometry(0.205, 12, 9),
      helmet,
      0,
      1.53,
      0,
      root,
    );
    head.scale.y = 1.1;
    this.part(root, visor, 0.32, 0.08, 0.12, 0, 1.53, -0.16);
    this.part(root, suit, 0.26, 0.16, 0.26, 0, 1.33, 0);
    this.part(root, vest, 0.3, 0.34, 0.16, 0, 1.1, 0.23);
    this.part(root, vest, 0.075, 0.14, 0.07, 0.2, 1.56, 0);
    this.part(root, visor, 0.035, 0.16, 0.03, 0.22, 1.38, -0.08);
    for (const sign of [-1, 1]) {
      const leg = new T.Group();
      leg.name = sign === -1 ? 'legL' : 'legR';
      leg.position.set(sign * 0.14, 0.64, 0);
      root.add(leg);
      this.mesh(
        new T.CapsuleGeometry(0.09, 0.26, 4, 8),
        suit,
        0,
        -0.19,
        0,
        leg,
      );
      this.part(leg, suit, 0.16, 0.2, 0.17, 0, -0.39, 0);
      this.part(leg, vest, 0.17, 0.14, 0.07, 0, -0.29, -0.11);
      this.part(leg, vest, 0.2, 0.14, 0.31, 0, -0.57, -0.04);
      const arm = this.mesh(
        new T.CapsuleGeometry(0.095, 0.24, 4, 8),
        suit,
        sign * 0.3,
        1.06,
        -0.12,
        root,
      );
      arm.rotation.x = -0.65;
      this.part(root, vest, 0.105, 0.13, 0.11, sign * 0.28, 0.89, -0.27);
      this.part(root, suit, 0.16, 0.14, 0.2, sign * 0.32, 1.25, -0.03);
    }
    this.part(root, vest, 0.09, 0.13, 0.55, 0.19, 1.12, -0.48);
    this.part(root, visor, 0.035, 0.035, 0.25, 0.19, 1.12, -0.86);
    const mark = this.mat(p.team === 'amber' ? '#eab56e' : '#80c5d7');
    this.part(root, mark, 0.08, 0.09, 0.34, -0.27, 1.19, 0);
    this.scene.add(root);
    this.actors.set(p.id, root);
    return root;
  }
  /** Point the scene at the original's fog for the state the frame is in. */
  private applyMapFog() {
    this.sourceFogApplied = this.sourceFogState;
    applySourceFog(this.scene, this.sourceFogApplied);
  }

  /** Put the key light and the ambient fill where the map says they are.
   *
   * `light_environment` states the sun's direction (Source yaw/pitch), its colour and the
   * ambient colour; every lit scene takes them, so the world, the characters and the viewmodel
   * agree about where the light is. The *intensities* stay this renderer's own, because Source's
   * light units are not three's, and the hemisphere's ground half stays this renderer's own
   * because Source states a single ambient colour. The distance from the target is kept at the
   * value the shadow camera's near/far were set for. */
  private applyMapLighting() {
    const light = this.sourceEnvironment.light;
    const direction = environmentSunDirection(this.sourceEnvironment);
    this.sunOffset.set(...direction).multiplyScalar(SOURCE_SUN_DISTANCE);
    this.sun.color.set(environmentColor(light.sunColor));
    this.weaponSun.color.copy(this.sun.color);
    this.ambient.color.set(environmentColor(light.ambientColor));
    this.gunAmbient.color.copy(this.ambient.color);
    this.sun.position.copy(this.sun.target.position).add(this.sunOffset);
  }

  /** What the frame is actually hazed and lit by, so the in-game run can measure the real thing
   * rather than the intent: the installed ramp, the numbers the fog object carries, and the one
   * shared value every fogged material's `fogMaxDensity` uniform was told. */
  setSourceParticleLightingWorld(options:Parameters<typeof loadSourceLightingTrace>[0]|null){
    const epoch=++this.sourceLightingEpoch;
    this.sourceParticleLighting?.dispose();this.sourceParticleLighting=null;
    this.sourceLightingTrace?.dispose();this.sourceLightingTrace=null;
    this.sourceParticleLightingError=null;
    this.sourceParticleLightingReady=!options?Promise.resolve():(async()=>{
      const trace=await loadSourceLightingTrace({...options,signal:this.mapAbort.signal});
      if(this.disposed||epoch!==this.sourceLightingEpoch){trace.dispose();return;}
      const probes=this.sourceProbes;
      if(!probes){trace.dispose();throw Error('Original particle lighting requires map ambient probes');}
      this.sourceLightingTrace=trace;
      this.sourceParticleLighting=createSourceParticleLighting({lightingTrace:trace,
        sampleAmbient:p=>probes.ambient.sampleSourcePosition(new T.Vector3(...p))});
    })().catch(error=>{if(epoch===this.sourceLightingEpoch&&!this.disposed)this.sourceParticleLightingError=String(error);});
    return this.sourceParticleLightingReady;
  }
  private bindSourceRopeLighting(){
    const probes=this.sourceProbes,ropes=this.sourceMap?.details.ropes;
    if(!probes||!ropes)return;
    ropes.setLighting(position=>{
      const sample=probes.ambient.sampleWorldPosition(position);
      if(!sample)return null;
      return [0,1,2].map(channel=>sample.faces.reduce((sum,face)=>sum+face[channel],0)/6) as [number,number,number];
    });
  }
  get sourceEnvironmentAudit() {
    const fog = this.scene.fog;
    const sunDirection = this.sun.position.clone().sub(this.sun.target.position).normalize();
    const shadowCamera = this.sun.shadow.camera;
    return {
      environment: this.sourceEnvironment,
      applied: {
        fog: this.originalDust2 ? {...this.sourceFogApplied, ramp: 'source-linear-capped',
          sharedMaxDensity: sourceFogMaxDensity()} : null,
        lightScale: this.sourceEnvironment.light.lightScaleHDR,
        sunDirection: sunDirection.toArray(),
        expectedSunDirection: environmentSunDirection(this.sourceEnvironment),
        sunColor: '#' + this.sun.color.getHexString(),
        ambientColor: '#' + this.ambient.color.getHexString(),
        sunTarget: this.sun.target.position.toArray(),
        sunPosition: this.sun.position.toArray(),
        shadow: {castShadow: this.sun.castShadow, mapSize: [this.sun.shadow.mapSize.x, this.sun.shadow.mapSize.y],
          box: {left: shadowCamera.left, right: shadowCamera.right, top: shadowCamera.top,
            bottom: shadowCamera.bottom, near: shadowCamera.near, far: shadowCamera.far}},
      },
      sceneFog: fog && 'near' in fog && !(fog instanceof T.FogExp2)
        ? {type: 'Fog', near: fog.near, far: fog.far, color: '#' + fog.color.getHexString()}
        : fog ? {type: 'FogExp2', density: (fog as T.FogExp2).density,
          color: '#' + fog.color.getHexString()} : null,
      // The chunk the GPU was actually given, so the evidence is not a claim about intent.
      fogFragment: T.ShaderChunk.fog_fragment,
      historicalLimitations: this.sourceEnvironment.declaredButUnapplied,
      runtimeCapabilities:{histogramExposure:!!this.worldComposite.autoExposure,
        sunSprite:!!this.worldComposite.sun,colorCorrection:!!this.worldComposite.sun?.lut,
        heightAwareShadows:!!this.sourceProjectedShadows,viewmodelShadow:!!this.sourceViewmodelShadow},
      unapplied: this.originalDust2?[
        'Installed-client tone-curve, exposure scheduling and sun-occlusion timing are not pixel-matched; the WebGL owners apply the original map values and SDK arithmetic.',
        'Projected receivers follow original collision heights; native BSP polygon clipping and per-entity shadow constants are not reproduced.',
      ]:this.sourceEnvironment.declaredButUnapplied,
    };
  }

  updateSmoke(clouds: Smoke[], dt: number, sourceRound=this.sourceSmokeRound) {
    if(this.sourceSmokeRound!==sourceRound){this.sourceGrenadeSmoke?.clear();this.sourceSmokeRound=sourceRound;}
    this.clouds = clouds;
    if(this.originalDust2){
      for(const cloud of clouds)this.sourceGrenadeSmoke?.spawn(String(cloud.id),cloud,this.clock-cloud.age,
        sourceWorldRifleMuzzleSeeds('smoke-grenade',cloud.id).vent,()=>this.sourceParticleLighting?.sampleWorldPosition(cloud));
      return;
    }
    for (const [id, root] of this.smokeMeshes)
      if (!clouds.some((s) => s.id === id)) {
        root.removeFromParent();
        this.smokeMeshes.delete(id);
      }
    if (clouds.length && !this.smokeMaterial) {
      const map = this.texture((c) => {
        c.clearRect(0, 0, 256, 256);
        const gradient = c.createRadialGradient(128, 128, 6, 128, 128, 126);
        gradient.addColorStop(0, 'rgba(255,255,255,.95)');
        gradient.addColorStop(0.4, 'rgba(255,255,255,.85)');
        gradient.addColorStop(0.75, 'rgba(255,255,255,.4)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = gradient;
        c.fillRect(0, 0, 256, 256);
      });
      this.smokeMaterial = new T.SpriteMaterial({
        map,
        color: '#a8ada5',
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      });
      this.materials.push(this.smokeMaterial);
    }
    for (const cloud of clouds) {
      let root = this.smokeMeshes.get(cloud.id);
      if (!root) {
        root = new T.Group();
        this.scene.add(root);
        this.smokeMeshes.set(cloud.id, root);
        for (let i = 0; i < 22; i++) {
          const puff = new T.Sprite(this.smokeMaterial!);
          const angle = i * 2.39996,
            level = ((i % 5) - 2) * 0.24,
            r = Math.sqrt((i + 0.5) / 22) * 0.75;
          puff.position.set(Math.cos(angle) * r, level, Math.sin(angle) * r);
          puff.scale.setScalar(1.65 + (i % 3) * 0.15);
          root.add(puff);
        }
      }
      root.position.set(cloud.x, cloud.y, cloud.z);
      root.scale.setScalar(smokeRadius(cloud));
      root.rotation.y += dt * 0.025;
    }
  }
  updateGrenades(list: GrenadeSnapshot[]) {
    const ids = new Set(list.map((g) => g.id));
    for (const [id, m] of this.grenadeMeshes)
      if (!ids.has(id)) {
        m.removeFromParent();
        if(m instanceof T.Group)this.sourceGrenadeModels?.release(m);
        else {m.geometry.dispose();(m.material as T.Material).dispose();}
        this.grenadeMeshes.delete(id);
      }
    for (const g of list) {
      let m = this.grenadeMeshes.get(g.id);
      if (!m) {
        m = this.sourceGrenadeModels?this.sourceGrenadeModels.create(g.kind??'he'):new T.Mesh(
          new T.SphereGeometry(0.12, 8, 6),
          new T.MeshStandardMaterial({
            color:
              g.kind === 'flash'
                ? '#d8d4bf'
                : g.kind === 'smoke'
                  ? '#7c9091'
                  : '#627049',
            roughness: 0.7,
            metalness: 0.2,
          }),
        );
        m.castShadow = true;
        this.scene.add(m);
        this.grenadeMeshes.set(g.id, m);
      }
      m.position.set(g.x, g.y, g.z);
      if(g.rotation)m.quaternion.set(g.rotation.x,g.rotation.y,g.rotation.z,g.rotation.w).normalize();
    }
  }
  updateDroppedWeapons(states:readonly SourceDroppedWeaponState[]){this.sourceDroppedWeapons?.sync(states);}
  updateActors(players: Player[], you: string, dt: number, menu = false) {
    const ids = new Set(players.map((p) => p.id));
    for (const [id, root] of this.actors) {
      if (ids.has(id)) continue;
      this.retireActor(id,root);
    }
    for (const p of players) {
      const root = this.actor(p);
      const old = root.position.clone();
      root.position.set(p.x, p.y, p.z);
      root.rotation.y = p.yaw;
      const presentationVisible = this.assets.updateDeath(root, p, dt);
      const observer = players.find((v) => v.id === you);
      const obscured =
        observer &&
        smokeBlocks(
          this.resolveEye(observer),
          this.resolveEye(p),
          this.clouds,
        );
      root.visible =
        !obscured &&
        p.id !== you &&
        p.y > -50 &&
        !menu &&
        presentationVisible;
      // The local operator's own world model stays invisible in first person,
      // but while an original reload is out it still has to be posed: the
      // magazine that leaves the weapon at AE_CL_EJECT_MAG is its own prop, and
      // that prop is what the shooter sees drop.
      const reloading = p.id === you && root.userData.sourceCharacter !== undefined && p.sourcePose?.reload !== undefined;
      if (!root.visible && !reloading) continue;
      if (root.visible) {
        applyWeaponSkin(root, p.skin);
        this.applySourceFinish(root,p.sourceWeaponFinish?.weapon===p.weapon?p.sourceWeaponFinish:null);
      }
      const marker = root.getObjectByName('TeamMarker');
      if (marker) marker.visible = p.alive;
      // Runtime supplies a complete pose sampled on one timeline; a second position filter
      // would separate the rendered head/body from yaw, stance and the shot rewind time.
      if (root.userData.mixer||root.userData.sourceCharacter) {
        this.assets.animateOperator(root, p, dt);
        if(this.sourceDroppedWeapons&&root.userData.sourceCharacter)
          setSourceHeldWeaponVisible(root.userData.sourceCharacter,p.alive&&p.weapon!=='knife');
        if (p.id !== you) this.fireWorldMuzzleFlash(root, p);
        const drop = this.assets.takeMagazineDrop(root);
        // The dropped prop re-samples the original collision under its own
        // column as it flies, so it lands on the surface it actually falls over.
        if (drop && this.resolveGround) drop.surfaceY = this.resolveGround;
        if (drop) this.magazineDrops.spawn(drop);
        root.visible = !obscured && p.id !== you && p.y > -50 && !menu && presentationVisible;
        continue;
      }
      root.scale.y = p.crouch ? 0.76 : 1;
      const moving = old.distanceTo(root.position) > 0.005;
      const swing = moving ? Math.sin(this.clock * 13) * 0.48 : 0;
      root.getObjectByName('legL')!.rotation.x = swing;
      root.getObjectByName('legR')!.rotation.x = -swing;
    }
  }
  private updateProjectedShadows(model:T.Object3D|null){
    // Every actor the original would draw casts its own shadow: a silhouette of that actor projected
    // straight down onto the surface below it, at the map's own shadow colour.
    if (this.sourceProjectedShadows) {
      const casters: SourceProjectedShadowCaster[] = [];
      for (const [id, root] of this.actors)
        if (root.visible){
          root.updateMatrixWorld(true);
          const bounds=this.sourceActorBounds.update(root,new T.Box3());
          if(!bounds.isEmpty()){
            const center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3());
            // Follow the actual fallen skeleton as it travels away from the
            // actor origin; the silhouette camera and receiver share bounds.
            const origin=new T.Vector3(center.x,Math.max(root.position.y,bounds.min.y),center.z);
            casters.push({id,object:root,origin,radius:Math.max(size.x,size.z)/2,bounds});
          }
        }
      const view=this.sourceViewmodelShadow?.update(model,this.camera);if(view)casters.push(view);
      this.sourceDroppedWeapons?.group.children.forEach(root=>{
        const bounds=this.sourceActorBounds.update(root,new T.Box3());if(bounds.isEmpty())return;
        const center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3());
        casters.push({id:'drop:'+root.userData.sourceDroppedWeapon,object:root,origin:new T.Vector3(center.x,bounds.min.y,center.z),radius:Math.max(size.x,size.z)/2,bounds});
      });
      this.sourceProjectedShadows.update(casters, this.camera);
    }
  }
  /** Half the widest side of an actor's own bound: how wide its shadow's silhouette is sampled. */
  private actorShadowRadius(root: T.Object3D) {
    const cached = this.shadowRadii.get(root);
    if (cached !== undefined) return cached;
    const size = new T.Box3().setFromObject(root).getSize(new T.Vector3());
    const radius = Math.max(0.2, Math.max(size.x, size.z) / 2);
    this.shadowRadii.set(root, radius);
    return radius;
  }
  trace(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    own = false,
    eject = true,
  ) {
    if (own&&eject) this.ejectCasing();
    // Dust2's shot uses its own tracer and surface decal. Keep ejection independent:
    // removing the legacy line/impact must not remove the local training shot's brass.
    if (this.originalDust2) return;
    const length = Math.hypot(dx, dy, dz),
      v = new T.Vector3(dx, dy, dz).normalize();
    const m = new T.MeshBasicMaterial({
      color: own ? '#ffdda0' : '#edbd71',
      transparent: true,
      opacity: 0.7,
    });
    const mesh = new T.Mesh(
      new T.CylinderGeometry(0.008, 0.013, Math.min(length, 12), 4),
      m,
    );
    mesh.position
      .set(x, y, z)
      .addScaledVector(v, Math.min(length, 12) / 2 + 0.3);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), v);
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.065 });
    const impact = new T.Mesh(
      new T.SphereGeometry(0.065, 5, 4),
      new T.MeshBasicMaterial({ color: '#ffd58d' }),
    );
    impact.position.set(x + dx, y + dy, z + dz);
    this.scene.add(impact);
    this.tracers.push({ mesh: impact, life: 0.14 });
  }
  explosion(x: number, z: number, y = 0) {
    this.effects.explode(new T.Vector3(x, y + .15, z));
  }
  /** Draws the original bullet hole a shot left in the world.
   *
   * The draws come from the shot's own identity, so every client that received the same
   * shot draws the same decal at the same rotation, and an acceptance run can name the
   * mark it expected. Returns what was drawn, or why nothing was.
   */
  sourceBulletImpact(by: string, seq: number,
    impact: { x: number; y: number; z: number; nx: number; ny: number; nz: number; surface: string | null }): SourceImpactOutcome | null {
    if (!this.sourceImpacts || !impact.surface) return null;
    const draws = sourceImpactDraws(by, seq);
    return this.sourceImpacts.add({ x: impact.x, y: impact.y, z: impact.z,
      nx: impact.nx, ny: impact.ny, nz: impact.nz, surface: impact.surface,
      draw: draws.decal, scaleDraw: draws.scale, roll: draws.roll });
  }
  sourceImpactAudit() {
    return this.sourceImpacts?.audit() ?? null;
  }
  sourceProjectedShadowAudit() {
    return this.sourceProjectedShadows?.audit() ?? null;
  }
  /** Draws the original tracer along the shot's own line: from where the bullet started to
   * where the authority's trace says it stopped.
   *
   * The streak's speed, width, alpha, colour and length come from the system's own operators,
   * and the draws that pick inside each range come from the shot's identity, so every client
   * that received this shot draws the same streak.
   */
  sourceTracerShot(by: string, seq: number, weapon: WeaponId,
    from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): SourceTracerOutcome | null {
    if (!this.sourceTracers) return null;
    return this.sourceTracers.spawn({ weapon, by, seq, from: [from.x, from.y, from.z], to: [to.x, to.y, to.z] });
  }
  sourceTracerAudit() {
    return this.sourceTracers?.audit() ?? null;
  }
  /** The original impact sound event of a surface, or null when the shipped surface
   * table names none for it (the original decals some letters with no sound). */
  sourceImpactSoundName(surface: string | null) {
    return surface ? this.sourceImpacts?.table.impact[surface]?.bulletImpact ?? null : null;
  }
  ejectCasing() {
    const model=this.weaponCache.get(this.gunId);
    // The original bolt-action event71, later in awp_fire, owns ejection.
    if(model&&isSourceAWPViewmodel(model))return;
    // The shipped `weapon_shell_casing_*` system of this weapon, at the weapon's own
    // shell-eject attachment. The attachment is in the viewmodel's own space, so the camera
    // is what puts the casing into the world it then falls through.
    if(this.sourceShells&&this.sourceShells.table.weapons[this.gunId]){
      const local=model&&isSourcePistolViewmodel(model)?sourcePistolAttachment(model,'2',this.gunScene)
        :model&&isSourceViewmodel(model)?sourceAttachment(model,'ejection',this.gunScene):null;
      if(local){
        const world=new T.Matrix4().multiplyMatrices(this.camera.matrixWorld,local);
        this.sourceShells.spawn(this.gunId,world,[Math.random(),Math.random(),Math.random()]);
        return;
      }
    }
    if(model&&isSourcePistolViewmodel(model)){
      // Original attachment 2 is parented to v_weapon.shelleject (1 is flash).
      this.effects.eject(sourcePistolAttachment(model,'2',this.gunScene));return;
    }
    if(model&&isSourceViewmodel(model)){
      const position=new T.Vector3().setFromMatrixPosition(sourceAttachment(model,'ejection',this.gunScene));
      this.effects.eject(new T.Matrix4().makeTranslation(position.x,position.y,position.z));return;
    }
    const port = this.ejectionPorts.get(this.gunId);
    if (!port) return;
    this.gun.updateWorldMatrix(true, true);
    const position = new T.Vector3();
    if (!port.geometry.boundingBox) port.geometry.computeBoundingBox();
    port.geometry.boundingBox!.getCenter(position).applyMatrix4(port.matrixWorld);
    // View-space velocity must leave toward camera-right, irrespective of imported
    // node axis conventions. Position comes from the actual loaded ejection geometry.
    this.effects.eject(new T.Matrix4().makeTranslation(position.x + .015, position.y, position.z));
  }
  /** Queued once by the existing accepted-shot/prediction deduplication path.
   * The next render samples the original animation before resolving CP0. */
  sourceFirstPersonFlash(weapon:WeaponId,mode:number,shot:number,shooter:string){
    if(!this.originalDust2)return;
    // The weapon's own `muzzle_flash_effect_1st_person` decides, and only a system this
    // build has staged is queued; a family whose own system is not staged keeps the port's
    // own placeholder rather than being drawn with another weapon's original effect.
    if(!this.firstPersonMuzzle(weapon))return;
    this.pendingFirstPersonFlashes.push({weapon,mode,shot,shooter});
  }
  /** The original first-person system of one weapon of this client, resolved from the
   * shipped effect map; null when the original names one this build has not staged. */
  private firstPersonMuzzle(weapon:WeaponId){
    return sourceFirstPersonMuzzleSystem(this.sourceWeaponEffects?sourceWeaponEffects(this.sourceWeaponEffects,weapon):null,weapon);
  }
  /** Emits the shots the actor pass published, stamped with the clock this frame
   * samples the original systems at. Called from `frame()` right after the clock
   * advances, so an emission and the sample that draws it share one tick the way
   * the original's do. */
  emitWorldMuzzleShots(){
    for(const shot of this.pendingWorldMuzzleShots){
      if('vent' in shot.seeds){
        if(this.sourceWorldRifleParticles){this.sourceWorldRifleParticles.fire(this.sourceParticleAnchor(shot.position,shot.forward,shot.up),this.clock,shot.seeds);this.sourceWorldRifleBursts++;}
      }else if('awp' in shot.seeds){
        if(this.sourceWorldAwpParticles){this.sourceWorldAwpParticles.fire(this.sourceParticleAnchor(shot.position,shot.forward,shot.up),this.clock,shot.seeds);this.sourceWorldAwpBursts++;}
      }else if(this.sourceWorldPistolParticles){
        this.sourceWorldPistolParticles.fire({position:shot.position,forward:shot.forward},this.clock,shot.seeds);this.sourceWorldPistolBursts++;
      }
    }
    this.pendingWorldMuzzleShots.length=0;
  }
  private sourceParticleAnchor(position:T.Vector3,forward:T.Vector3,up:T.Vector3,view=false){
    const worldPosition=position.clone(),worldForward=forward.clone(),worldUp=up.clone();
    if(view){this.camera.updateMatrixWorld(true);worldPosition.applyMatrix4(this.camera.matrixWorld);worldForward.transformDirection(this.camera.matrixWorld);worldUp.transformDirection(this.camera.matrixWorld);}
    const sourcePosition:[number,number,number]=[worldPosition.x/.0254,-worldPosition.z/.0254,worldPosition.y/.0254];
    return{position,forward,up,sourcePosition,worldForward,worldUp,lightingColor:this.sourceParticleLighting?.sampleSourcePosition(sourcePosition)};
  }
  frameProfile = { effects: 0, wind: 0, particles: 0, projectedShadows: 0, visibility: 0, sky: 0, render: 0, total: 0 };
  frame(
    dt: number,
    p?: Player,
    menu = false,
    aim = false,
    moving = false,
    fov = 78,
    sourceRound = 0,
    sourceClockRunning = true,
  ) {
    const profile = this.frameProfile;
    const phaseStart = performance.now();
    let mark = performance.now();
    const phase = (key: keyof typeof profile) => { const now = performance.now(); profile[key] = now - mark; mark = now; };
    this.clock += dt;
    if(this.sourceSmokeRound!==sourceRound){this.sourceGrenadeSmoke?.clear();this.sourceSmokeRound=sourceRound;}
    if(this.sourceGrenadeSmoke)this.sourceGrenadeSmokeFrame=this.sourceGrenadeSmoke.update(this.clock);
    this.emitWorldMuzzleShots();
    this.effects.update(dt);
    this.magazineDrops.update(dt);
    // Casings fall through the world the shot was fired in, not the viewmodel's own frame.
    this.sourceShells?.update(dt, this.sourceShellTrace);
    // A tracer is drawn while the system's own draw distance allows and for as long as its own
    // flight lasts, so it has to see where the camera is.
    this.sourceTracers?.update(dt, this.camera);
    phase('effects');
    this.kick = Math.max(0, this.kick - dt * 6);
    this.hit = Math.max(0, this.hit - dt);
    this.damage = Math.max(0, this.damage - dt * 1.7);
    this.sourceViewAudit=null;
    this.sourceRifleViewAudit=null;
    if(this.sourceMap){
      const epoch=`${menu?'menu':'game'}:${this.sourceWindGeneration}`;
      if(epoch!==this.sourceWindEpoch){this.sourceWindEpoch=epoch;this.sourceWindTime=0;}
      else if(sourceClockRunning)this.sourceWindTime+=dt;
      this.sourceMap.updateWind(this.sourceWindTime,epoch);
      phase('wind');
    }
    if(menu||!p?.alive)this.sourceDrawActorKey=null;
    if (menu && this.sourceMap) {
      const spawn=this.sourceMap.level.spawns.find(s=>s.team==='amber')!;
      this.camera.position.set(spawn.x,spawn.y+this.sourceMap.level.player.standing.eyeHeight,spawn.z);
      this.camera.rotation.order='YXZ';this.camera.rotation.set(0,spawn.yaw,0);this.camera.fov=75;
    } else if (menu) {
      const t = this.clock * 0.035;
      this.camera.position.set(22 + Math.sin(t) * 5, 12, -24 + Math.cos(t) * 4);
      this.camera.lookAt(-3, 1, 2);
      this.camera.fov = 65;
    } else if (p) {
      const eye = this.resolveEye(p);
      this.camera.position.set(eye.x, eye.y, eye.z);
      this.camera.rotation.order = 'YXZ';
      if(p.sourceRifleHandling){
        const punch=p.sourceRifleHandling.punch,basis=sourceBrowserCameraBasis(p.yaw,p.pitch,punch);
        this.sourceViewMatrix.makeBasis(this.sourceViewRight.fromArray(basis.right),this.sourceViewUp.fromArray(basis.up),this.sourceViewBack.fromArray(basis.forward).negate());
        this.camera.quaternion.setFromRotationMatrix(this.sourceViewMatrix).normalize();
        this.sourceViewAudit={yaw:p.yaw,pitch:p.pitch,punch};
      }else{
        const recoil = recoilOffset(p);
        this.camera.rotation.set(p.pitch + recoil.pitch + this.kick * 0.008,p.yaw + recoil.yaw,0);
      }
      if(p.weapon==='awp'&&p.sourceAWP){
        // Original authoritative command FOV clock; smoothstep interpolation
        // between stored start/target, no renderer-side lerp. The same
        // authoritative player clock that drives the pose drives this.
        const now=p.sourceAWPPose?.clock?.time??this.clock;
        const referenceFov=sourceAWPFov(p.sourceAWP.command,now).value,horizontalFov=sourceAWPScaleFov(referenceFov,this.camera.aspect*.75);
        const verticalFov=2*Math.atan(Math.tan(horizontalFov*Math.PI/360)/this.camera.aspect)*180/Math.PI;
        this.camera.fov=verticalFov;this.sourceAWPProjection={referenceFov,horizontalFov,verticalFov,aspect:this.camera.aspect};
      }else this.camera.fov = T.MathUtils.lerp(
        this.camera.fov,
        aim && p.weapon === 'marshal' ? 30 : fov,
        Math.min(1, dt * 12),
      );
    }
    const inSmoke = this.clouds.some(
      (s) =>
        this.camera.position.distanceTo(new T.Vector3(s.x, s.y, s.z)) <
        smokeRadius(s) * 0.85,
    );
    if(this.originalDust2){
      // Two states, both the original's own ramp: the map's fog, and the near-opaque wash the
      // port's smoke device stands in for. three gets one fog per scene, so the cap travels in
      // a shared uniform instead of in the fog object.
      this.sourceFogApplied=inSmoke?PORT_SMOKE_FOG:this.sourceFogState;
      applySourceFog(this.scene,this.sourceFogApplied);
      // The original's sun shadow covers the view, not a fixed patch of the world: keep the
      // light and its target together on the camera so the box travels with the player. The
      // offset is the map's own sun direction, so the light does not turn while it follows.
      this.sun.target.position.copy(this.camera.position);
      this.sun.position.copy(this.sun.target.position).add(this.sunOffset);
    }else{
      const fog=this.scene.fog as T.FogExp2;
      fog.color.set(inSmoke ? '#91988f' : '#95acb7');
      fog.density = inSmoke ? 0.85 : 0.0035;
    }
    this.camera.updateProjectionMatrix();
    // The viewmodel is camera-local, so transform the same world lighting into
    // view space instead of using a fixed studio light while the player turns.
    this.inverseView.copy(this.camera.quaternion).invert();
    this.environmentOrientation.setFromEuler(this.scene.environmentRotation);
    this.gunScene.environmentRotation.setFromQuaternion(
      this.inverseView.clone().multiply(this.environmentOrientation),
    );
    this.lightingDirection.copy(this.sun.position).sub(this.sun.target.position)
      .normalize().applyQuaternion(this.inverseView);
    this.weaponSun.position.copy(this.weaponSun.target.position)
      .addScaledVector(this.lightingDirection, 3);
    if (p && (p.weapon !== this.gunId||(this.originalDust2&&p.team!==this.gunTeam))) this.setWeapon(p.weapon,p.team);
    const reload = p?.reload ?? 0;
    const model = this.weaponCache.get(this.gunId);
    this.sourcePistolFx=null;
    if(!menu&&p?.alive&&model&&hasSourceDraw(model)){
      const key=`${p.id}:${p.deaths}:${sourceRound}`;
      if(this.sourceDrawActorKey!==key){startSourceDraw(model);this.sourceDrawActorKey=key;}
    }
    if (model && isSourceViewmodel(model) && (aim || (!menu && !p?.alive))) cancelSourceInspection(model);
    if(model&&isSourcePistolViewmodel(model)&&(aim||(!menu&&!p?.alive)))cancelSourcePistolInspection(model);
    if(model&&isSourceAWPViewmodel(model)&&(aim||(!menu&&!p?.alive)))cancelSourceAWPInspection(model);
    if (model) { this.assets.animateWeapon(model, p, this.kick, dt,sourceRound); this.sourceRifleViewAudit=this.assets.sourceRifleViewAudit; }
    this.muzzle.visible = this.kick > 0.78 && !menu;
    this.muzzle.position.set(
      0,
      this.gunId === 'marshal' ? -0.037 : -0.003,
      { vandal: -0.568, m4a4:-0.568, glock:-0.166, usp:-0.166,deagle:-0.166, awp:-0.731, spectre: -0.399, marshal: -0.731, sidearm: -0.166, knife: -0.42 }[
        this.gunId
      ],
    );
    this.muzzle.rotation.z = this.clock * 31;
    this.gun.position.set(
      0.22 + (moving ? Math.sin(this.clock * 6) * 0.007 : 0),
      -0.22 +
        Math.sin(this.clock * 1.8) * 0.002 +
        (moving ? Math.cos(this.clock * 12) * 0.006 : 0),
      -0.32 + this.kick * 0.028,
    );
    this.gun.rotation.set(
      reload > 0 ? -0.22 : this.kick * 0.045,
      reload > 0 ? -0.16 : 0,
      reload > 0 ? -0.28 : 0,
    );
    if(model&&isSourcePistolViewmodel(model)){
      this.gun.position.set(0,0,0);this.gun.rotation.set(0,0,0);
      const fx=sourcePistolFxAttachments(model,this.gunScene,{silencerAttached:p?p.sourceUSP?.command.silencerAttached:true});
      this.muzzle.visible=false;
      for(const shot of this.pendingFirstPersonFlashes){
        if(this.firstPersonMuzzle(shot.weapon)?.renderer!=='pistol-field')continue;
        // Suppressed USP selects the original alternate particle field. Its
        // absent value is not permission to substitute the normal main/core.
        if(!menu&&p?.alive&&shot.weapon===fx.weapon&&sourcePistolParticleSystemForShot(shot.weapon,shot.mode)){
          this.sourcePistolParticles?.fire(fx.muzzle,this.clock);this.sourcePistolParticleBursts++;
        }
      }
      this.sourcePistolFx={version:fx.version,weapon:fx.weapon,muzzleAttachment:fx.muzzle.name,muzzlePosition:fx.muzzle.position.toArray(),muzzleForward:fx.muzzle.forward.toArray(),shellAttachment:fx.shellEject.name,
        particleRenderer:p?.weapon==='usp'&&p.sourceUSP?.command.silencerAttached?'native-alt-field-empty':this.sourcePistolParticles?.program.version??'not-loaded'};
    }else if(model&&isSourceAWPViewmodel(model)){
      this.gun.position.set(0,0,0);this.gun.rotation.set(0,0,0);
      // The anchor is taken in the viewmodel scene's own frame because that is the
      // frame the original first-person effect is drawn in.
      const socket=sourceAWPAttachment(model,'1',this.gunScene);this.muzzle.position.setFromMatrixPosition(socket);
      this.muzzle.scale.setScalar(1);this.muzzle.rotation.set(0,0,this.clock*31);
      // The weapon's own `muzzle_flash_effect_1st_person` names the same shipped system
      // as its third-person one, and this build has that system staged: the bolt-action's
      // own continuous flame and its own glow, anchored on the viewmodel's own muzzle
      // attachment rather than the world weapon's. Nothing here is picked by weapon name.
      const firstPerson=this.firstPersonMuzzle('awp');
      if(firstPerson?.renderer==='awp-chain'){
        // The original system is the flash, so the port's own cone does not stand in for it.
        this.muzzle.visible=false;
        for(const shot of this.pendingFirstPersonFlashes){
          if(shot.weapon!=='awp'||menu||!p?.alive||!this.sourceViewAwpParticles)continue;
          const position=new T.Vector3().setFromMatrixPosition(socket);
          const forward=new T.Vector3(1,0,0).transformDirection(socket);
          const up=new T.Vector3(0,1,0).transformDirection(socket);
          this.sourceViewAwpParticles.fire(this.sourceParticleAnchor(position,forward,up,true),this.clock,
            sourceWorldAwpMuzzleSeeds(shot.shooter,shot.shot));
          this.sourceViewAwpBursts++;
          this.sourceViewAwpLast={at:[+position.x.toFixed(4),+position.y.toFixed(4),+position.z.toFixed(4)],
            forward:[+forward.x.toFixed(4),+forward.y.toFixed(4),+forward.z.toFixed(4)],
            shooter:shot.shooter,weapon:shot.weapon,shot:shot.shot,system:firstPerson.system,
            attachment:'1'};
        }
      }
    }else if(model&&isSourceViewmodel(model)) {
      this.gun.position.set(0,0,0);this.gun.rotation.set(0,0,0);
      const socket=sourceAttachment(model,'muzzle',this.gunScene);
      this.muzzle.position.setFromMatrixPosition(socket);this.muzzle.scale.setScalar(1);
      this.muzzle.rotation.set(0,0,this.clock*31);
      // The rifle family's own first-person system, in the viewmodel's own scene and on the
      // viewmodel's own muzzle attachment, when this weapon's own first-person column names
      // a system this build has staged.
      const firstPerson=this.firstPersonMuzzle(this.gunId);
      if(firstPerson?.renderer==='rifle-vent'){
        // The original system is the flash, so the port's own cone does not stand in for it.
        this.muzzle.visible=false;
        for(const shot of this.pendingFirstPersonFlashes){
          if(shot.weapon!==this.gunId||menu||!p?.alive||!this.sourceViewRifleParticles)continue;
          const position=new T.Vector3().setFromMatrixPosition(socket);
          const forward=new T.Vector3(1,0,0).transformDirection(socket);
          const up=new T.Vector3(0,1,0).transformDirection(socket);
          this.sourceViewRifleParticles.fire(this.sourceParticleAnchor(position,forward,up,true),this.clock,
            sourceWorldRifleMuzzleSeeds(shot.shooter,shot.shot));
          this.sourceViewRifleBursts++;
          this.sourceViewRifleLast={at:[+position.x.toFixed(4),+position.y.toFixed(4),+position.z.toFixed(4)],
            forward:[+forward.x.toFixed(4),+forward.y.toFixed(4),+forward.z.toFixed(4)],
            shooter:shot.shooter,weapon:shot.weapon,shot:shot.shot,system:firstPerson.system,
            attachment:'muzzle'};
        }
      }
    } else if (model && isFalconViewmodel(model)) {
      this.gun.position.set(moving ? Math.sin(this.clock * 6) * .003 : 0,
        moving ? Math.cos(this.clock * 12) * .003 : 0, this.kick * .014);
      this.gun.rotation.set(this.kick * .015, 0, 0);
      updateFalconMuzzle(model, this.muzzle);
    } else if (model?.userData.approvedStaticWeapon) {
      const socket = model.getObjectByName('Socket_Muzzle');
      if (socket) {
        this.gun.updateWorldMatrix(true, true);
        const m = this.gun.matrixWorld.clone().invert().multiply(socket.matrixWorld);
        m.decompose(this.muzzle.position, this.muzzle.quaternion, this.muzzle.scale);
      }
    }
    if (menu && model && !isFalconViewmodel(model)&&!isSourceViewmodel(model)&&!isSourcePistolViewmodel(model)&&!isSourceAWPViewmodel(model)) {
      this.gun.position.set(0.38, -0.13, -0.42);
      this.gun.rotation.set(0.08, -0.35, -0.12);
    }
    const inspection = this.inspection.update(dt, reload > 0 || this.kick > .1 || aim || (!menu && !p?.alive));
    if(!model||!isSourceViewmodel(model)&&!isSourcePistolViewmodel(model)&&!isSourceAWPViewmodel(model)) {
      this.gun.position.x -= .12 * inspection.weight;
      this.gun.position.y += .075 * inspection.weight;
      this.gun.position.z -= .015 * inspection.weight;
      this.gun.rotation.y += (.28 + inspection.turn * .2) * inspection.weight;
      this.gun.rotation.z += (.5 - inspection.turn * .15) * inspection.weight;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const a = this.tracers[i];
      a.life -= dt;
      if (a.life <= 0) {
        this.scene.remove(a.mesh);
        a.mesh.geometry.dispose();
        (a.mesh.material as T.Material).dispose();
        this.tracers.splice(this.tracers.indexOf(a), 1);
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.v.y -= dt * 10;
      d.mesh.position.addScaledVector(d.v, dt);
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        (d.mesh.material as T.Material).dispose();
        this.debris.splice(this.debris.indexOf(d), 1);
      }
    }
    this.pendingFirstPersonFlashes.length=0;
    if(this.sourcePistolParticles){
      if(menu||!p?.alive)this.sourcePistolParticles.clear();
      const frame=this.sourcePistolParticles.update(this.clock);
      this.sourcePistolParticleCurrent=frame;
      if(frame.counts.main||frame.counts.core){this.sourcePistolParticleFrames.push(frame);if(this.sourcePistolParticleFrames.length>12)this.sourcePistolParticleFrames.shift();}
    }
    // The world-space instance of the same original graph serves every other
    // player's weapon; only a menu clears it, because one player's death does not
    // end someone else's flash.
    if(this.sourceWorldPistolParticles){
      if(menu)this.sourceWorldPistolParticles.clear();
      this.sourceWorldPistolParticles.update(this.clock);
    }
    if(this.sourceWorldRifleParticles){
      if(menu)this.sourceWorldRifleParticles.clear();
      // The original system's glow draws alongside the vent, so the count is kept
      // as evidence that the second subsystem really emitted.
      const frame=this.sourceWorldRifleParticles.update(this.clock);
      this.sourceWorldRifleGlowFrame=frame.glowCount;
      this.sourceWorldRifleGlowSprites+=frame.glowCount;
      this.sourceWorldRifleFlameFrame=frame.flameCount;
      this.sourceWorldRifleFlameSprites+=frame.flameCount;
      this.sourceWorldRifleContinuousSprites+=frame.continuousCount;
    }
    if(this.sourceWorldAwpParticles){
      if(menu)this.sourceWorldAwpParticles.clear();
      // The AWP's own chain draws a continuous flame and its glow; both counts are kept
      // as evidence that the second original subsystem emitted too.
      const frame=this.sourceWorldAwpParticles.update(this.clock);
      this.sourceWorldAwpFlameSprites+=frame.flameCount;
      this.sourceWorldAwpGlowSprites+=frame.glowCount;
    }
    // The shooter's own instance of the rifle family's system, drawn in the viewmodel scene.
    if(this.sourceViewRifleParticles){
      if(menu||!p?.alive)this.sourceViewRifleParticles.clear();
      const frame=this.sourceViewRifleParticles.update(this.clock);
      this.sourceViewRifleVentSprites+=frame.count;
      this.sourceViewRifleGlowSprites+=frame.glowCount;
      this.sourceViewRifleFlameSprites+=frame.flameCount;
      this.sourceViewRifleContinuousSprites+=frame.continuousCount;
      if(frame.count||frame.glowCount||frame.flameCount||frame.continuousCount){
        this.sourceViewRifleFrames.push({bursts:frame.bursts,vent:frame.particles,glow:frame.glow,
          flame:frame.flame,continuous:frame.continuous});
        if(this.sourceViewRifleFrames.length>8)this.sourceViewRifleFrames.shift();
      }
    }
    // The shooter's own instance of that same original system, drawn in the viewmodel
    // scene. One player's death ends their flash, so it is cleared with the pistol's.
    if(this.sourceViewAwpParticles){
      if(menu||!p?.alive)this.sourceViewAwpParticles.clear();
      const frame=this.sourceViewAwpParticles.update(this.clock);
      this.sourceViewAwpFlameSprites+=frame.flameCount;
      this.sourceViewAwpGlowSprites+=frame.glowCount;
      if(frame.flameCount||frame.glowCount){
        this.sourceViewAwpFrames.push({bursts:frame.bursts,flame:frame.flame,glow:frame.glow});
        if(this.sourceViewAwpFrames.length>8)this.sourceViewAwpFrames.shift();
      }
    }
    phase('particles');
    this.updateProjectedShadows(!menu&&p?.alive?(model??null):null);
    phase('projectedShadows');
    this.renderer.info.reset();
    // The sky's own TextureScroll advances on the same clock as everything else this frame.
    if(this.sourceMap){this.sourceVisibility=this.sourceMap.updateVisibility(this.camera.position);phase('visibility');this.sourceSkyView=this.sourceMap.updateSky(this.camera,this.clock);this.sourceMap.updateDetails(this.camera,this.clock);phase('sky');}
    const showGun = menu || (p?.alive && !(aim && p.weapon === 'marshal' && !reload) && !(p.weapon==='awp'&&p.sourceAWP?.command.scoped));
    if(this.worldComposite.autoExposure)this.renderer.toneMappingExposure=this.worldComposite.autoExposure.advance(dt);
    this.worldComposite.render(this.renderer, this.scene, this.camera,
      this.gunScene, showGun ? this.gunCamera : null,this.sourceSkyView?.enabled&&this.sourceMap?.sky?this.sourceMap.sky:undefined);
    if(this.sourceAWPScope){
      const active=!menu&&!!p?.alive&&p.weapon==='awp'&&!!p.sourceAWP;
      const key=active?`${sourceRound}:${p.id}:${p.deaths}`:'';
      if(key!==this.sourceAWPScopeKey){this.sourceAWPScope.reset();this.sourceAWPScopeKey=key;}
      const runtime=active?p.sourceAWP:undefined,mode=runtime?.command.mode??0;
      this.sourceAWPScope.render(this.renderer,{dt,player:active,scoped:runtime?.command.scoped??false,
        playerFov:active?this.sourceAWPProjection!.referenceFov:90,zoomFov:runtime?.command.zoomLevel===2?10:runtime?.command.zoomLevel===1?40:90,
        displayInaccuracy:runtime?sourceAWPInaccuracy(mode,runtime.handling.accuracy,sourcePlayerAccuracyContext(p!)):0,spread:SOURCE_AWP_ACCURACY_PROFILES[mode].spread});
    }
    phase('render');
    profile.total = performance.now() - phaseStart;
  }
  setQuality(q: string) {
    this.quality = q;
    this.renderer.setPixelRatio(
      q === 'low' ? 1 : Math.min(devicePixelRatio, q === 'ultra' ? 2 : 1.5),
    );
    this.renderer.shadowMap.enabled = q !== 'low';
    // The map's own `shadow_control` replaces the sun's shadow map on the original map, so quality
    // changes may not switch it back on. See game/source-projected-shadows.ts.
    this.sun.castShadow = q !== 'low' && !this.sourceProjectedShadows;
    this.weaponSun.castShadow = q !== 'low';
    this.sun.shadow.mapSize.set(
      q === 'ultra' ? 4096 : 2048,
      q === 'ultra' ? 4096 : 2048,
    );
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    for (const material of this.materials) material.needsUpdate = true;
    this.resize();
  }
  resize() {
    const w = this.canvas.clientWidth || innerWidth,
      h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.gunCamera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.gunCamera.updateProjectionMatrix();
  }
  assetAudit() {
    const model = this.weaponCache.get(this.gunId);
    const sourceFinishMaterials=this.sourceFinishAudit(model);
    return {
      map: this.sourceMap?.stats ?? this.portMap?.stats ?? null,
      sourceImpact: this.sourceImpactAudit(),
      sourceProjectedShadows: this.sourceProjectedShadowAudit(),
      sourceShells: this.sourceShells?.audit() ?? null,
      sourceGrenades: this.sourceGrenadeModels?.audit() ?? null,
      sourceDroppedWeapons:this.sourceDroppedWeapons?{loaded:true,verifiedFiles:Object.keys(this.sourceDroppedWeapons.verified).length,
        count:this.sourceDroppedWeapons.group.children.length,finishes:this.sourceFinishAudit(this.sourceDroppedWeapons.group)}:null,
      sourceExposure: this.worldComposite.autoExposure?.audit() ?? null,
      sourceSoftParticles: this.worldComposite.softParticles.audit(),
      sourceSun: this.worldComposite.sun?.audit()??null,
      sourceWorldBrass: {spawned:this.sourceWorldBrassCount,attachment:'shell_eject',awpTiming:'original animation event 71'},
      sourceGrenadeSmoke: this.sourceGrenadeSmoke?{hashVerified:this.sourceGrenadeSmoke.hashVerified,
        counts:this.sourceGrenadeSmokeFrame?.counts,events:this.sourceGrenadeSmokeFrame?.events,
        distortion:this.sourceGrenadeSmokeFrame?.distortion,tailLifecycle:'original PCF survives gameplay volume removal'}:null,
      sourceParticleLighting:{ready:!!this.sourceParticleLighting,error:this.sourceParticleLightingError,query:this.sourceParticleLighting?.audit,trace:this.sourceLightingTrace?.audit},
      sourceEnvironmentProbes: this.sourceProbes?{...this.sourceProbes.audit(),bindings:this.sourceProbeBindings.map(b=>b.audit())}:null,
      sourceTracers: this.sourceTracers?.audit() ?? null,
      sourceVisibility:this.sourceVisibility,
      sourceSky:this.sourceSkyView,sourcePistolFx:this.sourcePistolFx,
      sourceAWP:{projection:this.gunId==='awp'?this.sourceAWPProjection:null,brassEvents:this.sourceAWPBrass,scope:this.sourceAWPScope?{...this.sourceAWPScope.audit(),hashVerified:this.sourceAWPScope.hashVerified}:null},
      sourcePistolParticles:this.sourcePistolParticles?{version:this.sourcePistolParticles.program.version,hashVerified:this.sourcePistolParticles.hashVerified,bursts:this.sourcePistolParticleBursts,current:this.sourcePistolParticleCurrent,recentFrames:this.sourcePistolParticleFrames,
        limitations:this.sourcePistolParticles.program.limitations,space:'viewmodel-scene-metres',placeholderVisible:this.muzzle.visible}:null,
      // The shooter's own original first-person flashes, in the viewmodel scene: one entry
      // per shipped system this build has staged there. Each is the same shipped name its
      // third-person instance draws, but a separate program in a separate scene.
      sourceViewMuzzle:this.sourceViewAwpParticles||this.sourceViewRifleParticles?{space:'viewmodel-scene-metres',
        placeholderVisible:this.muzzle.visible,weapon:this.gunId,
        systems:{
          [SOURCE_RIFLE_MUZZLE_ROOT]:this.sourceViewRifleParticles?{bursts:this.sourceViewRifleBursts,
            programVersion:this.sourceViewRifleParticles.program.version,
            hashVerified:this.sourceViewRifleParticles.hashVerified,
            limitations:this.sourceViewRifleParticles.program.limitations,lastBurst:this.sourceViewRifleLast,
            sprites:{vent:this.sourceViewRifleVentSprites,glow:this.sourceViewRifleGlowSprites,
              flame:this.sourceViewRifleFlameSprites,continuous:this.sourceViewRifleContinuousSprites},
            recentFrames:this.sourceViewRifleFrames,
            configuration:{vent:this.sourceViewRifleParticles.program.configuration,
              glow:this.sourceViewRifleParticles.glow.configuration,
              flame:this.sourceViewRifleParticles.flame.configuration,
              continuous:this.sourceViewRifleParticles.continuous.configuration}}:null,
          [SOURCE_AWP_MUZZLE_ROOT]:this.sourceViewAwpParticles?{bursts:this.sourceViewAwpBursts,hero:this.sourceViewAwpParticles.flame.system,
            hashVerified:this.sourceViewAwpParticles.hashVerified,limitations:this.sourceViewAwpParticles.flame.limitations,
            flameSprites:this.sourceViewAwpFlameSprites,glowSprites:this.sourceViewAwpGlowSprites,
            lastBurst:this.sourceViewAwpLast,recentFrames:this.sourceViewAwpFrames,
            configuration:{flame:this.sourceViewAwpParticles.flame.configuration,
              glow:this.sourceViewAwpParticles.glow.configuration}}:null,
        }}:null,
      sourceWorldMuzzle:this.sourceWorldPistolParticles||this.sourceWorldRifleParticles||this.sourceWorldAwpParticles?{space:'world-metres',
        bursts:this.sourceWorldPistolBursts+this.sourceWorldRifleBursts+this.sourceWorldAwpBursts,
        reasons:this.sourceWorldMuzzleReasons,attachments:this.sourceWorldMuzzleCursors.size,lastBurst:this.sourceWorldLastBurst,
        // One entry per original third-person system this build has staged, each
        // with its own graph, material and texture.
        systems:{
          [SOURCE_PISTOL_WORLD_MUZZLE_SYSTEM]:this.sourceWorldPistolParticles?{bursts:this.sourceWorldPistolBursts,
            programVersion:this.sourceWorldPistolParticles.program.version,hashVerified:this.sourceWorldPistolParticles.hashVerified,
            limitations:this.sourceWorldPistolParticles.program.limitations}:null,
          [SOURCE_RIFLE_MUZZLE_ROOT]:this.sourceWorldRifleParticles?{bursts:this.sourceWorldRifleBursts,
            programVersion:this.sourceWorldRifleParticles.program.version,hashVerified:this.sourceWorldRifleParticles.hashVerified,
            limitations:this.sourceWorldRifleParticles.program.limitations,
            glowSprites:this.sourceWorldRifleGlowSprites,
            glowSpritesThisFrame:this.sourceWorldRifleGlowFrame,
            flameSprites:this.sourceWorldRifleFlameSprites,
            flameSpritesThisFrame:this.sourceWorldRifleFlameFrame,
            continuousFlameSprites:this.sourceWorldRifleContinuousSprites,
            configuration:{vent:this.sourceWorldRifleParticles.program.configuration,
              glow:this.sourceWorldRifleParticles.glow.configuration,
              flame:this.sourceWorldRifleParticles.flame.configuration,
              continuousFlame:this.sourceWorldRifleParticles.continuous.configuration}}:null,
          // The AWP's own dispatcher: the hunting rifle's continuous flame and its glow.
          [SOURCE_AWP_WORLD_MUZZLE_SYSTEM]:this.sourceWorldAwpParticles?{bursts:this.sourceWorldAwpBursts,
            flameSprites:this.sourceWorldAwpFlameSprites,glowSprites:this.sourceWorldAwpGlowSprites,
            hashVerified:this.sourceWorldAwpParticles.hashVerified,
            limitations:this.sourceWorldAwpParticles.flame.limitations,
            configuration:{flame:this.sourceWorldAwpParticles.flame.configuration,
              glow:this.sourceWorldAwpParticles.glow.configuration}}:null,
        }}:null,
      character: this.assets.sourceCharacter?{id:this.assets.sourceCharacter.manifest.poseVersion,hashVerified:this.assets.sourceCharacter.hashVerified,limitations:this.assets.sourceCharacter.manifest.limitations}:this.assets.falconStatus,
      counterTerrorist:this.assets.sourceCT?{id:this.assets.sourceCT.manifest.poseVersion,hashVerified:this.assets.sourceCT.hashVerified,limitations:this.assets.sourceCT.manifest.limitations}:null,
      originalM4:this.assets.sourceTM4&&this.assets.sourceCTM4?{t:{id:this.assets.sourceTM4.manifest.poseVersion,hashVerified:this.assets.sourceTM4.hashVerified},ct:{id:this.assets.sourceCTM4.manifest.poseVersion,hashVerified:this.assets.sourceCTM4.hashVerified}}:null,
      originalDeagle:Object.fromEntries(Object.entries(this.assets.sourceDeagleCharacters).map(([team,owner])=>[team,{id:owner.manifest.poseVersion,hashVerified:owner.hashVerified}])),
      originalAWP:Object.fromEntries(Object.entries(this.assets.sourceAWPCharacters).map(([team,owner])=>[team,{id:owner.manifest.poseVersion,hashVerified:owner.hashVerified}])),
      originalUSP:Object.fromEntries(Object.entries(this.assets.sourceUSPCharacters).map(([team,owner])=>[team,{id:owner.manifest.poseVersion,hashVerified:owner.hashVerified}])),
      originalGlock:Object.fromEntries(Object.entries(this.assets.sourceGlockCharacters).map(([team,owner])=>[team,{id:owner.manifest.poseVersion,hashVerified:owner.hashVerified}])),
      skin:sourceFinishMaterials.length?'source-ak-redline':model?.userData.weaponSkin ?? 'default',
      sourceWeaponFinish:{requested:this.sourceWeaponFinish,status:this.sourceFinishStatus(),materials:sourceFinishMaterials},
      materialOverride:sourceFinishMaterials.length?'Original style7 color/exponent with bounded Source Phong adaptation': model && (isSourceViewmodel(model)||isSourcePistolViewmodel(model)||isSourceAWPViewmodel(model)) ? 'Original '+model.userData.sourceWeapon+' albedo with bounded Source Phong adaptation' : (model?.userData.weaponSkin ?? 'default') === 'default' ? 'source PBR restored' : 'instance-only coating shader; source materials, skin and lenses preserved',
      paintedMeshes: model?.userData.paintedMeshes ?? 0,
      inspection: {elapsed:this.inspection.elapsed, weight:this.inspection.weight},
      effects: ['casing', 'smoke', 'debris', 'flash'].map(kind => {
        const mesh = (kind === 'casing' ? this.gunScene : this.scene).getObjectByName(`CombatEffects_${kind}`) as T.InstancedMesh;
        return {kind, count: mesh?.count ?? 0, visible: mesh?.visible ?? false};
      }),
      magazineDrops: {active: this.magazineDrops.active, budget: SOURCE_MAGAZINE_DROP_BUDGET, props: this.magazineDrops.audit()},
      firstPerson: model ? { name: model.name, scale: model.scale.toArray(),team:this.gunTeam,armsProfile:model.userData.sourceArmsProfile,
        hashVerified:isSourceAWPViewmodel(model)?this.assets.sourceAWPViewmodels[this.gunTeam]?.hashVerified:isSourcePistolViewmodel(model)?(model.userData.sourceWeapon==='deagle'?this.assets.sourceDeagleViewmodels:model.userData.sourceWeapon==='usp'?this.assets.sourceUSPViewmodels:this.assets.sourceGlockViewmodels)[this.gunTeam]?.hashVerified:model.userData.sourceWeapon==='m4a4'?(model.userData.sourceArmsProfile==='ct_arms_idf'?this.assets.sourceM4Viewmodel?.hashVerified:this.assets.sourceM4TViewmodel?.hashVerified):
          model.userData.sourceArmsProfile==='ct_arms_idf'?this.assets.sourceCTViewmodel?.hashVerified:model.userData.sourceArmsProfile==='t_arms'?this.assets.sourceTViewmodel?.hashVerified:undefined,
        detail: isSourceAWPViewmodel(model)?inspectSourceAWPViewmodel(model):isSourcePistolViewmodel(model)?inspectSourcePistolViewmodel(model):isSourceViewmodel(model)?inspectSourceViewmodel(model):isFalconViewmodel(model) ? inspectFalconViewmodel(model) : model.userData } : null,
      actors: [...this.actors.entries()].slice(0,10).map(([id,root]) => ({id,name:root.name,
        visible:root.visible,scale:root.scale.toArray(),position:root.position.toArray(),
        skin:root.userData.weaponSkin,paintedMeshes:root.userData.paintedMeshes,
        sourceWeaponFinish:this.sourceFinishAudit(root),
        death:root.userData.deathPresentation ?? null,
        asset:root.userData.assetRelease,clip:root.userData.sampledClip,time:root.userData.sampledClipTime,
        sourceWeapon:root.userData.sourceWeaponId,pistolStatus:['glock','usp','deagle','awp'].includes(root.userData.sourceWeaponId)?root.userData.sourceCharacter?.status:undefined,
        pelvisDrop:root.userData.poseReport?.pelvisDrop,feet:root.userData.poseReport?.feet,
        legBones:['L','R'].map(side=>({side,positions:['Thigh','Calf','Foot'].map(part=>
          root.getObjectByName(`Bip01_${side}_${part}`)?.getWorldPosition(new T.Vector3()).toArray())})),
      })),
    };
  }
  dispose() {
    this.sourceActorBounds.dispose();
    this.sourceDroppedWeapons?.dispose();this.sourceDroppedWeapons=null;
    for(const owner of this.sourceFinishReady.values())owner.dispose();
    this.sourceFinishReady.clear();this.sourceFinishOwners.clear();this.sourceFinishRequests.clear();
    this.sourcePistolParticles?.dispose();this.sourcePistolParticles=null;this.pendingFirstPersonFlashes.length=0;
    this.sourceWorldPistolParticles?.dispose();this.sourceWorldPistolParticles=null;this.sourceWorldMuzzleCursors.clear();this.pendingWorldMuzzleShots.length=0;
    this.sourceWorldAwpParticles?.dispose();this.sourceWorldAwpParticles=null;
    this.sourceViewAwpParticles?.dispose();this.sourceViewAwpParticles=null;this.sourceViewAwpFrames.length=0;
    // The rifle family's two instances were left to the garbage collector until now; both
    // hold their own staged textures, so they are released with the rest.
    this.sourceWorldRifleParticles?.dispose();this.sourceWorldRifleParticles=null;
    this.sourceViewRifleParticles?.dispose();this.sourceViewRifleParticles=null;this.sourceViewRifleFrames.length=0;
    this.sourceAWPScope?.dispose();this.sourceAWPScope=null;
    this.mapAbort.abort();
    this.sourceMap?.dispose();this.sourceMap=null;this.sourceVisibility=null;
    this.sourceImpacts?.dispose();this.sourceImpacts=null;
    this.sourceProjectedShadows?.dispose();this.sourceProjectedShadows=null;
    this.sourceViewmodelShadow?.dispose();this.sourceViewmodelShadow=null;
    this.sourceShells?.dispose();this.sourceShells=null;
    this.worldComposite.softParticles.sceneColor=null;this.sourceGrenadeSmoke?.dispose();this.sourceGrenadeSmoke=null;
    this.sourceGrenadeModels?.dispose();this.sourceGrenadeModels=null;this.grenadeMeshes.clear();
    this.setSourceParticleLightingWorld(null);
    this.sourceProbeBindings.forEach(b=>b.dispose());this.sourceProbeBindings=[];this.sourceProbes?.dispose();this.sourceProbes=null;
    this.sourceTracers?.dispose();this.sourceTracers=null;
    this.effects.dispose();
    this.magazineDrops.dispose();
    for (const model of this.weaponCache.values()) disposeWeaponSkin(model);
    for (const actor of this.actors.values()) disposeWeaponSkin(actor);
    this.worldComposite.dispose();
    this.disposed = true;
    if (this.portMap) { this.scene.remove(this.portMap.root); this.portMap.dispose(); this.portMap = null; }
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    this.gunScene.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.geometries.forEach((g) => g.dispose());
    for (const model of this.weaponCache.values()) disposeFalconViewmodel(model);
    for (const model of this.weaponCache.values()) this.assets.releaseSourceWeapon(model);
    this.assets.dispose();
    for (const root of this.actors.values()) {
      (root.userData.mixer as T.AnimationMixer | undefined)?.stopAllAction();
    }
    this.renderer.dispose();
  }
}
