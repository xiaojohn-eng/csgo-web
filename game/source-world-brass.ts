import type {Player} from './types';
import {sourceAWPAnimationClock} from './source-awp-animation-clock';
import {sourceImpactDraws} from './source-impact-table';
export type SourceWorldBrassCursor={key:string;cycle:number};
export function sourceBrassDraws(actor:string,shot:number):[number,number,number]{
  const r=sourceImpactDraws(actor+':brass',shot);return[r.decal,r.scale,r.roll/(2*Math.PI)];
}
/** AWP waits for the installed animation's event 71. A network snapshot can
 * skip over the event cycle; compare the interval rather than equality. */
export function sourceAWPWorldBrass(player:Player,previous?:SourceWorldBrassCursor){
  const runtime=player.sourceAWP,animation=runtime?.animation;
  if(!player.alive||player.weapon!=='awp'||!runtime?.action||!animation)return{fire:false,cursor:undefined};
  const profile=sourceAWPAnimationClock.profile(animation.sequence);
  const key=[player.deaths,runtime.action.generation,animation.sequence].join(':');
  const cycle=animation.cycle,start=previous?.key===key?previous.cycle:-1e-6;
  const event=profile.events.find(e=>e.recordEvent===71&&e.type===1040);
  return{fire:!!event&&start<event.cycle&&cycle>=event.cycle,cursor:{key,cycle}};
}
