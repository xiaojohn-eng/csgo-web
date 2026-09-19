import {createSourcePoseDriver,type SourcePoseDriver} from './source-player-contract.js';
import {sourceSequenceCycleRate,interpolateSourcePoseInput,type SourceCharacterPoseInput} from './source-character-pose.js';
import {sourcePistolWorldCycleRate,type SourcePistolCharacterPoseIndex,type SourcePistolCharacterPoseInput,type SourcePistolWorldParameters,type SourcePistolLayer} from './source-pistol-character-pose.js';
export const SOURCE_PISTOL_POSE_DRIVER_VERSION='csgo-pistol-pose-driver-12426148-r1';
export const SOURCE_USP_POSE_DRIVER_VERSION='csgo-usp-pose-driver-12426148-r1';
const clamp=(v:number)=>Math.min(1,Math.max(0,v));
function worldParameters(body:SourceCharacterPoseInput):SourcePistolWorldParameters{
 return {body_yaw:body.parameters.body_yaw??0,body_pitch:body.parameters.body_pitch??0,
  aim_blend_stand_idle:body.state==='Idle'?1:0,aim_blend_stand_walk:body.state==='Walk'?1:0,
  aim_blend_stand_run:body.state==='Run'?1:0,aim_blend_crouch_idle:body.state==='Crouch_Idle'?1:0,
  aim_blend_crouch_walk:body.state==='Crouch_Walk'?1:0};
}
function layer(sequence:string,elapsed:number,rate:number):SourcePistolLayer{
 const cycle=clamp(elapsed*rate);return {sequence,cycle,weight:cycle<1?1:0};
}
/** Shared explicit ground selector and native sequence durations. The original
 * CCSGOPlayerAnimState transition weights/IK are a separate fidelity task. */
export function createSourceGlockPoseDriver(index:SourcePistolCharacterPoseIndex,id:string):SourcePoseDriver{
 if(index.weapon!=='glock')throw Error('Glock pose driver requires its original pistol graph');
 const base=createSourcePoseDriver(index.body,id);
 return {...base,pistolPose(player,now){
  if(player.weapon!=='glock'||!player.sourcePose||player.sourcePoseVersion!==id||!Number.isFinite(now))throw Error('Glock pose requires its current shared body pose');
  const body=structuredClone(player.sourcePose),parameters=worldParameters(body),action=player.sourceGlock?.action;
  const elapsed=action?Math.max(0,now-action.time):0,bodyLayers:SourcePistolLayer[]=[],worldLayers:SourcePistolLayer[]=[];
  let bodyRate=0,worldRate=0;
  if(action?.activity===194){
   const sequence=[...index.body.sequences.values()].find(s=>s.name==='Reload_PISTOL')!;
   bodyRate=sourceSequenceCycleRate(index.body,sequence.index,body.parameters);bodyLayers.push(layer('Reload_PISTOL',elapsed,bodyRate));
   const moving=['Walk','Run','Crouch_Walk'].includes(body.state),crouch=body.state.startsWith('Crouch');
   const name='pistol_reload'+(crouch?'_crouch':'')+(moving?'_moving':'');worldRate=sourcePistolWorldCycleRate(index.world,name,parameters);worldLayers.push(layer(name,elapsed,worldRate));
  }else if(action?.activity===192){
   const name=body.state.startsWith('Crouch')?'pistol_fire_crouch':'pistol_fire';worldRate=sourcePistolWorldCycleRate(index.world,name,parameters);worldLayers.push(layer(name,elapsed,worldRate));
  }
  return {body,bodyLayers,world:{parameters,cycle:0,layers:worldLayers},silencerVisible:false,magazineVisible:true,
   clock:{time:now,startedAt:action?.time??now,generation:action?.generation??0,bodyRate,worldRate}};
 }};
}
type SourceWorldDisplayEvent={cycle:number;name:string};
type SourceUSPWorldVisibility={attached:boolean;events:{cycle:number;target:'silencer'|'magazine';visible:boolean}[]};
/** Serialized with the shared pose so remote interpolation can cross the
 * original world-model display events without consulting local weapon state. */
export type SourceUSPRuntimePose=SourcePistolCharacterPoseInput&{uspWorldVisibility?:SourceUSPWorldVisibility};
function uspWorldEvents(index:SourcePistolCharacterPoseIndex,name:string){
 const sequence=index.world.named.get(name),events=(sequence as (typeof sequence&{events?:SourceWorldDisplayEvent[]})|undefined)?.events;
 if(!sequence||!Array.isArray(events)||events.some(e=>!Number.isFinite(e.cycle)||e.cycle<0||e.cycle>1||typeof e.name!=='string'))
  throw Error('USP world action requires its original display event records: '+name);
 return events.flatMap(e=>{
  const target=e.name==='AE_CL_SHOW_SILENCER'||e.name==='AE_CL_HIDE_SILENCER'?'silencer':
   e.name==='AE_CL_EJECT_MAG'||e.name==='AE_CL_EJECT_MAG_UNHIDE'?'magazine':undefined;
  return target?[{cycle:e.cycle,target,visible:e.name==='AE_CL_SHOW_SILENCER'||e.name==='AE_CL_EJECT_MAG_UNHIDE'}]:[];
 })as SourceUSPWorldVisibility['events'];
}
function uspDisplay(pose:SourceUSPRuntimePose,elapsed:number){
 const visibility=pose.uspWorldVisibility;if(!visibility)return pose;
 let silencerVisible=visibility.attached,magazineVisible=true;
 const cycle=clamp(elapsed*(pose.clock?.worldRate??0));
 // Original world actions have different durations/events from the viewmodel.
 // Their SHOW/HIDE only display the loose part; attachment remains authoritative.
 if(pose.world.layers?.length&&cycle<1)for(const event of visibility.events)if(cycle>=event.cycle){
  if(event.target==='silencer')silencerVisible=event.visible;else magazineVisible=event.visible;
 }
 return {...pose,silencerVisible,magazineVisible};
}
/** Original USP T/CT body and world layers driven by the shared command action.
 * This does not claim the full CCSGOPlayerAnimState/IK transition weights. */
export function createSourceUSPPoseDriver(index:SourcePistolCharacterPoseIndex,id:string):SourcePoseDriver{
 if(index.weapon!=='usp')throw Error('USP pose driver requires its original pistol graph');
 const base=createSourcePoseDriver(index.body,id);
 return {...base,pistolPose(player,now){
  if(player.weapon!=='usp'||!player.sourcePose||player.sourcePoseVersion!==id||!Number.isFinite(now))throw Error('USP pose requires its current shared body pose');
  const runtime=player.sourceUSP;
  if(!runtime||typeof runtime.command.silencerAttached!=='boolean')throw Error('USP pose requires explicit authoritative USP state');
  const action=runtime.action,body=structuredClone(player.sourcePose),parameters=worldParameters(body),elapsed=action?Math.max(0,now-action.time):0;
  const bodyLayers:SourcePistolLayer[]=[],worldLayers:SourcePistolLayer[]=[],crouch=body.state.startsWith('Crouch'),moving=['Walk','Run','Crouch_Walk'].includes(body.state);
  let bodyRate=0,worldRate=0,bodyName:string|undefined,worldName:string|undefined;
  if(action?.activity===194){
   bodyName='Reload_PISTOL';worldName='pistol_reload'+(crouch?'_crouch':'')+(moving?'_moving':'');
  }else if(action?.activity===192){
   worldName='pistol_fire'+(crouch?'_crouch':'');
  }else if(action?.activity===220||action?.activity===221){
   bodyName=action.activity===220?'Silencer_Attach_Pistol':'Silencer_Detach_Pistol';
   // The original world graph has one crouch variant, including crouch movement.
   worldName=(action.activity===220?'pistol_silencer_ON':'pistol_silencer_OFF')+(crouch?'_crouch':moving?'_moving':'');
  }
  if(bodyName){const sequence=index.body.namedSequences.get(bodyName);if(!sequence)throw Error('USP original body action is missing: '+bodyName);
   bodyRate=sourceSequenceCycleRate(index.body,sequence.index,body.parameters);bodyLayers.push(layer(bodyName,elapsed,bodyRate));}
  if(worldName){worldRate=sourcePistolWorldCycleRate(index.world,worldName,parameters);worldLayers.push(layer(worldName,elapsed,worldRate));}
  return uspDisplay({body,bodyLayers,world:{parameters,cycle:0,layers:worldLayers},
   uspWorldVisibility:{attached:runtime.command.silencerAttached,events:worldName?uspWorldEvents(index,worldName):[]},
   clock:{time:now,startedAt:action?.time??now,generation:action?.generation??0,bodyRate,worldRate}},elapsed);
 }};
}
/** Retimes an observed action from its actual start. Event boundaries are
 * discrete, with no interpolation from the previous action into the new one. */
export function interpolateSourcePistolPose(a:SourcePistolCharacterPoseInput,b:SourcePistolCharacterPoseInput,t:number,span:number){
 if(t<=0)return structuredClone(a);if(t>=1)return structuredClone(b);
 if(a.body.state!==b.body.state)return structuredClone(a);
 const body=interpolateSourcePoseInput(a.body,b.body,t,{spanSeconds:span}),ca=a.clock,cb=b.clock;
 if(!ca||!cb)return {...structuredClone(a),body,world:{...structuredClone(a.world),parameters:worldParameters(body)}};
 const now=ca.time+(cb.time-ca.time)*t,newAction=ca.generation!==cb.generation&&now>=cb.startedAt;
 const source=newAction?b:a,clock=source.clock!,elapsed=Math.max(0,now-clock.startedAt);
 return uspDisplay({...structuredClone(source),body,bodyLayers:source.bodyLayers?.map(l=>layer(l.sequence,elapsed,clock.bodyRate)),
  world:{...structuredClone(source.world),parameters:worldParameters(body),layers:source.world.layers?.map(l=>layer(l.sequence,elapsed,clock.worldRate))},clock:{...clock,time:now}},elapsed);
}
