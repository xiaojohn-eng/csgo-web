/** Runtime selection only; each original model keeps its own verified owner. */
import type {Group,Object3D} from 'three';
import {isSourcePistolViewmodel as isLegacy,inspectSourcePistolViewmodel as inspectLegacy,sampleSourcePistolViewmodel as sampleLegacy,sourcePistolAttachment as legacyAttachment} from './source-pistol-viewmodel.js';
import {isSourceDeagleViewmodel,inspectSourceDeagleViewmodel,sampleSourceDeagleViewmodel,sourceDeagleAttachment} from './source-deagle-viewmodel.js';
export function isSourcePistolViewmodel(root:Group){return isLegacy(root)||isSourceDeagleViewmodel(root);}
export function inspectSourcePistolViewmodel(root:Group){return isSourceDeagleViewmodel(root)?inspectSourceDeagleViewmodel(root):inspectLegacy(root);}
export function sampleSourcePistolViewmodel(root:Group,input:{sequence:string;timeSeconds:number;silencerAttached?:boolean}){return isSourceDeagleViewmodel(root)?sampleSourceDeagleViewmodel(root,input):sampleLegacy(root,input);}
export function sourcePistolAttachment(root:Group,name:string,relativeTo:Object3D){return isSourceDeagleViewmodel(root)?sourceDeagleAttachment(root,name,relativeTo):legacyAttachment(root,name,relativeTo);}
