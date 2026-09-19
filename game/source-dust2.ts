import * as T from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {applySourceWorldLightmaps,type SourceLightmapDescriptor} from './source-world-lightmaps';
import {createSourceVisibilityPreview} from './source-visibility-render';
import type {SourceVisibilityData} from './source-visibility';
import type {SourceLevelData} from './source-level';
import type {SourceMapCollisionData} from './source-map-collision';
import type {SourceNavigationData} from './source-navigation';
import {sourceSha256} from './source-sha256';
import {loadSourcePropLighting} from './source-prop-lighting-loader';
import {createSourcePropBatch} from './source-prop-batch';
import {createSourcePlainPropBatch} from './source-plain-prop-batch';
import {createSourceWorldBatch} from './source-world-batch';
import {prepareSourceSky,type SourceSkyData} from './source-sky';
import {createSourceSkyRender} from './source-sky-render';
import {loadSourceSkyCloudLayer} from './source-sky-cloud-loader';
import {createSourceSkyBatch} from './source-sky-batch';
import {SOURCE_DUST2_ENVIRONMENT} from './source-environment.js';
import {loadSourceFoliage} from './source-foliage-loader';
import {loadSourceOlive} from './source-olive-loader';
import {createSourceMapWind} from './source-map-wind';
import {loadSourceOverlays} from './source-overlays-loader';
import {loadSourceRopesRender} from './source-ropes-loader';
import {loadSourceWorldLayers} from './source-world-layers-loader';
import {loadSourcePropMips} from './source-map-prop-mips';
import {sourceMapCapabilities} from './source-map-capabilities';
import {sourcePVSRetainedIndices} from './source-map-pvs-index';

import {DUST2_BSP_SHA256,sourceSimulationVersion} from './source-identity';
export {DUST2_BSP_SHA256} from './source-identity';
type FileKey='world'|'props'|'lightmaps'|'atlas'|'visibility'|'level'|'collision'|'navigation'|'sky'|'skyTexture2';
export type SourceMapManifest={format:'source-map-runtime-v1';id:'de_dust2';sourceBspSha256:string;
  files:Record<FileKey,{url:string;bytes:number;sha256:string}>;worldTriangles:number;propTriangles:number;limitations:string[]};

function ownGLTF(gltf:GLTF){
  const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>();
  gltf.scene.traverse(object=>{const mesh=object as T.Mesh;if(!mesh.isMesh)return;
    geometries.add(mesh.geometry);
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
      materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
    }
  });
  let disposed=false;
  return ()=>{if(disposed)return;disposed=true;gltf.scene.removeFromParent();
    for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();
    const bitmaps=new Set<ImageBitmap>();
    for(const texture of textures){texture.dispose();if(typeof ImageBitmap!=='undefined'&&texture.image instanceof ImageBitmap)bitmaps.add(texture.image);}
    for(const bitmap of bitmaps)bitmap.close();
  };
}
function triangleCount(root:T.Object3D){let count=0;root.traverse(object=>{const mesh=object as T.Mesh;if(mesh.isMesh)count+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;});return count;}

/** After every GLTF dependency (geometry bytes, materials, textures) has been
 * resolved and verified, the retained GLB binary body and the CPU-side vertex
 * arrays have no remaining readers: rendering reads GPU buffers, PVS keeps its
 * own index/face copies, foliage wind is a vertex shader. Drops the body
 * reference and lets each attribute free its view once WebGL uploaded it. */
function releaseSourceGLTFCPUBuffers(...gltfs:GLTF[]){
 let bodiesReleased=0,attributes=0,geometries=0,bufferCachesDropped=0;
 for(const gltf of gltfs){
  // The loader always owns a parser; test fixtures may parse bare scenes.
  const parser=gltf.parser as unknown as {extensions?:Record<string,unknown>;cache?:{removeAll?:()=>void}}|undefined;
  const binary=parser?.extensions?.KHR_binary_glTF as {body?:ArrayBuffer|null}|undefined;
  if(binary&&'body'in binary){binary.body=null;bodiesReleased++;}
  // GLTFLoader's registry caches every resolved dependency forever, including
  // each bufferView slice (full BIN chunk size) and the buffer promise holding
  // the body. Runtime readers only touch parser.json/associations, so clearing
  // the registry frees both copies the released attributes point into.
  if(typeof parser?.cache?.removeAll==='function'){parser.cache.removeAll();bufferCachesDropped++;}
  const owned=new Set<T.BufferGeometry>();
  gltf.scene.traverse(object=>{const mesh=object as T.Mesh;if(mesh.isMesh)owned.add(mesh.geometry);});
  const drop=function(this:T.BufferAttribute){this.array=null as unknown as T.BufferAttribute['array'];};
  for(const geometry of owned){
    for(const attribute of Object.values(geometry.attributes))
      if(attribute instanceof T.BufferAttribute){attribute.onUploadCallback=drop;attributes++;}
    if(geometry.index&&!sourcePVSRetainedIndices.has(geometry.index)){geometry.index.onUploadCallback=drop;attributes++;}
  }
  geometries+=owned.size;
 }
 return {bodiesReleased,geometries,attributes,bufferCachesDropped};
}

/** One asynchronous asset owner for both training and LAN scene integration.
 * Creates no physics World and does not choose a room's map. Source files have
 * already received their single metre transform; this Group adds no transform.
 */
export async function loadSourceDust2(options:{manifestURL?:string;signal?:AbortSignal;sky?:boolean;enableDetails?:boolean;detailsBaseURL?:string;enableWorldLayers?:boolean;worldLayersBaseURL?:string;enableOriginalPropMips?:boolean;propMipsBaseURL?:string;enablePropBatch?:boolean;enablePlainPropBatch?:boolean;enableWorldBatch?:boolean;enableSkyBatch?:boolean;propLighting?:{baseURL?:string;maxTextureSize:number;enablePlainUnbumped?:boolean;enableDecalMultiply?:boolean;enableTintMask?:boolean;enableTintDecal?:boolean;enableStructuralTint?:boolean;enableFoliage?:boolean;foliageBaseURL?:string;enableOlive?:boolean;oliveBaseURL?:string}}={}){
  const started=performance.now();
  const manifestURL=new URL(options.manifestURL??'/source/csgo-12426148/dust2/manifest.json',globalThis.location?.href??'http://127.0.0.1/').href;
  const response=await fetch(manifestURL,{signal:options.signal,cache:'no-cache'});if(!response.ok)throw Error(`Dust2 manifest HTTP ${response.status}`);
  const manifest:SourceMapManifest=await response.json();
  if(manifest.format!=='source-map-runtime-v1'||manifest.id!=='de_dust2'||manifest.sourceBspSha256!==DUST2_BSP_SHA256||
    manifest.worldTriangles!==302307||manifest.propTriangles!==6269945)throw Error('Dust2 original asset identity differs');
  const verified:Partial<Record<FileKey,boolean>>={};
  async function bytes(key:FileKey){
    const file=manifest.files[key];
    if(!file||!Number.isSafeInteger(file.bytes)||file.bytes<1||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid Dust2 file receipt: '+key);
    const url=new URL(file.url,manifestURL).href;
    const result=await fetch(url,{signal:options.signal,cache:'no-cache'});if(!result.ok)throw Error(`Dust2 ${key} HTTP ${result.status}`);
    const data=await result.arrayBuffer();if(data.byteLength!==file.bytes)throw Error('Incomplete Dust2 file: '+key);
    const hash=await sourceSha256(new Uint8Array(data),options.signal);
    if(hash!==file.sha256)throw Error('Dust2 file checksum differs: '+key);verified[key]=true;
    return {data,url};
  }
  const cleanup:(()=>void)[]=[];let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;for(const release of cleanup.slice().reverse())release();};
  const gltf=async(key:'world'|'props')=>{
    const {data,url}=await bytes(key),asset=await new GLTFLoader().parseAsync(data,new URL('.',url).href);
    cleanup.push(ownGLTF(asset));return asset;
  };
  const json=async<Value>(key:FileKey)=>JSON.parse(new TextDecoder().decode((await bytes(key)).data)) as Value;
  try{
    // Settle every concurrent load before cleanup, including late GLTF decodes.
    const pending=await Promise.allSettled([gltf('world'),gltf('props'),json<SourceLightmapDescriptor>('lightmaps'),bytes('atlas'),
      json<SourceVisibilityData>('visibility'),json<SourceLevelData>('level'),json<SourceMapCollisionData>('collision'),json<SourceNavigationData>('navigation'),
      options.sky?json<SourceSkyData>('sky'):Promise.resolve(null)]as const);
    for(const result of pending)if(result.status==='rejected')throw result.reason;
    const [world,props,lightmaps,atlas,visibility,level,collision,navigation,skyData]=pending.map(result=>(result as PromiseFulfilledResult<unknown>).value) as
      [GLTF,GLTF,SourceLightmapDescriptor,{data:ArrayBuffer;url:string},SourceVisibilityData,SourceLevelData,SourceMapCollisionData,SourceNavigationData,SourceSkyData|null];
    options.signal?.throwIfAborted();
    if([lightmaps,visibility,level,collision,navigation].some(data=>data.sourceBspSha256!==DUST2_BSP_SHA256)||navigation.sourceNavSha256!==level.sourceNavSha256)throw Error('Dust2 data layers do not share one BSP/NAV');
    if(triangleCount(world.scene)!==manifest.worldTriangles||triangleCount(props.scene)!==manifest.propTriangles)throw Error('Dust2 geometry counts differ');
    // Keep original Texture identity before VHV/sky/batch owners borrow it;
    // the same live owner later toggles its authored mip chain for fixed-frame A/B.
    const propMips=await loadSourcePropMips(props,{baseURL:options.propMipsBaseURL,signal:options.signal,enabled:options.enableOriginalPropMips!==false});
    cleanup.push(propMips.dispose);
    const worldLayers=options.enableWorldLayers!==false?await loadSourceWorldLayers(world,{baseURL:options.worldLayersBaseURL,
      signal:options.signal,maxTextureSize:options.propLighting?.maxTextureSize??8192}):null;
    if(worldLayers)cleanup.push(worldLayers.dispose);
    const hdr=applySourceWorldLightmaps(world.scene,lightmaps,atlas.data,worldLayers?.decorateMaterial);cleanup.push(hdr.dispose);
    if(worldLayers&&worldLayers.audit.decorated!==85)throw Error('Original world shader material coverage differs');
    const propLighting=options.propLighting?await loadSourcePropLighting(props,{baseURL:options.propLighting.baseURL??new URL('vhv/remap/',manifestURL).href,
      maxTextureSize:options.propLighting.maxTextureSize,enablePlainUnbumped:options.propLighting.enablePlainUnbumped,enableDecalMultiply:options.propLighting.enableDecalMultiply,enableTintMask:options.propLighting.enableTintMask,enableTintDecal:options.propLighting.enableTintDecal,enableStructuralTint:options.propLighting.enableStructuralTint,signal:options.signal}):null;
    if(propLighting)cleanup.push(propLighting.dispose);
    // Original R5 branches keep their own untouched resources and counts.
    // This independent leaf owner is released first, before R5 and the GLTF.
    const foliage=options.propLighting&&options.propLighting.enableFoliage!==false?await loadSourceFoliage(props,{
      enabled:true,baseURL:options.propLighting.foliageBaseURL??new URL('vhv/foliage/',manifestURL).href,
      state:{timeSeconds:0,windSourceXY:[0,0]},maxTextureSize:options.propLighting.maxTextureSize,signal:options.signal}):null;
    if(foliage)cleanup.push(foliage.dispose);
    const foliageMeshes=foliage&&'meshes'in foliage.audit?Number(foliage.audit.meshes):0;
    if(foliage&&foliageMeshes!==70)throw Error('Dust2 foliage owner coverage differs');
    // Bind before the sky pass clones props so its 48 olive meshes borrow the
    // same exact instance material and current wind, without a second owner.
    const olive=options.propLighting?.enableOlive?await loadSourceOlive(props,{
      enabled:true,csm:false,baseURL:options.propLighting.oliveBaseURL??new URL('vhv/olive-foliage/',manifestURL).href,
      state:{timeSeconds:0,windSourceXY:[0,0]},maxTextureSize:options.propLighting.maxTextureSize,signal:options.signal}):null;
    if(olive)cleanup.push(olive.dispose);
    const oliveMeshes=olive&&'meshes'in olive.audit?Number(olive.audit.meshes):0;
    if(olive&&oliveMeshes!==64)throw Error('Dust2 olive owner coverage differs');
    const wind=foliage||olive||options.enableDetails!==false?createSourceMapWind(state=>{foliage?.setState(state);olive?.setState(state);}):null;
    if(wind)cleanup.push(wind.dispose);
    options.signal?.throwIfAborted();
    // The two-texture sky material draws the product of its own two textures, so its second
    // texture is staged beside this map's other data and verified here before the sky owner
    // samples it (game/source-sky-cloud-loader.ts). A descriptor that declares one and a
    // manifest that cannot serve it is a failure, not a silent one-texture fallback.
    const cloudRule=skyData?.unlitMaterials.find(rule=>rule.second!==null)?.second??null;
    const cloudLayer=cloudRule?await loadSourceSkyCloudLayer({rule:cloudRule,signal:options.signal,
      read:async()=>new Uint8Array((await bytes('skyTexture2')).data)}):null;
    if(cloudLayer)cleanup.push(cloudLayer.dispose);
    const sky=skyData?createSourceSkyRender({world:world.scene,props:props.scene,sky:prepareSourceSky(skyData,visibility),
      secondTextures:cloudLayer&&cloudRule?[{file:cloudRule.file,texture:cloudLayer.texture}]:[],
      // The two-texture material's program ends with `rgb * cLightScale`, and the scale is the
      // map's own `light_environment._lightscaleHDR`, not a renderer choice
      // (scripts/probe-source-environment.py -> game/source-environment.ts).
      lightScale:SOURCE_DUST2_ENVIRONMENT.light.lightScaleHDR}):null;
    if(sky)cleanup.push(sky.dispose);
    // Merge the borrowed sky backdrop into one draw call per original material
    // state. Runs while the GLTF CPU buffers still exist (baking reads them),
    // borrows the exact VHV/olive bindings and shared wind the owners installed,
    // and must be disposed before the sky renderer and the shading owners.
    const skyBatch=sky&&options.enableSkyBatch!==false?createSourceSkyBatch({scene:sky.scene,sourceMeshes:sky.meshOrigins,
      vhv:propLighting?.batch??null,olive:olive?.batch??null}):null;
    if(skyBatch)cleanup.push(skyBatch.dispose);
    // Merge the R5-owned static props into one draw call per original material
    // state after the sky pass borrowed their instances, and before visibility
    // anchors are captured. Sky-excluded props keep their own anchors and PVS.
    const propBatch=propLighting?.batch?.lookup&&options.enablePropBatch!==false?createSourcePropBatch(props.scene,propLighting.batch,{skipPropIds:sky?.excludedStaticPropIds}):null;
    if(propBatch)cleanup.push(propBatch.dispose);
    // Props no VHV branch owns keep plain glTF materials; merging them by
    // material instance removes the remaining per-prop draw calls without
    // touching any shader-owned (VHV/foliage/olive/tint) material.
    const plainBatch=options.enablePropBatch!==false&&options.enablePlainPropBatch!==false?createSourcePlainPropBatch(props.scene,{skipPropIds:sky?.excludedStaticPropIds}):null;
    if(plainBatch)cleanup.push(plainBatch.dispose);
    // World (BSP) meshes merge by material state after the sky pass borrowed
    // their geometry; PVS selects contiguous original face index spans before
    // GPU submission. Created after sky, before PVS anchors and the
    // CPU vertex release (merging still reads the glTF attributes).
    const worldBatch=options.enableWorldBatch!==false?createSourceWorldBatch(world.scene,{excludedFaceIds:sky?.excludedWorldFaceIds??[]}):null;
    if(worldBatch)cleanup.push(worldBatch.dispose);
    const overlays=options.enableDetails!==false?await loadSourceOverlays({
      baseURL:options.detailsBaseURL?new URL('overlays/',options.detailsBaseURL).href:undefined,
      signal:options.signal,maxTextureSize:options.propLighting?.maxTextureSize??8192,
      skyFaceIds:sky?.excludedWorldFaceIds,createHDRMaterial:hdr.createMaterial}):null;
    if(overlays){cleanup.push(overlays.dispose);sky?.scene.add(overlays.sky);}
    const pvs=createSourceVisibilityPreview({world:world.scene,props:props.scene,data:visibility,
      excludeWorldFaceIds:sky?.excludedWorldFaceIds,excludeStaticPropIds:sky?.excludedStaticPropIds,
      worldMeshFilter:mesh=>!mesh.userData.sourceWorldBatch,
      onStaticProps:mask=>{propBatch?.setVisibleProps(mask);plainBatch?.setVisibleProps(mask);},
      onWorldFaces:(mask,firstFace)=>{worldBatch?.setVisibleFaces(mask,firstFace);overlays?.setVisibleFaces(mask,firstFace);}});cleanup.push(pvs.dispose);
    if(!pvs.index.valid||pvs.index.allStaticPropIds.length!==3158)throw Error('Dust2 original visibility data is incomplete');
    const ropes=options.enableDetails!==false?await loadSourceRopesRender({
      baseURL:options.detailsBaseURL?new URL('ropes/',options.detailsBaseURL).href:undefined,
      signal:options.signal,visibility:pvs.index,skyLeafIds:skyData?.skyLeafIds}):null;
    if(ropes){cleanup.push(ropes.dispose);sky?.scene.add(ropes.sky);}
    const cpuRelease=releaseSourceGLTFCPUBuffers(world,props);
    const root=new T.Group();root.name='Dust2_Source12426148';root.add(world.scene,props.scene);if(overlays)root.add(overlays.world);if(ropes)root.add(ropes.world);cleanup.push(()=>root.removeFromParent());
    const stats={id:manifest.id,sourceBspSha256:DUST2_BSP_SHA256,simulationVersion:sourceSimulationVersion(manifest.files),worldTriangles:manifest.worldTriangles,propTriangles:manifest.propTriangles,
      files:manifest.files,hashVerified:verified,loadMilliseconds:performance.now()-started,...sourceMapCapabilities(manifest.limitations,worldLayers?.audit??null),
      details:{overlays:overlays?.audit??null,ropes:ropes?.audit??null},worldLayers:worldLayers?.audit??null,sky:sky?.stats??null,foliage:foliage?.audit??null,olive:olive?.audit??null,wind:wind?.audit??null,
      propBatch:propBatch?.audit??null,
      propMips:propMips.audit,
      plainPropBatch:plainBatch?.audit??null,
      worldBatch:worldBatch?.audit??null,
      skyBatch:skyBatch?.audit??null,
      propLighting:propLighting?{...propLighting.audit,totalAppliedMeshes:propLighting.audit.appliedMeshes+foliageMeshes+oliveMeshes,
        verification:{...propLighting.audit.verification,skipped:propLighting.audit.verification.skipped.length}}:null,
      cpuRelease};
    return {root,world,props,details:{overlays,ropes},
      setOriginalPropMips:(enabled:boolean)=>{if(disposed)throw Error('Source map owner disposed');propMips.setEnabled(enabled);},
      updateDetails:(camera:T.PerspectiveCamera,_timeSeconds?:number)=>{if(disposed)throw Error('Source map owner disposed');overlays?.update(camera.position,sky?.camera.position);ropes?.update(camera);},level,collision,navigation,stats,sky,updateSky:(camera:T.PerspectiveCamera,timeSeconds?:number)=>sky?.update(camera,timeSeconds),lightmap:{width:hdr.width,height:hdr.height,samples:hdr.samples,materials:hdr.materials},
      cpuReleaseProbe(){let freed=0,kept=0;for(const gltf of [world,props])
        gltf.scene.traverse(object=>{const mesh=object as T.Mesh;if(!mesh.isMesh)return;
          for(const attribute of Object.values(mesh.geometry.attributes))
            if(attribute instanceof T.BufferAttribute)attribute.array===null?freed++:kept++;
          if(mesh.geometry.index)mesh.geometry.index.array===null?freed++:kept++;});
        return {freed,kept};},
      updateWind:(levelTime:number,epoch:string)=>{if(disposed)throw Error('Source map owner disposed');const frame=wind?.update(levelTime,epoch)??null;
        if(frame)ropes?.setWind(frame.currentWind,frame.levelTime,frame.epoch);return frame;},
      windSnapshot:()=>wind?.snapshot()??null,
      updateVisibility:(camera:T.Vector3,enabled=true)=>pvs.update(camera,enabled),dispose};
  }catch(error){dispose();throw error;}
}
