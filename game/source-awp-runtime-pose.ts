import type {Player} from './types.js';
import {createSourcePoseDriver,type SourceActorPose,type SourcePoseDriver} from './source-player-contract.js';
import {interpolateSourcePoseInput,sourceSequenceCycleRate,type SourceCharacterPoseInput} from './source-character-pose.js';
import {sourceAWPWorldCycleRate,type SourceAWPWorldSequence} from './source-awp-world-pose.js';
import {sourceAWPCharacterWorldEvents,type SourceAWPCharacterPoseIndex,type SourceAWPCharacterPoseInput} from './source-awp-character-pose.js';
import type {SourceAWPRuntimeState} from './source-awp-runtime.js';

export const SOURCE_AWP_POSE_DRIVER_VERSION='csgo-awp-pose-driver-12426148-r1';
// Original items_game max player speed. The shared small ground-state selector
// is explicit; this does not reproduce the complete native AnimState or IK.
export const SOURCE_AWP_POSE_MAX_SPEED=200;
export type SourceAWPPosePlayer=Omit<Player,'weapon'>&{weapon:Player['weapon']|'awp';sourceAWP?:Pick<SourceAWPRuntimeState,'command'|'action'>};
export type SourceAWPActorPose=Omit<SourceActorPose,'weapon'>&{weapon?:Player['weapon']|'awp'};
export type SourceAWPRuntimePose=SourceAWPCharacterPoseInput&{awpWorldVisibility?:{events:{cycle:number;visible:boolean}[]}};
export type SourceAWPPoseDriver=Omit<SourcePoseDriver,'advance'|'pistolPose'>&{
  advance(player:SourceAWPPosePlayer|Player,previous:SourceAWPActorPose,dt:number):SourceCharacterPoseInput;
  awpPose(player:SourceAWPPosePlayer|Player,now:number):SourceAWPRuntimePose;
};
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
function actionLayer<S extends string>(sequence:S,elapsed:number,rate:number){const cycle=clamp(elapsed*rate);return{sequence,cycle,weight:cycle<1?1:0};}
function display(pose:SourceAWPRuntimePose):SourceAWPRuntimePose{
  let magazineVisible=true;
  const clock=pose.clock,elapsed=clock?Math.max(0,clock.time-clock.startedAt):0,cycle=clamp(elapsed*(clock?.worldRate??0));
  if(pose.world.layers?.length&&cycle<1)for(const event of pose.awpWorldVisibility?.events??[])if(cycle>=event.cycle)magazineVisible=event.visible;
  return{...pose,magazineVisible};
}
/** Original AWP body reload overlays and world reload graph, driven by one
 * authoritative action. Fire is already in the body's original AWP Shoot layer;
 * no world fire/bolt/draw sequence is invented for the five-sequence world MDL. */
export function createSourceAWPPoseDriver(index:SourceAWPCharacterPoseIndex,id:string):SourceAWPPoseDriver{
  if(index.weapon!=='awp'||index.world.data.sourceModel!=='models/weapons/w_snip_awp.mdl')throw Error('AWP pose requires its original body and world graph');
  const base=createSourcePoseDriver(index.body,id,SOURCE_AWP_POSE_MAX_SPEED),team=index.team==='t'?'amber':'blue';
  function identity(player:SourceAWPPosePlayer|Player){if(player.weapon!=='awp'||player.team!==team)throw Error('AWP pose weapon/team identity differs');}
  return{id,advance(player,previous,dt){identity(player);return base.advance(player as Player,previous as SourceActorPose,dt);},awpPose(player,now){
    identity(player);
    if(!player.sourcePose||player.sourcePoseVersion!==id||!Number.isFinite(now))throw Error('AWP pose requires its current shared body pose');
    const runtime=(player as SourceAWPPosePlayer).sourceAWP;
    if(!runtime||!runtime.command||typeof runtime.command!=='object')throw Error('AWP pose requires explicit authoritative command state');
    const action=runtime.action;
    if(action&&(!Number.isFinite(action.time)||!Number.isSafeInteger(action.generation)||action.generation<0))throw Error('Invalid AWP action clock');
    const body=structuredClone(player.sourcePose),elapsed=action?Math.max(0,now-action.time):0;
    const bodyLayers:NonNullable<SourceAWPRuntimePose['bodyLayers']>[number][]=[],worldLayers:NonNullable<SourceAWPRuntimePose['world']['layers']>[number][]=[],events:{cycle:number;visible:boolean}[]=[];
    let bodyRate=0,worldRate=0;
    if(action?.activity===194){
      bodyRate=sourceSequenceCycleRate(index.body,'Reload_AWP',body.parameters);bodyLayers.push(actionLayer('Reload_AWP',elapsed,bodyRate));
      const crouch=body.state.startsWith('Crouch'),moving=['Walk','Run','Crouch_Walk'].includes(body.state),sequence=('sniper_reload'+(crouch?'_crouch':'')+(moving?'_moving':''))as SourceAWPWorldSequence;
      worldRate=sourceAWPWorldCycleRate(index.world,sequence);worldLayers.push(actionLayer(sequence,elapsed,worldRate));
      for(const event of sourceAWPCharacterWorldEvents(index,sequence))if(event.name==='AE_CL_EJECT_MAG'||event.name==='AE_CL_EJECT_MAG_UNHIDE')events.push({cycle:event.cycle,visible:event.name==='AE_CL_EJECT_MAG_UNHIDE'});
    }
    return display({body,bodyLayers,world:{sequence:'default',cycle:0,layers:worldLayers},awpWorldVisibility:{events},
      clock:{time:now,startedAt:action?.time??now,generation:action?.generation??0,bodyRate,worldRate}});
  }};
}
/** Rewind/interpolation consumes the serialized AWP world event clock. No
 * local weapon or viewmodel state can change a remote magazine transition. */
export function interpolateSourceAWPPose(a:SourceAWPRuntimePose,b:SourceAWPRuntimePose,t:number,span:number):SourceAWPRuntimePose{
  if(t<=0)return structuredClone(a);if(t>=1)return structuredClone(b);
  if(a.body.state!==b.body.state)return structuredClone(a);
  const body=interpolateSourcePoseInput(a.body,b.body,t,{spanSeconds:span}),ca=a.clock,cb=b.clock;
  if(!ca||!cb)return{...structuredClone(a),body};
  const now=ca.time+(cb.time-ca.time)*t,source=ca.generation!==cb.generation&&now>=cb.startedAt?b:a,clock=source.clock!,elapsed=Math.max(0,now-clock.startedAt);
  return display({...structuredClone(source),body,bodyLayers:source.bodyLayers?.map(l=>actionLayer(l.sequence,elapsed,clock.bodyRate)),
    world:{...structuredClone(source.world),layers:source.world.layers?.map((l:{sequence:SourceAWPWorldSequence;cycle:number;weight:number})=>actionLayer(l.sequence,elapsed,clock.worldRate))},clock:{...clock,time:now}});
}
