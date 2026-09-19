import {sourcePropFoliageCandidate} from './source-prop-foliage';
import * as T from 'three';
import {validateSourcePropDecalUv,type SourcePropDecalUvBinding} from './source-prop-decal-uv';
import {sourcePropDecalMode,validateSourcePropDecal,attachSourcePropDecal} from './source-prop-decal';
import {sourcePropTintCandidate,validateSourcePropTint,attachSourcePropTint} from './source-prop-tint';
import {sourcePropTintDecalCandidate,validateSourcePropTintDecal,attachSourcePropTintDecal,SOURCE_TINT_DECAL_ANCHOR} from './source-prop-tint-decal';

export interface SourcePropMaterialSource {
  source:string;shader:string;parameters:Record<string,unknown>;mapped?:string[];
}
export interface SourcePropLightingBinding {
  mesh:T.Mesh;source:SourcePropMaterialSource;materialName?:string;normalMap?:T.Texture;normalGreenInverted?:boolean;decalMap?:T.Texture;decalUv?:SourcePropDecalUvBinding;
  /** Offsets count uint32 remap entries / 12-byte VHV vertices, not bytes. */
  mappingOffset:number;vertexCount:number;indexCount:number;lightingVertexOffset:number;lightingVertexCount:number;
  tintMap?:T.Texture;instanceRGB?:readonly number[];
}
export interface SourcePropLightingData {
  bindings:SourcePropLightingBinding[];remap:Uint32Array;lighting:Uint8Array;
  /** Pass renderer.capabilities.maxTextureSize. The default is an explicit 8192 cap. */
  maxTextureSize?:number;maxBytes?:number;
  /** Separately reviewed first-COLOR1 baked term. R1 stays the default. */
  enablePlainUnbumped?:boolean;
  enableDecalMultiply?:boolean;
  /** Separately reviewed original green-mask and per-instance RGB. Off by default. */
  enableTintMask?:boolean;
  enableTintDecal?:boolean;
}
const owners=new WeakSet<T.Mesh>();
const plainParameters=new Set(['$basetexture','$bumpmap','$surfaceprop','$model','$notint','$nocull','$nodecal',
  '$alphatest','$alphatestreference','$allowalphatocoverage']);

/** Deliberately narrow original three-color bumped diffuse branch. Unreviewed
 * VMT features remain on their original material instead of being discarded. */
export function sourcePropBranch(source:SourcePropMaterialSource,enablePlainUnbumped=false,enableDecalMultiply=false,enableTintMask=false,enableTintDecal=false,enableFoliage=false){
  const reasons:string[]=[];
  if(enableFoliage&&sourcePropFoliageCandidate(source))return reasons;
  if(source.shader.toLowerCase()!=='vertexlitgeneric')reasons.push('shader '+source.shader);
  if(!source.parameters.$basetexture)reasons.push('missing $basetexture');
  if(!source.parameters.$bumpmap&&!enablePlainUnbumped)reasons.push('missing $bumpmap');
  const decal=enableDecalMultiply&&sourcePropDecalMode(source.parameters);
  const tint=enableTintMask&&sourcePropTintCandidate(source.parameters);
  const compound=enableTintDecal&&sourcePropTintDecalCandidate(source.parameters);
  for(const key of Object.keys(source.parameters))if(!plainParameters.has(key)&&!(decal&&['$decaltexture','$decalblendmode'].includes(key))&&!(tint&&key==='$tintmasktexture')&&!(compound&&['$tintmasktexture','$decaltexture','$decalblendmode'].includes(key)))reasons.push(key);
  return reasons;
}
type TexturedMaterial=T.Material & {map?:T.Texture|null;color?:T.Color};
const safeInteger=(n:number)=>Number.isSafeInteger(n)&&n>=0;

/** Installed App740 bump VS static0/dynamic4 + PS static4/dynamic80 evidence:
 * D3DCOLOR bytes are BGRA; pow(2*RGB,2.2) is evaluated at vertices, then three
 * interpolated linear colors are weighted by squared saturated bump-basis dots.
 * Alpha is not read by this verified PS branch. No exposure/color compensation.
 *
 * Uses WebGL2 gl_VertexID and two bounded shared textures; geometry, indices,
 * attributes, node TRS and borrowed source textures remain completely unchanged.
 * Exact remap and original instance identity must have been verified by caller.
 */
export function applySourcePropLighting(root:T.Object3D,data:SourcePropLightingData){
  const maximum=data.maxTextureSize??8192,budget=data.maxBytes??96*1024*1024;
  if(!Number.isInteger(maximum)||maximum<1||maximum>32768||!safeInteger(budget))throw Error('Invalid VHV texture budget');
  if(!(data.remap instanceof Uint32Array)||!data.remap.length||!(data.lighting instanceof Uint8Array)||
    !data.lighting.length||data.lighting.length%12)throw Error('Invalid original VHV binary layout');
  const width=Math.min(4096,maximum),mapHeight=Math.ceil(data.remap.length/width),lightHeight=Math.ceil(data.lighting.length/4/width);
  if(Math.max(mapHeight,lightHeight)>maximum)throw Error('VHV data exceeds texture dimensions');
  const bytes=width*(mapHeight+lightHeight)*4;
  if(bytes>budget)throw Error('VHV lookup texture memory budget exceeded');
  const members=new Set<T.Object3D>();root.traverse(object=>members.add(object));
  const seen=new Set<T.Mesh>(),selected:SourcePropLightingBinding[]=[],skipped:{mesh:string;material:string;reasons:string[]}[]=[];
  // Validate everything before resource allocation or scene mutation.
  for(const binding of data.bindings){
    const {mesh,source,normalMap,mappingOffset,vertexCount,indexCount,lightingVertexOffset,lightingVertexCount}=binding;
    if(!mesh?.isMesh||!members.has(mesh)||seen.has(mesh))throw Error('Duplicate or foreign VHV mesh binding');seen.add(mesh);
    if(owners.has(mesh))throw Error('VHV mesh already owned by an active lighting handle');
    if(Array.isArray(mesh.material)||mesh.material.name!==(binding.materialName??source.source))throw Error('Original VHV material identity differs');
    const reasons=sourcePropBranch(source,data.enablePlainUnbumped,data.enableDecalMultiply,data.enableTintMask,data.enableTintDecal);
    if(reasons.length){skipped.push({mesh:mesh.name,material:source.source,reasons});continue;}
    if(source.parameters.$decaltexture){validateSourcePropDecal(binding.decalMap);validateSourcePropDecalUv(binding.decalUv,vertexCount);}
    if(sourcePropTintDecalCandidate(source.parameters)&&data.enableTintDecal)validateSourcePropTintDecal(binding.tintMap,binding.decalMap,binding.decalUv,binding.instanceRGB,source.parameters,mesh.material,vertexCount);
    else if(source.parameters.$tintmasktexture)validateSourcePropTint(binding.tintMap,binding.instanceRGB,source.parameters,mesh.material);
    if(![mappingOffset,vertexCount,indexCount,lightingVertexOffset,lightingVertexCount].every(safeInteger)||
      !vertexCount||!lightingVertexCount||mappingOffset+vertexCount>data.remap.length||
      (lightingVertexOffset+lightingVertexCount)*12>data.lighting.length)throw Error('Invalid VHV mapping or lighting range');
    const geometry=mesh.geometry,index=geometry.index,original=mesh.material as TexturedMaterial;
    if(!index||index.count!==indexCount||geometry.attributes.position?.count!==vertexCount||geometry.attributes.uv?.count!==vertexCount)
      throw Error('Original VHV geometry counts differ');
    if(!original.map||original.map.channel!==0||(source.parameters.$bumpmap&&(!normalMap?.isTexture||normalMap.channel!==0||normalMap.colorSpace!==T.NoColorSpace)))
      throw Error('Original VHV base/normal texture contract differs');
    // Unreferenced sentinel entries never enter the vertex shader. Drawn invalid
    // source IDs must fail instead of indexing another prop's lighting payload.
    for(let i=0;i<index.count;i++){
      const vertex=index.getX(i),sourceId=data.remap[mappingOffset+vertex];
      if(!safeInteger(vertex)||vertex>=vertexCount||sourceId>=lightingVertexCount)
        throw Error('VHV referenced vertex has no original lighting identity');
    }
    selected.push(binding);
  }
  const materials:{mesh:T.Mesh;original:T.Material;replacement:T.MeshBasicMaterial}[]=[];
  let mapTexture:T.DataTexture|undefined,lightTexture:T.DataTexture|undefined,disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;
    for(const item of materials){if(item.mesh.material===item.replacement)item.mesh.material=item.original;owners.delete(item.mesh);item.replacement.dispose();}
    mapTexture?.dispose();lightTexture?.dispose();
  };
  const audit={appliedMeshes:0,materials:0,skipped,lookupBytes:0,textureWidth:width,mapHeight,lightHeight,
    geometryModified:false,sourceAlphaUsed:false,branch:'installed bump VS static0/dynamic4 + PS static4/dynamic80 diffuse',
    plainUnbumpedEnabled:!!data.enablePlainUnbumped,plainUnbumpedMeshes:0,
    decalMultiplyEnabled:!!data.enableDecalMultiply,decalMultiplyMeshes:0,
    tintMaskEnabled:!!data.enableTintMask,tintMaskMeshes:0,
    tintDecalEnabled:!!data.enableTintDecal,tintDecalMeshes:0,
    limitations:['Other VMT branches retain original materials','Original instance diffuse_modulation remains a separate layer',
      'Source dynamic lights, exposure and complete material pipeline remain separate']};
  if(!selected.length)return {audit,dispose};
  try{
    const mapPixels=new Uint32Array(width*mapHeight);mapPixels.set(data.remap);
    const lightPixels=new Uint8Array(width*lightHeight*4);lightPixels.set(data.lighting);
    mapTexture=new T.DataTexture(mapPixels,width,mapHeight,T.RedIntegerFormat,T.UnsignedIntType);mapTexture.internalFormat='R32UI';
    lightTexture=new T.DataTexture(lightPixels,width,lightHeight,T.RGBAFormat,T.UnsignedByteType);
    for(const texture of [mapTexture,lightTexture]){
      texture.colorSpace=T.NoColorSpace;texture.flipY=false;texture.generateMipmaps=false;
      texture.magFilter=texture.minFilter=T.NearestFilter;texture.unpackAlignment=1;texture.needsUpdate=true;
    }
    for(const binding of selected){
      const original=binding.mesh.material as TexturedMaterial,normal=binding.normalMap,bumped=!!binding.source.parameters.$bumpmap;
      const compound=!!data.enableTintDecal&&sourcePropTintDecalCandidate(binding.source.parameters);
      const material=new T.MeshBasicMaterial({map:original.map,color:original.color??0xffffff,side:original.side,
        alphaTest:original.alphaTest,opacity:original.opacity,transparent:original.transparent,depthWrite:original.depthWrite,
        depthTest:original.depthTest,toneMapped:original.toneMapped,fog:('fog' in original)?Boolean(original.fog):true});
      material.name=original.name+' / original VHV diffuse';
      material.alphaToCoverage=String(binding.source.parameters.$allowalphatocoverage??'0')==='1';
      const normalTransform=normal?(normal.matrixAutoUpdate?new T.Matrix3().setUvTransform(normal.offset.x,normal.offset.y,normal.repeat.x,normal.repeat.y,
        normal.rotation,normal.center.x,normal.center.y):normal.matrix.clone()):undefined;
      material.onBeforeCompile=shader=>{
        const vc='#include <common>',vb='#include <begin_vertex>',fc='#include <common>',fm='#include <map_fragment>';
        if(!shader.vertexShader.includes(vc)||!shader.vertexShader.includes(vb)||!shader.fragmentShader.includes(fc)||!shader.fragmentShader.includes(fm))
          throw Error('Three VHV shader contract changed');
        Object.assign(shader.uniforms,{sourceVhvRemap:{value:mapTexture},sourceVhvLighting:{value:lightTexture},sourceTextureWidth:{value:width},
          sourceMappingOffset:{value:binding.mappingOffset},sourceInstanceOffset:{value:binding.lightingVertexOffset}});
        if(bumped)Object.assign(shader.uniforms,{sourceNormalMap:{value:normal},sourceNormalTransform:{value:normalTransform},sourceNormalGreenSign:{value:binding.normalGreenInverted?-1:1}});
        shader.vertexShader=shader.vertexShader.replace(vc,vc+`
          uniform highp usampler2D sourceVhvRemap;
          uniform highp sampler2D sourceVhvLighting;
          uniform int sourceTextureWidth,sourceMappingOffset,sourceInstanceOffset;
          varying vec3 vSourceLight0;
          ${bumped?'uniform mat3 sourceNormalTransform; varying vec3 vSourceLight1,vSourceLight2; varying vec2 vSourceNormalUv;':''}
          ivec2 sourcePixel(int address){return ivec2(address%sourceTextureWidth,address/sourceTextureWidth);}
          vec3 sourceDecode(int address){
            vec4 encoded=texelFetch(sourceVhvLighting,sourcePixel(address),0);
            return pow(encoded.bgr*2.0,vec3(2.200000047683716));
          }
        `).replace(vb,vb+`
          uint sourceId=texelFetch(sourceVhvRemap,sourcePixel(sourceMappingOffset+gl_VertexID),0).r;
          int sourceAddress=(sourceInstanceOffset+int(sourceId))*3;
          vSourceLight0=sourceDecode(sourceAddress);
          ${bumped?`
          vSourceLight1=sourceDecode(sourceAddress+1);
          vSourceLight2=sourceDecode(sourceAddress+2);
          vSourceNormalUv=(sourceNormalTransform*vec3(uv,1.0)).xy;
          `:''}
        `);
        shader.fragmentShader=shader.fragmentShader.replace(fc,fc+`
          varying vec3 vSourceLight0;
          ${bumped?'uniform sampler2D sourceNormalMap; uniform float sourceNormalGreenSign; varying vec3 vSourceLight1,vSourceLight2; varying vec2 vSourceNormalUv;':''}
        `).replace(fm,fm+(bumped?`
          vec3 sourceNormal=texture2D(sourceNormalMap,vSourceNormalUv).rgb*2.0-1.0;
          sourceNormal.y*=sourceNormalGreenSign;
          vec3 sourceWeights=clamp(vec3(
            dot(sourceNormal,vec3(0.8164966106414795,0.0,0.5773502588272095)),
            dot(sourceNormal,vec3(-0.40824833512306213,0.7071067690849304,0.5773502588272095)),
            dot(sourceNormal,vec3(-0.4082482159137726,-0.7071068286895752,0.5773502588272095))),0.0,1.0);
          sourceWeights*=sourceWeights;
          // A malformed zero normal has a defined black result rather than NaN.
          ${compound?'vec3 sourceBakedDiffuse=':'diffuseColor.rgb*='}(vSourceLight0*sourceWeights.x+vSourceLight1*sourceWeights.y+vSourceLight2*sourceWeights.z)/max(dot(sourceWeights,vec3(1.0)),1e-8);
          ${compound?SOURCE_TINT_DECAL_ANCHOR:''}
        `:'\n diffuseColor.rgb*=vSourceLight0;\n'));
      };
      material.customProgramCacheKey=()=> bumped?'source-original-vhv-bump-r1':'source-original-vhv-plain-unbumped-r1';
      const decal=sourcePropDecalMode(binding.source.parameters);
      if(compound)attachSourcePropTintDecal(material,binding.tintMap!,binding.decalMap!,binding.decalUv!,binding.instanceRGB!);
      else{
        if(decal)attachSourcePropDecal(material,binding.decalMap!,decal,binding.decalUv!);
        if(binding.source.parameters.$tintmasktexture)attachSourcePropTint(material,binding.tintMap!,binding.instanceRGB!,String(binding.source.parameters.$notint??'0')==='1');
      }
      materials.push({mesh:binding.mesh,original,replacement:material});
    }
    for(const item of materials){owners.add(item.mesh);item.mesh.material=item.replacement;}
    audit.appliedMeshes=materials.length;audit.materials=materials.length;audit.lookupBytes=bytes;
    audit.plainUnbumpedMeshes=selected.filter(b=>!b.source.parameters.$bumpmap).length;
    audit.decalMultiplyMeshes=selected.filter(b=>!!b.source.parameters.$decaltexture&&!b.source.parameters.$tintmasktexture).length;
    audit.tintMaskMeshes=selected.filter(b=>!!b.source.parameters.$tintmasktexture&&!b.source.parameters.$decaltexture).length;
    audit.tintDecalMeshes=selected.filter(b=>!!b.source.parameters.$tintmasktexture&&!!b.source.parameters.$decaltexture).length;
    // Borrowed by the draw-call batching adapter; its materials are disposed
    // before this owner releases the shared lighting texture.
    return {audit,dispose,lookup:{lighting:lightTexture,width}};
  }catch(error){dispose();throw error;}
}
