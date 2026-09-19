import {sourceDeagleAnimationClock} from './source-deagle-animation-clock.js';
import type {Group} from 'three';
import type {Player} from './types.js';
import {inspectSourcePistolViewmodel,sampleSourcePistolViewmodel} from './source-owned-pistol-viewmodel.js';
import {sourceGlockAnimationProfile} from './source-glock-animation-clock.js';
import {sourceUSPAnimationClock} from './source-usp-animation-clock.js';
type Playback={key:string;generation:number;actionKey:string;inspection:number|null;inspectionSerial:number;busy:boolean};
const states=new WeakMap<Group,Playback>();
function state(root:Group){let s=states.get(root);if(!s){s={key:'',generation:0,actionKey:'',inspection:null,inspectionSerial:0,busy:false};states.set(root,s);}return s;}
export function cancelSourcePistolInspection(root:Group){state(root).inspection=null;}
export function resetSourcePistolPlayback(root:Group){states.delete(root);}
export function startSourcePistolInspection(root:Group){const s=state(root);if(s.busy)return false;s.inspection=0;s.inspectionSerial++;return true;}
/** Original pistol sequences, sampled from the shared command action clock.
 * Inspect is a local presentation action and never controls ammo or firing. */
export function updateSourceGlockPlayback(root:Group,player:Player|undefined,dt:number,lifecycle=0){
 const s=state(root),detail=inspectSourcePistolViewmodel(root),isGlock=detail.weapon==='glock',isDeagle=detail.weapon==='deagle',runtime=isDeagle?player?.sourceDeagle:isGlock?player?.sourceGlock:player?.sourceUSP;
 const clips=new Map(detail.clips.map(c=>[c.sourceSequence,c])),action=runtime?.action;
 const actionKey=player&&action?`${lifecycle}:${player.id}:${player.deaths}:${action.generation}:${action.activity}:${action.time}`:'';
 if(actionKey!==s.actionKey){s.inspection=null;s.actionKey=actionKey;}
 const animation=runtime?.animation,profile=isDeagle?(player?.sourceDeagle?.animation?sourceDeagleAnimationClock.profile(player.sourceDeagle.animation.sequence):undefined):isGlock?(player?.sourceGlock?.animation?sourceGlockAnimationProfile(player.sourceGlock.animation.sequence):undefined):(player?.sourceUSP?.animation?sourceUSPAnimationClock.profile(player.sourceUSP.animation.sequence):undefined);
 const elapsed=animation&&profile?Math.fround(animation.cycle*profile.duration):action?Math.max(0,(player?.sourcePistolPose?.clock?.time??action.time)-action.time):0;
 const idleSequence=isDeagle?'idle1':isGlock?'glock_idle':'idle',fallback:Record<number,string>={183:'glock_draw',192:'glock_firesingle',194:'glock_reload'};
 const nativeSequence=profile?.name??(isGlock&&action?fallback[action.activity]:idleSequence);
 const duration=clips.get(nativeSequence)!.duration;
 s.busy=!!player&&((runtime?.command.ownerNextAttack??0)>Math.fround(player.sourcePistolPose?.clock?.time??0)||!!runtime?.command.reloading||(!isGlock&&!isDeagle&&(player.sourceUSP?.command.silencerSwitchTime??0)>Math.fround(player.sourcePistolPose?.clock?.time??0)));
 if(s.busy||player&&!player.alive)s.inspection=null;
 // Native WeaponIdle owns selection. A completed fire/reload sequence holds
 // its final pose until that command selects idle; cycle 1 alone is no signal.
 let sequence=animation?nativeSequence:action&&elapsed<duration?nativeSequence:idleSequence,time=sequence==='glock_idle'?0:elapsed,key=actionKey+':'+sequence;
 let sound={key:actionKey+':'+nativeSequence,pose:nativeSequence,time:animation?.eventCursor??Math.min(elapsed,duration),generation:action?.generation??0,cycleWindow:!!animation,
  events:profile?.events.filter(e=>e.recordEvent===5004).map(e=>({time:e.cycle,event:e.options.toLowerCase()}))};
 if(s.inspection!==null){s.inspection+=Math.max(0,dt);if(s.inspection<clips.get('lookat01')!.duration){sequence='lookat01';time=s.inspection;key='inspect:'+s.inspectionSerial;}else s.inspection=null;}
 if(sequence==='lookat01')sound={key,pose:sequence,time,generation:s.inspectionSerial,cycleWindow:false,events:undefined};
 if(key!==s.key){s.key=key;s.generation++;}
 const sampled=sampleSourcePistolViewmodel(root,{sequence,timeSeconds:time,silencerAttached:player?.sourceUSP?.command.silencerAttached??true});
 return {pose:sampled.sequence,time:sampled.time,generation:s.generation,sound};
}

/** Shared pistol playback; legacy named export remains for frozen Glock consumers. */
export const updateSourcePistolPlayback=updateSourceGlockPlayback;
