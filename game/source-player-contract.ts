import type { Player,Team,WeaponId } from './types.js';
import type { SourceLevelData } from './source-level.js';
import {advanceSourceSequenceCycle,sourceSequenceCycleRate,type SourceCharacterGrenadeLayer,type SourceCharacterGrenadePrepLayer,type SourceCharacterJumpLayer,type SourceCharacterPoseInput,type SourceCharacterPoseIndex,type SourceCharacterReloadLayer,type SourceGrenadeThrowStyle} from './source-character-pose.js';
import type {SourceRagdollDriver,SourceRagdollIndex} from './source-ragdoll.js';
import type {SourcePistolCharacterPoseInput} from './source-pistol-character-pose.js';
import type {SourceAWPRuntimePose} from './source-awp-runtime-pose.js';
export const SOURCE_PLAYER_CONTRACT_ID='csgo-player-12426148' as const;
/** The shared third-person body graph identity. Bumped whenever the layer
 * composition changes (r2 adds the merged original world-model reload layer),
 * so a LAN peer running an older graph is rejected instead of disagreeing about
 * the pose. */
export const SOURCE_BODY_POSE_DRIVER_VERSION='csgo-body-pose-driver-12426148-r2';
/** Death1 has no pose parameter axes; the corpse keeps neutral parameters. */
const EMPTY_DEATH_PARAMETERS={move_x:0,move_y:0,body_yaw:0,body_pitch:0} as const;
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
export type SourcePoint={x:number;y:number;z:number};
export type SourceActorPose=Pick<Player,'x'|'y'|'z'|'yaw'|'pitch'|'crouch'> &
  Partial<Pick<Player,'team'|'weapon'|'grounded'|'sourceContract'|'sourcePose'|'sourcePoseVersion'|'sourceRagdoll'|'sourcePistolPose'|'sourceGlock'|'sourceUSP'|'sourceDeagle'|'sourceAWP'|'sourceAWPPose'>>;
export type SourceActorHit={distance:number;head:boolean;bone?:number;hitbox?:number;group?:number};
/** An exact provider must interpret this build's hitbox extension and use the
 * sampled source bone matrix. Unknown raw extension bytes are not capsules. */
export type SourceHitboxProvider={
  id:string;status:'verified-bone-hitboxes';
  raycast(pose:SourceActorPose,origin:SourcePoint,direction:SourcePoint,maxDistance:number):SourceActorHit|null;
};
export type SourcePoseDriver={
  id:string;
  advance(player:Player,previous:SourceActorPose,dt:number):SourceCharacterPoseInput;
  /** Arm the merged original pin-pull preparation overlay at the throw-key
   * press instant; advance() then keeps it looping/locked while
   * player.sourceGrenadeHold stays true and fades it out after the release. */
  beginGrenadePrep?(player:Player):void;
  /** Arm the merged original release overlay at the server-confirmed throw
   * instant; advance() then runs and fades the layer on its own. The style
   * selects the original overhand/medium/underhand variant set. */
  beginGrenadeThrow?(player:Player,style?:SourceGrenadeThrowStyle):void;
  /** Original VPhysics corpse simulation keyed per player id; the authority
   * begins/steps it, rendering falls back to the Death1 clamp when absent. */
  ragdoll?:SourceRagdollDriver;
  /** The bound ragdoll index of this driver's pose dataset, for clients that
   * rebuild the death-instant rest locally before snapshots arrive. */
  ragdollIndex?:SourceRagdollIndex;
  pistolPose?(player:Player,now:number):SourcePistolCharacterPoseInput;
  awpPose?(player:Player,now:number):SourceAWPRuntimePose;
};
/** Exact actor basis shared by original Source bone poses and rendering:
 * Source +X forward -> browser (-sin(yaw),0,-cos(yaw)). */
export function sourceActorMatrix(p:Pick<SourceActorPose,'x'|'y'|'z'|'yaw'>){
  const angle=p.yaw+Math.PI/2,c=Math.cos(angle),s=Math.sin(angle);
  return new Float64Array([c,0,-s,0,0,1,0,0,s,0,c,0,p.x,p.y,p.z,1]);
}
/** Original sequence clocks/poses, with an explicit small ground state selector.
 * This selector is not the original CCSGOPlayerAnimState graph. Airborne lower
 * playback keeps the frozen ground sequence while the merged original looping
 * jump_lower 9-way layer fades in/out over the sequence's own fade times. Dead
 * actors switch to the merged original non-looping Death1 full-body fall; the
 * non-looping clamp freezes the corpse at the final frame, and revival simply
 * re-enters the ground selector. No ladder clips are fabricated. */
export function createSourcePoseDriver(index:SourceCharacterPoseIndex,id:string,maximumSpeedUnits?:number):SourcePoseDriver{
  if(!id)throw Error('A Source pose data/version identity is required');
  if(maximumSpeedUnits!==undefined&&(!Number.isFinite(maximumSpeedUnits)||maximumSpeedUnits<=0))throw Error('Invalid Source pose speed selector');
  const jumpSequences=index.data.states.Jump;
  if(!jumpSequences)throw Error('Source pose data lacks the merged original Jump state');
  const deathSequences=index.data.states.Death;
  if(!deathSequences)throw Error('Source pose data lacks the merged original Death state');
  const jumpSequence=index.sequences.get(jumpSequences.lower);
  if(!jumpSequence||index.namedSequences.get('jump_lower')!==jumpSequence)throw Error('Source pose data lacks the original jump_lower sequence');
  if(index.sequences.get(deathSequences.lower)!==index.namedSequences.get('Death1'))throw Error('Source pose data lacks the original Death1 sequence');
  const jumpFadeIn=Math.max(jumpSequence.fadeIn??0.2,1/128),jumpFadeOut=Math.max(jumpSequence.fadeOut??0.2,1/128);
  // The merged original grenade release layers: three original strengths, one
  // variant per ground locomotion state each. GREN1 is the 14-frame @30fps
  // overhand release, GREN2 the 19-frame medium and GREN3 the 19-frame
  // underhand one; all three sets share the parameterless non-looping delta
  // layer contract, so a single clock drives whichever variant the live state
  // selects.
  type GrenadeVariantSet={style:SourceGrenadeThrowStyle;
    variants:Partial<Record<'Idle'|'Walk'|'Run'|'Crouch_Idle'|'Crouch_Walk',number>>;fadeIn:number;fadeOut:number};
  const throwSets:GrenadeVariantSet[]=([['overhand','Shoot_GREN1'],['medium','Shoot_GREN2'],['underhand','Shoot_GREN3']] as const)
    .map(([style,suffix])=>{
      const variants:GrenadeVariantSet['variants']={
        Idle:index.namedSequences.get(`Idle_${suffix}`)?.index,Walk:index.namedSequences.get(`Walk_${suffix}`)?.index,
        Run:index.namedSequences.get(`Run_${suffix}`)?.index,Crouch_Idle:index.namedSequences.get(`Crouch_Idle_${suffix}`)?.index,
        Crouch_Walk:index.namedSequences.get(`Crouch_Walk_${suffix}`)?.index};
      const present=Object.values(variants).filter(v=>v!==undefined).length;
      if(present!==0&&present!==5)throw Error(`Source pose data has an incomplete ${suffix} variant set`);
      const sequence=variants.Idle!==undefined?index.sequences.get(variants.Idle):undefined;
      return {style,variants,fadeIn:Math.max(sequence?.fadeIn??0.2,1/128),fadeOut:Math.max(sequence?.fadeOut??0.2,1/128)};
    });
  const completeThrowSets=throwSets.filter(set=>set.variants.Idle!==undefined);
  const overhandSet=completeThrowSets.find(set=>set.style==='overhand')??completeThrowSets[0];
  // A requested strength whose variant set this data lacks falls back to the
  // overhand release, and the layer records the strength that actually plays.
  const throwSetFor=(style?:SourceGrenadeThrowStyle):GrenadeVariantSet|undefined=>
    (style!==undefined?completeThrowSets.find(set=>set.style===style):undefined)??overhandSet;
  // The merged original pin-pull preparation graph: per ground state one
  // non-looping Upper_GREN wrapper masked to the two weapon hand bones, whose
  // original auto-layers blend the 9-way Aim_GREN body_yaw/body_pitch aim pose
  // and the HandPos_GREN hold. The original per-state lengths differ (T idle
  // 61, walk 33, run 21, crouch-idle 61, crouch-walk 25 frames @30fps), so the
  // shared clock runs at the live variant's own rate: the pin pull completes
  // faster while moving, exactly like the original per-state clips.
  const prepVariants:GrenadeVariantSet['variants']={
    Idle:index.namedSequences.get('Idle_Upper_GREN')?.index,Walk:index.namedSequences.get('Walk_Upper_GREN')?.index,
    Run:index.namedSequences.get('Run_Upper_GREN')?.index,Crouch_Idle:index.namedSequences.get('Crouch_Idle_Upper_GREN')?.index,
    Crouch_Walk:index.namedSequences.get('Crouch_Walk_Upper_GREN')?.index};
  const prepPresent=Object.values(prepVariants).filter(v=>v!==undefined).length;
  if(prepPresent!==0&&prepPresent!==5)throw Error('Source pose data has an incomplete Upper_GREN variant set');
  const prepSequence=prepVariants.Idle!==undefined?index.sequences.get(prepVariants.Idle):undefined;
  const prepFadeIn=Math.max(prepSequence?.fadeIn??0.2,1/128),prepFadeOut=Math.max(prepSequence?.fadeOut??0.2,1/128);
  const grenadeVariantFor=(set:GrenadeVariantSet,state:SourceCharacterPoseInput['state']):number|undefined=>
    state==='Jump'||state==='Death'?undefined:set.variants[state];
  return {id,advance(player,previous,dt){
    if(!Number.isFinite(dt)||dt<0)throw Error('Invalid Source pose dt');
    const old=previous.sourcePoseVersion===id?previous.sourcePose:undefined;
    // Only an explicit server-authoritative alive=false switches to the corpse
    // playback; driver consumers that never track aliveness stay on the ground
    // selector (undefined is not a death verdict).
    if(player.alive===false){
      // Authoritative corpse: play the original Death1 once from the death
      // instant, then hold the clamped final frame until revival/round reset.
      const held=old?.state==='Death'?old:undefined;
      const advanced=advanceSourceSequenceCycle(index,deathSequences.lower,held?.cycle??0,dt,EMPTY_DEATH_PARAMETERS);
      const cycle=(index.sequences.get(deathSequences.lower)!.flags&1)?advanced.unwrapped:advanced.cycle;
      return {state:'Death' as const,parameters:{...EMPTY_DEATH_PARAMETERS},cycle,upperCycle:cycle,
        fireCycle:0,fireWeight:0,blendMode:'sdk-3way' as const};
    }
    const dx=player.x-previous.x,dz=player.z-previous.z,distance=Math.hypot(dx,dz),speed=dt>0?distance/dt:0;
    const moving=player.grounded&&speed>.00254,airborneMoving=!player.grounded&&speed>.00254;
    const directional=moving||airborneMoving;
    const state:SourceCharacterPoseInput['state']=!player.grounded?(old?.state??'Idle'):
      player.crouch?(moving?'Crouch_Walk':'Crouch_Idle'):moving?(player.sourceWalking||speed<(maximumSpeedUnits??((player.weapon==='glock'||player.weapon==='usp')?240:player.weapon==='deagle'?230:player.weapon==='m4a4'?225:215))*.0254*.52?'Walk':'Run'):'Idle';
    const same=old?.state===state,cos=Math.cos(player.yaw),sin=Math.sin(player.yaw);
    const parameters={move_x:directional?(-sin*dx-cos*dz)/distance:0,move_y:directional?-(cos*dx-sin*dz)/distance:0,
      body_yaw:0,body_pitch:Math.max(-70,Math.min(70,-player.pitch*180/Math.PI))};
    const sequences=index.data.states[state];check(sequences,'Unknown original character state');
    const clock=(sequence:number,cycle:number,delta:number)=>{
      const value=advanceSourceSequenceCycle(index,sequence,cycle,delta,parameters);
      return index.sequences.get(sequence)!.flags&1?value.unwrapped:value.cycle;
    };
    // Airborne 9-way keeps the original jump_lower loop running through the
    // fade; on landing the pose freezes and fades back into the ground state.
    const wasAirborne=previous.grounded===undefined?(old?.jump?.airborne??false):!previous.grounded;
    let jump:SourceCharacterJumpLayer|undefined;
    if(!player.grounded){
      const held=wasAirborne&&old?.jump?old.jump:undefined;
      const weight=Math.min(1,(held?.weight??0)+dt/jumpFadeIn),elapsed=(held?.elapsed??0)+dt;
      if(weight>0||elapsed>0)jump={cycle:clock(jumpSequences.lower,held?.cycle??0,dt),weight,elapsed,airborne:true};
    }else if(old?.jump){
      const weight=Math.max(0,old.jump.weight-dt/jumpFadeOut);
      if(weight>0)jump={cycle:old.jump.cycle,weight,elapsed:(old.jump.airborne?0:old.jump.elapsed)+dt,airborne:false};
    }
    // The merged original pin-pull preparation runs while the throw key stays
    // held (player.sourceGrenadeHold): the non-looping Upper_GREN wrapper
    // plays once at the live variant's own rate and the clamp locks the
    // pulled-pin final frame for as long as the key stays down; the release
    // then fades the armed pose out at the original fade time while the
    // release layer takes over. Airborne ticks keep the pin pull running at
    // the remembered ground variant (upper-body overlays survive the jump,
    // exactly what the original jumpthrow relies on); only the authoritative
    // corpse drops it.
    let prep:SourceCharacterGrenadePrepLayer|undefined;
    const heldPrep=old?.prep;
    if(heldPrep){
      const variant=state==='Jump'||state==='Death'?undefined:prepVariants[state];
      if(variant===undefined)prep=heldPrep;
      else if(player.sourceGrenadeHold){
        const advanced=advanceSourceSequenceCycle(index,variant,heldPrep.cycle,dt,parameters);
        prep={cycle:advanced.cycle,weight:Math.min(1,heldPrep.weight+dt/prepFadeIn),variant};
      }else{
        const weight=heldPrep.weight-dt/prepFadeOut;
        if(weight>0)prep={cycle:heldPrep.cycle,weight,variant};
      }
    }
    // The merged original throw runs once at the sequence's own fade times:
    // fadeIn during the arm swing, then fadeOut from the clamped final frame.
    // The variant tracks the live ground state every tick, matching the
    // original's per-frame activity selection while the shared clock keeps the
    // run continuous across variant changes; the release strength never
    // changes inside one continuous throw.
    let grenade:SourceCharacterGrenadeLayer|undefined;
    const heldGrenade=old?.grenade;
    if(heldGrenade){
      const set=completeThrowSets.find(s=>s.style===heldGrenade.style);
      const variant=set===undefined?undefined:grenadeVariantFor(set,state);
      if(variant!==undefined&&set!==undefined){
        const advanced=advanceSourceSequenceCycle(index,variant,heldGrenade.cycle,dt,parameters);
        if(advanced.cycle<1)grenade={cycle:advanced.cycle,weight:Math.min(1,heldGrenade.weight+dt/set.fadeIn),variant,style:set.style};
        else{
          const weight=heldGrenade.weight-dt/set.fadeOut;
          if(weight>0)grenade={cycle:1,weight,variant,style:set.style};
        }
      }
    }
    // The merged original world-model reload: the Reload_<weapon> wrapper plays
    // once over the armed aim layer while the magazine is out. Its clock is the
    // server-authoritative reload timer, so the pose lands back on the aim
    // exactly when the magazine commits and both ends derive the same frame
    // without shipping extra pose state; a reload that is interrupted (weapon
    // switch, drop, a shot) fades out at the original fade time instead of
    // snapping back to the aim. The wrapper masks no bones by itself, so its
    // original interior envelope is what blends the action in and out.
    let reload:SourceCharacterReloadLayer|undefined;
    const reloadGraph=index.reload;
    if(reloadGraph){
      if(player.reload>0){
        reload={cycle:Math.min(1,Math.max(0,(reloadGraph.seconds-player.reload)/reloadGraph.seconds)),weight:1};
      }else if(old?.reload&&old.reload.cycle<reloadGraph.exitCycle){
        // Interrupted inside the action (a weapon switch, drop or shot aborted
        // the reload): fade the armed pose out at the original fade time. Past
        // the original envelope tail the action has already returned to the aim
        // by itself, so a completed reload simply drops the layer.
        const weight=old.reload.weight-dt/reloadGraph.fadeOut;
        if(weight>0)reload={cycle:old.reload.cycle,weight};
      }
    }
    const fireCycleRate=sourceSequenceCycleRate(index,sequences.shoot,parameters);
    const fireTimeSeconds=Math.max(0,player.shotIdle),fireCycle=Math.min(1,fireTimeSeconds*fireCycleRate);
    const result:SourceCharacterPoseInput={state,parameters,cycle:clock(sequences.lower,same?old!.cycle:0,player.grounded?dt:0),
      upperCycle:clock(sequences.upper,same?(old!.upperCycle??old!.cycle):0,dt),fireCycle,fireTimeSeconds,fireCycleRate,
      fireWeight:fireCycle<1?1:0,blendMode:'sdk-3way'};
    if(jump)result.jump=jump;
    if(prep)result.prep=prep;
    if(grenade)result.grenade=grenade;
    if(reload)result.reload=reload;
    return result;
  },beginGrenadePrep(player){
    const pose=player.sourcePose;
    if(player.alive===false||player.sourcePoseVersion!==id||!pose||pose.state==='Death')return;
    const variant=pose.state==='Jump'?undefined:prepVariants[pose.state];
    if(variant===undefined)return;
    // Re-arming mid-pull restarts the pin-pull clock, mirroring the original
    // activity restart when the next grenade is readied.
    player.sourcePose={...pose,prep:{cycle:0,weight:0,variant}};
  },beginGrenadeThrow(player,style){
    const pose=player.sourcePose;
    if(player.alive===false||player.sourcePoseVersion!==id||!pose||pose.state==='Death')return;
    const set=throwSetFor(style);
    if(set===undefined)return;
    const variant=grenadeVariantFor(set,pose.state);
    if(variant===undefined)return;
    // Re-arming mid-run restarts the throw clock, mirroring the original
    // activity restart when the next grenade leaves the hand.
    player.sourcePose={...pose,grenade:{cycle:0,weight:0,variant,style:set.style}};
  }};
}
export function createSourcePlayerContract(profile:SourceLevelData['player'],options:{hitboxes?:SourceHitboxProvider;poseDriver?:SourcePoseDriver;
  poseDrivers?:Partial<Record<Team,SourcePoseDriver>>;hitboxesByTeam?:Partial<Record<Team,SourceHitboxProvider>>;
  poseDriversByWeapon?:Partial<Record<Team,Partial<Record<WeaponId,SourcePoseDriver>>>>;
  hitboxesByWeapon?:Partial<Record<Team,Partial<Record<WeaponId,SourceHitboxProvider>>>>}={}){
  const providers=options.hitboxesByTeam;
  const weaponProviders=options.hitboxesByWeapon;
  const hitboxStatus=options.hitboxes?.status??(weaponProviders?.amber&&weaponProviders?.blue?'verified-bone-hitboxes':
    providers?.amber&&providers?.blue?'verified-bone-hitboxes':providers||weaponProviders?'partial':'unavailable');
  return {id:SOURCE_PLAYER_CONTRACT_ID,hitboxStatus,hitboxProviderId:options.hitboxes?.id??null,
    poseDriver:options.poseDriver,
    poseDriverFor(p:Pick<SourceActorPose,'team'|'weapon'>){
      const variants=p.team?options.poseDriversByWeapon?.[p.team]:undefined;
      return variants?variants[p.weapon??'vandal']:(p.team?options.poseDrivers?.[p.team]:undefined)??options.poseDriver;
    },
    eyeOrigin(p:SourceActorPose):SourcePoint{return {x:p.x,y:p.y+profile[p.crouch?'crouching':'standing'].eyeHeight,z:p.z};},
    raycast(p:SourceActorPose,origin:SourcePoint,direction:SourcePoint,maxDistance:number){
      const variants=p.team?weaponProviders?.[p.team]:undefined;
      const provider=variants?variants[p.weapon??'vandal']:(p.team?providers?.[p.team]:undefined)??options.hitboxes;
      const hit=provider?.raycast(p,origin,direction,maxDistance)??null;
      return hit&&Number.isFinite(hit.distance)&&hit.distance>=0&&hit.distance<maxDistance?hit:null;
    }};
}
