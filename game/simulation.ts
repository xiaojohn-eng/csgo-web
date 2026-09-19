import { CHARACTER, eyeHeight, eyeOrigin, capsuleHeight, characterHitVolumes, characterReferences,characterBlend } from './character-contract.js';
import {advanceLocomotion,readLocomotion,type LocomotionPose} from './locomotion.js';
import { advanceStance, stanceBlend } from './falcon-stance.js';
import {clearancePose,resolvePoseMotion,POSE_OBSTACLE_FLAGS,type PoseResolution} from './pose-clearance.js';
import {samplePoseFrame} from './pose-timeline.js';
import {createSourceLevel,SOURCE_PROP_GROUND_PROBE} from './source-level.js';
import {sourceRagdollVelocityFromWorld,type SourceRagdollGround} from './source-ragdoll.js';
import {createSourceDroppedWeaponPhysics,isSourceDroppedWeapon,sourceDroppedWeaponPoseFromRest,SOURCE_DROPPED_WEAPON_MAX_PHYSICS_STEP} from './source-dropped-weapons.js';
import {createSourcePlayerMovement} from './source-player-movement.js';
import {createSourcePlayerContract,SOURCE_PLAYER_CONTRACT_ID,type SourceActorPose,type SourcePoint} from './source-player-contract.js';
import type {SourceGrenadeThrowStyle} from './source-character-pose.js';
import {SOURCE_GRENADE_COLLIDERS} from './source-grenade-colliders.js';
import type {SourceScenario} from './source-scenario.js';
import {computeSourceBulletDamage,type SourceBulletDamageResult} from './source-damage.js';
import {sourceBulletPenetrationFactor} from './source-bullet-penetration.js';
import {sourceArmorPurchase} from './source-armor.js';
import {SOURCE_DEFAULT_RULE_SET,sourceRuleSet,sourceKillCash,sourceLoserBonus,sourceTeamWinCash,sourceBuyWindowOpen,sourceMatchFormat,SOURCE_CONSECUTIVE_LOSS_AVERSION,sourceFriendlyFireMultiplier,type SourceGamemode,type SourceMatchFormat,type SourceRoundWinKind,type SourceRuleSetId} from './source-gamemode.js';
import {sourceKillAward} from './source-kill-award.js';
import {createSourceRifleHandlingState,sourceRifleHandlingMovementTick,sourceRifleHandlingWeaponTick,sourceRifleHandlingSwitch,sourceRifleHandlingShot,sourceRifleHandlingAfterAcceptedShot} from './source-rifle-handling.js';
import {sourceRifleOnLand} from './source-landing.js';
import {isSourcePistol,sourceOwnedPistolOnLand,sourceOwnedPistol,sourcePistolHandling,createSourceSecondary,sourceOwnedPistolDeploy,sourceOwnedPistolHolster,sourceOwnedPistolFrame,sourceOwnedPistolPostThink} from './source-owned-pistol.js';
import {SOURCE_UTILITY_SHOP,SOURCE_DEFUSE_KIT_COST,SOURCE_OBJECTIVE_TIMERS,sourceUtilityPurchaseAllowed,sourceWeaponTeamAllows} from './source-economy.js';
import {advanceSourceViewmodelAnimTimes} from './source-viewmodel-animation-time.js';
import {SOURCE_GLOCK_BUTTONS} from './source-glock-command.js';
import {createSourceAWPRuntimeState,sourceAWPRuntimeDeploy,sourceAWPRuntimeHolster,sourceAWPRuntimeFrame,sourceAWPRuntimePostThink} from './source-awp-runtime.js';
import {SOURCE_AWP_ACCURACY_PROFILES} from './source-awp-accuracy.js';
import {sourceAWPHandlingOnLand} from './source-awp-handling.js';
import {computeSourceAWPBulletDamage} from './source-awp-damage.js';
import {sourceCommandSeed} from './source-seed.js';
import {sourceRifleId,sourcePlayerAccuracyContext,freshSourceRifleSeed} from './source-player-handling.js';
import {sourceBrowserShotBasis} from './source-aim.js';
import {sourceSpreadDirection} from './source-spread.js';
import type {SourceCollisionRole} from './source-map-collision.js';
import {sourceBuyZoneAllows,type SourceBuyZone} from './source-buy-zone.js';
import {validSourceWeaponFinish,type SourceFinishWeaponId,type SourceWeaponFinish} from './source-weapon-finish.js';
import type {SourceNavWaypoint} from './source-navigation.js';
import { smokeBlocks, flashExposure, type Smoke } from './tactics.js';
import {
  accelerate,
  recoverAccuracy,
  shotDirection,
  registerShot,
  recoilOffset,
} from './handling.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { SOURCE_IMPACT_BUILD, loadSourceImpactTable, sourceImpactSurfaceFor,
  type SourceImpactTable } from './source-impact-table.js';
import { BOXES, SPAWN_POSES, SITES, isInsideSite, pathfind, sight, wallDistance } from './map.js';
import {
  EMPTY_INPUT,
  WEAPONS,
  cleanName,
  type Team,
  type Mode,
  type Player,
  type Input,
  type Snapshot,
  type Event,
  type EventDraft,
  type WeaponId,
  type Utility,
} from './types.js';
let initialization: Promise<void> | null = null;
export async function initPhysics() {
  initialization ??= RAPIER.init();
  await initialization;
}
const DT = 1 / 60;
export class Simulation {
  world: RAPIER.World;
  controller: RAPIER.KinematicCharacterController;
  readonly sourceLevel:ReturnType<typeof createSourceLevel>|null;
  private readonly sourceMovement:ReturnType<typeof createSourcePlayerMovement>|null;
  readonly sourcePlayerContract:ReturnType<typeof createSourcePlayerContract>|null;
  /** The original surface table of the map this instance runs, or null when no original
   * level is loaded. Its presence is what makes a bullet report an original surface. */
  private sourceImpacts:SourceImpactTable|null=null;
  readonly sourceWeaponIds:ReadonlySet<WeaponId>|null;
  readonly sourceDefaultWeapons:Record<Team,WeaponId>;
  readonly sourceDefaultSecondaries:Partial<Record<Team,WeaponId>>;
  private readonly rifleSeed:()=>number;
  private readonly pistolSeed:()=>number;
  private readonly pistolCommandSeeds=new Map<string,{seq:number;seed:number}>();
  readonly scenarioIdentity:{mapId:string;sourceBspSha256:string;sourceNavSha256:string;simulationVersion?:string;playerContract:string;hitboxStatus:string;poseDriverId:string|null}|null;
  private poseResolutions=new WeakMap<RAPIER.Collider,PoseResolution>();
  private readonly stairTreads=BOXES.filter(box=>box.kind==='step');
  bodies = new Map<
    string,
    { body: RAPIER.RigidBody; collider: RAPIER.Collider }
  >();
  players: Player[] = [];
  inputs = new Map<string, Input>();
  tick = 0;
  private sourceItemInputs = new Map<string, { seq: number; use: boolean }>();
  private sourceItemSerial = 0;
  time = 0;
  phase: Snapshot['phase'] = 'buy';
  remaining = 12;
  round = 1;
  score = { amber: 0, blue: 0 };
  winner: Team | null = null;
  /** Consecutive-loss counters, created from the active mode's `mp_starting_losses`. */
  private lossStreakStore: Record<Team, number> | null = null;
  private get startingLosses(): number { return this.rules?.teamCash.startingLosses ?? 1; }
  private get lossStreak(): Record<Team, number> {
    if (!this.lossStreakStore) this.lossStreakStore = { amber: this.startingLosses, blue: this.startingLosses };
    return this.lossStreakStore;
  }
  /** The original competitive rules drive the LAN match — the short competitive
   * mode, which is that same config plus the two keys its override file names — and
   * the practice mode keeps its own sandbox money so solo training never runs dry. */
  private get rules(): SourceGamemode | null { return this.mode === 'training' ? null : sourceRuleSet(this.ruleSet); }
  /** The active mode's original cash amounts. Practice is a sandbox for money, but
   * the amounts it awards are the original ones. */
  /** The scenario map's own buy volumes; empty means the scenario declares none. */
  private readonly buyZones: readonly SourceBuyZone[];

  private get cashRules(): SourceGamemode { return sourceRuleSet(this.ruleSet); }
  /** A reduced rifle-only fixture has no legal secondary animation/command
   * owner. Keep its declared test loadout; the full R4 scene supplies both teams'
   * native pistols and therefore always uses the real competitive inventory. */
  private sourceCompetitiveInventory(team:Team):boolean {
    return !!this.sourceLevel&&this.mode!=='training'&&isSourcePistol(this.sourceDefaultSecondaries[team]);
  }
  /** Client-selected defaults are authority-owned preferences. They are kept
   * apart from the finish currently attached to each in-world slot so picking
   * up an enemy weapon never gets overwritten by a later loadout sync. */
  private sourceFinishLoadouts = new Map<string, Partial<Record<SourceFinishWeaponId, SourceWeaponFinish>>>();
  private sourceFinishEquals(a:SourceWeaponFinish|undefined,b:SourceWeaponFinish|undefined){
    return !!a&&!!b&&a.weapon===b.weapon&&a.paintKitId===b.paintKitId&&a.seed===b.seed&&a.wear===b.wear;
  }
  private sourceSlotFinish(p:Player,weapon:WeaponId){
    const slot=weapon==='awp'||weapon==='vandal'||weapon==='m4a4'?p.primaryFinish:
      isSourcePistol(weapon)?p.secondaryFinish:undefined;
    return slot??(p.sourceWeaponFinish?.weapon===weapon?p.sourceWeaponFinish:undefined);
  }
  private setSourceSlotFinish(p:Player,weapon:WeaponId,finish:SourceWeaponFinish|undefined){
    if(weapon==='awp'||weapon==='vandal'||weapon==='m4a4'){
      if(finish)p.primaryFinish=structuredClone(finish);else delete p.primaryFinish;
    }else if(isSourcePistol(weapon)){
      if(finish)p.secondaryFinish=structuredClone(finish);else delete p.secondaryFinish;
    }
  }
  private syncSourceActiveFinish(p:Player){
    const finish=this.sourceSlotFinish(p,p.weapon);
    if(finish&&finish.weapon===p.weapon)p.sourceWeaponFinish=structuredClone(finish);
    else delete p.sourceWeaponFinish;
  }
  /** Apply one explicit loadout default. A slot carrying a picked-up finish is
   * left untouched; an owned/default slot follows the new preference. */
  setSourceFinishLoadout(id:string,weapon:SourceFinishWeaponId,finish:SourceWeaponFinish|null){
    const next=finish?validSourceWeaponFinish(finish):null;
    if(finish&&(!next||next.weapon!==weapon))return false;
    const map=this.sourceFinishLoadouts.get(id)??{};
    const previous=map[weapon];
    if(next)map[weapon]=structuredClone(next);else delete map[weapon];
    this.sourceFinishLoadouts.set(id,map);
    const p=this.players.find(row=>row.id===id);if(!p)return true;
    const current=this.sourceSlotFinish(p,weapon);
    const picked=weapon==='awp'||weapon==='vandal'||weapon==='m4a4'?p.primaryFinishPicked:p.secondaryFinishPicked;
    if(!picked&&(!current||this.sourceFinishEquals(current,previous))){
      this.setSourceSlotFinish(p,weapon,next??undefined);
      if(p.weapon===weapon)this.syncSourceActiveFinish(p);
    }
    return true;
  }
  setSourceFinishLoadoutBulk(id:string,values:unknown){
    if(!Array.isArray(values))return false;
    for(const value of values){
      if(!value||typeof value!=='object')return false;
      const finish=validSourceWeaponFinish(value);if(!finish)return false;
    }
    for(const value of values as SourceWeaponFinish[])this.setSourceFinishLoadout(id,value.weapon,value);
    return true;
  }
  /** Reset only equipment. Cash and score are handled by the round owner. */
  private resetSourceInventory(p:Player):void {
    const competitive=this.sourceCompetitiveInventory(p.team);
    p.primary=competitive?null:this.sourceDefaultWeapons[p.team];
    p.secondary=this.sourceDefaultSecondaries[p.team];
    p.weapon=p.primary??p.secondary!;p.slot=p.primary===null?1:0;
    p.primaryAmmo=p.primary?WEAPONS[p.primary].mag:0;
    p.primaryReserve=p.primary?WEAPONS[p.primary].reserve:0;
    p.armor=0;p.helmet=false;p.defuseKit=false;
    p.grenades=p.smokes=p.flashes=competitive?0:1;
  }
  /** AI uses the same priced purchase path as a human. It must not manufacture
   * a rifle when a round loss leaves its budget below the weapon's price. */
  private buySourceBotEquipment(p:Player):void {
    if(!p.bot||!this.sourceCompetitiveInventory(p.team)||!this.canBuy(p))return;
    if(p.primary===null)this.buy(p.id,this.sourceDefaultWeapons[p.team]);
    this.buy(p.id,'armor');
    if(p.team==='blue')this.buy(p.id,'defuseKit');
  }
  /** The original match format: how many rounds win, and whether ends change. */
  get format(): SourceMatchFormat | null { const rules = this.rules; return rules ? sourceMatchFormat(rules) : null; }
  private award(p: Player, amount: number): void {
    p.money = Math.min(this.rules?.money.max ?? 16000, p.money + amount);
  }
  /** The original buy window: through the freeze time, and `mp_buytime` seconds
   * measured from the round's start, so it runs into the live round. */
  /** The original buy window, and — when the caller names the player — the original
   * `func_buyzone` volume they have to be standing in. The window alone answers the
   * window's own tests; the buy path and the snapshot always name the player. */
  canBuy(p?: Player): boolean {
    const rules = this.rules;
    if (!(rules ? sourceBuyWindowOpen(rules, this.phase, this.remaining, false) : true)) return false;
    // The volumes are the scenario map's own data, so a scenario that declares none has no
    // rule to apply; the shipped map scenario always declares the map's own.
    if (!this.buyZones.length || !p) return true;
    // The port's own team names against the original's: its blue team is the map's
    // `info_player_counterterrorist`, which is the original's Counter-Terrorist, teamnum 3.
    return sourceBuyZoneAllows(this.buyZones, p, p.team === 'blue' ? 3 : 2);
  }
  reason = '';
  events: Event[] = [];
  eid = 0;
  bomb: Snapshot['bomb'] = {
    planted: false,
    dropped: false,
    x: 0,
    y: 0,
    z: 0,
    timer: 35,
    site: '',
    carrier: null,
  };
  ai = new Map<
    string,
    {
      path: ({x:number;z:number;y?:number;areaId?:number;kind?:SourceNavWaypoint['kind'];flags?:number;supportY?:number|null})[];
      sourceBlockedFor?:number;
      sourceAttackHeld?:boolean;
      sourceLast?:{x:number;y:number;z:number};
      timer: number;
      reaction: number;
      target: string | null;
    }
  >();
  grenades: {
    id: number;
    by: string;
    kind: 'he' | 'smoke' | 'flash';
    body: RAPIER.RigidBody;
    timer: number;
  }[] = [];
  smokes: Smoke[] = [];
  readonly droppedWeapons:ReturnType<typeof createSourceDroppedWeaponPhysics>;
  stepTicks = new Map<string, number>();
  history: {
    time: number;
    players: ({
      id: string;
      x: number;
      y: number;
      z: number;
      alive: boolean;
      deaths: number;
      team: Team;
      crouch: boolean;
      yaw: number;
      pitch: number;
      stancePhase: number;
      stanceRate: number;
      stanceTarget: boolean;
    } & LocomotionPose & Partial<Pick<Player,'weapon'|'secondary'|'sourceContract'|'sourceJumpHeld'|'sourcePose'|'sourcePoseVersion'|'sourcePistolPose'|'sourceGlock'|'sourceUSP'|'sourceDeagle'|'sourceAWP'|'sourceAWPPose'|'sourceRifleHandling'|'sourceViewmodelTime'>>)[];
  }[] = [];
  rng = 69421;
  disposed = false;
  constructor(
    public mode: Mode = 'demolition',
    public bots = true,
    scenario?:SourceScenario,
    /** Which original mode's rules this match plays. */
    public ruleSet: SourceRuleSetId = SOURCE_DEFAULT_RULE_SET,
  ) {
    this.world = new RAPIER.World({ x: 0, y: -(scenario?.level.player.gravity??22), z: 0 });
    this.droppedWeapons=createSourceDroppedWeaponPhysics(this.world);
    this.sourceLevel=null;this.sourceMovement=null;this.sourcePlayerContract=null;this.scenarioIdentity=null;
    this.sourceWeaponIds=scenario?new Set(scenario.weapons??['vandal']):null;
    this.rifleSeed=scenario?.rifleSeed??freshSourceRifleSeed;
    this.pistolSeed=scenario?.pistolSeed??freshSourceRifleSeed;
    this.buyZones=scenario?.buyZones??[];
    this.sourceDefaultWeapons={amber:scenario?.defaultWeaponByTeam?.amber??'vandal',blue:scenario?.defaultWeaponByTeam?.blue??'vandal'};
    this.sourceDefaultSecondaries={...(this.sourceWeaponIds?.has('glock')?{amber:'glock' as const}:{}),...scenario?.defaultSecondaryWeaponByTeam};
    if(this.sourceWeaponIds&&([...this.sourceWeaponIds].some(id=>id!=='vandal'&&id!=='m4a4'&&id!=='awp'&&!isSourcePistol(id))||
      Object.values(this.sourceDefaultWeapons).some(id=>(id!=='vandal'&&id!=='m4a4')||!this.sourceWeaponIds!.has(id))||
      Object.values(this.sourceDefaultSecondaries).some(id=>!isSourcePistol(id)||!this.sourceWeaponIds!.has(id))))throw Error('Unsupported original Source loadout');
    this.controller = this.world.createCharacterController(0.015);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.controller.enableAutostep(0.28, 0.2, true);
    this.controller.enableSnapToGround(0.18);
    if (!scenario) for (const b of BOXES)
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(
          b.x,
          b.y,
          b.z,
        ),
      );
    if(scenario){
      try{
        this.sourceLevel=createSourceLevel(this.world,scenario.level,scenario.collision,{navigation:scenario.navigation});
        this.sourceMovement=createSourcePlayerMovement(this.world,this.sourceLevel);
        this.sourcePlayerContract=createSourcePlayerContract(scenario.level.player,scenario);
        // The surface table is refused outright when it does not describe this exact map,
        // so a bullet can never be given another build's decal or impact sound. A scenario
        // that declares none simply reports no surface.
        this.sourceImpacts=scenario.impacts===undefined?null
          :loadSourceImpactTable(scenario.impacts,{build:SOURCE_IMPACT_BUILD,
            sourceBspSha256:scenario.level.sourceBspSha256});
        this.scenarioIdentity={mapId:scenario.mapId??scenario.level.id,sourceBspSha256:scenario.level.sourceBspSha256,
          sourceNavSha256:scenario.level.sourceNavSha256,simulationVersion:scenario.simulationVersion,playerContract:SOURCE_PLAYER_CONTRACT_ID,
          hitboxStatus:this.sourcePlayerContract.hitboxStatus,poseDriverId:scenario.poseDriver?.id??null};
        this.world.step();
      }catch(error){this.sourceMovement?.dispose();this.sourceLevel?.dispose();this.world.removeCharacterController(this.controller);this.world.free();throw error;}
    }
    if (mode === 'training') {
      this.phase = 'live';
      this.remaining = 180;
    } else {
      // LAN rooms construct the first round directly; only later rounds call
      // nextRound(). Both paths must start with the selected mode's freeze time.
      this.remaining = this.rules!.timers.freezeTime;
    }
    if(this.sourceLevel)this.bomb.timer=SOURCE_OBJECTIVE_TIMERS.fuse;
  }
  eyeOrigin(p:SourceActorPose){return this.sourcePlayerContract?this.sourcePlayerContract.eyeOrigin(p):eyeOrigin(p);}
  sight(a:SourcePoint,b:SourcePoint){return this.sourceLevel?this.sourceLevel.sight(a,b):sight(a,b);}
  /** The original map surface under a corpse. The authoritative ragdoll rests on
   * Dust2's real geometry (ramps, crates, ledges) instead of one plane frozen at
   * the death instant, so a corpse killed in mid-air actually falls to the
   * ground below it. A physics prop rests on MASK_SOLID, which is exactly this
   * level's 'projectile' role. */
  private ragdollGround(p:Player):SourceRagdollGround|undefined{
    const level=this.sourceLevel;if(!level)return undefined;
    return {x:p.x,y:p.y,z:p.z,yaw:p.yaw,metersPerSourceUnit:level.metersPerSourceUnit,
      physicsWorld:this.world,
      surfaceY:(x:number,z:number,fromY:number)=>level.groundHeight(x,z,fromY)};
  }
  wallDistance(x:number,y:number,z:number,dx:number,dy:number,dz:number,role:SourceCollisionRole='bullet'){
    return this.sourceLevel?this.sourceLevel.wallDistance(x,y,z,dx,dy,dz,role):wallDistance(x,y,z,dx,dy,dz);
  }
  private sitesFor(p:Player){return this.sourceLevel?this.sourceLevel.sites.filter(s=>
    this.sourceLevel!.sitesForSourcePlayer(p,p.crouch?'crouching':'standing').includes(s.name)):
    SITES.filter(s=>isInsideSite(s,p.x,p.z,p.y));}
  private sourceWaypointY(point:{x:number;y?:number;z:number;flags?:number;supportY?:number|null},p:Player){
    if(point.supportY!==undefined)return point.supportY;
    const level=this.sourceLevel;if(!level||point.y===undefined)return null;
    const stance=(point.flags??0)&1?'crouching':'standing',half=level.player[stance].halfExtents,shape=new RAPIER.Cuboid(...half);
    const identity={x:0,y:0,z:0,w:1},groups=level.queryGroups('player'),self=this.bodies.get(p.id)?.collider;
    const onlyMap=(c:RAPIER.Collider)=>level.collision.metadata.has(c.handle)&&!c.isSensor();
    // Original NAV heights approximate the walking surface. Resolve their local
    // support with the original hull, retaining the raw NAV y/area/portal data.
    // Never bridge a different storey: both start and landing stay within one
    // original step of NAV y. Low ceilings also constrain the candidate hull.
    const increments=[0];for(let i=2;i<=18;i+=2)increments.push(i,-i);
    for(const units of increments){
      const feetY=point.y+units*level.metersPerSourceUnit,center={x:point.x,y:feetY+half[1],z:point.z},candidates:RAPIER.Collider[]=[];
      this.world.intersectionsWithShape(center,identity,shape,c=>{candidates.push(c);return true;},RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,groups,self,undefined,onlyMap);
      if(candidates.some(c=>(c.contactShape(shape,center,identity,0)?.distance??0)<-1e-5))continue;
      const hit=this.world.castShape(center,identity,{x:0,y:-1,z:0},shape,0,2*level.player.stepHeight,true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,groups,self,undefined,onlyMap);
      if(hit&&hit.normal1.y>=level.player.standableNormal){const y=feetY-hit.time_of_impact;
        if(Math.abs(y-point.y)<=level.player.stepHeight){point.supportY=y;return y;}}
    }
    point.supportY=null;return null;
  }
  random() {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }
  emit(e: EventDraft) {
    this.events.push({ ...e, time: this.time, id: ++this.eid });
    if (this.events.length > 80) this.events.shift();
  }
  addPlayer(id: string, name: string, team: Team, bot = false) {
    const competitive=this.sourceCompetitiveInventory(team);
    const primary=competitive?null:this.sourceDefaultWeapons[team];
    const weapon=primary??this.sourceDefaultSecondaries[team]!;
    const p: Player = {
      id,
      name: cleanName(name),
      team,
      bot,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      vy: 0,
      vx: 0,
      vz: 0,
      shotHeat: 0,
      shotIdle: 10,
      grounded: true,
      crouch: false,
      stancePhase: 0,
      stanceRate: 0,
      stanceTarget: false,
      stridePhase:0,strideWeight:0,strideSpeed:0,strideX:0,strideZ:-1,
      hp: 100,
      armor: 0,
      helmet:false,
      defuseKit:false,
      alive: true,
      weapon,
      primary,
      ...(this.sourceDefaultSecondaries[team]?{secondary:this.sourceDefaultSecondaries[team]}:{}),
      knife: true,
      slot: primary?0:1,
      ammo: WEAPONS[weapon].mag,
      reserve: WEAPONS[weapon].reserve,
      primaryAmmo: primary?WEAPONS[primary].mag:0,
      primaryReserve: primary?WEAPONS[primary].reserve:0,
      pistolAmmo: 12,
      pistolReserve: 48,
      reload: 0,
      cooldown: 0,
      kills: 0,
      deaths: 0,
      money: this.rules?.money.start ?? 16000,
      ack: 0,
      respawn: 0,
      use: 0,
      grenades: competitive?0:1,
      smokes: competitive?0:1,
      flashes: competitive?0:1,
      flash: 0,
      reveal: 0,
    };
    this.players.push(p);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased(),
    );
    const collider = this.world.createCollider(
      this.sourceLevel?RAPIER.ColliderDesc.cuboid(...this.sourceLevel.player.standing.halfExtents):RAPIER.ColliderDesc.capsule(CHARACTER.standingHalfSegment, CHARACTER.radius),
      body,
    );
    this.bodies.set(id, { body, collider });
    if(this.sourceLevel)this.sourceFinishLoadouts.set(id,{});
    this.spawn(p);
    this.ai.set(id, { path: [], timer: 0, reaction: 0.6, target: null });
    // A player who joins mid-round stands where their team spawns, the same placement the
    // round's own spawn uses, rather than at the origin until the next round.
    if (this.sourceLevel) this.spawn(p);
    this.assignBomb();
    return p;
  }
  spawn(p: Player) {
    const choices=this.sourceLevel?.spawns[p.team]??SPAWN_POSES[p.team];
    const index = this.players.filter((v) => v.team === p.team).indexOf(p) % choices.length;
    const authored=choices[index];
    const pose=this.sourceLevel?this.sourceLevel.settleSourceSpawn(this.sourceLevel.spawns[p.team][index]):authored;
    if(!pose)throw Error('Source spawn has no valid original AABB support');
    p.x = pose.x;
    p.z = pose.z;
    p.y = pose.y + (this.sourceLevel?0:0.05);
    p.vy = 0;
    p.vx = p.vz = p.shotHeat = 0;
    p.shotIdle = 10;
    p.hp = 100;
    p.alive = true;
    p.yaw = pose.yaw;
    p.pitch = 0;
    p.crouch = false;
    p.stancePhase = p.stanceRate = 0;
    p.stanceTarget = false;
    if(this.sourceLevel){p.sourceContract=SOURCE_PLAYER_CONTRACT_ID;p.sourceJumpHeld=false;p.sourceFallVelocity=0;p.sourceWalking=false;p.sourceGrenadeHold=false;delete p.sourcePose;delete p.sourcePoseVersion;delete p.sourceRagdoll;
      this.sourcePlayerContract?.poseDriverFor(p)?.ragdoll?.endRagdoll(p);
      if(p.primary!==null&&!this.sourceWeaponIds!.has(p.primary)){
        p.primary=this.sourceDefaultWeapons[p.team];p.ammo=p.primaryAmmo=WEAPONS[p.primary].mag;p.reserve=p.primaryReserve=WEAPONS[p.primary].reserve;
      }
      if(p.primary===null&&!isSourcePistol(p.secondary)&&!p.knife)throw Error('Source inventory has no supported owned weapon');
      p.weapon=p.primary??p.secondary??'knife';p.slot=p.primary!==null?0:p.secondary?1:2;p.grounded=true;p.ammo=p.primaryAmmo;p.reserve=p.primaryReserve;
      const loadout=this.sourceFinishLoadouts.get(p.id)??{},legacy=p.sourceWeaponFinish?.weapon===p.weapon?p.sourceWeaponFinish:undefined;
      const loadoutFinish=(weapon:WeaponId|undefined)=>weapon?loadout[weapon as SourceFinishWeaponId]:undefined;
      p.primaryFinish=p.primary&&loadoutFinish(p.primary)?structuredClone(loadoutFinish(p.primary)):legacy&&p.primary===p.weapon?structuredClone(legacy):undefined;
      p.secondaryFinish=p.secondary&&loadoutFinish(p.secondary)?structuredClone(loadoutFinish(p.secondary)):legacy&&p.secondary===p.weapon?structuredClone(legacy):undefined;
      p.primaryFinishPicked=false;p.secondaryFinishPicked=false;
      this.syncSourceActiveFinish(p);
      p.sourceRifleHandling=createSourceRifleHandlingState(sourceRifleId(p.weapon==='vandal'||p.weapon==='m4a4'?p.weapon:this.sourceDefaultWeapons[p.team]));
      delete p.sourceAWP;delete p.sourceAWPPose;
      p.sourceViewmodelTime={animTime:Math.fround(this.time),previousAnimTime:Math.fround(this.time)};
      if(isSourcePistol(p.secondary))createSourceSecondary(p,p.secondary,this.time);
      else{delete p.sourceGlock;delete p.sourceUSP;delete p.sourceDeagle;p.pistolAmmo=p.pistolReserve=0;}
      if(isSourcePistol(p.weapon)){sourceOwnedPistolDeploy(p,this.time,sourcePlayerAccuracyContext(p));this.syncSourcePistolDisplay(p);}
      delete p.sourcePistolPose;this.pistolCommandSeeds.delete(p.id);}
    Object.assign(p,{stridePhase:0,strideWeight:0,strideSpeed:0,strideX:0,strideZ:-1});
    p.reload = 0;
    p.cooldown = 0.3;
    p.use = 0;
    p.reveal = 0;
    p.flash = 0;
    if (this.mode === 'training') {
      p.grenades = p.smokes = p.flashes = 1;
      p.armor = 50;
      p.ammo = WEAPONS[p.weapon].mag;
      p.reserve = WEAPONS[p.weapon].reserve;
      if(this.sourceLevel){p.primaryAmmo=p.ammo;p.primaryReserve=p.reserve;}
    }
    if(this.sourceLevel&&p.weapon==='awp')this.createSourceAWP(p);
    const v = this.bodies.get(p.id)!;
    v.collider.setEnabled(true);
    const center=this.sourceLevel?this.sourceLevel.player.standing.halfExtents[1]:CHARACTER.standingCenter;
    v.collider.setShape(this.sourceLevel?new RAPIER.Cuboid(...this.sourceLevel.player.standing.halfExtents):new RAPIER.Capsule(CHARACTER.standingHalfSegment, CHARACTER.radius));
    if(this.sourceLevel)v.collider.setCollisionGroups(this.sourceLevel.queryGroups('player'));
    v.body.setTranslation({ x: p.x, y: p.y + center, z: p.z }, true);
    v.body.setNextKinematicTranslation({ x: p.x, y: p.y + center, z: p.z });
    if(this.sourceLevel)this.world.propagateModifiedBodyPositionsToColliders();
    const driver=this.sourcePlayerContract?.poseDriverFor(p);
    if(driver){p.sourcePose=driver.advance(p,{...p},0);p.sourcePoseVersion=driver.id;}
    this.updateSourcePistolPose(p);
  }
  // Change the controller of an existing combatant, never its combat resources.
  transferControl(fromId: string, toId: string, name: string, bot: boolean): Player {
    const p = this.players.find(player => player.id === fromId);
    if (!p || !this.bodies.has(fromId)) throw new Error('SEAT_NOT_FOUND');
    if (!toId || (fromId !== toId && this.players.some(player => player.id === toId)))
      throw new Error('SEAT_ID_CONFLICT');
    const physical = this.bodies.get(fromId)!;
    const loadout=this.sourceFinishLoadouts.get(fromId);
    this.sourceFinishLoadouts.delete(fromId);
    if(loadout)this.sourceFinishLoadouts.set(toId,loadout);
    this.pistolCommandSeeds.delete(fromId);this.pistolCommandSeeds.delete(toId);
    this.inputs.delete(fromId);
    this.sourceItemInputs.delete(fromId);this.sourceItemInputs.delete(toId);
    this.bodies.delete(fromId);
    this.bodies.set(toId, physical);
    this.ai.delete(fromId);
    this.ai.set(toId, { path: [], timer: 0, reaction: 0.6, target: null });
    const lastStep = this.stepTicks.get(fromId);
    this.stepTicks.delete(fromId);
    if (lastStep !== undefined) this.stepTicks.set(toId, lastStep);
    for (const state of this.ai.values()) if (state.target === fromId) state.target = toId;
    for (const g of this.grenades) if (g.by === fromId) g.by = toId;
    for (const frame of this.history)
      for (const target of frame.players) if (target.id === fromId) target.id = toId;
    for (const event of this.events) {
      if (event.by === fromId) event.by = toId;
      if (event.target === fromId) event.target = toId;
    }
    if (this.bomb.carrier === fromId) this.bomb.carrier = toId;
    p.id = toId;
    p.name = cleanName(name);
    p.bot = bot;
    p.ack = 0;
    p.use = 0;
    if(this.sourceLevel){p.sourceJumpHeld=false;p.sourceGrenadeHold=false;}
    return p;
  }
  remove(id: string) {
    const player=this.players.find(p=>p.id===id);
    if(player)this.sourcePlayerContract?.poseDriverFor(player)?.ragdoll?.endRagdoll(player);
    this.pistolCommandSeeds.delete(id);
    this.sourceFinishLoadouts.delete(id);
    const v = this.bodies.get(id);
    if (v) this.world.removeRigidBody(v.body);
    this.bodies.delete(id);
    this.players = this.players.filter((p) => p.id !== id);
    this.inputs.delete(id);
    this.sourceItemInputs.delete(id);
    this.ai.delete(id);
    this.assignBomb();
  }
  fillBots() {
    for (const team of ['amber', 'blue'] as Team[]) {
      while (this.players.filter((p) => p.team === team).length < 5) {
        let i = 1;
        while (this.players.some((p) => p.id === `bot-${team}-${i}`)) i++;
        this.addPlayer(
          `bot-${team}-${i}`,
          (team === 'amber'
            ? ['霜线', '猎隼', '回声', '灰岩', '流火']
            : ['夜枭', '寒锋', '深蓝', '岩盾', '幽影'])[i % 5],
          team,
          true,
        );
      }
    }
  }
  assignBomb() {
    if (
      !this.bomb.planted &&
      !this.bomb.dropped &&
      !this.players.some((p) => p.id === this.bomb.carrier && p.alive)
    ) {
      this.bomb.carrier =
        (
          this.players.find((p) => p.team === 'amber' && p.alive && !p.bot) ??
          this.players.find((p) => p.team === 'amber' && p.alive)
        )?.id ?? null;
    }
  }
  setInput(id: string, input: Input) {
    this.inputs.set(id, input);
  }
  private updateSourcePistolPose(p:Player){
    const driver=this.sourcePlayerContract?.poseDriverFor(p);
    if(driver?.pistolPose)p.sourcePistolPose=driver.pistolPose(p,this.time);
    else delete p.sourcePistolPose;
    if(driver?.awpPose)p.sourceAWPPose=driver.awpPose(p,this.time);
    else delete p.sourceAWPPose;
  }
  private createSourceAWP(p:Player){
    const state=createSourceAWPRuntimeState(this.time);
    state.command.clip=p.primaryAmmo;state.command.reserve=p.primaryReserve;
    state.handling.punch=structuredClone(p.sourceRifleHandling!.punch);
    p.sourceAWP=sourceAWPRuntimeDeploy(state,this.time,sourcePlayerAccuracyContext(p)).state;
    this.syncSourceAWPDisplay(p);
  }
  private syncSourceAWPDisplay(p:Player){
    if(p.primary!=='awp'||!p.sourceAWP)return;
    const state=p.sourceAWP.command;p.primaryAmmo=state.clip;p.primaryReserve=state.reserve;
    if(p.weapon==='awp'){
      p.ammo=state.clip;p.reserve=state.reserve;
      p.reload=state.reloading?Math.max(0,state.ownerNextAttack-this.time):0;
      p.cooldown=Math.max(0,state.nextPrimary-this.time,state.ownerNextAttack-this.time);
    }
  }
  /** One owned index0 VM PostThink after this player's command. Rifle clips do
   * not supply Glock duration; only their shared original time fields advance. */
  private postSourceViewmodel(p:Player){
    if(!this.sourceLevel||!p.alive)return;
    if(!p.sourceViewmodelTime)throw Error('Missing shared Source viewmodel time');
    if(isSourcePistol(p.weapon)){
      const post=sourceOwnedPistolPostThink(p,this.time);
      const {animTime,previousAnimTime}=post.state.animation;p.sourceViewmodelTime={animTime,previousAnimTime};
      this.syncSourcePistolDisplay(p);this.updateSourcePistolPose(p);
    }else if(p.weapon==='awp'){
      if(!p.sourceAWP)throw Error('Missing authoritative AWP state');
      const post=sourceAWPRuntimePostThink(p.sourceAWP,{now:this.time,viewmodelTime:p.sourceViewmodelTime});p.sourceAWP=post.state;
      const {animTime,previousAnimTime}=post.state.animation;p.sourceViewmodelTime={animTime,previousAnimTime};
      this.syncSourceAWPDisplay(p);this.updateSourcePistolPose(p);
    }else p.sourceViewmodelTime=advanceSourceViewmodelAnimTimes(p.sourceViewmodelTime,this.time).state;
  }
  private syncSourcePlayerPunch(p:Player){
    if(p.sourceAWP&&p.sourceRifleHandling)p.sourceAWP={...p.sourceAWP,handling:{...p.sourceAWP.handling,punch:p.sourceRifleHandling.punch}};
    if(p.sourceGlock&&p.sourceRifleHandling)p.sourceGlock={...p.sourceGlock,handling:{...p.sourceGlock.handling,punch:p.sourceRifleHandling.punch}};
    if(p.sourceDeagle&&p.sourceRifleHandling)p.sourceDeagle={...p.sourceDeagle,handling:{...p.sourceDeagle.handling,punch:p.sourceRifleHandling.punch}};
    if(p.sourceUSP&&p.sourceRifleHandling)p.sourceUSP={...p.sourceUSP,handling:{...p.sourceUSP.handling,punch:p.sourceRifleHandling.punch}};
  }
  private syncSourcePistolDisplay(p:Player){
    if(!isSourcePistol(p.secondary))return;
    const state=sourceOwnedPistol(p,p.secondary);
    p.pistolAmmo=state.command.clip;p.pistolReserve=state.command.reserve;
    if(isSourcePistol(p.weapon)){
      p.ammo=p.pistolAmmo;p.reserve=p.pistolReserve;
      p.reload=state.command.reloading?Math.max(0,state.command.ownerNextAttack-this.time):0;
      p.cooldown=Math.max(0,state.command.nextPrimary-this.time,state.command.ownerNextAttack-this.time);
    }
  }
  /** Source slot selection precedes this command's movement, so the active
   * profile supplies speed/OnLand and owns the subsequent weapon phase. */
  private selectSourceSlot(p:Player,slot:0|1|2){
    if(!this.sourceLevel||p.slot===slot||(slot===2&&!p.knife)||(slot===1&&!isSourcePistol(p.secondary))||(slot===0&&p.primary===null))return;
    if(p.sourceWeaponFinish?.weapon===p.weapon)this.setSourceSlotFinish(p,p.weapon,p.sourceWeaponFinish);
    this.holsterSourceWeapon(p);
    p.slot=slot;p.reload=0;
    if(slot===2){
      p.weapon='knife';p.ammo=0;p.reserve=0;p.cooldown=0;
    }else if(slot===1){
      p.weapon=p.secondary!;this.syncSourcePlayerPunch(p);
      sourceOwnedPistolDeploy(p,this.time,sourcePlayerAccuracyContext(p));
      this.syncSourcePistolDisplay(p);
    }else{
      p.weapon=p.primary!;p.ammo=p.primaryAmmo;p.reserve=p.primaryReserve;
      if(p.weapon==='awp'){
        this.syncSourcePlayerPunch(p);p.sourceAWP=sourceAWPRuntimeDeploy(p.sourceAWP!,this.time,sourcePlayerAccuracyContext(p)).state;
        this.syncSourceAWPDisplay(p);
      }else{
        p.sourceRifleHandling=sourceRifleHandlingSwitch(p.sourceRifleHandling!,sourceRifleId(p.weapon),sourcePlayerAccuracyContext(p),this.time);
        p.cooldown=Math.max(0,WEAPONS[p.weapon].rate-(this.time-p.sourceRifleHandling.weapons[sourceRifleId(p.weapon)].lastShotTime));
      }
    }
    this.syncSourceActiveFinish(p);
    this.refreshSourceWeaponPose(p);
  }
  private holsterSourceWeapon(p:Player){
    if(isSourcePistol(p.weapon)){
      sourceOwnedPistolHolster(p,this.time);
      this.syncSourcePistolDisplay(p);
    }else if(p.weapon==='knife'){
      p.ammo=0;p.reserve=0;
    }else if(p.weapon==='awp'){
      p.sourceAWP=sourceAWPRuntimeHolster(p.sourceAWP!,this.time).state;this.syncSourceAWPDisplay(p);
    }else{p.primaryAmmo=p.ammo;p.primaryReserve=p.reserve;}
  }
  private refreshSourceWeaponPose(p:Player){
    p.shotHeat=0;p.shotIdle=10;
    const driver=this.sourcePlayerContract?.poseDriverFor(p);
    if(driver){p.sourcePose=driver.advance(p,{...p,sourcePose:undefined,sourcePoseVersion:undefined},0);p.sourcePoseVersion=driver.id;}
    this.updateSourcePistolPose(p);
  }
  /** Source E pickup for a dropped primary when the player's primary slot is
   * empty. The authority owns both the body removal and ammo transfer; an
   * old snapshot without ammo fields falls back to the weapon's original full
   * clip, keeping replay compatibility while never granting a free purchase. */
  private pickupSourcePrimary(p:Player):boolean {
    if(!this.sourceLevel)return false;
    const nearest=this.droppedWeapons.read()
      .filter(drop=>isSourcePistol(drop.weapon)||p.primary===null)
      .map(drop=>({drop,distance:Math.hypot(drop.position[0]-p.x,drop.position[2]-p.z)}))
      .filter(row=>this.canReachSourceItem(p,row.drop.position))
      .sort((a,b)=>a.distance-b.distance)[0];
    if(!nearest)return false;
    const drop=nearest.drop,w=WEAPONS[drop.weapon];
    if(isSourcePistol(drop.weapon)){
      const previous=isSourcePistol(p.secondary)?this.droppedWeapons.create({
        id:`replace:${this.round}:${++this.sourceItemSerial}`,ownerId:p.id,weapon:p.secondary,createdAt:this.time,
        position:[p.x,p.y+.9,p.z],quaternion:[0,0,0,1],velocity:[0,0,0],angularVelocity:[0,0,0],
        ammo:isSourcePistol(p.weapon)?p.ammo:p.pistolAmmo,reserve:isSourcePistol(p.weapon)?p.reserve:p.pistolReserve,
        sourceWeaponFinish:this.sourceSlotFinish(p,p.secondary)?.weapon===p.secondary?this.sourceSlotFinish(p,p.secondary):undefined,
        silencerVisible:p.secondary==='usp'?p.sourceUSP?.command.silencerAttached??true:true,sleeping:false}):null;
      if(!this.droppedWeapons.remove(drop.id)){if(previous)this.droppedWeapons.remove(previous.id);return false;}
      this.holsterSourceWeapon(p);
      const pickedAmmo=Math.max(0,Math.min(w.mag,drop.ammo??w.mag)),pickedReserve=Math.max(0,Math.min(w.reserve,drop.reserve??w.reserve));
      p.secondary=drop.weapon;p.pistolAmmo=pickedAmmo;p.pistolReserve=pickedReserve;
      p.weapon=drop.weapon;p.slot=1;createSourceSecondary(p,drop.weapon,this.time);
      p.secondaryFinish=drop.sourceWeaponFinish?structuredClone(drop.sourceWeaponFinish):undefined;
      p.secondaryFinishPicked=true;
      const picked=sourceOwnedPistol(p,drop.weapon);picked.command.clip=pickedAmmo;picked.command.reserve=pickedReserve;p.pistolAmmo=pickedAmmo;p.pistolReserve=pickedReserve;
      if(drop.weapon==='usp'&&p.sourceUSP){
        p.sourceUSP.command.silencerAttached=drop.silencerVisible;
        p.sourceUSP.command.mode=drop.silencerVisible?1:0;
        p.sourceUSP.handling.modes['usp-s']=p.sourceUSP.command.mode;
      }
      sourceOwnedPistolDeploy(p,this.time,sourcePlayerAccuracyContext(p));this.syncSourcePistolDisplay(p);p.cooldown=.25;
      this.syncSourceActiveFinish(p);
      this.refreshSourceWeaponPose(p);
      return true;
    }
    if(p.primary!==null)return false;
    if(!this.droppedWeapons.remove(drop.id))return false;
    this.holsterSourceWeapon(p);
    p.primary=drop.weapon;p.primaryAmmo=Math.max(0,Math.min(w.mag,drop.ammo??w.mag));
    p.primaryReserve=Math.max(0,Math.min(w.reserve,drop.reserve??w.reserve));
    p.primaryFinish=drop.sourceWeaponFinish?structuredClone(drop.sourceWeaponFinish):undefined;
    p.primaryFinishPicked=true;
    p.weapon=drop.weapon;p.slot=0;p.ammo=p.primaryAmmo;p.reserve=p.primaryReserve;p.reload=0;p.cooldown=.25;
    if(p.weapon==='awp')this.createSourceAWP(p);
    else{delete p.sourceAWP;delete p.sourceAWPPose;p.sourceRifleHandling=sourceRifleHandlingSwitch(p.sourceRifleHandling!,sourceRifleId(p.weapon),sourcePlayerAccuracyContext(p),this.time);}
    this.syncSourceActiveFinish(p);this.refreshSourceWeaponPose(p);return true;
  }
  private canReachSourceItem(p:Player,point:readonly number[],radius=1.25){
    if(!this.sourceLevel)return false;
    const [x,y,z]=point,eye=this.eyeOrigin(p);
    if(Math.hypot(x-p.x,z-p.z)>radius||y<p.y-.4||y>eye.y+.25)return false;
    const dx=x-eye.x,dy=y+.03-eye.y,dz=z-eye.z,length=Math.hypot(dx,dy,dz);
    return length<1e-6||this.wallDistance(eye.x,eye.y,eye.z,dx/length,dy/length,dz/length)>=length-.01;
  }
  /** The original bomb is a world prop after its carrier dies. Reclaim it
   * with the same E use key, keeping objective planting authoritative. */
  private pickupSourceBomb(p:Player):boolean {
    if(!this.sourceLevel||p.team!=='amber'||this.bomb.planted||!this.bomb.dropped)return false;
    if(!this.canReachSourceItem(p,[this.bomb.x,this.bomb.y,this.bomb.z],1.5))return false;
    this.bomb={...this.bomb,carrier:p.id,dropped:false};return true;
  }
  private dropSourceWeapon(p:Player):boolean {
    if(!this.sourceLevel||!p.alive||p.weapon==='knife'||!isSourceDroppedWeapon(p.weapon))return false;
    const weapon=p.weapon,heldAmmo=p.ammo,heldReserve=p.reserve;
    if(isSourcePistol(weapon)?p.secondary!==weapon:p.primary!==weapon)return false;
    // Allocate the world item before clearing the slot. A failed physics
    // allocation must leave the owned weapon and its ammunition intact.
    this.droppedWeapons.create({id:`drop:${this.round}:${++this.sourceItemSerial}`,ownerId:p.id,weapon,createdAt:this.time,
      position:[p.x,p.y+.9,p.z],quaternion:[0,0,0,1],velocity:[p.vx,p.vy,p.vz],angularVelocity:[0,0,0],
      ammo:heldAmmo,reserve:heldReserve,sourceWeaponFinish:this.sourceSlotFinish(p,weapon)?.weapon===weapon?this.sourceSlotFinish(p,weapon):undefined,
      silencerVisible:weapon==='usp'?p.sourceUSP?.command.silencerAttached??true:true,sleeping:false});
    this.holsterSourceWeapon(p);
    if(weapon==='glock'||weapon==='usp'||weapon==='deagle'){
      p.secondary=undefined;delete p.secondaryFinish;delete p.secondaryFinishPicked;p.weapon='knife';p.slot=2;p.ammo=0;p.reserve=0;
      p.pistolAmmo=0;p.pistolReserve=0;delete p.sourceGlock;delete p.sourceUSP;delete p.sourceDeagle;
      if(p.primary)this.selectSourceSlot(p,0);
    }else{
      p.primary=null;delete p.primaryFinish;delete p.primaryFinishPicked;p.primaryAmmo=0;p.primaryReserve=0;
      if(p.secondary){p.weapon=p.secondary;p.slot=1;p.ammo=p.pistolAmmo;p.reserve=p.pistolReserve;sourceOwnedPistolDeploy(p,this.time,sourcePlayerAccuracyContext(p));this.syncSourcePistolDisplay(p);}else{p.weapon='knife';p.slot=2;p.ammo=0;p.reserve=0;}
    }
    if(weapon==='awp'){delete p.sourceAWP;delete p.sourceAWPPose;}
    this.syncSourceActiveFinish(p);
    p.reload=0;this.refreshSourceWeaponPose(p);
    return true;
  }
  buy(id: string, item: string) {
    const p = this.players.find((v) => v.id === id);
    if (!p || !p.alive || !this.canBuy(p))
      return false;
    if(this.sourceWeaponIds){
      if(item==='defuseKit'){
        if(p.team!=='blue'||p.defuseKit||p.money<SOURCE_DEFUSE_KIT_COST)return false;
        p.money-=SOURCE_DEFUSE_KIT_COST;p.defuseKit=true;return true;
      }
      const utility=SOURCE_UTILITY_SHOP.find(row=>row.id===item);
      if(utility){
        if(!sourceUtilityPurchaseAllowed(p,utility.id))return false;
        p.money-=utility.cost;p[utility.field]++;return true;
      }
      if(item!=='armor'&&item!=='helmet'&&(!this.sourceWeaponIds.has(item as WeaponId)
        ||this.mode!=='training'&&!sourceWeaponTeamAllows(p.team,item as WeaponId)))return false;
    }
    if(!this.sourceLevel&&(item==='m4a4'||item==='awp'||isSourcePistol(item as WeaponId)))return false;
    if(this.sourceLevel&&(item==='armor'||item==='helmet')){
      const purchase=sourceArmorPurchase(item,p.armor,!!p.helmet);
      if(!purchase||p.money<purchase.cost)return false;
      p.money-=purchase.cost;p.armor=purchase.armor;p.helmet=purchase.helmet;return true;
    }
    if (item === 'armor') {
      if (p.armor >= 100 || p.money < 650) return false;
      p.money -= 650;
      p.armor = 100;
      return true;
    }
    if (!Object.hasOwn(WEAPONS, item) || (item === 'sidearm' || item === 'spectre')) return false;
    // Original Cstrike_Already_Own_Weapon: buying an owned sidearm must not
    // recreate its silencer, ammunition, animation or player punch state.
    if(this.sourceLevel&&isSourcePistol(item as WeaponId)&&item===p.secondary)return false;
    if(this.sourceLevel&&item===p.primary)return false;
    const w = WEAPONS[item as WeaponId];
    if (p.money < w.cost) return false;
    p.money -= w.cost;
    if(this.sourceLevel&&isSourcePistol(item as WeaponId)){
      this.holsterSourceWeapon(p);
      createSourceSecondary(p,item as 'glock'|'usp'|'deagle',this.time);
      const loadout=this.sourceFinishLoadouts.get(p.id)??{};
      p.secondaryFinish=loadout[item as SourceFinishWeaponId]?structuredClone(loadout[item as SourceFinishWeaponId]):undefined;
      p.secondaryFinishPicked=false;
      p.weapon=item as 'glock'|'usp'|'deagle';p.slot=1;p.reload=0;
      this.syncSourceActiveFinish(p);
      sourceOwnedPistolDeploy(p,this.time,sourcePlayerAccuracyContext(p));this.syncSourcePistolDisplay(p);
      p.shotHeat=0;p.shotIdle=10;
      const driver=this.sourcePlayerContract?.poseDriverFor(p);
      if(driver){p.sourcePose=driver.advance(p,{...p,sourcePose:undefined,sourcePoseVersion:undefined},0);p.sourcePoseVersion=driver.id;}
      this.updateSourcePistolPose(p);return true;
    }
    if(this.sourceLevel&&isSourcePistol(p.weapon))sourceOwnedPistolHolster(p,this.time);
    if(this.sourceLevel&&p.weapon==='awp')p.sourceAWP=sourceAWPRuntimeHolster(p.sourceAWP!,this.time).state;
    p.primary = item as WeaponId;
    p.weapon = p.primary;
    p.slot = 0;
    p.ammo = w.mag;
    p.reserve = w.reserve;
    p.primaryAmmo = w.mag;
    p.primaryReserve = w.reserve;
    const loadout=this.sourceFinishLoadouts.get(p.id)??{};
    p.primaryFinish=loadout[item as SourceFinishWeaponId]?structuredClone(loadout[item as SourceFinishWeaponId]):undefined;
    p.primaryFinishPicked=false;
    p.reload = 0;
    p.shotHeat=0;p.shotIdle=10;
    if(this.sourceLevel){
      if(p.weapon==='awp')this.createSourceAWP(p);
      else{delete p.sourceAWP;delete p.sourceAWPPose;p.sourceRifleHandling=sourceRifleHandlingSwitch(p.sourceRifleHandling!,sourceRifleId(p.weapon),sourcePlayerAccuracyContext(p),this.time);}
    }
    this.syncSourceActiveFinish(p);
    const driver=this.sourcePlayerContract?.poseDriverFor(p);
    if(driver){p.sourcePose=driver.advance(p,{...p,sourcePose:undefined,sourcePoseVersion:undefined},0);p.sourcePoseVersion=driver.id;}
    this.updateSourcePistolPose(p);
    return true;
  }
  /** Exact current-world clearance for proposed growth; no authored BOXES-only shortcut. */
  hasStanceClearance(p: Player, height: number): boolean {
    const shape = new RAPIER.Capsule(height / 2 - CHARACTER.radius, CHARACTER.radius);
    const position = {x:p.x,y:p.y + height / 2,z:p.z};
    let blocked = false;
    this.world.intersectionsWithShape(position,{x:0,y:0,z:0,w:1},shape,collider => {
      const contact=collider.contactShape(shape,position,{x:0,y:0,z:0,w:1},0);
      // A floor touching the fixed feet does not obstruct upward growth.
      if (contact && !(contact.normal1.y > .7 && contact.point1.y <= p.y + .025)) blocked=true;
      return !blocked;
    },POSE_OBSTACLE_FLAGS,undefined,this.bodies.get(p.id)?.collider);
    return !blocked;
  }
  poseResolution(p:Player) { const c=this.bodies.get(p.id)?.collider;return c?this.poseResolutions.get(c):undefined; }
  private usesFlatStairStance(p:{x:number;y:number;z:number}):boolean {
    // This gait has no terrain foot anchors. Retain the calibrated neutral feet
    // near authored risers instead of sending a planar swing through the stair.
    // 0.65m covers the maximum swing + boot reach before the first contact;
    // the normal capsule / head / eye transaction still checks every obstacle.
    return this.stairTreads.some(b=>Math.abs(p.x-b.x)<b.w/2+.65&&Math.abs(p.z-b.z)<b.d/2+.65&&
      p.y>=b.y-b.h/2-.10&&p.y<=b.y+b.h/2+.30);
  }
  /** Read back actual head/eye contacts after the shared constraint solve. */
  poseClearance(p: Player) {
    if(this.sourceLevel)throw Error('Source uses AABB clearance; C02 head/eye pose diagnostics do not apply');
    const head=characterReferences(p).head, eye=eyeOrigin(p);
    const check=(center:{x:number;y:number;z:number},radius:number) => {
      const hits:{collider:number;penetration:number}[]=[],shape=new RAPIER.Ball(radius);
      this.world.intersectionsWithShape(center,{x:0,y:0,z:0,w:1},shape,c=>{
        const contact=c.contactShape(shape,center,{x:0,y:0,z:0,w:1},0);
        if(contact)hits.push({collider:c.handle,penetration:Math.max(0,-contact.distance)});
        return true;
      },POSE_OBSTACLE_FLAGS,undefined,this.bodies.get(p.id)?.collider);
      return hits;
    };
    return {head:check(head,CHARACTER.headRadius),eye:check(eye,.015)};
  }
  private moveSource(p:Player,input:Input,dt:number){
    const physical=this.bodies.get(p.id);if(!physical||!this.sourceMovement||!this.sourceLevel)return;
    const previous={...p};recoverAccuracy(p,dt);p.yaw=input.yaw;p.pitch=input.pitch;
    p.sourceRifleHandling=sourceRifleHandlingMovementTick(p.sourceRifleHandling!,dt);
    const next=this.sourceMovement.step(physical.body,physical.collider,{feet:{x:p.x,y:p.y,z:p.z},velocity:{x:p.vx,y:p.vy,z:p.vz},
      grounded:p.grounded,stance:p.crouch?'crouching':'standing',jumpHeld:p.sourceJumpHeld??false,fallVelocitySource:p.sourceFallVelocity??0,walking:p.sourceWalking??false},
      {forward:-input.mz,right:input.mx,yaw:p.yaw,jump:input.jump,crouch:input.crouch,walk:input.walk??false,dt,maxSpeed:(p.weapon==='awp'?SOURCE_AWP_ACCURACY_PROFILES[p.sourceAWP!.command.mode].speed:WEAPONS[p.weapon].sourceMaxSpeedUnits??215)*this.sourceLevel.metersPerSourceUnit});
    p.x=next.feet.x;p.y=next.feet.y;p.z=next.feet.z;p.vx=next.velocity.x;p.vy=next.velocity.y;p.vz=next.velocity.z;
    p.grounded=next.grounded;p.crouch=next.stance==='crouching';p.sourceJumpHeld=next.jumpHeld;p.sourceContract=SOURCE_PLAYER_CONTRACT_ID;
    p.sourceFallVelocity=next.fallVelocitySource;p.sourceWalking=next.walking;
    if(isSourcePistol(p.weapon)){
      this.syncSourcePlayerPunch(p);
      if(next.landedFallVelocitySource!==null){
        const handling=sourceOwnedPistolOnLand(p,next.landedFallVelocitySource,sourceCommandSeed(p.bot?this.tick:input.seq));
        sourcePistolHandling(p,handling);p.sourceRifleHandling={...p.sourceRifleHandling!,punch:handling.punch};
      }
    }else if(p.weapon==='awp'){
      this.syncSourcePlayerPunch(p);
      if(next.landedFallVelocitySource!==null){
        const handling=sourceAWPHandlingOnLand(p.sourceAWP!.handling,p.sourceAWP!.command.mode,next.landedFallVelocitySource,sourceCommandSeed(p.bot?this.tick:input.seq));
        p.sourceAWP={...p.sourceAWP!,handling};p.sourceRifleHandling={...p.sourceRifleHandling!,punch:handling.punch};
      }
    }else{
      if(next.landedFallVelocitySource!==null)p.sourceRifleHandling=sourceRifleOnLand(p.sourceRifleHandling!,next.landedFallVelocitySource,sourceCommandSeed(p.bot?this.tick:input.seq));
      p.sourceRifleHandling=sourceRifleHandlingWeaponTick(p.sourceRifleHandling!,sourcePlayerAccuracyContext(p),this.time,dt);
    }
    this.syncSourcePlayerPunch(p);
    p.stancePhase=p.crouch?1:0;p.stanceRate=0;p.stanceTarget=input.crouch;
    // Source AABB stance is not the C02 continuous IK/capsule contract.
    const driver=this.sourcePlayerContract?.poseDriverFor(p);
    if(driver){p.sourcePose=driver.advance(p,previous,dt);p.sourcePoseVersion=driver.id;}
    // While a reload is running the magazine can leave the weapon and becomes its
    // own prop on both clients. Where it lands is a property of the original map,
    // so trace the surface here: a reload beside a ledge then drops the magazine
    // onto the real ledge instead of onto a plane through the shooter's feet. The
    // field only exists while it can be used, so a snapshot carries it for the
    // same ticks the original reload does.
    if(p.reload>0)p.sourceGroundY=this.sourceLevel.groundHeight(p.x,p.z,p.y+SOURCE_PROP_GROUND_PROBE)??p.y;
    else delete p.sourceGroundY;
    this.updateSourcePistolPose(p);
    p.ack=input.seq;
  }
  move(p: Player, input: Input, dt = DT) {
    if(this.sourceLevel){this.moveSource(p,input,dt);return;}
    const before=clearancePose(p),wasGrounded=p.grounded;
    p.yaw = input.yaw;
    p.pitch = input.pitch;
    recoverAccuracy(p, dt);
    const v = this.bodies.get(p.id);
    if (!v) return;
    const oldHeight=capsuleHeight(p), next=advanceStance(p,input.crouch,dt);
    const proposedHeight=capsuleHeight({...p,...next});
    if (proposedHeight > oldHeight + 1e-8 && !this.hasStanceClearance(p,proposedHeight)) {
      // Freeze the same phase used by collision and visuals; remove stored upward momentum.
      p.stanceRate=0;p.stanceTarget=input.crouch;
    } else Object.assign(p,next);
    p.crouch=input.crouch || stanceBlend(p) > .001;
    const height=capsuleHeight(p);
    // Reconciliation copies Player first; the prediction world's collider may still be another stance.
    const resized=Math.abs(height-2*(v.collider.halfHeight()+v.collider.radius()))>1e-7;
    if(resized)
      v.collider.setShape(new RAPIER.Capsule(height/2-CHARACTER.radius,CHARACTER.radius));
    accelerate(p, input, dt);
    const dx = p.vx * dt,
      dz = p.vz * dt,
      center = height / 2;
    // Rapier can stall on consecutive short risers at low speed. Apply a
    // bounded step-up on authored stairs only, with full capsule head clearance.
    // This runs in the shared simulation, so prediction and authority agree.
    if (p.grounded && p.vy <= 0 && Math.hypot(dx, dz) > 0.001) {
      const nx = p.x + dx,
        nz = p.z + dz;
      const support = BOXES.filter(
        (b) =>
          (b.kind === 'step' || b.kind === 'platform') &&
          Math.abs(nx - b.x) < b.w / 2 + 0.3 &&
          Math.abs(nz - b.z) < b.d / 2 + 0.3 &&
          b.y + b.h / 2 > p.y + 0.025 &&
          b.y + b.h / 2 <= p.y + 0.26,
      ).sort((a, b) => b.y + b.h / 2 - a.y - a.h / 2)[0];
      if (support) {
        const top = support.y + support.h / 2;
        const blocked = BOXES.some(
          (b) =>
            b !== support &&
            Math.abs(nx - b.x) < b.w / 2 + 0.3 &&
            Math.abs(nz - b.z) < b.d / 2 + 0.3 &&
            b.y + b.h / 2 > top + 0.025 &&
            b.y - b.h / 2 < top + center * 2,
        );
        if (!blocked) p.y = top + 0.015;
      }
    }
    if (input.jump && p.grounded && !p.crouch) p.vy = 7;
    p.vy = Math.max(-25, p.vy - 22 * dt);
    v.body.setTranslation({ x: p.x, y: p.y + center, z: p.z }, true);
    // A resized shape and its new center must reach the collider together before its sweep.
    // Otherwise Rapier queries the previous center and continuous shrinking sinks the feet.
    if(resized)this.world.propagateModifiedBodyPositionsToColliders();
    this.controller.computeColliderMovement(
      v.collider,
      { x: dx, y: p.vy * dt, z: dz },
      // Filter in Rapier: querying collider/body state from its mutable controller
      // callback can retain a WASM borrow and later make world.free() fail.
      POSE_OBSTACLE_FLAGS,
    );
    const mv = this.controller.computedMovement();
    let horizontalContact = false;
    for (let n = 0; n < this.controller.numComputedCollisions(); n++) {
      const contact = this.controller.computedCollision(n);
      if (!contact || Math.abs(contact.normal1.y) > 0.5) continue;
      horizontalContact = true;
      const normal = contact.normal1;
      const into = p.vx * normal.x + p.vz * normal.z;
      if (into < 0) {
        p.vx -= into * normal.x;
        p.vz -= into * normal.z;
      }
    }
    // The arena uses flat floors and axis-aligned cover. Preserve the requested
    // tangent motion when Rapier reports only floor contacts (capsule/floor
    // numerical grazing otherwise loses up to several percent of forward speed).
    p.x += horizontalContact ? mv.x : dx;
    p.y = Math.max(0, p.y + mv.y);
    p.z += horizontalContact ? mv.z : dz;
    p.grounded = this.controller.computedGrounded() || p.y < 0.025;
    if (p.grounded && p.vy < 0) p.vy = 0;
    const requested={x:p.x-before.x,z:p.z-before.z},requestLength=Math.hypot(requested.x,requested.z);
    const oldStride=readLocomotion(before);
    const strideAt=(pose:typeof before)=>{
      if(this.usesFlatStairStance(pose))return {stridePhase:oldStride.stridePhase,
        strideWeight:0,strideSpeed:0,strideX:0,strideZ:-1};
      const ax=pose.x-before.x,az=pose.z-before.z,actualLength=Math.hypot(ax,az);
      // Clearance may push an idle actor away from a wall. Only accepted progress
      // along controller motion advances gait; depenetration is not a footstep.
      const progress=requestLength>1e-8?Math.max(0,Math.min(requestLength,(ax*requested.x+az*requested.z)/requestLength)):0;
      let vx=p.vx,vz=p.vz;
      const cx=pose.x-p.x,cz=pose.z-p.z,correctionLength=Math.hypot(cx,cz);
      if(correctionLength>1e-8){const nx=cx/correctionLength,nz=cz/correctionLength,into=vx*nx+vz*nz;
        if(into<0){vx-=into*nx;vz-=into*nz;}}
      // Rapier may periodically consume millimetres of contact skin while held
      // against a wall. Its rejected normal velocity must not restart a stride.
      const velocityBound=actualLength>1e-8?Math.max(0,(vx*ax+vz*az)/actualLength):0;
      const speed=dt>0?Math.min(progress/dt,velocityBound):0,turn=speed>.03&&actualLength>1e-8;
      const cos=Math.cos(pose.yaw),sin=Math.sin(pose.yaw);
      return {...advanceLocomotion(oldStride,speed,dt,pose.grounded??true,characterBlend(pose)),
        strideX:turn?(cos*ax-sin*az)/actualLength:oldStride.strideX,
        strideZ:turn?(sin*ax+cos*az)/actualLength:oldStride.strideZ};
    };
    Object.assign(p,strideAt(clearancePose(p)));
    let resolution=resolvePoseMotion(this.world,before,clearancePose(p),v.collider);
    // A head correction can reduce accepted progress. Recompute from the original
    // clock, then validate that COMPLETE corrected pose; never advance twice.
    for(let attempt=0;attempt<3&&resolution.status==='corrected';attempt++){
      const gait=strideAt(resolution.pose),current=readLocomotion(resolution.pose);
      if(Math.abs(gait.stridePhase-current.stridePhase)+Math.abs(gait.strideWeight-current.strideWeight)+
        Math.abs(gait.strideSpeed-current.strideSpeed)+Math.abs(gait.strideX-current.strideX)+Math.abs(gait.strideZ-current.strideZ)<1e-10)break;
      const next=resolvePoseMotion(this.world,before,{...resolution.pose,...gait},v.collider);
      if(next.status==='blocked'||next.status==='unresolved'){resolution=next;break;}
      resolution={...next,status:'corrected',correction:{x:next.pose.x-p.x,y:next.pose.y-p.y,z:next.pose.z-p.z}};
      if(Math.hypot(next.correction.x,next.correction.z)<1e-8)break;
      if(attempt===2)resolution={...resolution,status:resolution.initiallyLegal?'blocked':'unresolved',
        pose:{...before,stanceRate:0,stanceTarget:p.stanceTarget},
        correction:{x:before.x-p.x,y:before.y-p.y,z:before.z-p.z},reason:'Complete locomotion/clearance pose did not settle within three corrections'};
    }
    const rejected=resolution.status==='blocked'||resolution.status==='unresolved';
    if(resolution.status==='blocked'&&resolution.initiallyLegal&&oldStride.strideWeight>1e-6){
      // A rejected turn can otherwise replay the same extended leg forever.
      // Settle ONLY in the previous legal pose, without accepting any rejected
      // input translation / yaw or advancing phase. Head rise and returning
      // feet still pass the full sweep; a low roof may reject this too.
      const settled=resolvePoseMotion(this.world,before,{...before,
        ...advanceLocomotion(oldStride,0,dt,wasGrounded,characterBlend(before))},v.collider);
      if(settled.status==='clear'||settled.status==='corrected')resolution={...settled,status:'corrected',
        correction:{x:settled.pose.x-p.x,y:settled.pose.y-p.y,z:settled.pose.z-p.z},
        reason:'Requested pose rejected; accepted checked stationary gait settling'};
    }
    this.poseResolutions.set(v.collider,resolution);
    Object.assign(p,resolution.pose);
    if(rejected){
      p.vx=p.vz=p.vy=0;p.grounded=wasGrounded;
    }else{
      const {x,z}=resolution.correction,length=Math.hypot(x,z);
      if(length>1e-6){const nx=x/length,nz=z/length,into=p.vx*nx+p.vz*nz;
        if(into<0){p.vx-=into*nx;p.vz-=into*nz;}}
    }
    const acceptedHeight=capsuleHeight(p);
    if(Math.abs(acceptedHeight-height)>1e-7)v.collider.setShape(new RAPIER.Capsule(acceptedHeight/2-CHARACTER.radius,CHARACTER.radius));
    v.body.setTranslation({x:p.x,y:p.y+acceptedHeight/2,z:p.z},true);
    v.body.setNextKinematicTranslation({ x: p.x, y: p.y + acceptedHeight/2, z: p.z });
    this.world.propagateModifiedBodyPositionsToColliders();
    p.ack = input.seq;
  }
  /** Shared accepted reload/fire boundary. Prediction advances deterministic
   * state only; it never allocates a bullet seed, ray, damage, or event. */
  private sourceCommandExecution(p:Player,seq:number,prediction:boolean):{type:'authority';serverSeed:number}|{type:'prediction'}{
    if(prediction)return{type:'prediction'};
    let command=this.pistolCommandSeeds.get(p.id);
    if(!command||command.seq!==seq){command={seq,seed:this.pistolSeed()};this.pistolCommandSeeds.set(p.id,command);}
    return{type:'authority',serverSeed:command.seed};
  }
  private advanceSourcePistolCommand(p:Player,input:Input,dt:number,prediction:boolean){
    if(!p.sourceRifleHandling)throw Error('Missing Source player command state');
    this.syncSourcePlayerPunch(p);
    const seq=p.bot?this.tick:input.seq;
    const execution=this.sourceCommandExecution(p,seq,prediction);
    const result=sourceOwnedPistolFrame(p,
      {now:this.time,dt,buttons:(input.fire?SOURCE_GLOCK_BUTTONS.attack:0)|(input.aim?SOURCE_GLOCK_BUTTONS.secondary:0)|(input.reload?SOURCE_GLOCK_BUTTONS.reload:0),
       commandSeed:sourceCommandSeed(seq),accuracy:sourcePlayerAccuracyContext(p),execution});
    p.sourceRifleHandling={...p.sourceRifleHandling,punch:result.state.handling.punch};
    this.syncSourcePistolDisplay(p);let fired=false;
    for(const event of result.events){
      if(event.kind==='empty'&&!prediction&&isSourcePistol(p.weapon))
        this.emit({type:'weaponSound',by:p.id,seq:input.seq,weapon:p.weapon,x:p.x,y:p.y,z:p.z,
          sourceWeaponSound:{weapon:p.weapon,event:'Default.ClipEmpty_Pistol'}});
      if(event.kind==='sound'&&!prediction&&event.name==='Weapon.AutoSemiAutoSwitch')
        this.emit({type:'weaponSound',by:p.id,seq:input.seq,weapon:'glock',x:p.x,y:p.y,z:p.z,
          sourceWeaponSound:{weapon:'glock',event:event.name}});
      if(event.kind!=='bullet')continue;
      fired=true;p.reveal=.8;registerShot(p);
      if(p.sourcePose)p.sourcePose={...p.sourcePose,fireCycle:0,fireTimeSeconds:0,fireWeight:1};
      if(event.shot){
        const [dx,dy,dz]=sourceSpreadDirection(sourceBrowserShotBasis(p.yaw,p.pitch,event.shot.punchAngles),event.shot.offset);
        this.traceShot(p,input,{dx,dy,dz},undefined,{...event.shot,browserAim:[p.yaw,p.pitch]});
      }
    }
    this.updateSourcePistolPose(p);return fired;
  }
  private advanceSourceAWPCommand(p:Player,input:Input,dt:number,prediction:boolean){
    if(!p.sourceAWP||!p.sourceRifleHandling)throw Error('Missing authoritative AWP command state');
    this.syncSourcePlayerPunch(p);const seq=p.bot?this.tick:input.seq;
    const result=sourceAWPRuntimeFrame(p.sourceAWP,{now:this.time,dt,
      buttons:(input.fire?SOURCE_GLOCK_BUTTONS.attack:0)|(input.aim?SOURCE_GLOCK_BUTTONS.secondary:0)|(input.reload?SOURCE_GLOCK_BUTTONS.reload:0),
      commandSeed:sourceCommandSeed(seq),accuracy:sourcePlayerAccuracyContext(p),execution:this.sourceCommandExecution(p,seq,prediction)});
    p.sourceAWP=result.state;p.sourceRifleHandling={...p.sourceRifleHandling,punch:result.state.handling.punch};
    this.syncSourceAWPDisplay(p);let fired=false;
    for(const event of result.events){
      if(!prediction&&(event.kind==='empty'||event.kind==='sound'&&event.name==='Weapon_AWP.Zoom'))
        this.emit({type:'weaponSound',by:p.id,seq:input.seq,weapon:'awp',x:p.x,y:p.y,z:p.z,
          sourceWeaponSound:{weapon:'awp',event:event.kind==='empty'?'Default.ClipEmpty_Rifle':event.name}});
      if(event.kind!=='bullet')continue;
      fired=true;p.reveal=.8;registerShot(p);
      if(p.sourcePose)p.sourcePose={...p.sourcePose,fireCycle:0,fireTimeSeconds:0,fireWeight:1};
      if(event.shot){
        const [dx,dy,dz]=sourceSpreadDirection(sourceBrowserShotBasis(p.yaw,p.pitch,event.shot.punchAngles),event.shot.offset);
        this.traceShot(p,input,{dx,dy,dz},undefined,undefined,{...event.shot,browserAim:[p.yaw,p.pitch]});
      }
    }
    this.updateSourcePistolPose(p);return fired;
  }
  private advanceWeaponCommand(p:Player,input:Input,dt:number,prediction:boolean){
    // While the original grenade hold is armed the primary/secondary attacks
    // belong to the grenade (the throw strength selection), never to the
    // weapon: a held LMB must not fire the rifle and set the cooldown that
    // would swallow the release-edge throw.
    if(p.sourceGrenadeHold===true)return false;
    if(this.sourceLevel&&p.weapon==='knife')return this.advanceSourceKnifeCommand(p,input,dt,prediction);
    if(this.sourceLevel&&p.weapon==='awp')return this.advanceSourceAWPCommand(p,input,dt,prediction);
    if(this.sourceLevel&&isSourcePistol(p.weapon))return this.advanceSourcePistolCommand(p,input,dt,prediction);
    const w=WEAPONS[p.weapon];
    if(p.reload>0){
      p.reload=Math.max(0,p.reload-dt);
      if(p.reload===0){const n=Math.min(w.mag-p.ammo,p.reserve);p.ammo+=n;p.reserve-=n;}
    }
    if(input.reload&&p.reload===0&&p.ammo<w.mag&&p.reserve>0)p.reload=w.reload;
    if(input.fire&&p.cooldown===0&&p.reload===0){
      if(p.ammo>0){
        if(prediction){
          p.ammo--;p.cooldown=w.rate;p.reveal=.8;registerShot(p);
          p.sourceRifleHandling=sourceRifleHandlingAfterAcceptedShot(p.sourceRifleHandling!,this.time);
          this.syncSourcePlayerPunch(p);
          if(p.sourcePose)p.sourcePose={...p.sourcePose,fireCycle:0,fireTimeSeconds:0,fireWeight:1};
        }else this.shoot(p,input);
        return true;
      }else if(p.reserve>0)p.reload=w.reload;
    }
    return false;
  }
  /** Minimal authority-owned Source knife: light attack is a short fast cone,
   * heavy attack uses the secondary button and a slower, stronger cone. */
  private advanceSourceKnifeCommand(p:Player,input:Input,_dt:number,prediction:boolean){
    // Knife secondary is a right-click attack on its own; it is not a rifle
    // aim modifier. Accept either attack button and let aim select the heavy
    // profile, matching the browser's independent LMB/RMB button state.
    if(!(input.fire||input.aim)||p.cooldown>0)return false;
    const heavy=input.aim, damage=heavy?65:40;
    p.cooldown=heavy?0.9:0.45;p.reveal=0;
    const fx=-Math.sin(p.yaw), fz=-Math.cos(p.yaw);
    // Source's melee trace is a short 3D swing. Keep the reach bounded in
    // metres, reject targets on another floor, and require the original map's
    // player collision to be clear between the attacker and target. The ray is
    // evaluated on the authority and replayed identically by prediction.
    const level=this.sourceLevel, origin=this.eyeOrigin(p), maxReach=2.2;
    let victim:Player|undefined,best=Number.POSITIVE_INFINITY;
    for(const target of this.players){
      if(!target.alive||target.team===p.team)continue;
      const dx=target.x-p.x,dz=target.z-p.z,distanceXZ=Math.hypot(dx,dz);
      if(distanceXZ>maxReach||distanceXZ<1e-6)continue;
      const targetHalfY=level?(target.crouch?level.player.crouching.halfExtents[1]:level.player.standing.halfExtents[1]):.9;
      const targetCentreY=target.y+targetHalfY;
      const verticalGap=Math.abs(targetCentreY-origin.y);
      // A swing can reach the target's authored body volume, with a bounded
      // 0.55 m hand/swing allowance; this rejects cross-storey hits while
      // allowing a normal step and crouching opponent.
      if(verticalGap>targetHalfY+.55)continue;
      const facing=(dx*fx+dz*fz)/distanceXZ;
      if(facing<0.55)continue;
      const targetPoint={x:target.x,y:targetCentreY,z:target.z};
      const distance3D=Math.hypot(dx,targetCentreY-origin.y,dz);
      if(distance3D>maxReach||distance3D>=best)continue;
      if(level&&!level.sight(origin,targetPoint,'player'))continue;
      best=distance3D;victim=target;
    }
    if(victim&&!prediction)this.damage(victim,p,damage,false,undefined,'knife');
    return true;
  }
  /** Rebuild from snapshot.time, then replay each unacknowledged command once.
   * This path is only for a live Source local player. */
  predictSourceCommand(p:Player,input:Input,dt=DT){
    if(!this.sourceLevel||!p.sourceRifleHandling)throw Error('Source prediction requires the matching authoritative handling state');
    this.time+=dt;this.tick++;p.cooldown=Math.max(0,p.cooldown-dt);
    if(input.slotSelect !== false)this.selectSourceSlot(p,input.slot);
    this.move(p,input,dt);
    const shot=this.advanceWeaponCommand(p,input,dt,true);
    this.postSourceViewmodel(p);this.world.step();return shot;
  }
  /** Server-authoritative grenade release: consumes one charge, spawns the
   * physics body and arms the matching original release overlay. The original
   * release strengths scale the throw velocity by strength*0.7+0.3 (the
   * CS:GO m_flThrowStrength formula: 1.0 overhand, 0.5 medium, 0 underhand),
   * so the medium release keeps 65% and the underhand 30% of the speed. */
  private throwUtility(p:Player,utility:Utility,style:SourceGrenadeThrowStyle){
    const inventory=utility==='smoke'?'smokes':utility==='flash'?'flashes':'grenades';
    if(p[inventory]<=0||p.cooldown!==0)return;
    p[inventory]--;
    p.cooldown=0.6;
    const power=style==='overhand'?1:style==='medium'?.65:.3;
    const dx=-Math.sin(p.yaw)*Math.cos(p.pitch),
      dy=Math.sin(p.pitch),
      dz=-Math.cos(p.yaw)*Math.cos(p.pitch);
    const throwEye=this.eyeOrigin(p);
    const body=this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x+dx*0.5,this.sourceLevel?throwEye.y:p.y+1.3,p.z+dz*0.5)
        .setLinvel(dx*12*power,dy*12*power+3*power,dz*12*power)
        // The non-spherical original bodies now have an observable orientation.
        // Rapier integrates it on the server and both clients receive that pose.
        .setAngvel({x:Math.cos(p.yaw)*10,y:2,z:-Math.sin(p.yaw)*10})
        .setAngularDamping(.1)
        .setCcdEnabled(true),
    );
    const shape=this.sourceLevel
      ?RAPIER.ColliderDesc.convexHull(new Float32Array(SOURCE_GRENADE_COLLIDERS[utility].hullMetres))
      :RAPIER.ColliderDesc.ball(.12);
    if(!shape)throw Error('Original grenade body has no convex hull: '+utility);
    this.world.createCollider(
      shape.setRestitution(0.4).setFriction(0.6).setCollisionGroups(this.sourceLevel?.queryGroups('projectile')??0xffffffff),
      body,
    );
    this.grenades.push({
      id:++this.eid,
      by:p.id,
      kind:utility,
      body,
      timer:utility==='smoke'?1.8:1.5,
    });
    // The original Shoot_GREN release overlay (overhand/medium/underhand by
    // the held modifiers) starts at the server-confirmed release instant; the
    // pose driver runs and fades it on its own.
    this.sourcePlayerContract?.poseDriverFor(p)?.beginGrenadeThrow?.(p,style);
    this.emit({type:'throw',by:p.id});
  }
  step(dt = DT) {
    if (this.disposed) return;
    this.time += dt;
    this.tick++;
    for (const s of this.smokes) {
      s.age += dt;
      s.remaining -= dt;
    }
    this.smokes = this.smokes.filter((s) => s.remaining > 0);
    // Combat is stopped, but the last fire clip must finish on the authority clock.
    if (this.phase === 'ended' || this.phase === 'match')
      for (const p of this.players) {
        p.shotIdle += dt;
        // The final shot still finishes on the authoritative clock after a round
        // ends. Keep lower/upper poses frozen and never advance them locally.
        if(p.sourcePose&&typeof p.sourcePose.fireCycleRate==='number'){const fireCycle=Math.min(1,p.shotIdle*p.sourcePose.fireCycleRate);
          p.sourcePose={...p.sourcePose,fireTimeSeconds:p.shotIdle,fireCycle,fireWeight:fireCycle<1?1:0};}
        this.postSourceViewmodel(p);this.updateSourcePistolPose(p);
      }
    if (this.phase === 'match') return;
    this.remaining = Math.max(0, this.remaining - dt);
    if (this.phase === 'buy' && this.remaining === 0) {
      this.phase = 'live';
      this.remaining = this.rules ? this.rules.timers.roundTime : 100;
      this.emit({ type: 'round', text: '行动开始' });
    }
    if (this.phase === 'ended' && this.remaining === 0) {
      this.nextRound();
      return;
    }
    for (const p of this.players) {
      p.cooldown = Math.max(0, p.cooldown - dt);
      p.reveal = Math.max(0, p.reveal - dt);
      p.flash = Math.max(0, p.flash - dt);
      if (!p.alive) {
        // Advance the authoritative Death1 corpse clock until the non-looping
        // clamp freezes it; frozen corpses stop consuming pose ticks.
        const deathDriver=this.sourcePlayerContract?.poseDriverFor(p);
        if(deathDriver&&p.sourcePose&&!(p.sourcePose.state==='Death'&&p.sourcePose.cycle>=1)){
          p.sourcePose=deathDriver.advance(p,{...p},dt);p.sourcePoseVersion=deathDriver.id;
          // Pistol/AWP actors render the body through the world pose input;
          // keep it following the Death1 fall instead of freezing mid-action.
          this.updateSourcePistolPose(p);
        }
        // The original VPhysics corpse keeps integrating on the authority
        // clock until it settles; settled corpses stop consuming ticks.
        if(p.sourceRagdoll&&deathDriver?.ragdoll){
          const next=deathDriver.ragdoll.stepRagdoll(p,dt,this.ragdollGround(p));
          if(next)p.sourceRagdoll=next;
        }
        if (this.mode === 'training') {
          p.respawn -= dt;
          if (p.respawn <= 0) this.spawn(p);
        }
        continue;
      }
      const input =
        p.bot && this.bots
          ? this.botInput(p, dt)
          : (this.inputs.get(p.id) ?? {
              ...EMPTY_INPUT,
              yaw: p.yaw,
              pitch: p.pitch,
              slot: p.slot,
            });
      if((this.phase==='live'||this.phase==='buy')&&input.slotSelect!==false)this.selectSourceSlot(p,input.slot);
      if (this.phase !== 'ended')
        this.move(
          p,
          this.phase === 'buy'
            ? { ...input, mx: 0, mz: 0, jump: false }
            : input,
          dt,
        );
      if (this.phase !== 'live') {if(this.phase==='buy'){this.postSourceViewmodel(p);this.interact(p,input,dt);}continue;}
      if (!this.sourceLevel && input.slotSelect !== false && input.slot !== p.slot) {
        if (p.slot === 0) {
          p.primaryAmmo = p.ammo;
          p.primaryReserve = p.reserve;
        } else {
          p.pistolAmmo = p.ammo;
          p.pistolReserve = p.reserve;
        }
        p.slot = input.slot;
        p.weapon = p.slot === 0 ? p.primary??'sidearm' : 'sidearm';
        p.ammo = p.slot === 0 ? p.primaryAmmo : p.pistolAmmo;
        p.reserve = p.slot === 0 ? p.primaryReserve : p.pistolReserve;
        p.reload = 0;
        p.cooldown = 0.25;
        p.shotHeat = 0;
      }
      this.advanceWeaponCommand(p,input,dt,false);
      this.postSourceViewmodel(p);
      const utility = input.utility ?? 'he';
      const inventory =
        utility === 'smoke'
          ? 'smokes'
          : utility === 'flash'
            ? 'flashes'
            : 'grenades';
      if (input.grenadeHold !== undefined) {
        // The original grenade hold: the throw-key press edge arms the pin-pull
        // preparation layer, the release edge performs the throw. The original
        // three release strengths select by the mouse buttons held at the
        // release (the throw key stands in for the primary attack): secondary
        // fire alone picks the underhand release, primary+secondary the medium
        // one, otherwise the overhand release.
        if (input.grenadeHold) {
          if (p.sourceGrenadeHold !== true && p[inventory] > 0 && p.cooldown === 0) {
            p.sourceGrenadeHold = true;
            this.sourcePlayerContract?.poseDriverFor(p)?.beginGrenadePrep?.(p);
          }
        } else if (p.sourceGrenadeHold === true) {
          p.sourceGrenadeHold = false;
          const style:SourceGrenadeThrowStyle = input.aim ? (input.fire ? 'medium' : 'underhand') : 'overhand';
          this.throwUtility(p, utility, style);
        }
      } else if (input.grenade && p[inventory] > 0 && p.cooldown === 0) {
        // Legacy press-edge inputs (older clients, bots, fixtures) keep the
        // instant overhand release.
        this.throwUtility(p, utility, 'overhand');
      }
      if (
        p.grounded &&
        !p.crouch &&
        Math.hypot(input.mx, input.mz) > 0.5 &&
        this.tick - (this.stepTicks.get(p.id) ?? 0) > 22
      ) {
        this.stepTicks.set(p.id, this.tick);
        this.emit({ type: 'step', by: p.id, x: p.x, y: p.y, z: p.z });
      }
      this.interact(p, input, dt);
    }
    // Advance every shared rigid body together. Thin original dropped weapon
    // hulls need substeps; controller/weapon commands still run once per tick.
    const substeps=this.droppedWeapons.read().some(drop=>!drop.sleeping)
      ?Math.ceil(dt/SOURCE_DROPPED_WEAPON_MAX_PHYSICS_STEP):1;
    this.world.timestep=dt/substeps;
    for(let i=0;i<substeps;i++)this.world.step();
    this.world.timestep=dt;
    this.droppedWeapons.afterStep(dt);
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const grenade = this.grenades[i];
      grenade.timer -= dt;
      if (grenade.timer <= 0) {
        const pos = grenade.body.translation(),
          by = this.players.find((p) => p.id === grenade.by);
        this.emit({
          type: grenade.kind === 'he' ? 'grenade' : grenade.kind,
          by: grenade.by,
          x: pos.x,
          y: pos.y,
          z: pos.z,
        });
        if (grenade.kind === 'smoke') {
          this.smokes.push({
            id: grenade.id,
            x: pos.x,
            // Smoke belongs to the detonation location, including Dust2's
            // below-zero ground. A global minimum made CT/tunnel smoke float.
            y: pos.y,
            z: pos.z,
            age: 0,
            remaining: 16,
          });
        }
        if (grenade.kind === 'flash') {
          for (const target of this.players)
            if (target.alive)
              target.flash = Math.max(
                target.flash,
                flashExposure(target, pos, this) * 3.2,
              );
        }
        if (by && grenade.kind === 'he')
          for (const target of this.players) {
            const distance = Math.hypot(target.x - pos.x, target.y + 1 - pos.y, target.z - pos.z);
            const friendly = target.team === by.team;
            const selfDamage = target.id === by.id;
            const multiplier = friendly
              ? this.rules ? sourceFriendlyFireMultiplier(this.rules, 'grenade', selfDamage) : 0
              : 1;
            if (
              target.alive &&
              multiplier > 0 &&
              distance < 6 &&
              this.sight(
                { x: pos.x, y: pos.y + 0.1, z: pos.z },
                { x: target.x, y: target.y + 1, z: target.z },
              )
            )
              this.damage(
                target,
                by,
                Math.round((1 - distance / 6) * 85),
                false,
                undefined,
                // The grenade killed, whatever its thrower is holding now.
                'he',
              );
          }
        this.world.removeRigidBody(grenade.body);
        this.grenades.splice(this.grenades.indexOf(grenade), 1);
      }
    }
    this.assignBomb();
    this.history.push({
      time: this.time,
      players: this.players.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        z: p.z,
        alive: p.alive,
        deaths: p.deaths,
        team: p.team,
        crouch: p.crouch,
        yaw:p.yaw,
        pitch:p.pitch,
        stancePhase:p.stancePhase,
        stanceRate:p.stanceRate,
        stanceTarget:p.stanceTarget,
        ...readLocomotion(p),grounded:p.grounded,sourceContract:p.sourceContract,sourceJumpHeld:p.sourceJumpHeld,
        weapon:p.weapon,secondary:p.secondary,sourcePose:p.sourcePose?structuredClone(p.sourcePose):undefined,sourcePoseVersion:p.sourcePoseVersion,
        sourceRagdoll:p.sourceRagdoll?structuredClone(p.sourceRagdoll):undefined,
        sourcePistolPose:p.sourcePistolPose?structuredClone(p.sourcePistolPose):undefined,
        sourceAWPPose:p.sourceAWPPose?structuredClone(p.sourceAWPPose):undefined,sourceAWP:p.sourceAWP?structuredClone(p.sourceAWP):undefined,
        sourceGlock:p.sourceGlock?structuredClone(p.sourceGlock):undefined,sourceUSP:p.sourceUSP?structuredClone(p.sourceUSP):undefined,sourceDeagle:p.sourceDeagle?structuredClone(p.sourceDeagle):undefined,
        sourceViewmodelTime:p.sourceViewmodelTime?{...p.sourceViewmodelTime}:undefined,
        sourceRifleHandling:p.sourceRifleHandling?structuredClone(p.sourceRifleHandling):undefined,
      })),
    });
    while (this.history.length > 20) this.history.shift();
    if (this.phase === 'live') {
      if (this.mode === 'training') {
        if (
          this.remaining === 0 ||
          this.score.amber >= 25 ||
          this.score.blue >= 25
        ) {
          this.phase = 'match';
          this.winner = this.score.amber >= this.score.blue ? 'amber' : 'blue';
          this.reason = '训练结束';
        }
      } else if (this.bomb.planted) {
        this.bomb.timer -= dt;
        if (this.bomb.timer <= 0) {
          this.emit({ type: 'explode', x: this.bomb.x, y: this.bomb.y, z: this.bomb.z });
          this.endRound('amber', '目标装置已引爆', 'detonation');
        } else if (!this.players.some((p) => p.team === 'blue' && p.alive))
          this.endRound('amber', '防守方已被清除');
      } else if (this.remaining === 0) this.endRound('blue', '成功守住目标', 'time');
      else if (this.players.length > 1) {
        if (!this.players.some((p) => p.team === 'amber' && p.alive))
          this.endRound('blue', '进攻方已被清除');
        else if (!this.players.some((p) => p.team === 'blue' && p.alive))
          this.endRound('amber', '防守方已被清除');
      }
    }
  }
  shoot(p: Player, input: Input) {
    if(this.sourceLevel&&(p.weapon==='awp'||isSourcePistol(p.weapon)))throw Error('Source weapon firing requires the authoritative command bridge');
    const w = WEAPONS[p.weapon];
    p.ammo--;
    p.cooldown = w.rate;
    p.reveal = 0.8;
    let sourceRifleShot:Event['sourceRifleShot'];
    let direction:{dx:number;dy:number;dz:number};
    if(this.sourceLevel){
      const result=sourceRifleHandlingShot(p.sourceRifleHandling!,sourcePlayerAccuracyContext(p),this.time,this.rifleSeed());
      p.sourceRifleHandling=result.state;sourceRifleShot={...result.shot,browserAim:[p.yaw,p.pitch]};
      this.syncSourcePlayerPunch(p);
      const [dx,dy,dz]=sourceSpreadDirection(sourceBrowserShotBasis(p.yaw,p.pitch,result.shot.punchAngles),result.shot.offset);
      direction={dx,dy,dz};
    }else direction=shotDirection(p,input);
    registerShot(p);
    if(this.sourcePlayerContract&&p.sourcePose)p.sourcePose={...p.sourcePose,fireCycle:0,fireTimeSeconds:0,fireWeight:1};
    this.traceShot(p,input,direction,sourceRifleShot);
  }
  /** Trace/damage only: the accepted weapon owner already advanced ammo,
   * recoil and the shared punch exactly once. */
  private traceShot(p:Player,input:Input,direction:{dx:number;dy:number;dz:number},sourceRifleShot?:Event['sourceRifleShot'],sourcePistolShot?:Event['sourcePistolShot'],sourceAWPShot?:Event['sourceAWPShot']){
    const w=WEAPONS[p.weapon],{dx,dy,dz}=direction;
    const origin = this.eyeOrigin(p), oy=origin.y;
    let nearest = Math.min(this.wallDistance(origin.x, oy, origin.z, dx, dy, dz),this.sourceLevel?w.range:Infinity),
      victim: Player | undefined,
      head = false,hitgroup=0;
    const wallHit = this.sourceLevel && Number.isFinite(nearest)
      ? this.sourceLevel.traceBullet(origin.x, oy, origin.z, dx, dy, dz, Math.min(nearest + .01, w.range))
      : null;
    let penetrationFactor = 1;
    // Only allow a bounded rewind relative to the server clock (never arbitrary client positions).
    const rewind = Math.max(this.time - 0.2, Math.min(this.time, input.time));
    const frames = [...this.history.filter(h => h.time < this.time),
      {time:this.time,players:this.players}];
    const past = samplePoseFrame(frames,rewind);
    const friendlyBullets = this.rules ? sourceFriendlyFireMultiplier(this.rules, 'bullet') : 0;
    for (const t of this.players) {
      // The shooter is inside their own hit volumes; Source never resolves that
      // first-person ray as a self hit. Teammate volumes are eligible only when
      // the active competitive rules explicitly enable friendly fire.
      if (!t.alive || t.id === p.id || (t.team === p.team && friendlyBullets <= 0)) continue;
      const pos = past?.players.find((v) => v.id === t.id);
      // Never fall back from an absent/dead historical life to a newly respawned target.
      if (!pos?.alive || pos.deaths !== t.deaths) continue;
      if(this.sourcePlayerContract){
        const hit=this.sourcePlayerContract.raycast(pos,origin,{x:dx,y:dy,z:dz},nearest);
        if(hit){nearest=hit.distance;victim=t;head=hit.head;hitgroup=hit.group??(hit.head?1:0);}continue;
      }
      for (const volume of characterHitVolumes(pos)) {
        const cx = volume.center.x - origin.x,
          cy = volume.center.y - oy,
          cz = volume.center.z - origin.z,
          dot = cx * dx + cy * dy + cz * dz,
          disc = volume.radius * volume.radius - (cx * cx + cy * cy + cz * cz - dot * dot);
        if (disc < 0) continue;
        const d = dot - Math.sqrt(disc);
        if (d > 0 && d < nearest) {
          nearest = d;
          victim = t;
          head = volume.head;
        }
      }
    }
    // The first trace deliberately stops at world geometry. For a supported
    // firearm, walk the original collider surfaces one by one. Each exit is
    // filtered to the entry collider itself: overlapping BSP/prop colliders
    // must not turn another collider's entry face into a false thin wall.
    // Actors are admitted only in the free segment before the next wall; this
    // prevents a target behind a second wall from being hit by a one-wall model.
    const penetrationWeapon = p.weapon === 'awp' ? 'awp' : p.weapon === 'vandal' ? 'ak47'
      : p.weapon === 'glock' ? 'glock18' : p.weapon === 'usp' ? 'usp-s'
        : p.weapon === 'deagle' ? 'deagle' : p.weapon === 'm4a4' ? 'm4a4' : null;
    if (!victim && this.sourceLevel && wallHit && wallHit.source &&
      Object.keys(wallHit.source).length > 0 && w && penetrationWeapon) {
      const findAfterWall = (minDistance:number,maxDistance:number) => {
        let found: { target:Player; distance:number; head:boolean; group:number } | undefined;
        for (const t of this.players) {
          if (!t.alive || t.id === p.id || (t.team === p.team && friendlyBullets <= 0)) continue;
          const pos = past?.players.find((v) => v.id === t.id);
          if (!pos?.alive || pos.deaths !== t.deaths) continue;
          if (this.sourcePlayerContract) {
            const hit = this.sourcePlayerContract.raycast(pos, origin, {x: dx, y: dy, z: dz}, maxDistance);
            if (hit && hit.distance > minDistance && hit.distance < maxDistance &&
              (!found || hit.distance < found.distance))
              found = {target:t,distance:hit.distance,head:hit.head,group:hit.group ?? (hit.head ? 1 : 0)};
            continue;
          }
          for (const volume of characterHitVolumes(pos)) {
            const cx = volume.center.x - origin.x, cy = volume.center.y - oy, cz = volume.center.z - origin.z;
            const dot = cx * dx + cy * dy + cz * dz;
            const disc = volume.radius * volume.radius - (cx * cx + cy * cy + cz * cz - dot * dot);
            if (disc < 0) continue;
            const d = dot - Math.sqrt(disc);
            if (d > minDistance && d < maxDistance && (!found || d < found.distance))
              found = {target:t,distance:d,head:volume.head,group:volume.head ? 1 : 0};
          }
        }
        if (!found) return false;
        nearest=found.distance;victim=found.target;head=found.head;hitgroup=found.group;return true;
      };
      let current=wallHit, entryAbsolute=wallHit.distance, factor=1, wallCount=0;
      while (current && wallCount<4 && !victim) {
        const entryPoint={x:current.x+dx*.001,y:current.y+dy*.001,z:current.z+dz*.001};
        const remaining=Math.max(0,w.range-entryAbsolute-.001);
        // Restrict the non-solid query to the exact entry collider. With a
        // compound/overlapping map this returns that solid's own exit, never a
        // neighbouring collider's entry face.
        const exit=this.sourceLevel.traceBullet(entryPoint.x,entryPoint.y,entryPoint.z,dx,dy,dz,
          remaining,'bullet',false,current.collider);
        if (!exit || exit.distance<=0) break;
        const thickness=exit.distance+.001;
        factor*=sourceBulletPenetrationFactor(penetrationWeapon,thickness);
        if (!(factor>0)) break;
        const exitAbsolute=entryAbsolute+.001+exit.distance;
        const afterExit={x:exit.x+dx*.001,y:exit.y+dy*.001,z:exit.z+dz*.001};
        const nextRemaining=Math.max(0,w.range-exitAbsolute-.001);
        const next=nextRemaining>0?this.sourceLevel.traceBullet(afterExit.x,afterExit.y,afterExit.z,dx,dy,dz,
          nextRemaining,'bullet',true):null;
        const nextAbsolute=next?exitAbsolute+.001+next.distance:w.range;
        if(findAfterWall(exitAbsolute,nextAbsolute)) { penetrationFactor=factor; break; }
        penetrationFactor=factor;
        if(!next||next.source===null||Object.keys(next.source).length===0) break;
        current=next;entryAbsolute=nextAbsolute;wallCount++;
      }
    }
    // A shot that stops on the world leaves the original's own mark: the point it stopped
    // at, the surface normal there, and the original surface property of the face it hit.
    // A shot that stopped in an actor has none of these, and neither has one that ran out
    // of range in open air, so both report no impact at all rather than a guessed surface.
    let impact:Event['impact'];
    if(!victim&&this.sourceLevel&&this.sourceImpacts&&Number.isFinite(nearest)){
      const stoppedAt=Math.min(nearest*1.000001+0.001,10000);
      const hit=this.sourceLevel.traceBullet(origin.x,oy,origin.z,dx,dy,dz,stoppedAt);
      if(hit)impact={x:hit.x,y:hit.y,z:hit.z,nx:hit.nx,ny:hit.ny,nz:hit.nz,
        surface:sourceImpactSurfaceFor(this.sourceImpacts,hit.source)};
    }
    this.emit({
      type: 'shot',
      by: p.id,
      x: origin.x,
      y: oy,
      z: origin.z,
      dx: dx * Math.min(nearest, 100),
      dy: dy * Math.min(nearest, 100),
      dz: dz * Math.min(nearest, 100),
      weapon: p.weapon,
      seq: input.seq,
      ...(sourceRifleShot?{sourceRifleShot}:{}),
      ...(sourcePistolShot?{sourcePistolShot}:{}),
      ...(sourceAWPShot?{sourceAWPShot}:{}),
      ...(this.sourceLevel?{sourceTracer:{end:[origin.x+dx*nearest,oy+dy*nearest,origin.z+dz*nearest] as [number,number,number]}}:{}),
      ...(impact?{impact}:{}),
    });
    if (victim) {
      if(this.sourceLevel){
        if(p.weapon==='awp'){
          const result=computeSourceAWPBulletDamage({weapon:'awp',hitgroup,distanceMetres:nearest,armor:victim.armor,helmet:!!victim.helmet});
          if(result.withinRange){
            const scaled=penetrationFactor===1?result:{...result,
              healthDamage:Math.trunc(result.healthDamage*penetrationFactor),
              healthDamageFloat:result.healthDamageFloat*penetrationFactor,
              armorDamage:Math.trunc(result.armorDamage*penetrationFactor),
              reportedArmorDamage:Math.trunc(result.reportedArmorDamage*penetrationFactor)};
            this.damage(victim,p,scaled.healthDamage,head,scaled,p.weapon);
          }
          return;
        }
        if(p.weapon!=='vandal'&&p.weapon!=='m4a4'&&!isSourcePistol(p.weapon))throw Error('No original bullet profile for held weapon');
        const result=computeSourceBulletDamage({weapon:p.weapon==='vandal'?'ak47':p.weapon==='glock'?'glock18':p.weapon==='usp'?'usp-s':p.weapon==='deagle'?'deagle':'m4a4',hitgroup,distanceMetres:nearest,armor:victim.armor,helmet:!!victim.helmet});
        if(result.withinRange){
          const scaled = penetrationFactor === 1 ? result : {...result,
            healthDamage: Math.trunc(result.healthDamage * penetrationFactor),
            healthDamageFloat: result.healthDamageFloat * penetrationFactor,
            armorDamage: Math.trunc(result.armorDamage * penetrationFactor),
            reportedArmorDamage: Math.trunc(result.reportedArmorDamage * penetrationFactor)};
          this.damage(victim,p,scaled.healthDamage,head,scaled,p.weapon);
        }
        return;
      }
      const falloff = Math.max(
        0.65,
        1 - Math.max(0, nearest - w.range) * 0.005,
      );
      this.damage(
        victim,
        p,
        Math.round(w.damage * (head ? w.head : 1) * falloff),
        head,
        undefined,
        p.weapon,
      );
    }
  }
  damage(t: Player, p: Player, amount: number, head: boolean,sourceBullet?:SourceBulletDamageResult,
    killedWith?: WeaponId | Utility) {
    // The cash a kill pays is the killing weapon's own award, so the damage has to say
    // what dealt it: a bullet's shooter holds that weapon at this instant, while a
    // grenade's thrower may hold anything, so the grenade names itself.
    const award = sourceKillAward(killedWith ?? p.weapon);
    const friendly = t.team === p.team;
    const selfDamage = t.id === p.id;
    const rules = this.rules;
    const friendlyKind: 'bullet' | 'grenade' | 'other' = killedWith === 'he'
      ? 'grenade'
      : sourceBullet || killedWith ? 'bullet' : 'other';
    // A firearm trace never resolves the shooter's own body. Keep the same
    // invariant for direct callers; self damage is only admitted through the
    // grenade path, whose shipped cfg has a separate self multiplier.
    if (selfDamage && sourceBullet) return;
    const multiplier = friendly
      ? rules ? sourceFriendlyFireMultiplier(rules, friendlyKind, selfDamage) : 0
      : 1;
    if (!t.alive || multiplier <= 0) return;
    const armorBefore = t.armor;
    let absorbed: number;
    let damage: number;
    if (sourceBullet) {
      // Native bullet damage has already applied the weapon's armor ratio. The
      // friendly-fire cvar scales the delivered health/armor portions together;
      // preserve integer truncation and never restore armor already removed.
      damage = Math.trunc(sourceBullet.healthDamage * multiplier);
      const armorRemoved = Math.min(armorBefore, Math.trunc(sourceBullet.armorDamage * multiplier));
      t.armor = armorBefore - armorRemoved;
      absorbed = armorRemoved;
    } else {
      const scaledAmount = Math.trunc(amount * multiplier);
      absorbed = Math.min(t.armor, Math.floor(scaledAmount * 0.4));
      t.armor = t.armor - absorbed;
      damage = scaledAmount - absorbed;
    }
    t.hp = Math.max(0, t.hp - damage);
    this.emit({ type: 'hit', by: p.id, target: t.id, head, damage });
    if (t.hp === 0) {
      // Sample the living locomotion, aim and weapon layers before Death
      // replaces them. This exact pose is also sent to remote skinning.
      const deathDriver=this.sourcePlayerContract?.poseDriverFor(t);
      const deathRest=deathDriver?.ragdoll?.capturePose(t);
      if(deathRest&&deathDriver?.ragdollIndex&&isSourceDroppedWeapon(t.weapon)){
        // Training replaces a player's old life; normal rounds retain drops
        // until the authoritative round reset. Never keep a second held gun.
        if(this.mode==='training')for(const drop of this.droppedWeapons.read())
          if(drop.ownerId===t.id)this.droppedWeapons.remove(drop.id);
        const pose=sourceDroppedWeaponPoseFromRest(deathDriver.ragdollIndex,deathRest,t);
        this.droppedWeapons.create({id:`${this.round}:${t.id}:${t.deaths+1}`,ownerId:t.id,
          weapon:t.weapon,createdAt:this.time,...pose,velocity:[t.vx,t.vy,t.vz],
          sourceWeaponFinish:t.sourceWeaponFinish?.weapon===t.weapon?t.sourceWeaponFinish:undefined,
          ammo:t.ammo,reserve:t.reserve,
          magazineVisible:t.sourcePistolPose?.magazineVisible??t.sourceAWPPose?.magazineVisible??true,
          silencerVisible:t.weapon==='usp'?(t.sourcePistolPose?.silencerVisible??t.sourceUSP?.command.silencerAttached??true):true});
      }
      if(!this.bomb.planted&&this.bomb.carrier===t.id){
        this.bomb={...this.bomb,x:t.x,y:t.y,z:t.z,carrier:null,dropped:true};
      }
      t.alive = false;
      t.deaths++;
      t.respawn = 3;
      t.use = 0;
      this.bodies.get(t.id)?.collider.setEnabled(false);
      if (friendly && !selfDamage) {
        // Competitive Source applies the shipped teammate-kill cash penalty;
        // a self HE death has no teammate penalty and no enemy kill award.
        this.award(p, this.cashRules.money.teamKill);
      } else if (!friendly) {
        p.kills++;
        this.award(p, sourceKillCash(this.cashRules, award));
      }
      if(deathDriver&&t.sourcePose){t.sourcePose=deathDriver.advance(t,{...t},0);t.sourcePoseVersion=deathDriver.id;}
      // Complete rigid transforms preserve twist. Convert world velocities
      // through both Source axes and actor yaw, then let the shared map world
      // advance contacts once per simulation tick.
      if(deathDriver?.ragdoll&&this.sourceLevel){
        const unit=this.sourceLevel.metersPerSourceUnit;
        const dx=t.x-p.x,dz=t.z-p.z,dist=Math.hypot(dx,dz);
        const nx=dist>1e-6?dx/dist:0,nz=dist>1e-6?dz/dist:0;
        const impulseUnits=head?260:170;
        const up=impulseUnits*.25;
        const ground=this.ragdollGround(t)!;
        t.sourceRagdoll=deathDriver.ragdoll.beginRagdoll(t,
          sourceRagdollVelocityFromWorld(ground,{x:t.vx,y:t.vy,z:t.vz}),
          sourceRagdollVelocityFromWorld(ground,{x:nx*impulseUnits*unit,y:up*unit,z:nz*impulseUnits*unit}),
          ground,deathRest);
      }
      if (this.mode === 'training') this.score[p.team]++;
      this.emit({
        type: 'kill',
        by: p.id,
        target: t.id,
        head,
        weapon: killedWith ?? p.weapon,
      });
      this.assignBomb();
    }
  }
  canDefuse(p: Player) {
    if (!this.bomb.planted || p.team !== 'blue' || !p.alive || !p.grounded ||
      this.phase !== 'live' || this.mode !== 'demolition') return false;
    const dx = this.bomb.x - p.x, dz = this.bomb.z - p.z;
    const height = this.bomb.y - p.y;
    if (Math.abs(height) > 0.75 || Math.hypot(dx, height, dz) >= 2.8) return false;
    const eye = this.eyeOrigin(p), ex=this.bomb.x-eye.x, ez=this.bomb.z-eye.z, dy = this.bomb.y + 0.18 - eye.y;
    const length = Math.hypot(ex, dy, ez);
    return length < 1e-9 || this.wallDistance(eye.x, eye.y, eye.z, ex / length, dy / length, ez / length) > length - 0.01;
  }
  interact(p: Player, input: Input, dt: number) {
    const previous=this.sourceItemInputs.get(p.id),fresh=previous?.seq!==input.seq;
    const pickupPressed=fresh&&input.use&&!previous?.use,dropPressed=fresh&&input.drop;
    if(fresh)this.sourceItemInputs.set(p.id,{seq:input.seq,use:input.use});
    const objectiveLive=this.mode==='demolition'&&this.phase==='live';
    if ((!objectiveLive&&!(this.sourceLevel&&(this.phase==='buy'||this.phase==='live'))) || !p.alive) {
      p.use = 0;
      return;
    }
    let active = false;
    if (input.use && p.grounded && !input.fire && !input.grenade && !input.reload && p.reload === 0) {
      // Objective use has priority over the same Source E key used for a
      // nearby weapon pickup; otherwise a rifle at the plant site could steal
      // the keypress and make planting appear unreliable.
      if (objectiveLive&&!this.bomb.planted && p.id === this.bomb.carrier) {
        const site = this.sitesFor(p)[0];
        if (site) {
          active = true;
          p.use += dt;
          if (p.use >= (this.sourceLevel?SOURCE_OBJECTIVE_TIMERS.plant:3)) {
            this.bomb = {
              planted: true,
              x: p.x,
              y: p.y,
              z: p.z,
              timer: this.sourceLevel?SOURCE_OBJECTIVE_TIMERS.fuse:35,
              site: site.name,
              carrier: null,
              dropped: false,
            };
            this.emit({
              type: 'plant',
              by: p.id,
              text: `${site.name} 区装置已启动`,
            });
            this.award(p, this.cashRules.money.bombPlanted);
            p.use = 0;
          }
        }
      } else if (this.canDefuse(p)) {
        active = true;
        p.use += dt;
        if (p.use >= (this.sourceLevel?(p.defuseKit?SOURCE_OBJECTIVE_TIMERS.defuseKit:SOURCE_OBJECTIVE_TIMERS.defuse):5)) {
          this.emit({ type: 'defuse', by: p.id });
          this.award(p, this.cashRules.money.bombDefused);
          this.endRound('blue', '目标装置已解除', 'defuse');
          p.use = 0;
        }
      }
      if(!active&&pickupPressed)active=this.pickupSourceBomb(p)||this.pickupSourcePrimary(p);
    }
    if(!active&&dropPressed&&!input.use&&!input.fire&&!input.grenade&&!input.reload&&p.reload===0)this.dropSourceWeapon(p);
    if (!active) p.use = 0;
  }
  endRound(team: Team, reason: string, kind: SourceRoundWinKind = 'elimination') {
    if (this.phase !== 'live') return;
    this.score[team]++;
    this.winner = team;
    this.reason = reason;
    this.phase = 'ended';
    const rules = this.rules;
    this.remaining = rules ? rules.timers.roundEndPanel : 5;
    const loser: Team = team === 'amber' ? 'blue' : 'amber';
    let cash: { amber: number; blue: number };
    if (!rules) {
      cash = team === 'amber' ? { amber: 2700, blue: 1900 } : { amber: 1900, blue: 2700 };
      for (const p of this.players) p.money = Math.min(16000, p.money + (p.team === team ? 2700 : 1900));
    } else {
      // The original bomb-map round cash: the winners take the cash for how the
      // round was won, and the losers either take the planted-bomb cash (they
      // planted it and still lost) or the consecutive-loss ladder's next rung.
      // The original starts this counter at `mp_starting_losses` and reads the
      // bonus from it before advancing, so a fresh team's first loss pays 1400 and
      // each further consecutive loss moves one rung up the ladder.
      const losses = this.lossStreak[loser];
      const winnerCash = sourceTeamWinCash(rules, kind);
      const loserCash = kind === 'defuse' ? rules.teamCash.plantedButDefused : sourceLoserBonus(rules, losses);
      cash = team === 'amber' ? { amber: winnerCash, blue: loserCash } : { amber: loserCash, blue: winnerCash };
      for (const p of this.players) p.money = Math.min(rules.money.max, p.money + (p.team === team ? winnerCash : loserCash));
      // `mp_consecutive_loss_aversion=1` lowers the winner's loss-bonus counter
      // by one for each win. Keep the state so a second consecutive win
      // continues lowering it; native round-end logic clamps at zero.
      this.lossStreak[team] = Math.max(
        0,
        this.lossStreak[team] - SOURCE_CONSECUTIVE_LOSS_AVERSION,
      );
      this.lossStreak[loser] = losses + 1;
    }
    // The round panel shows the same amounts the teams were just paid, so the
    // original economy is legible instead of only visible in the money counter.
    this.emit({ type: 'round', team, text: reason, cash });
    const format = this.format;
    if (this.score[team] >= (format?.winTarget ?? 5) || (format && this.round >= format.maxRounds)) {
      this.phase = 'match';
      this.winner = this.score.amber === this.score.blue ? null : this.score.amber > this.score.blue ? 'amber' : 'blue';
      this.reason = this.winner === null ? '平局' : '任务完成';
    }
  }
  /** At halftime scores follow their players to the opposite side. Source
   * competitive equipment, cash and loss state restart for the next pistol
   * round; the original-map actors then spawn in their new team's locations. */
  swapSides() {
    for (const p of this.players) p.team = p.team === 'amber' ? 'blue' : 'amber';
    const score = this.score.amber;
    this.score.amber = this.score.blue;
    this.score.blue = score;
    if(this.sourceLevel&&this.rules){
      for(const p of this.players){p.money=this.rules.money.start;this.resetSourceInventory(p);}
      this.lossStreakStore={amber:this.startingLosses,blue:this.startingLosses};
    }else{
      const streak = this.lossStreak.amber;
      this.lossStreak.amber = this.lossStreak.blue;
      this.lossStreak.blue = streak;
    }
    this.winner = null;
    this.reason = '';
    // A side swap is not something a player can infer from the score alone, so it is
    // announced the same way a round result is.
    this.emit({ type: 'round', text: '半场结束 · 双方交换边' });
  }
  nextRound() {
    // Only restart() may leave a completed regulation match; it clears the
    // round counter before entering here. A stale round transition must not
    // create an extra round after either a clinch or a final tie.
    if (this.format && this.phase === 'match' && this.round > 0) return;
    // `mp_halftime` swaps ends once, right after the round that completes the first
    // half. The round counter is still the round just played at this point.
    const format = this.format;
    if (format && format.swapAfterRound > 0 && this.phase === 'ended' && this.round === format.swapAfterRound) this.swapSides();
    this.history = [];
    for (const g of this.grenades) this.world.removeRigidBody(g.body);
    this.grenades = [];
    this.droppedWeapons.clear();
    this.smokes = [];
    this.round++;
    this.phase = 'buy';
    this.remaining = this.rules ? this.rules.timers.freezeTime : 12;
    this.winner = null;
    this.bomb = {
      planted: false,
      x: 0,
      y: 0,
      z: 0,
      timer: this.sourceLevel?SOURCE_OBJECTIVE_TIMERS.fuse:35,
      site: '',
      carrier: null,
      dropped: false,
    };
    for (const p of this.players) {
      if (!p.alive) {
        if(this.sourceLevel)this.resetSourceInventory(p);
        else{
          p.primary='sidearm';p.weapon=p.primary;p.slot=1;p.armor=0;p.helmet=false;
        }
      }
      const w = WEAPONS[p.weapon];
      p.ammo = w.mag;
      p.reserve = w.reserve;
      p.primaryAmmo = p.primary?WEAPONS[p.primary].mag:0;
      p.primaryReserve = p.primary?WEAPONS[p.primary].reserve:0;
      p.pistolAmmo = 12;
      p.pistolReserve = 48;
      if(!this.sourceCompetitiveInventory(p.team))p.grenades = p.smokes = p.flashes = 1;
      this.spawn(p);
      if (p.bot) {
        if(this.sourceCompetitiveInventory(p.team))this.buySourceBotEquipment(p);
        else{
          if (p.primary === 'sidearm') this.buy(p.id, 'vandal');
          this.buy(p.id, 'armor');
        }
      }
    }
    this.assignBomb();
    this.inputs.clear();
    this.sourceItemInputs.clear();
  }
  restart() {
    this.score = { amber: 0, blue: 0 };
    this.round = 0;
    this.lossStreakStore = { amber: this.startingLosses, blue: this.startingLosses };
    for (const p of this.players) {
      p.kills = 0;
      p.deaths = 0;
      p.money = this.rules?.money.start ?? 16000;
      if(this.sourceLevel)this.resetSourceInventory(p);
      else{p.primary=this.sourceDefaultWeapons[p.team];p.weapon=p.primary;p.slot=0;}
      p.alive = true;
    }
    this.nextRound();
    if (this.mode === 'training') {
      this.phase = 'live';
      this.remaining = 180;
    }
  }
  botInput(p: Player, dt: number): Input {
    const a = this.ai.get(p.id)!;
    a.timer -= dt;
    const visible = this.players
      .filter(
        (t) =>
          t.team !== p.team &&
          t.alive &&
          p.flash < 0.5 &&
          !smokeBlocks(
            this.sourceLevel?this.eyeOrigin(p):{ x: p.x, y: p.y + 1.45, z: p.z },
            this.sourceLevel?this.eyeOrigin(t):{ x: t.x, y: t.y + 1.3, z: t.z },
            this.smokes,
          ) &&
          Math.hypot(t.x - p.x, t.z - p.z) < 38 &&
          this.sight(
            this.sourceLevel?this.eyeOrigin(p):{ x: p.x, y: p.y + 1.45, z: p.z },
            this.sourceLevel?this.eyeOrigin(t):{ x: t.x, y: t.y + 1.3, z: t.z },
          ),
      )
      .sort(
        (v, w) =>
          Math.hypot(v.x - p.x, v.z - p.z) - Math.hypot(w.x - p.x, w.z - p.z),
      );
    const target = visible[0];
    const input = {
      ...EMPTY_INPUT,
      seq: this.tick,
      yaw: p.yaw,
      pitch: p.pitch,
      time: this.time,
      slot: p.primary === null||p.primary === 'sidearm' ? 1 : 0,
    } as Input;
    if (target) {
      if (a.target !== target.id) {
        a.target = target.id;
        a.reaction = 0.45 + this.random() * 0.6;
      }
      a.reaction -= dt;
      const dx = target.x - p.x,
        dz = target.z - p.z;
      const desired = Math.atan2(-dx, -dz),
        delta = Math.atan2(
          Math.sin(desired - p.yaw),
          Math.cos(desired - p.yaw),
        );
      input.yaw = p.yaw + Math.max(-dt * 3, Math.min(dt * 3, delta));
      input.pitch = Math.atan2(
        this.sourceLevel?this.eyeOrigin(target).y-this.eyeOrigin(p).y:target.y+1.08-(p.y+eyeHeight(p)),
        Math.hypot(dx, dz),
      );
      const recoil = recoilOffset(p);
      input.pitch -= recoil.pitch * 0.65;
      input.yaw -= recoil.yaw * 0.65;
      input.fire = a.reaction <= 0 && Math.abs(delta) < 0.12 && p.shotHeat < 4;
      // Short controlled bursts; recover accuracy between bursts and stop to shoot.
      if (input.fire && Math.hypot(p.vx, p.vz) > 1.2) input.fire = false;
      // Source secondary attack is not a generic aim button: on USP it removes
      // the silencer, and on Glock it changes firing mode. Only the AWP scopes.
      input.aim = !this.sourceLevel||p.weapon==='awp';
      if(this.sourceLevel&&isSourcePistol(p.weapon))
        input.fire=input.fire&&!a.sourceAttackHeld&&p.cooldown===0&&p.reload===0;
      if (a.reaction > 0 || p.shotHeat >= 4)
        input.mx = Math.sin(this.time * 0.7 + this.players.indexOf(p)) * 0.3;
    } else {
      a.target = null;
      const index = this.players.indexOf(p),
        site = (this.sourceLevel?.sites??SITES)[(Math.floor(index / 2) + Math.floor(this.round / 2)) % 2];
      let tx = site.x, ty=(site as {y?:number}).y??p.y, tz = site.z;
      if (this.mode === 'training') {
        const opponent = this.players.filter(
          (v) => v.team !== p.team && v.alive,
        )[
          Math.floor(this.time / 12 + index) %
            Math.max(
              1,
              this.players.filter((v) => v.team !== p.team && v.alive).length,
            )
        ];
        if (opponent) {
          tx = opponent.x;ty=opponent.y;
          tz = opponent.z;
        }
      }
      if (this.bomb.planted) {
        ty=this.bomb.y;
        tx = this.bomb.x + (p.team === 'amber' ? (index % 2 ? 4 : -4) : 0);
        tz = this.bomb.z + (p.team === 'amber' ? 4 : 0);
      }
      if (a.timer <= 0 || !a.path.length) {
        if(this.sourceLevel){
          // Ground route following has no jump-link/ladder state machine yet.
          // Query the real graph with those areas excluded, never a fake grid.
          const route=this.sourceLevel.navigation?this.sourceLevel.pathfind(p,{x:tx,y:ty,z:tz},{allowLadders:false,blockedFlags:2,maxSnapDistance:3}):null;
          a.path=route?.status==='path'?route.waypoints.map(point=>({...point})):[];
        }else a.path = pathfind(p.x, p.z, tx, tz);
        a.timer = 1.5 + this.random();
      }
      if(this.sourceLevel){
        const last=a.sourceLast;a.sourceBlockedFor=last&&a.path.length&&Math.hypot(last.x-p.x,last.y-p.y,last.z-p.z)<.0001?(a.sourceBlockedFor??0)+dt:0;
        a.sourceLast={x:p.x,y:p.y,z:p.z};if(a.sourceBlockedFor>1){a.timer=0;a.sourceBlockedFor=0;}
      }
      while (
        a.path.length &&
        Math.hypot(a.path[0].x - p.x, a.path[0].z - p.z) < 0.23&&
        (!this.sourceLevel||((this.sourceWaypointY(a.path[0],p))!==null&&Math.abs(a.path[0].supportY!-p.y)<2*this.sourceLevel.metersPerSourceUnit+.002))
      )
        a.path.shift();
      let next = a.path[0];
      if(this.sourceLevel&&next&&Math.hypot(next.x-p.x,next.z-p.z)<this.sourceLevel.player.standing.halfExtents[0]&&Math.abs((this.sourceWaypointY(next,p)??next.y!)-p.y)>.05){
        // Keep the vertical portal pending while steering beyond it. Popping by
        // XZ alone would incorrectly skip a step/drop to another floor.
        next=a.path.find(point=>Math.hypot(point.x-p.x,point.z-p.z)>=this.sourceLevel!.player.standing.halfExtents[0])??next;
      }
      if (next) {
        if(this.sourceLevel){input.crouch=Boolean((next.flags??0)&1);input.jump=Boolean((next.flags??0)&2)&&p.grounded&&!p.sourceJumpHeld;}
        const dx = next.x - p.x,
          dz = next.z - p.z;
        input.yaw = Math.atan2(-dx, -dz);
        input.mz = -0.85;
        input.pitch = 0;
      }
    }
    input.reload = p.reserve > 0 &&
      (p.ammo === 0 || (!target && p.ammo < WEAPONS[p.weapon].mag * 0.45));
    if (
      (p.id === this.bomb.carrier &&
        this.sitesFor(p).length>0) ||
      this.canDefuse(p)
    ) {
      input.use = true;
      input.mx = 0;
      input.mz = 0;
      input.fire = false;
      input.reload = false;
    }
    a.sourceAttackHeld=input.fire;
    return input;
  }
  snapshot(you?: string): Snapshot {
    return {
      ...(this.scenarioIdentity?{mapId:this.scenarioIdentity.mapId,sourceBspSha256:this.scenarioIdentity.sourceBspSha256,simulationVersion:this.scenarioIdentity.simulationVersion}:{}),
      tick: this.tick,
      time: this.time,
      mode: this.mode,
      rules: this.mode === 'training' ? null : this.ruleSet,
      phase: this.phase,
      remaining: this.remaining,
      round: this.round,
      score: { ...this.score },
      players: this.players.map((p) => ({ ...p,...(p.sourceWeaponFinish?{sourceWeaponFinish:{...p.sourceWeaponFinish}}:{}), ...(p.sourcePose?{sourcePose:structuredClone(p.sourcePose)}:{}),...(p.sourceRifleHandling?{sourceRifleHandling:structuredClone(p.sourceRifleHandling)}:{}),
        ...(p.sourceRagdoll?{sourceRagdoll:structuredClone(p.sourceRagdoll)}:{}),
        ...(p.sourceAWP?{sourceAWP:structuredClone(p.sourceAWP)}:{}),...(p.sourceAWPPose?{sourceAWPPose:structuredClone(p.sourceAWPPose)}:{}),
        ...(p.sourcePistolPose?{sourcePistolPose:structuredClone(p.sourcePistolPose)}:{}),...(p.sourceGlock?{sourceGlock:structuredClone(p.sourceGlock)}:{}),...(p.sourceUSP?{sourceUSP:structuredClone(p.sourceUSP)}:{}),...(p.sourceDeagle?{sourceDeagle:structuredClone(p.sourceDeagle)}:{}),...(p.sourceViewmodelTime?{sourceViewmodelTime:{...p.sourceViewmodelTime}}:{}) })),
      events: this.events.map((e) => ({ ...e,...(e.sourceRifleShot?{sourceRifleShot:structuredClone(e.sourceRifleShot)}:{}),...(e.sourcePistolShot?{sourcePistolShot:structuredClone(e.sourcePistolShot)}:{}),...(e.sourceAWPShot?{sourceAWPShot:structuredClone(e.sourceAWPShot)}:{}),...(e.sourceWeaponSound?{sourceWeaponSound:{...e.sourceWeaponSound}}:{}) })),
      grenades: this.grenades.map((g) => ({
        id: g.id,
        kind: g.kind,
        ...g.body.translation(),
        rotation: {...g.body.rotation()},
      })),
      droppedWeapons:this.droppedWeapons.read(),
      smokes: this.smokes.map((s) => ({ ...s })),
      bomb: { ...this.bomb },
      winner: this.winner,
      reason: this.reason,
      you,
      canBuy: this.canBuy(this.players.find(p => p.id === you)),
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.droppedWeapons.dispose();
    for(const p of this.players)this.sourcePlayerContract?.poseDriverFor(p)?.ragdoll?.endRagdoll(p);
    this.pistolCommandSeeds.clear();this.sourceFinishLoadouts.clear();this.sourceMovement?.dispose();this.sourceLevel?.dispose();this.world.removeCharacterController(this.controller);
    this.world.free();
  }
}
