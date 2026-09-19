import {SOURCE_DEAGLE_RUNTIME_VERSION} from './source-deagle-runtime.js';
import {SOURCE_DEAGLE_HANDLING_VERSION} from './source-deagle-handling.js';
import {SOURCE_DEAGLE_ANIMATION_CLOCK_VERSION} from './source-deagle-animation-clock.js';
import {SOURCE_DEAGLE_CHARACTERS} from './source-deagle-character-contracts.js';
import {createSourceDeaglePoseDriver,SOURCE_DEAGLE_POSE_DRIVER_VERSION} from './source-deagle-runtime-pose.js';
import {createSourceDeagleHitboxes} from './source-deagle-hitboxes.js';
import type {SourceDeagleCharacterPoseIndex} from './source-deagle-character-pose.js';
import {createSourcePoseDriver,SOURCE_BODY_POSE_DRIVER_VERSION} from './source-player-contract.js';
import {createSourceHitboxes} from './source-hitboxes.js';
import type {SourceCharacterPoseIndex} from './source-character-pose.js';
import type {SourceScenario} from './source-scenario.js';
import type {Team} from './types.js';
import {SOURCE_DAMAGE_VERSION,SOURCE_PISTOL_DAMAGE_VERSION} from './source-damage.js';
import {createSourceGlockPoseDriver,createSourceUSPPoseDriver,SOURCE_PISTOL_POSE_DRIVER_VERSION,SOURCE_USP_POSE_DRIVER_VERSION} from './source-pistol-runtime-pose.js';
import {createSourcePistolHitboxes} from './source-pistol-hitboxes.js';
import type {SourcePistolCharacterPoseIndex} from './source-pistol-character-pose.js';
import {SOURCE_PISTOL_CHARACTERS} from './source-pistol-character-contracts.js';
import {SOURCE_USP_RUNTIME_VERSION} from './source-usp-runtime.js';
import {SOURCE_USP_ANIMATION_CLOCK_VERSION} from './source-usp-animation-clock.js';
import {SOURCE_GLOCK_RUNTIME_VERSION} from './source-glock-runtime.js';
import {SOURCE_PISTOL_HANDLING_VERSION} from './source-pistol-handling.js';
import {SOURCE_GLOCK_ANIMATION_CLOCK_VERSION} from './source-glock-animation-clock.js';
import {SOURCE_RIFLE_HANDLING_VERSION} from './source-rifle-handling.js';
import {SOURCE_LANDING_VERSION} from './source-landing.js';
import {SOURCE_WALKING_VERSION} from './source-walking.js';
import {SOURCE_PLAYER_MOVEMENT_VERSION} from './source-player-movement.js';
import {SOURCE_AWP_RUNTIME_VERSION} from './source-awp-runtime.js';
import {SOURCE_AWP_HANDLING_VERSION} from './source-awp-handling.js';
import {SOURCE_AWP_DAMAGE_VERSION} from './source-awp-damage.js';
import {SOURCE_AWP_ANIMATION_CLOCK_VERSION} from './source-awp-animation-clock.js';
import {SOURCE_AWP_CHARACTERS} from './source-awp-character-contracts.js';
import {createSourceAWPPoseDriver,SOURCE_AWP_POSE_DRIVER_VERSION} from './source-awp-runtime-pose.js';
import {createSourceAWPCharacterHitboxes} from './source-awp-character-hitboxes.js';
import type {SourceAWPCharacterPoseIndex} from './source-awp-character-pose.js';
import {createSourceRagdollPoseDriver,SOURCE_RAGDOLL_POSE_DRIVER_VERSION,type SourceRagdollData,type SourceRagdollRest,type SourceRagdollLive} from './source-ragdoll.js';
import {SOURCE_DROPPED_WEAPON_VERSION} from './source-dropped-weapons.js';
import {SOURCE_ECONOMY_VERSION} from './source-economy.js';
export type SourceAWPPoseAsset={poseIndex:SourceAWPCharacterPoseIndex;poseVersion:string};
export type SourceRiflePoseAsset={poseIndex:SourceCharacterPoseIndex;poseVersion:string};
export type SourceDeaglePoseAsset={poseIndex:SourceDeagleCharacterPoseIndex;poseVersion:string};
export type SourceGlockPoseAsset={poseIndex:SourcePistolCharacterPoseIndex;poseVersion:string};
export function sourceRifleSimulationVersion(mapVersion:string,assets:Record<Team,Record<'vandal'|'m4a4',{poseVersion:string}>>){
  const versions:string[]=[];
  for(const team of ['amber','blue']as const)for(const weapon of ['vandal','m4a4']as const){
    const version=assets[team][weapon].poseVersion,prefix=`csgo-${team==='amber'?'t':'ct'}-${weapon==='vandal'?'ak':'m4'}-12426148:`;
    if(!version.startsWith(prefix))throw Error('Wrong original rifle/team pose profile');versions.push(version);
  }
  return mapVersion+':rifles-v1:'+versions.join(':')+':'+SOURCE_DAMAGE_VERSION+':'+SOURCE_RIFLE_HANDLING_VERSION+':'+SOURCE_LANDING_VERSION+':'+SOURCE_WALKING_VERSION+':'+SOURCE_PLAYER_MOVEMENT_VERSION+':'+SOURCE_BODY_POSE_DRIVER_VERSION;
}
export function sourceGlockSimulationVersion(rifleVersion:string,glocks:Record<Team,{poseVersion:string}>){
  for(const team of ['amber','blue']as const){
    const sourceTeam=team==='amber'?'t':'ct';
    if(glocks[team].poseVersion!==SOURCE_PISTOL_CHARACTERS[`${sourceTeam}-glock`].poseVersion)throw Error('Wrong original Glock/team pose profile');
  }
  return rifleVersion+':glock-v1:'+glocks.amber.poseVersion+':'+glocks.blue.poseVersion+':'+SOURCE_GLOCK_RUNTIME_VERSION+':'+SOURCE_PISTOL_HANDLING_VERSION+':'+SOURCE_PISTOL_DAMAGE_VERSION+':'+SOURCE_PISTOL_POSE_DRIVER_VERSION+':'+SOURCE_GLOCK_ANIMATION_CLOCK_VERSION;
}
export function sourceUSPSimulationVersion(previous:string,usps:Record<Team,{poseVersion:string}>){
  for(const team of ['amber','blue']as const)if(usps[team].poseVersion!==SOURCE_PISTOL_CHARACTERS[`${team==='amber'?'t':'ct'}-usp`].poseVersion)throw Error('Wrong original USP/team pose profile');
  return previous+':usp-v1:'+usps.amber.poseVersion+':'+usps.blue.poseVersion+':'+SOURCE_USP_RUNTIME_VERSION+':'+SOURCE_USP_ANIMATION_CLOCK_VERSION+':'+SOURCE_USP_POSE_DRIVER_VERSION+':'+SOURCE_PISTOL_HANDLING_VERSION+':'+SOURCE_PISTOL_DAMAGE_VERSION;
}
/** Shared client/authority wiring. Every held rifle selects its own original
 * team animation graph, so hitboxes and rendering sample the same bone pose. */
export function createSourceRifleProfiles(assets:Record<Team,Record<'vandal'|'m4a4',SourceRiflePoseAsset>>,mapVersion:string,glocks?:Record<Team,SourceGlockPoseAsset>,usps?:Record<Team,SourceGlockPoseAsset>,deagles?:Record<Team,SourceDeaglePoseAsset>,awps?:Record<Team,SourceAWPPoseAsset>,ragdoll?:SourceRagdollData){
  const result:Pick<SourceScenario,'simulationVersion'|'weapons'|'defaultWeaponByTeam'|'defaultSecondaryWeaponByTeam'|'poseDriversByWeapon'|'hitboxesByWeapon'>={
    simulationVersion:sourceRifleSimulationVersion(mapVersion,assets)+(ragdoll?':'+SOURCE_RAGDOLL_POSE_DRIVER_VERSION+':'+SOURCE_DROPPED_WEAPON_VERSION:''),weapons:['vandal','m4a4'],defaultWeaponByTeam:{amber:'vandal',blue:'m4a4'},poseDriversByWeapon:{},hitboxesByWeapon:{}};
  // One corpse table per scenario: a player who dies holding a rifle gets its
  // ragdoll spawned by that rifle's driver, and round reset clears it through
  // whichever driver reaches the reset first.
  const ragdollStates=ragdoll?new Map<string,{rest:SourceRagdollRest;live:SourceRagdollLive}>():undefined;
  for(const team of ['amber','blue']as const){
    result.poseDriversByWeapon![team]={};result.hitboxesByWeapon![team]={};
    for(const weapon of ['vandal','m4a4']as const){
      const source=assets[team][weapon],prefix=`csgo-${team==='amber'?'t':'ct'}-${weapon==='vandal'?'ak':'m4'}-12426148:`;
      if(!source.poseVersion.startsWith(prefix))throw Error('Wrong original rifle/team pose profile');
      const driver=createSourcePoseDriver(source.poseIndex,source.poseVersion);
      result.poseDriversByWeapon![team]![weapon]=ragdoll&&ragdollStates?
        createSourceRagdollPoseDriver(driver,source.poseIndex,ragdoll,ragdollStates):driver;
      result.hitboxesByWeapon![team]![weapon]=createSourceHitboxes(source.poseIndex,source.poseVersion);
    }
    // Until a knife body animation set is staged, its visible body uses this
    // team's AK body (Assets.operator has the same selection). Bind that same
    // pose and its actual OBBs so drawing a knife cannot remove hit detection.
    // This is an explicit temporary body presentation, not knife animation parity.
    result.poseDriversByWeapon![team]!.knife=result.poseDriversByWeapon![team]!.vandal;
    result.hitboxesByWeapon![team]!.knife=result.hitboxesByWeapon![team]!.vandal;
  }
  if(glocks){
    result.weapons=[...result.weapons!,'glock'];result.defaultSecondaryWeaponByTeam={amber:'glock'};
    for(const team of ['amber','blue']as const){const source=glocks[team],sourceTeam=team==='amber'?'t':'ct';
      if(source.poseVersion!==SOURCE_PISTOL_CHARACTERS[`${sourceTeam}-glock`].poseVersion||source.poseIndex.team!==sourceTeam||source.poseIndex.weapon!=='glock')throw Error('Wrong original Glock/team pose profile');
      result.poseDriversByWeapon![team]!.glock=ragdoll&&ragdollStates?
        createSourceRagdollPoseDriver(createSourceGlockPoseDriver(source.poseIndex,source.poseVersion),source.poseIndex.body,ragdoll,ragdollStates):createSourceGlockPoseDriver(source.poseIndex,source.poseVersion);
      result.hitboxesByWeapon![team]!.glock=createSourcePistolHitboxes(source.poseIndex,source.poseVersion);
    }
    result.simulationVersion=sourceGlockSimulationVersion(result.simulationVersion!,glocks);
  }
  if(usps){
    result.weapons=[...result.weapons!,'usp'];result.defaultSecondaryWeaponByTeam={...result.defaultSecondaryWeaponByTeam,blue:'usp'};
    for(const team of ['amber','blue']as const){const source=usps[team],sourceTeam=team==='amber'?'t':'ct';
      if(source.poseVersion!==SOURCE_PISTOL_CHARACTERS[`${sourceTeam}-usp`].poseVersion||source.poseIndex.team!==sourceTeam||source.poseIndex.weapon!=='usp')throw Error('Wrong original USP/team pose profile');
      result.poseDriversByWeapon![team]!.usp=ragdoll&&ragdollStates?
        createSourceRagdollPoseDriver(createSourceUSPPoseDriver(source.poseIndex,source.poseVersion),source.poseIndex.body,ragdoll,ragdollStates):createSourceUSPPoseDriver(source.poseIndex,source.poseVersion);
      result.hitboxesByWeapon![team]!.usp=createSourcePistolHitboxes(source.poseIndex,source.poseVersion);
    }
    result.simulationVersion=sourceUSPSimulationVersion(result.simulationVersion!,usps);
  }
  if(deagles){
    result.weapons=[...result.weapons!,'deagle'];
    for(const team of ['amber','blue']as const){const source=deagles[team],sourceTeam=team==='amber'?'t':'ct';
      if(source.poseVersion!==SOURCE_DEAGLE_CHARACTERS[`${sourceTeam}-deagle`].poseVersion||source.poseIndex.team!==sourceTeam||source.poseIndex.weapon!=='deagle')throw Error('Wrong original Deagle/team pose profile');
      result.poseDriversByWeapon![team]!.deagle=ragdoll&&ragdollStates?
        createSourceRagdollPoseDriver(createSourceDeaglePoseDriver(source.poseIndex,source.poseVersion),source.poseIndex.body,ragdoll,ragdollStates):createSourceDeaglePoseDriver(source.poseIndex,source.poseVersion);
      result.hitboxesByWeapon![team]!.deagle=createSourceDeagleHitboxes(source.poseIndex,source.poseVersion);
    }
    result.simulationVersion=sourceDeagleSimulationVersion(result.simulationVersion!,deagles);
  }
  if(awps){
    result.weapons=[...result.weapons!,'awp'];
    for(const team of ['amber','blue']as const){const source=awps[team],sourceTeam=team==='amber'?'t':'ct';
      if(source.poseVersion!==SOURCE_AWP_CHARACTERS[`${sourceTeam}-awp`].poseVersion||source.poseIndex.team!==sourceTeam||source.poseIndex.weapon!=='awp')throw Error('Wrong original AWP/team pose profile');
      result.poseDriversByWeapon![team]!.awp=ragdoll&&ragdollStates?
        createSourceRagdollPoseDriver(createSourceAWPPoseDriver(source.poseIndex,source.poseVersion),source.poseIndex.body,ragdoll,ragdollStates):createSourceAWPPoseDriver(source.poseIndex,source.poseVersion);
      result.hitboxesByWeapon![team]!.awp=createSourceAWPCharacterHitboxes(source.poseIndex,source.poseVersion);
    }
    result.simulationVersion=sourceAWPSimulationVersion(result.simulationVersion!,awps);
  }
  // Inventory now permits an empty primary slot and carries paid utility/kit
  // state. Old clients must not predict or render these snapshots as free rifles.
  result.simulationVersion+=':'+SOURCE_ECONOMY_VERSION;
  return result;
}

export function sourceAWPSimulationVersion(previous:string,awps:Record<Team,{poseVersion:string}>){
  for(const team of ['amber','blue']as const)if(awps[team].poseVersion!==SOURCE_AWP_CHARACTERS[`${team==='amber'?'t':'ct'}-awp`].poseVersion)throw Error('Wrong original AWP/team pose profile');
  return previous+':awp-v1:'+awps.amber.poseVersion+':'+awps.blue.poseVersion+':'+SOURCE_AWP_RUNTIME_VERSION+':'+SOURCE_AWP_HANDLING_VERSION+':'+SOURCE_AWP_ANIMATION_CLOCK_VERSION+':'+SOURCE_AWP_POSE_DRIVER_VERSION+':'+SOURCE_AWP_DAMAGE_VERSION;
}

export function sourceDeagleSimulationVersion(previous:string,deagles:Record<Team,{poseVersion:string}>){
 for(const team of ['amber','blue']as const)if(deagles[team].poseVersion!==SOURCE_DEAGLE_CHARACTERS[`${team==='amber'?'t':'ct'}-deagle`].poseVersion)throw Error('Wrong original Deagle/team pose profile');
 return previous+':deagle-v1:'+deagles.amber.poseVersion+':'+deagles.blue.poseVersion+':'+SOURCE_DEAGLE_RUNTIME_VERSION+':'+SOURCE_DEAGLE_HANDLING_VERSION+':'+SOURCE_DEAGLE_ANIMATION_CLOCK_VERSION+':'+SOURCE_DEAGLE_POSE_DRIVER_VERSION+':deagle-damage-12426148-r1';
}
