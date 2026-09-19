import * as T from 'three';
import {sourceSha256} from './source-sha256';
import {SOURCE_ENVIRONMENT_PROBES_MANIFEST_SHA256} from './source-environment-probes-data';
import {createSourceMaterialEnvironment,setSourceMaterialEnvironment,type SourceEnvmapParameters} from './source-material-environment';
import {attachSourceAmbientCube,setSourceAmbientCube} from './source-ambient-cube';

type File={path:string;bytes:number;sha256:string};
type Probe={id:string;sourcePosition:[number,number,number];cube:string;width:number;mipCount:number};
type Manifest={format:'source-environment-probes-v1';sourceApp:740;build:12426148;metresPerSourceUnit:number;
  sourceBSP:{sha256:string};files:File[];probes:Probe[]};
export type SourceAmbientSample={leaf:number;resolvedLeaf:number;sampleCount:number;faces:number[][]};
export const SOURCE_WORLD_TO_SOURCE=new T.Matrix3().set(1,0,0,0,0,-1,0,1,0);

/** VTF7.5 cubemap, original RGBA16161616F including all authored mip levels.
 * Keeps raw half-float words; no PNG/sRGB conversion or generated mipmaps. */
export function decodeSourceHDRCube(bytes:Uint8Array){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<80||v.getUint32(0,true)!==0x00465456||v.getUint32(4,true)!==7||v.getUint32(8,true)!==5
    ||v.getInt32(52,true)!==24||!(v.getUint32(20,true)&0x4000)||v.getUint16(24,true)!==1)throw Error('Unsupported original HDR cube VTF');
  const width=v.getUint16(16,true),height=v.getUint16(18,true),mips=bytes[56],resources=v.getUint32(68,true);
  if(!width||width!==height||mips!==Math.log2(width)+1||80+resources*8>bytes.length)throw Error('Invalid original HDR cube layout');
  let offset=-1;
  for(let i=0;i<resources;i++)if(v.getUint32(80+i*8,true)===0x30)offset=v.getUint32(84+i*8,true);
  if(offset<80+resources*8)throw Error('Original HDR cube image resource missing');
  const levels:T.DataTexture[][]=Array.from({length:mips},()=>[]);
  for(let mip=mips-1;mip>=0;mip--){
    const size=Math.max(1,width>>mip),length=size*size*8;
    for(let face=0;face<6;face++){
      if(offset+length>bytes.length)throw Error('Truncated original HDR cube');
      const pixels=new Uint16Array(bytes.buffer.slice(bytes.byteOffset+offset,bytes.byteOffset+offset+length));
      // A NaN/Inf half-float in original data must never poison a frame.
      if(pixels.some(word=>(word&0x7c00)===0x7c00))throw Error('Invalid HDR cube component');
      const texture=new T.DataTexture(pixels,size,size,T.RGBAFormat,T.HalfFloatType);
      texture.colorSpace=T.LinearSRGBColorSpace;texture.flipY=false;texture.generateMipmaps=false;
      levels[mip].push(texture);offset+=length;
    }
  }
  if(offset!==bytes.length)throw Error('Unexpected original HDR cube payload');
  const cube=new T.CubeTexture(levels[0]);cube.type=T.HalfFloatType;cube.format=T.RGBAFormat;
  cube.colorSpace=T.LinearSRGBColorSpace;cube.flipY=false;cube.generateMipmaps=false;
  cube.magFilter=T.LinearFilter;cube.minFilter=T.LinearMipmapLinearFilter;
  cube.mipmaps=levels.slice(1).map(image=>({image})) as unknown as T.CubeTexture['mipmaps'];
  cube.needsUpdate=true;cube.userData={sourceFormat:'RGBA16161616F',originalMipCount:mips,originalFaces:true};
  return {cube,dispose(){cube.dispose();levels.flat().forEach(texture=>texture.dispose());}};
}

/** Uses original BSP node planes, leaf sample indices (including reference
 * leaves), and the pinned VRAD reconstruction weight 1/(distance^2+1). */
export function createSourceAmbientSampler(files:Map<string,Uint8Array>){
  function view(name:string,stride:number){const b=files.get(name);if(!b||b.length%stride)throw Error('Invalid original ambient lump '+name);return new DataView(b.buffer,b.byteOffset,b.byteLength);}
  const planes=view('planes.bin',20),nodes=view('nodes.bin',32),leaves=view('leaves.bin',32),index=view('ambient-index-hdr.bin',4),samples=view('ambient-lighting-hdr.bin',28);
  const leafCount=leaves.byteLength/32;if(index.byteLength/4!==leafCount)throw Error('Ambient leaf index mismatch');
  const position=new T.Vector3();
  function sampleSourcePosition(p:Readonly<T.Vector3>):SourceAmbientSample|null{
    let node=0,steps=0;
    while(node>=0){
      if(++steps>nodes.byteLength/32||node*32>=nodes.byteLength)throw Error('Invalid original BSP ambient tree');
      const o=node*32,plane=nodes.getInt32(o,true)*20;
      if(plane<0||plane+20>planes.byteLength)throw Error('Invalid original ambient plane');
      const d=p.x*planes.getFloat32(plane,true)+p.y*planes.getFloat32(plane+4,true)+p.z*planes.getFloat32(plane+8,true)-planes.getFloat32(plane+12,true);
      node=nodes.getInt32(o+(d>=0?4:8),true);
    }
    const leaf=-1-node;if(leaf<0||leaf>=leafCount)throw Error('Invalid original ambient leaf');
    let resolved=leaf,count=index.getUint16(leaf*4,true),first=index.getUint16(leaf*4+2,true);steps=0;
    while(!count){
      if(first===resolved&&(leaves.getInt32(resolved*32,true)&1))return null;
      if(++steps>leafCount||first>=leafCount)throw Error('Invalid original ambient reference leaf');
      resolved=first;count=index.getUint16(resolved*4,true);first=index.getUint16(resolved*4+2,true);
    }
    if((first+count)*28>samples.byteLength)throw Error('Invalid original ambient sample range');
    const faces=Array.from({length:6},()=>[0,0,0]);let total=0;
    for(let i=first;i<first+count;i++){
      const o=i*28;let dist=0;
      for(let axis=0;axis<3;axis++){
        const min=leaves.getInt16(resolved*32+8+axis*2,true),max=leaves.getInt16(resolved*32+14+axis*2,true);
        const sample=min+(max-min)*samples.getUint8(o+24+axis)/255;
        const delta=sample-p.getComponent(axis);dist+=delta*delta;
      }
      const weight=1/(dist+1);total+=weight;
      for(let f=0;f<6;f++){
        const scale=2**samples.getInt8(o+f*4+3)*weight;
        for(let c=0;c<3;c++)faces[f][c]+=samples.getUint8(o+f*4+c)*scale;
      }
    }
    faces.forEach(face=>face.forEach((c,i)=>face[i]=c/total));
    return {leaf,resolvedLeaf:resolved,sampleCount:count,faces};
  }
  return {sampleSourcePosition,sampleWorldPosition(world:Readonly<T.Vector3>){position.copy(world).applyMatrix3(SOURCE_WORLD_TO_SOURCE).multiplyScalar(1/.0254);return sampleSourcePosition(position);}};
}

export type SourceProbeSceneOptions={
  /** First-person gunScene supplies the gameplay camera. World scenes omit it. */
  worldCamera?:()=>T.Camera;
  /** Explicit lighting origin in metres when a model supplies one. */
  lightingPosition?:(mesh:T.Mesh,camera:T.Camera)=>T.Vector3;
  eligible?:(mesh:T.Mesh,material:T.Material)=>boolean;
};
export async function loadSourceEnvCubemaps(baseURL='/source/csgo-12426148/environment-probes',signal?:AbortSignal){
  const prefix=baseURL.replace(/\/$/,'');
  async function bytes(path:string){const r=await fetch(prefix+'/'+path,{signal});if(!r.ok)throw Error('Source environment HTTP '+r.status);return new Uint8Array(await r.arrayBuffer());}
  const raw=await bytes('manifest.json');if(await sourceSha256(raw,signal)!==SOURCE_ENVIRONMENT_PROBES_MANIFEST_SHA256)throw Error('Original environment manifest SHA mismatch');
  const manifest=JSON.parse(new TextDecoder().decode(raw)) as Manifest;
  if(manifest.format!=='source-environment-probes-v1'||manifest.sourceApp!==740||manifest.build!==12426148||manifest.metresPerSourceUnit!==.0254)throw Error('Original environment build mismatch');
  const files=new Map<string,Uint8Array>();
  await Promise.all(manifest.files.map(async file=>{if(file.path.includes('..')||file.path.startsWith('/')||file.path.includes('\\'))throw Error('Unsafe original probe path');const b=await bytes(file.path);if(b.length!==file.bytes||await sourceSha256(b,signal)!==file.sha256)throw Error('Source environment SHA mismatch '+file.path);files.set(file.path,b);}));
  const cubes=new Map<string,ReturnType<typeof decodeSourceHDRCube>>();
  try{for(const probe of manifest.probes)cubes.set(probe.id,decodeSourceHDRCube(files.get(probe.cube)!));}
  catch(error){cubes.forEach(value=>value.dispose());throw error;}
  const ambient=createSourceAmbientSampler(files),bindings=new Set<()=>void>();
  let disposed=false;
  const sourcePosition=new T.Vector3(),viewToSource=new T.Matrix3(),rotation=new T.Matrix3(),center=new T.Vector3();
  function nearest(world:T.Vector3){
    sourcePosition.copy(world).applyMatrix3(SOURCE_WORLD_TO_SOURCE).multiplyScalar(1/.0254);
    let best=manifest.probes[0],distance=Infinity;
    for(const probe of manifest.probes){const p=probe.sourcePosition,d=(p[0]-sourcePosition.x)**2+(p[1]-sourcePosition.y)**2+(p[2]-sourcePosition.z)**2;if(d<distance){best=probe;distance=d;}}
    return best;
  }
  function bindScene(scene:T.Scene,options:SourceProbeSceneOptions={}){
    if(disposed)throw Error('Original probe owner disposed');
    type Entry={base:T.Material;view:T.Material;release:()=>void};
    type Lighting={position:T.Vector3;probe:Probe;light:SourceAmbientSample|null};
    const views=new Map<T.Mesh,Map<T.Material,Entry>>(),lighting=new Map<T.Mesh,Lighting>();
    const objects=new Set<T.Object3D>(),meshes=new Set<T.Mesh>();
    const counters={renderPasses:0,skippedOverridePasses:0,meshChecks:0,ambientQueries:0,createdViews:0,releasedViews:0};
    let restores:{mesh:T.Mesh;base:T.Material|T.Material[];applied:T.Material|T.Material[]}[]=[];
    const before=scene.onBeforeRender,after=scene.onAfterRender;
    const restore=()=>{for(const row of restores)if(row.mesh.material===row.applied)row.mesh.material=row.base;restores=[];};
    // Scene graph changes are indexed once, not traversed again for every shadow,
    // opaque and particle pass. Replacements on an existing mesh are checked live.
    const added=(event:{child:T.Object3D})=>watch(event.child);
    const removed=(event:{child:T.Object3D})=>unwatch(event.child);
    function watch(object:T.Object3D){
      if(objects.has(object))return;objects.add(object);
      if(object instanceof T.Mesh)meshes.add(object);
      object.addEventListener('childadded',added);object.addEventListener('childremoved',removed);
      for(const child of object.children)watch(child);
    }
    function unwatch(object:T.Object3D){
      if(!objects.delete(object))return;
      object.removeEventListener('childadded',added);object.removeEventListener('childremoved',removed);
      if(object instanceof T.Mesh){
        meshes.delete(object);lighting.delete(object);
        views.get(object)?.forEach(entry=>entry.release());views.delete(object);
      }
      for(const child of object.children)unwatch(child);
    }
    watch(scene);
    scene.onBeforeRender=function(...args){
      const camera=args[2];
      before.apply(this,args);restore();counters.renderPasses++;
      // A depth/silhouette override replaces the Phong shader entirely. It must
      // neither sample probes nor evict material views used by the colour pass.
      if(scene.overrideMaterial||!scene.visible){counters.skippedOverridePasses++;return;}
      const worldCamera=options.worldCamera?.()??camera;
      if(worldCamera!==camera)worldCamera.updateWorldMatrix(true,false);
      rotation.setFromMatrix4(worldCamera.matrixWorld);viewToSource.copy(SOURCE_WORLD_TO_SOURCE).multiply(rotation);
      for(const mesh of meshes){
        counters.meshChecks++;
        if(!mesh.visible||!mesh.layers.test(camera.layers))continue;
        const original=mesh.material;
        const eligible=(base:T.Material)=>base.visible&&(options.eligible?.(mesh,base)??(base instanceof T.MeshPhongMaterial&&base.userData.sourceShader==='VertexLitGeneric'));
        if(!(Array.isArray(original)?original.some(eligible):eligible(original)))continue;
        // Object3D layers do not propagate, but ancestor visibility does.
        let ancestor:T.Object3D|null=mesh.parent,visible=true;
        while(ancestor){if(!ancestor.visible){visible=false;break;}ancestor=ancestor.parent;}
        if(!visible)continue;
        // Three updates matrices before Scene.onBeforeRender. Reading matrixWorld
        // avoids recursively updating every actor's parent chain for each surface.
        const world=options.lightingPosition?.(mesh,worldCamera)??center.setFromMatrixPosition(options.worldCamera?worldCamera.matrixWorld:mesh.matrixWorld);
        let sample=lighting.get(mesh);
        if(!sample||!sample.position.equals(world)){
          sample={position:world.clone(),probe:nearest(world),light:ambient.sampleWorldPosition(world)};
          lighting.set(mesh,sample);counters.ambientQueries++;
        }
        const {probe,light}=sample;
        const replace=(base:T.Material)=>{
          if(!eligible(base))return base;
          let byMaterial=views.get(mesh);if(!byMaterial){byMaterial=new Map();views.set(mesh,byMaterial);}
          let entry=byMaterial.get(base);
          if(!entry){
            const view=base.clone();view.onBeforeCompile=base.onBeforeCompile;view.customProgramCacheKey=base.customProgramCacheKey.bind(base);
            const env=base.userData.sourceEnvironment?.parameters as SourceEnvmapParameters|undefined;
            if(env){const uniforms=createSourceMaterialEnvironment(view,env),compile=view.onBeforeCompile;view.onBeforeCompile=function(shader,r){compile.call(this,shader,r);Object.assign(shader.uniforms,uniforms);};}
            attachSourceAmbientCube(view);
            const release=()=>{base.removeEventListener('dispose',release);view.dispose();byMaterial!.delete(base);counters.releasedViews++;};
            base.addEventListener('dispose',release);entry={base,view,release};byMaterial.set(base,entry);counters.createdViews++;
          }
          setSourceMaterialEnvironment(entry.view,{cube:cubes.get(probe.id)!.cube,viewToSource,probeId:probe.id,scale:1});
          setSourceAmbientCube(entry.view,light?.faces??null,viewToSource);
          entry.view.userData.sourceProbeBinding={probeId:probe.id,leaf:light?.leaf??null,resolvedLeaf:light?.resolvedLeaf??null,samples:light?.sampleCount??0};
          return entry.view;
        };
        const applied=Array.isArray(original)?original.map(replace):replace(original);
        if(applied!==original){mesh.material=applied;restores.push({mesh,base:original,applied});}
      }
    };
    scene.onAfterRender=function(...args){restore();after.apply(this,args);};
    let released=false;
    const release=()=>{if(released)return;released=true;restore();scene.onBeforeRender=before;scene.onAfterRender=after;unwatch(scene);views.clear();lighting.clear();bindings.delete(release);};bindings.add(release);
    return {dispose:release,audit:()=>({materialViews:[...views.values()].reduce((n,rows)=>n+rows.size,0),activeDrawSwaps:restores.length,probeCount:cubes.size,indexedMeshes:meshes.size,...counters})};
  }

  return {bindScene,ambient,nearest,manifest,audit:()=>({originalFilesVerified:files.size,probeCount:cubes.size,originalCubeMips:true,originalClientOutputCompared:false}),
    dispose(){if(disposed)return;disposed=true;[...bindings].forEach(release=>release());cubes.forEach(value=>value.dispose());cubes.clear();}};
}
