import * as T from 'three';
import type {SourcePropLightingBinding} from './source-prop-lighting';
import {sourcePropOliveCandidate,validateSourceTreeBinding,validateSourceTreeState,attachSourcePropOlive,type SourceTreeState,type SourceTreeBinding} from './source-prop-olive';
export type SourceOliveBinding=SourcePropLightingBinding&SourceTreeBinding;
export interface SourceOliveData {bindings:SourceOliveBinding[];remap:Uint32Array;lighting:Uint8Array;state:SourceTreeState;csm:false;maxTextureSize?:number;maxBytes?:number}
const owners=new WeakSet<T.Mesh>();
const integer=(n:number)=>Number.isSafeInteger(n)&&n>=0;
/** Independent opt-in owner. At most 64 original olive meshes, compact
 * exact remap/VHV bytes, two lookup textures. No R5 loader/owner contract edits. */
export function applySourceOliveLighting(root:T.Object3D,data:SourceOliveData){
 if(data.csm!==false)throw Error('Original olive candidate requires explicit no-CSM branch');
 validateSourceTreeState(data.state);
 const max=data.maxTextureSize??8192,budget=data.maxBytes??16*1024*1024;
 if(!integer(max)||max<1||max>32768||!integer(budget)||data.bindings.length>64)throw Error('Invalid foliage resource budget');
 if(!(data.remap instanceof Uint32Array)||!data.remap.length||!(data.lighting instanceof Uint8Array)||!data.lighting.length||data.lighting.length%12)throw Error('Invalid foliage VHV bytes');
 const width=Math.min(2048,max),mapHeight=Math.ceil(data.remap.length/width),lightHeight=Math.ceil(data.lighting.length/4/width),bytes=width*(mapHeight+lightHeight)*4;
 if(Math.max(mapHeight,lightHeight)>max||bytes>budget)throw Error('Foliage lookup budget exceeded');
 const members=new Set<T.Object3D>();root.traverse(o=>members.add(o));const seen=new Set<T.Mesh>();
 for(const b of data.bindings){
  const m=b.mesh;
  if(!m?.isMesh||!members.has(m)||seen.has(m)||owners.has(m))throw Error('Duplicate or foreign foliage owner');seen.add(m);
  if(!sourcePropOliveCandidate(b.source)||Array.isArray(m.material)||m.material.name!==(b.materialName??b.source.source))throw Error('Original foliage material identity differs');
  validateSourceTreeBinding(b,m.material);
  const material=m.material as T.MeshStandardMaterial;
  if(!material.map||material.map.channel!==0||material.color.r!==1||material.color.g!==1||material.color.b!==1)throw Error('Original foliage base color contract differs');
  if(![b.mappingOffset,b.lightingVertexOffset,b.lightingVertexCount,b.vertexCount,b.indexCount].every(integer)||!b.vertexCount||!b.lightingVertexCount||
   b.mappingOffset+b.vertexCount>data.remap.length||(b.lightingVertexOffset+b.lightingVertexCount)*12>data.lighting.length)throw Error('Invalid foliage lookup range');
  const g=m.geometry;if(g.attributes.position?.count!==b.vertexCount||g.attributes.uv?.count!==b.vertexCount||g.index?.count!==b.indexCount)throw Error('Original foliage geometry counts differ');
  for(let i=0;i<b.indexCount;i++){const id=g.index!.getX(i);if(!integer(id)||id>=b.vertexCount||data.remap[b.mappingOffset+id]>=b.lightingVertexCount)throw Error('Invalid referenced foliage remap');}
 }
 const materials:{mesh:T.Mesh;original:T.Material;replacement:T.MeshBasicMaterial;frustum:boolean}[]=[];
 let map:T.DataTexture|undefined,light:T.DataTexture|undefined,disposed=false;
 const timeWind=new T.Vector4(0,data.state.timeSeconds,...data.state.windSourceXY as [number,number]);
 const setState=(state:SourceTreeState)=>{if(disposed)throw Error('Foliage owner disposed');validateSourceTreeState(state);timeWind.set(0,state.timeSeconds,state.windSourceXY[0],state.windSourceXY[1]);};
 const dispose=()=>{if(disposed)return;disposed=true;for(const item of materials){if(item.mesh.material===item.replacement)item.mesh.material=item.original;item.mesh.frustumCulled=item.frustum;owners.delete(item.mesh);item.replacement.dispose();}map?.dispose();light?.dispose();};
 try{
  const mapData=new Uint32Array(width*mapHeight);mapData.set(data.remap);map=new T.DataTexture(mapData,width,mapHeight,T.RedIntegerFormat,T.UnsignedIntType);map.internalFormat='R32UI';
  const lightData=new Uint8Array(width*lightHeight*4);lightData.set(data.lighting);light=new T.DataTexture(lightData,width,lightHeight,T.RGBAFormat,T.UnsignedByteType);
  for(const texture of [map,light]){texture.colorSpace=T.NoColorSpace;texture.flipY=false;texture.generateMipmaps=false;texture.minFilter=texture.magFilter=T.NearestFilter;texture.unpackAlignment=1;texture.needsUpdate=true;}
  for(const b of data.bindings){
   const original=b.mesh.material as T.MeshStandardMaterial;
   const m=new T.MeshBasicMaterial({map:original.map,color:original.color,side:original.side,alphaTest:original.alphaTest,opacity:original.opacity,transparent:original.transparent,depthWrite:original.depthWrite,depthTest:original.depthTest,toneMapped:original.toneMapped,fog:original.fog});
   materials.push({mesh:b.mesh,original,replacement:m,frustum:b.mesh.frustumCulled});m.name=original.name+' / original olive no-CSM + VHV';
   m.onBeforeCompile=shader=>{
    const common='#include <common>',begin='#include <begin_vertex>',fragment='#include <map_fragment>';
    if(!shader.vertexShader.includes(common)||!shader.vertexShader.includes(begin)||!shader.fragmentShader.includes(fragment))throw Error('Three leaf shader contract changed');
    Object.assign(shader.uniforms,{sourceLeafRemap:{value:map},sourceLeafLighting:{value:light},sourceLeafWidth:{value:width},sourceLeafMappingOffset:{value:b.mappingOffset},sourceLeafLightingOffset:{value:b.lightingVertexOffset}});
    shader.vertexShader=shader.vertexShader.replace(common,common+`\nuniform highp usampler2D sourceLeafRemap;
     uniform highp sampler2D sourceLeafLighting;uniform int sourceLeafWidth,sourceLeafMappingOffset,sourceLeafLightingOffset;
     varying vec3 vSourceLeafLight;ivec2 sourceLeafPixel(int address){return ivec2(address%sourceLeafWidth,address/sourceLeafWidth);}`)
     .replace(begin,begin+`\nuint sourceLeafId=texelFetch(sourceLeafRemap,sourceLeafPixel(sourceLeafMappingOffset+gl_VertexID),0).r;
      vec3 sourceLeafEncoded=texelFetch(sourceLeafLighting,sourceLeafPixel((sourceLeafLightingOffset+int(sourceLeafId))*3),0).bgr;
      vSourceLeafLight=pow(sourceLeafEncoded*2.0,vec3(2.200000047683716));`);
    shader.fragmentShader=shader.fragmentShader.replace(common,common+'\nvarying vec3 vSourceLeafLight;').replace(fragment,fragment+'\ndiffuseColor.rgb*=vSourceLeafLight;');
   };
   m.customProgramCacheKey=()=> 'source-olive-no-csm-vhv-r1';attachSourcePropOlive(m,b,timeWind);
  }
  for(const item of materials){owners.add(item.mesh);item.mesh.material=item.replacement;item.mesh.frustumCulled=false;}
  return {audit:{meshes:materials.length,triangles:data.bindings.reduce((sum,b)=>sum+b.indexCount/3,0),textures:2,lookupBytes:bytes,
    geometryModified:false,baseColorModified:false,alphaTest:.3,doubleSided:true,frustumCullingTemporarilyDisabled:true,
    branch:'original VS128 treesway olive + first COLOR1 diffuse + explicit no-CSM PS0; vertexcolorpower unused',csm:false,vertexColorPower:0.7,vertexColorPowerApplied:false,envWindStateSimulation:false},
   // Borrowed by the sky-pass batching adapter; its merged materials are
   // disposed before this owner releases the shared lighting texture.
   lookup:{lighting:light!,width},timeWind,dispose,setState};
 }catch(error){dispose();throw error;}
}
