import {createSourceDeagleRuntimeState,sourceDeagleRuntimeFrame,sourceDeagleRuntimePostThink,sourceDeagleRuntimeDeploy,sourceDeagleRuntimeHolster} from './source-deagle-runtime.js';
import {sourceDeagleHandlingOnLand,type SourceDeagleHandlingState} from './source-deagle-handling.js';
import {sourcePistolHandlingOnLand} from './source-pistol-handling.js';
import type {Player,WeaponId} from './types.js';
import type {SourceAccuracyContext} from './source-accuracy.js';
import type {SourcePistolHandlingState} from './source-pistol-handling.js';
import {createSourceGlockRuntimeState,sourceGlockRuntimeFrame,sourceGlockRuntimePostThink,sourceGlockRuntimeDeploy,sourceGlockRuntimeHolster,type SourceGlockRuntimeInput} from './source-glock-runtime.js';
import {createSourceUSPRuntimeState,sourceUSPRuntimeFrame,sourceUSPRuntimePostThink,sourceUSPRuntimeDeploy,sourceUSPRuntimeHolster} from './source-usp-runtime.js';

export function isSourcePistol(weapon:WeaponId|undefined):weapon is 'glock'|'usp'|'deagle'{return weapon==='glock'||weapon==='usp'||weapon==='deagle';}
/** Inventory adapter only. Original weapon clocks and behavior remain in their
 * model-specific runtime, used identically by authority and prediction. */
export function sourceOwnedPistol(p:Player,weapon=p.weapon){
 if(weapon==='glock'&&p.sourceGlock)return p.sourceGlock;
 if(weapon==='usp'&&p.sourceUSP)return p.sourceUSP;
 if(weapon==='deagle'&&p.sourceDeagle)return p.sourceDeagle;
 throw Error('Missing owned Source pistol state');
}
export function sourcePistolHandling(p:Player,handling:SourcePistolHandlingState|SourceDeagleHandlingState){
 if(handling.activeWeapon==='deagle'){if(p.weapon!=='deagle'||!p.sourceDeagle)throw Error('Missing Deagle handling owner');p.sourceDeagle={...p.sourceDeagle,handling};return;}
 if(p.weapon==='glock'&&p.sourceGlock)p.sourceGlock={...p.sourceGlock,handling};
 else if(p.weapon==='usp'&&p.sourceUSP)p.sourceUSP={...p.sourceUSP,handling};
 else throw Error('Missing owned Source pistol handling');
}
export function createSourceSecondary(p:Player,weapon:'glock'|'usp'|'deagle',now:number){
 delete p.sourceGlock;delete p.sourceUSP;delete p.sourceDeagle;p.secondary=weapon;
 if(weapon==='glock')p.sourceGlock=createSourceGlockRuntimeState(now);
 else if(weapon==='usp')p.sourceUSP=createSourceUSPRuntimeState(now);
 else p.sourceDeagle=createSourceDeagleRuntimeState(now);
 const state=sourceOwnedPistol(p,weapon);state.handling.punch=p.sourceRifleHandling!.punch;
 p.pistolAmmo=state.command.clip;p.pistolReserve=state.command.reserve;
}
export function sourceOwnedPistolDeploy(p:Player,now:number,accuracy:SourceAccuracyContext){
 if(p.weapon==='glock'&&p.sourceGlock)p.sourceGlock=sourceGlockRuntimeDeploy(p.sourceGlock,now,accuracy).state;
 else if(p.weapon==='usp'&&p.sourceUSP)p.sourceUSP=sourceUSPRuntimeDeploy(p.sourceUSP,now,accuracy).state;
 else if(p.weapon==='deagle'&&p.sourceDeagle)p.sourceDeagle=sourceDeagleRuntimeDeploy(p.sourceDeagle,now,accuracy).state;
 else throw Error('Missing owned Source pistol deploy state');
}
export function sourceOwnedPistolHolster(p:Player,now:number){
 if(p.weapon==='glock'&&p.sourceGlock)p.sourceGlock=sourceGlockRuntimeHolster(p.sourceGlock,now).state;
 else if(p.weapon==='usp'&&p.sourceUSP)p.sourceUSP=sourceUSPRuntimeHolster(p.sourceUSP,now).state;
 else if(p.weapon==='deagle'&&p.sourceDeagle)p.sourceDeagle=sourceDeagleRuntimeHolster(p.sourceDeagle,now).state;
 else throw Error('Missing owned Source pistol holster state');
}
export function sourceOwnedPistolFrame(p:Player,input:SourceGlockRuntimeInput){
 if(p.weapon==='glock'&&p.sourceGlock){const r=sourceGlockRuntimeFrame(p.sourceGlock,input);p.sourceGlock=r.state;return r;}
 if(p.weapon==='usp'&&p.sourceUSP){const r=sourceUSPRuntimeFrame(p.sourceUSP,input);p.sourceUSP=r.state;return r;}
 if(p.weapon==='deagle'&&p.sourceDeagle){const r=sourceDeagleRuntimeFrame(p.sourceDeagle,input);p.sourceDeagle=r.state;return r;}
 throw Error('Missing owned Source pistol command state');
}
export function sourceOwnedPistolPostThink(p:Player,now:number){
 if(!p.sourceViewmodelTime)throw Error('Missing shared Source viewmodel time');
 const context={now,viewmodelTime:p.sourceViewmodelTime};
 if(p.weapon==='glock'&&p.sourceGlock){const r=sourceGlockRuntimePostThink(p.sourceGlock,context);p.sourceGlock=r.state;return r;}
 if(p.weapon==='usp'&&p.sourceUSP){const r=sourceUSPRuntimePostThink(p.sourceUSP,context);p.sourceUSP=r.state;return r;}
 if(p.weapon==='deagle'&&p.sourceDeagle){const r=sourceDeagleRuntimePostThink(p.sourceDeagle,context);p.sourceDeagle=r.state;return r;}
 throw Error('Missing owned Source pistol PostThink state');
}

export function sourceOwnedPistolOnLand(p:Player,velocity:number,seed:number){const s=sourceOwnedPistol(p).handling;return s.activeWeapon==='deagle'?sourceDeagleHandlingOnLand(s,velocity,seed):sourcePistolHandlingOnLand(s,velocity,seed);}
