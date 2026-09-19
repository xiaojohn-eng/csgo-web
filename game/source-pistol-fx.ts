import * as T from 'three';
import {inspectSourcePistolViewmodel,sourcePistolAttachment} from './source-owned-pistol-viewmodel';
import type {WeaponId} from './types';

export const SOURCE_PISTOL_FX_ATTACHMENT_VERSION='csgo-pistol-fx-attachments-12426148-r1';
export type SourcePistolFxFrame={name:string;matrix:T.Matrix4;position:T.Vector3;forward:T.Vector3;up:T.Vector3;right:T.Vector3};
/** Original getter 0x5e11f0 selects the empty alt field for attached USP.
 * Accepted USP bullet mode is 1 attached / 0 detached (AE44 / AE46). */
export function sourcePistolParticleSystemForShot(weapon:WeaponId,mode:number){
 if(weapon!=='glock'&&weapon!=='usp'&&weapon!=='deagle')return null;
 if(weapon==='usp'&&mode!==0&&mode!==1)throw Error('USP particle selection requires accepted mode');
 return weapon==='usp'&&mode===1?null:'weapon_muzzle_flash_pistol' as const;
}
/** Original client 0x5e0fb0: has-silencer AND m_bSilencerOn chooses
 * muzzle_flash2; otherwise attachment "1". Display bodygroups are not mode. */
export function sourcePistolMuzzleAttachmentName(weapon:'glock'|'usp'|'deagle',silencerAttached?:boolean){
 if(weapon!=='glock'&&weapon!=='usp'&&weapon!=='deagle')throw Error('Unknown original pistol FX weapon');
 if(weapon==='usp'&&typeof silencerAttached!=='boolean')throw Error('USP FX requires authoritative silencerAttached');
 return weapon==='usp'&&silencerAttached?'muzzle_flash2':'1';
}
function frame(root:T.Group,name:string,relativeTo:T.Object3D):SourcePistolFxFrame{
 const matrix=sourcePistolAttachment(root,name,relativeTo);
 if(!matrix.elements.every(Number.isFinite)||Math.abs(matrix.determinant())<1e-20)throw Error('Invalid original pistol FX attachment transform');
 // The exported attachment basis is C * original * inverse(C), C=(x,z,-y).
 // Local +X is Source forward, +Y is Source up, +Z is Source right (-Y).
 return {name,matrix,position:new T.Vector3().setFromMatrixPosition(matrix),
  forward:new T.Vector3(1,0,0).transformDirection(matrix),up:new T.Vector3(0,1,0).transformDirection(matrix),right:new T.Vector3(0,0,1).transformDirection(matrix)};
}
/** Call after sampling the current viewmodel. No offsets, units conversion,
 * world-transform multiplication or synthetic ejection velocity is added. */
export function sourcePistolFxAttachments(root:T.Group,relativeTo:T.Object3D,options:{silencerAttached?:boolean}={}){
 const {weapon}=inspectSourcePistolViewmodel(root),name=sourcePistolMuzzleAttachmentName(weapon,options.silencerAttached);
 return {version:SOURCE_PISTOL_FX_ATTACHMENT_VERSION,weapon,
  muzzle:frame(root,name,relativeTo),shellEject:frame(root,'2',relativeTo),
  // Names are verified items_game inputs; particle operators/textures are not
  // implemented here. The same base name does not prove identical silenced FX.
  particles:{muzzle:'weapon_muzzle_flash_pistol',shell:'weapon_shell_casing_9mm',rendererStatus:'not-implemented' as const}};
}
