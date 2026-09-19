import type {Player,WeaponId} from './types.js';
import type {SourceAccuracyContext} from './source-accuracy.js';
import {sourceInaccuracy,SOURCE_ACCURACY_PROFILES} from './source-accuracy.js';
import {sourceServerSeed} from './source-seed.js';
import {sourcePistolInaccuracy,SOURCE_PISTOL_ACCURACY_PROFILES} from './source-pistol-handling.js';
import {sourceAWPInaccuracy,SOURCE_AWP_ACCURACY_PROFILES} from './source-awp-accuracy.js';

export function sourceRifleId(weapon:WeaponId){
  if(weapon==='vandal')return 'ak47' as const;
  if(weapon==='m4a4')return 'm4a4' as const;
  throw Error('No original rifle handling profile for held weapon');
}
/** Walking comes from the original movement gate, not raw IN_SPEED input. */
export function sourcePlayerAccuracyContext(p:Pick<Player,'grounded'|'crouch'|'reload'|'vx'|'vy'|'vz'|'sourceWalking'>):SourceAccuracyContext{
  return {grounded:p.grounded,crouching:p.crouch,reloading:p.reload>0,walking:p.sourceWalking??false,
    velocitySource:[p.vx/.0254,-p.vz/.0254,p.vy/.0254]};
}
export function sourcePlayerSpread(p:Player){
  if(p.weapon==='awp'){const s=p.sourceAWP;if(!s)throw Error('Missing Source AWP handling snapshot');return sourceAWPInaccuracy(s.command.mode,s.handling.accuracy,sourcePlayerAccuracyContext(p))+SOURCE_AWP_ACCURACY_PROFILES[s.command.mode].spread;}
  if(p.weapon==='deagle'){const s=p.sourceDeagle?.handling;if(!s)throw Error('Missing Source Deagle handling snapshot');return sourcePistolInaccuracy('deagle',0,s.accuracy,sourcePlayerAccuracyContext(p))+SOURCE_PISTOL_ACCURACY_PROFILES.deagle[0].spread;}
  if(p.weapon==='glock'||p.weapon==='usp'){
    const s=(p.weapon==='glock'?p.sourceGlock:p.sourceUSP)?.handling;if(!s)throw Error('Missing Source pistol handling snapshot');
    const id=p.weapon==='glock'?'glock18':'usp-s';
    return sourcePistolInaccuracy(id,s.modes[id],s.weapons[id],sourcePlayerAccuracyContext(p))+SOURCE_PISTOL_ACCURACY_PROFILES[id][s.modes[id]].spread;
  }
  const s=p.sourceRifleHandling;if(!s)throw Error('Missing Source rifle handling snapshot');
  return sourceInaccuracy(s.activeWeapon,s.weapons[s.activeWeapon],sourcePlayerAccuracyContext(p))+SOURCE_ACCURACY_PROFILES[s.activeWeapon].spread;
}
/** Authority-owned entropy. Original seed byte construction is exact; this
 * browser/Node process does not reproduce the original engine global RNG's
 * unrelated history. Persist the resulting seed with each accepted bullet. */
export function freshSourceRifleSeed(){
  const entropy=crypto.getRandomValues(new Uint32Array(1))[0]!&0x7fffffff;
  return sourceServerSeed(performance.now()/1000,entropy);
}
