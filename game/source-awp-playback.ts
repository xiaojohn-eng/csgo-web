import {sourceAWPAnimationClock} from './source-awp-animation-clock.js';
import type {Group} from 'three';
import type {Player} from './types.js';
import {inspectSourceAWPViewmodel,sampleSourceAWPViewmodel} from './source-awp-viewmodel.js';
type Playback={key:string;generation:number;actionKey:string;inspection:number|null;inspectionSerial:number;busy:boolean};
const states=new WeakMap<Group,Playback>();
function state(root:Group){let s=states.get(root);if(!s){s={key:'',generation:0,actionKey:'',inspection:null,inspectionSerial:0,busy:false};states.set(root,s);}return s;}
export function cancelSourceAWPInspection(root:Group){state(root).inspection=null;}
export function resetSourceAWPPlayback(root:Group){states.delete(root);}
export function startSourceAWPInspection(root:Group){const s=state(root);if(s.busy)return false;s.inspection=0;s.inspectionSerial++;return true;}
/** Original AWP sequences, sampled from the authoritative runtime animation clock.
 * Inspect is a local presentation action and never controls ammo or firing. */
export function updateSourceAWPPlayback(root:Group,player:Player|undefined,dt:number,lifecycle=0){
 const s=state(root),detail=inspectSourceAWPViewmodel(root),runtime=player?.sourceAWP;
 const clips=new Map(detail.clips.map(c=>[c.sourceSequence,c])),action=runtime?.action;
 const actionKey=player&&action?`${lifecycle}:${player.id}:${player.deaths}:${action.generation}:${action.activity}:${action.time}`:'';
 if(actionKey!==s.actionKey){s.inspection=null;s.actionKey=actionKey;}
 const animation=runtime?.animation,profile=animation?sourceAWPAnimationClock.profile(animation.sequence):undefined;
 const elapsed=animation&&profile?Math.fround(animation.cycle*profile.duration):action?Math.max(0,(player?.sourceAWPPose?.clock?.time??action.time)-action.time):0;
 const idleSequence='awp_idle',nativeSequence=profile?.name??idleSequence;
 const duration=clips.get(nativeSequence)!.duration;
 s.busy=!!player&&((runtime?.command.ownerNextAttack??0)>Math.fround(player?.sourceAWPPose?.clock?.time??0)||!!runtime?.command.reloading);
 if(s.busy||player&&!player.alive)s.inspection=null;
 // Native WeaponIdle owns selection. A completed fire/reload sequence holds its
 // final pose until that command selects idle; cycle 1 alone is no signal.
 let sequence=animation?nativeSequence:action&&elapsed<duration?nativeSequence:idleSequence,time=sequence==='awp_idle'?0:elapsed,key=actionKey+':'+sequence;
 let sound={key:actionKey+':'+nativeSequence,pose:nativeSequence,time:animation?.eventCursor??Math.min(elapsed,duration),generation:action?.generation??0,cycleWindow:!!animation,
  events:profile?.events.filter(e=>e.recordEvent===5004||e.recordEvent===71&&e.type===1040).map(e=>({time:e.cycle,event:e.recordEvent===71?'AE_CLIENT_EJECT_BRASS':e.options.toLowerCase()}))};
 if(s.inspection!==null){s.inspection+=Math.max(0,dt);if(s.inspection<clips.get('lookat01')!.duration){sequence='lookat01';time=s.inspection;key='inspect:'+s.inspectionSerial;}else s.inspection=null;}
 if(sequence==='lookat01')sound={key,pose:sequence,time,generation:s.inspectionSerial,cycleWindow:false,events:undefined};
 if(key!==s.key){s.key=key;s.generation++;}
 const sampled=sampleSourceAWPViewmodel(root,{sequence,timeSeconds:time,silencerAttached:true});
 return {pose:sampled.sequence,time:sampled.time,generation:s.generation,sound};
}
