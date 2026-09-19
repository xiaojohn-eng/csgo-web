import type {Player} from './types.js';
import {createSourcePoseDriver,type SourceActorPose,type SourcePoseDriver} from './source-player-contract.js';
import {sourceSequenceCycleRate,type SourceCharacterPoseInput} from './source-character-pose.js';
import {interpolateSourcePistolPose} from './source-pistol-runtime-pose.js';
import {sourceDeagleWorldCycleRate,type SourceDeagleCharacterPoseIndex,type SourceDeagleCharacterPoseInput,type SourceDeagleWorldParameters,type SourceDeagleLayer} from './source-deagle-character-pose.js';

export const SOURCE_DEAGLE_POSE_DRIVER_VERSION='csgo-deagle-pose-driver-12426148-r1';
export const SOURCE_DEAGLE_POSE_MAX_SPEED=230;
/** Structural bridge while the shared player command union is integrated. */
export type SourceDeaglePosePlayer=Omit<Player,'weapon'|'sourceDeagle'>&{weapon:Player['weapon']|'deagle';sourceDeagle?:{
 command:object;action?:{activity:number;time:number;generation:number}}};
export type SourceDeagleActorPose=Omit<SourceActorPose,'weapon'|'sourceDeagle'>&{weapon?:Player['weapon']|'deagle'};
type MagazineEvent={cycle:number;visible:boolean};
/** Display events travel with the action clock through snapshots and rewind. */
export type SourceDeagleRuntimePose=SourceDeagleCharacterPoseInput&{deagleWorldVisibility?:{events:MagazineEvent[]}};
export type SourceDeaglePoseDriver=Omit<SourcePoseDriver,'advance'|'pistolPose'>&{
 advance(player:SourceDeaglePosePlayer|Player,previous:SourceDeagleActorPose,dt:number):SourceCharacterPoseInput;
 pistolPose(player:SourceDeaglePosePlayer|Player,now:number):SourceDeagleRuntimePose};
const clamp=(v:number)=>Math.min(1,Math.max(0,v));
function worldParameters(body:SourceCharacterPoseInput):SourceDeagleWorldParameters{
 return {body_yaw:body.parameters.body_yaw??0,body_pitch:body.parameters.body_pitch??0,
  aim_blend_stand_idle:body.state==='Idle'?1:0,aim_blend_stand_walk:body.state==='Walk'?1:0,
  aim_blend_stand_run:body.state==='Run'?1:0,aim_blend_crouch_idle:body.state==='Crouch_Idle'?1:0,
  aim_blend_crouch_walk:body.state==='Crouch_Walk'?1:0};
}
function layer(sequence:string,elapsed:number,rate:number):SourceDeagleLayer{
 const cycle=clamp(elapsed*rate);return {sequence,cycle,weight:cycle<1?1:0};
}
function magazineEvents(index:SourceDeagleCharacterPoseIndex,name:string):MagazineEvent[]{
 const sequence=index.world.named.get(name),events=(sequence as typeof sequence&{events?:{cycle:number;name:string}[]})?.events;
 if(!sequence||!Array.isArray(events)||events.some(e=>!Number.isFinite(e.cycle)||e.cycle<0||e.cycle>1||typeof e.name!=='string'))
  throw Error('Deagle world action requires original display events: '+name);
 return events.filter(e=>e.name==='AE_CL_EJECT_MAG'||e.name==='AE_CL_EJECT_MAG_UNHIDE')
  .map(e=>({cycle:e.cycle,visible:e.name==='AE_CL_EJECT_MAG_UNHIDE'}));
}
function display(pose:SourceDeagleRuntimePose):SourceDeagleRuntimePose{
 if(!pose.deagleWorldVisibility)return pose;
 const elapsed=pose.clock?Math.max(0,pose.clock.time-pose.clock.startedAt):0,cycle=clamp(elapsed*(pose.clock?.worldRate??0));
 let magazineVisible=true;
 if(pose.world.layers?.length&&cycle<1)for(const event of pose.deagleWorldVisibility?.events??[])if(cycle>=event.cycle)magazineVisible=event.visible;
 return {...pose,silencerVisible:false,magazineVisible};
}
/** Original T/CT PISTOL graph, Deagle world layers and 230 unit speed selector.
 * The explicit ground selector is shared; complete native animstate/IK weights
 * remain separate. Draw has no fabricated world clip, and final shot 195 uses
 * the original pistol_fire world sequence (only the viewmodel has shoot_empty). */
export function createSourceDeaglePoseDriver(index:SourceDeagleCharacterPoseIndex,id:string):SourceDeaglePoseDriver{
 if(index.weapon!=='deagle'||index.world.data.weaponId!=='deagle'||index.world.data.sourceModel!=='models/weapons/w_pist_deagle.mdl')
  throw Error('Deagle pose driver requires its original body/world graph');
 const base=createSourcePoseDriver(index.body,id),team=index.team==='t'?'amber':'blue';
 function identity(player:SourceDeaglePosePlayer|Player){
  if(player.weapon!=='deagle'||player.team!==team)throw Error('Deagle pose requires the matching weapon and team');
 }
 return {id,advance(player,previous,dt){
  identity(player);
  const speed=dt>0?Math.hypot(player.x-previous.x,player.z-previous.z)/dt:0;
  // Override only the selector's local flag, preserving weapon identity and the
  // authority state. Shared baseline otherwise defaults unknown weapons to 215.
  return base.advance({...player,sourceWalking:player.sourceWalking||speed<SOURCE_DEAGLE_POSE_MAX_SPEED*.0254*.52}as Player,previous as SourceActorPose,dt);
 },pistolPose(player,now){
  identity(player);
  if(!player.sourcePose||player.sourcePoseVersion!==id||!Number.isFinite(now))throw Error('Deagle pose requires its current shared body pose');
  const runtime=(player as SourceDeaglePosePlayer).sourceDeagle;
  if(!runtime||!runtime.command||typeof runtime.command!=='object')throw Error('Deagle pose requires explicit authoritative Deagle state');
  const action=runtime.action;
  if(action&&(!Number.isFinite(action.time)||!Number.isSafeInteger(action.generation)||action.generation<0||!Number.isFinite(action.activity)))throw Error('Invalid authoritative Deagle action clock');
  const body=structuredClone(player.sourcePose),parameters=worldParameters(body),elapsed=action?Math.max(0,now-action.time):0;
  const bodyLayers:SourceDeagleLayer[]=[],worldLayers:SourceDeagleLayer[]=[],crouch=body.state.startsWith('Crouch'),moving=['Walk','Run','Crouch_Walk'].includes(body.state);
  let bodyRate=0,worldRate=0,worldName:string|undefined;
  if(action?.activity===194){
   const sequence=index.body.namedSequences.get('Reload_PISTOL');if(!sequence)throw Error('Deagle original Reload_PISTOL body action is missing');
   bodyRate=sourceSequenceCycleRate(index.body,sequence.index,body.parameters);bodyLayers.push(layer(sequence.name,elapsed,bodyRate));
   worldName='pistol_reload'+(crouch?'_crouch':'')+(moving?'_moving':'');
  }else if(action?.activity===192||action?.activity===195)worldName='pistol_fire'+(crouch?'_crouch':'');
  if(worldName){worldRate=sourceDeagleWorldCycleRate(index.world,worldName,parameters);worldLayers.push(layer(worldName,elapsed,worldRate));}
  return display({body,bodyLayers,world:{parameters,cycle:0,layers:worldLayers},
   deagleWorldVisibility:{events:worldName?magazineEvents(index,worldName):[]},
   clock:{time:now,startedAt:action?.time??now,generation:action?.generation??0,bodyRate,worldRate}});
 }};
}
/** Keep the common body/action interpolation and evaluate original magazine
 * events at the resulting clock, including draw cancellation and final shots. */
export function interpolateSourceDeaglePose(a:SourceDeagleRuntimePose,b:SourceDeagleRuntimePose,t:number,span:number):SourceDeagleRuntimePose{
 return display(interpolateSourcePistolPose(a,b,t,span)as SourceDeagleRuntimePose);
}
