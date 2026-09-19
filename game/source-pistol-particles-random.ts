import {SOURCE_PISTOL_PARTICLE_RANDOM_TABLE_BASE64,SOURCE_PISTOL_PARTICLE_RANDOM_TABLE_SHA256} from './source-pistol-particles-random-data';
export {SOURCE_PISTOL_PARTICLE_RANDOM_TABLE_SHA256};
const bytes=Uint8Array.from(atob(SOURCE_PISTOL_PARTICLE_RANDOM_TABLE_BASE64),c=>c.charCodeAt(0));
const table=new DataView(bytes.buffer);
export type SourcePistolParticleSeeds={main:number;core:number};
/** Native scalar table lookup. Seed assignment is an explicit caller boundary:
 * the original unseeded constructor uses collection address plus Plat_MSTime(). */
export function sourcePistolParticleRandomValue(index:number){
 if(!Number.isSafeInteger(index))throw Error('Particle random index must be an integer');
 return table.getFloat32((index&4095)*4,true);
}
export function createSourcePistolParticleRandom(seed:number,counter=0){
 if(!Number.isSafeInteger(seed)||!Number.isSafeInteger(counter)||counter<0)throw Error('Invalid particle random seed/counter');
 const next=()=>{const value=sourcePistolParticleRandomValue(((seed&4095)+(counter&4095))&4095);counter=(counter+1)>>>0;return value;};
 return Object.assign(next,{snapshot:()=>({seed,counter})});
}
