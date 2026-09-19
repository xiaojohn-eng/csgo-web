import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {applySourceWorldLightmaps,type SourceLightmapDescriptor} from '../game/source-world-lightmaps';
export async function applySourceLightmapPreview(gltf:GLTF,base:string){
  const descriptor:SourceLightmapDescriptor=await fetch(base+'lightmaps.json').then(r=>{if(!r.ok)throw Error('HDR atlas metadata missing');return r.json();});
  const bytes=await fetch(base+descriptor.atlasFiles[0].file).then(r=>{if(!r.ok)throw Error('HDR atlas missing');return r.arrayBuffer();});
  return applySourceWorldLightmaps(gltf.scene,descriptor,bytes);
}
