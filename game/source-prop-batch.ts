import * as T from 'three';
import type {SourcePropLightingBinding} from './source-prop-lighting';
import {sourcePropDecalMode} from './source-prop-decal';
import {sourceInstanceTint} from './source-prop-tint';
import {sourcePropTintDecalCandidate,SOURCE_TINT_DECAL_FRAGMENT} from './source-prop-tint-decal';
import {createSourcePVSSubmission,sourcePVSSubmissionAudit,type SourcePVSSpan,type SourcePVSSubmissionAudit} from './source-map-pvs-index';

/** Inputs are the exact verified VHV batch data exposed by the lighting owner.
 * The batching adapter bakes every per-instance/per-primitive shader input
 * (lighting pixel coordinate, decal UV2, instance tint RGB) and each mesh's
 * world transform into vertex attributes, then merges all meshes of one
 * original material state into a single draw call. */
export interface SourcePropBatchInput {
  bindings:SourcePropLightingBinding[];
  remap:Uint32Array;
  /** Undefined when the VHV owner applied zero bindings; batching then no-ops. */
  lookup?:{lighting:T.DataTexture;width:number};
  enableDecalMultiply:boolean;
  enableTintMask:boolean;
  enableTintDecal:boolean;
}
export interface SourcePropBatchAudit {
  pvs?:SourcePVSSubmissionAudit;
  groups:number;mergedMeshes:number;sourceMeshes:number;mergedTriangles:number;sourceTriangles:number;
  mergedVertices:number;vertexBytes:number;indexBytes:number;skipped:{mesh:string;reason:string}[];
  branches:{bumped:number;plain:number;decal:number;tint:number;compound:number};
}
/** Original PVS selects contiguous prop index spans before GPU submission.
 * The shared prop-id texture remains a shader guard; hidden props no longer
 * consume vertex processing merely because a visible prop shares a batch. */
export interface SourcePropBatchHandle {
  audit:SourcePropBatchAudit;
  /** null = every prop visible (uniform short-circuit, no texture fetch). */
  setVisibleProps(mask:Uint8Array|null):void;
  dispose():void;
}

interface Group {
  key:string;bindings:SourcePropLightingBinding[];
  bumped:boolean;decal:1|2|undefined;tint:boolean;compound:boolean;
  vertices:number;indices:number;
}

const tintColors=new WeakMap<SourcePropLightingBinding,[number,number,number]>();

/** The maximum lighting pixel address (17711685) exceeds float32's exact
 * integer range, so addresses are baked as (x, y) texture pixels instead:
 * both components stay far below 2^24 and remain bit-exact through the
 * float32 vertex attribute. */
function lightingPixel(address:number,width:number):[number,number]{
  const x=address%width;return [x,(address-x)/width];
}

type BatchedMaterial=T.Material&{isMeshBasicMaterial?:boolean;map?:T.Texture|null;color?:T.Color;side?:T.Side;
  alphaTest?:number;opacity?:number;transparent?:boolean;depthWrite?:boolean;depthTest?:boolean;toneMapped?:boolean;fog?:boolean;alphaToCoverage?:boolean};

function groupKey(binding:SourcePropLightingBinding):string|null{
  const mesh=binding.mesh,material=mesh.material as BatchedMaterial;
  if(Array.isArray(mesh.material)||!material.isMeshBasicMaterial||!material.map||material.map.channel!==0||!material.color)return null;
  // Transparent faces rely on per-object sort order; a merged mesh loses it.
  if(material.transparent||material.opacity!==undefined&&material.opacity<1)return null;
  const parameters=binding.source.parameters;
  return [binding.source.source,parameters.$bumpmap?'bump':'plain',
    material.side,material.map.uuid,binding.normalMap?.uuid??'-',
    material.color.getHexString(),material.alphaTest,material.opacity,material.transparent,
    material.depthWrite,material.depthTest,material.toneMapped,('fog' in material)?material.fog:true,
    material.alphaToCoverage,sourcePropDecalMode(parameters)??'-',binding.decalMap?.uuid??'-',
    binding.tintMap?.uuid??'-',String(parameters.$notint??'0'),
  ].join('|');
}

/** Merged VS reproduces the installed VHV vertex decode verbatim: the three
 * consecutive lighting pixels are fetched per vertex exactly as the original
 * texelFetch remap did, so varying interpolation is bit-identical. */
function vertexDeclarations(group:Group){
  const bumped=group.bumped,decal=!!group.decal,tint=group.tint,compound=group.compound;
  return `
  uniform highp sampler2D sourceVhvLighting;
  uniform int sourceTextureWidth;
  attribute vec2 sourceLightCoord;
  varying vec3 vSourceLight0;
  ${bumped?'uniform mat3 sourceNormalTransform; varying vec3 vSourceLight1,vSourceLight2; varying vec2 vSourceNormalUv;':''}
  ${decal?'attribute vec2 sourceDecalUv; varying vec2 vSourceDecalUv;':''}
  ${tint?'varying vec2 vSourceTintUv; attribute vec3 sourceTintColor; varying vec3 vSourceTintColor;':''}
  ${compound?'attribute vec2 sourceDecalUv; attribute vec3 sourceTintColor; varying vec2 vSourceCompoundTintUv,vSourceCompoundDecalUv; varying vec3 vSourceCompoundTintColor;':''}
  ivec2 sourceStep(ivec2 p){return ivec2(p.x+1==sourceTextureWidth?0:p.x+1,p.x+1==sourceTextureWidth?p.y+1:p.y);}
  vec3 sourceDecode(ivec2 p){
    vec4 encoded=texelFetch(sourceVhvLighting,p,0);
    return pow(encoded.bgr*2.0,vec3(2.200000047683716));
  }
  `;
}

/** Redundant PVS guard after original index selection. One shared R8 texture
 * serves every merged group without changing any material lighting branch. */
function visibilityDeclarations():string{
  return `
  attribute float sourcePropId;
  uniform sampler2D sourcePropVisibleTex;
  uniform float sourcePropVisibleSide;
  uniform float sourcePropCulling;
  float sourcePropVisibleFactor(){
    if(sourcePropCulling<0.5)return 1.0;
    float column=mod(sourcePropId,sourcePropVisibleSide);
    float row=floor(sourcePropId/sourcePropVisibleSide);
    return texture2D(sourcePropVisibleTex,vec2((column+0.5)/sourcePropVisibleSide,(row+0.5)/sourcePropVisibleSide)).r;
  }
  `;
}
function visibilityProjection():string{
  return `
  gl_Position=mix(vec4(0.0,0.0,2.0,1.0),gl_Position,sourcePropVisibleFactor());
  `;
}
function vertexBody(group:Group){
  const bumped=group.bumped,decal=!!group.decal,tint=group.tint,compound=group.compound;
  return `
  ivec2 sourcePixel=ivec2(int(sourceLightCoord.x),int(sourceLightCoord.y));
  vSourceLight0=sourceDecode(sourcePixel);
  ${bumped?`
  vSourceLight1=sourceDecode(sourceStep(sourcePixel));
  vSourceLight2=sourceDecode(sourceStep(sourceStep(sourcePixel)));
  vSourceNormalUv=(sourceNormalTransform*vec3(uv,1.0)).xy;
  `:''}
  ${decal?'vSourceDecalUv=sourceDecalUv;':''}
  ${tint?'vSourceTintUv=uv; vSourceTintColor=sourceTintColor;':''}
  ${compound?'vSourceCompoundTintUv=uv; vSourceCompoundDecalUv=sourceDecalUv; vSourceCompoundTintColor=sourceTintColor;':''}
  `;
}
function fragmentDeclarations(group:Group){
  const bumped=group.bumped,decal=group.decal,tint=group.tint,compound=group.compound;
  return `
  varying vec3 vSourceLight0;
  ${bumped?'uniform sampler2D sourceNormalMap; uniform float sourceNormalGreenSign; varying vec3 vSourceLight1,vSourceLight2; varying vec2 vSourceNormalUv;':''}
  ${decal?'varying vec2 vSourceDecalUv; uniform sampler2D sourceDecalMap; uniform float sourceDecalScale;':''}
  ${tint?'varying vec2 vSourceTintUv; varying vec3 vSourceTintColor; uniform sampler2D sourceTintMap; uniform float sourceTintBias;':''}
  ${compound?'varying vec2 vSourceCompoundTintUv,vSourceCompoundDecalUv; varying vec3 vSourceCompoundTintColor; uniform sampler2D sourceCompoundTintMap,sourceCompoundDecalMap; uniform float sourceCompoundBias;':''}
  `;
}
function fragmentBody(group:Group){
  const bumped=group.bumped,decal=group.decal,tint=group.tint,compound=group.compound;
  if(compound)return `
  vec3 sourceBakedDiffuse=(vSourceLight0*sourceWeights.x+vSourceLight1*sourceWeights.y+vSourceLight2*sourceWeights.z)/max(dot(sourceWeights,vec3(1.0)),1e-8);
  ${SOURCE_TINT_DECAL_FRAGMENT.replaceAll('sourceCompoundTintColor','vSourceCompoundTintColor')}
  `;
  let body='';
  if(bumped)body+=`
  vec3 sourceBakedDiffuse=(vSourceLight0*sourceWeights.x+vSourceLight1*sourceWeights.y+vSourceLight2*sourceWeights.z)/max(dot(sourceWeights,vec3(1.0)),1e-8);
  diffuseColor.rgb*=sourceBakedDiffuse;
  `;else body+='\n diffuseColor.rgb*=vSourceLight0;\n';
  if(decal)body+='\ndiffuseColor.rgb*=texture2D(sourceDecalMap,vSourceDecalUv).rgb*sourceDecalScale;';
  if(tint)body+='\nfloat sourceTintMask=clamp(texture2D(sourceTintMap,vSourceTintUv).g+sourceTintBias,0.0,1.0);\ndiffuseColor.rgb*=vec3(1.0)+sourceTintMask*(vSourceTintColor-vec3(1.0));';
  return body;
}

/** Caller owns the props GLTF and the lighting handle; this adapter must be
 * disposed before them (scene meshes are restored to their anchors). Meshes
 * outside the merged batches keep their original anchors, materials and
 * visibility control untouched. */
export function createSourcePropBatch(root:T.Object3D,input:SourcePropBatchInput,options:{skipPropIds?:readonly number[]}={}):SourcePropBatchHandle{
  if(!input.lookup||!input.remap.length||!input.bindings.length)
    return {audit:{groups:0,mergedMeshes:0,sourceMeshes:0,mergedTriangles:0,sourceTriangles:0,mergedVertices:0,
      vertexBytes:0,indexBytes:0,skipped:[],branches:{bumped:0,plain:0,decal:0,tint:0,compound:0}},
      setVisibleProps(){},dispose(){}};
  const members=new Set<T.Object3D>();root.traverse(object=>members.add(object));
  const lookup=input.lookup;
  const skip=new Set(options.skipPropIds??[]);
  const groups=new Map<string,Group>();
  const bindingPropIds=new Map<SourcePropLightingBinding,number>();
  const skipped:{mesh:string;reason:string}[]=[];
  for(const binding of input.bindings){
    const mesh=binding.mesh;
    if(!mesh?.isMesh||!members.has(mesh)){skipped.push({mesh:mesh?.name??'?',reason:'not a live props mesh'});continue;}
    if(Array.isArray(mesh.material)){skipped.push({mesh:mesh.name,reason:'material array'});continue;}
    let anchor:T.Object3D|null=mesh;while(anchor&&!/^static_prop_\d+$/.test(anchor.name))anchor=anchor.parent;
    const id=anchor?Number(anchor.name.slice(12)):-1;
    if(id<0){skipped.push({mesh:mesh.name,reason:'no static prop anchor (no PVS identity)'});continue;}
    if(skip.has(id)){skipped.push({mesh:mesh.name,reason:'sky exclusion'});continue;}
    const key=groupKey(binding);
    if(!key){skipped.push({mesh:mesh.name,reason:'unsupported merged material state'});continue;}
    const geometry=mesh.geometry;
    if(!geometry.index||!geometry.attributes.position||!geometry.attributes.uv||
      geometry.attributes.position.itemSize!==3||geometry.attributes.uv.itemSize!==2||
      geometry.attributes.position.count!==binding.vertexCount||geometry.index.count!==binding.indexCount||
      geometry.attributes.uv.count!==binding.vertexCount){skipped.push({mesh:mesh.name,reason:'merged geometry contract differs'});continue;}
    const parameters=binding.source.parameters;
    const compound=!!input.enableTintDecal&&sourcePropTintDecalCandidate(parameters);
    const decal=!compound&&!!input.enableDecalMultiply?sourcePropDecalMode(parameters):undefined;
    const tint=!compound&&!!input.enableTintMask&&!!parameters.$tintmasktexture;
    if((decal||compound)&&!binding.decalUv){skipped.push({mesh:mesh.name,reason:'decal UV2 missing'});continue;}
    if((tint||compound)&&!binding.instanceRGB){skipped.push({mesh:mesh.name,reason:'instance tint RGB missing'});continue;}
    const group=groups.get(key)??{key,bindings:[],bumped:!!parameters.$bumpmap,decal,tint,compound,vertices:0,indices:0};
    group.bindings.push(binding);group.vertices+=binding.vertexCount;group.indices+=binding.indexCount;
    bindingPropIds.set(binding,id);
    groups.set(key,group);
  }
  const host=new T.Group();host.name='source_prop_batch';
  const restored:{mesh:T.Mesh;parent:T.Object3D}[]=[];
  const merged:{mesh:T.Mesh;material:T.MeshBasicMaterial}[]=[];
  const submissions:ReturnType<typeof createSourcePVSSubmission>[]=[];
  let pvsAudit:SourcePVSSubmissionAudit|undefined;
  // One shared nearest-sampled R8 lookup texture holds the per-prop visibility
  // of the current PVS cluster; every merged material reads the same texture.
  let maxPropId=-1;for(const id of bindingPropIds.values())if(id>maxPropId)maxPropId=id;
  const propCount=maxPropId+1;
  const visibleSide=Math.max(1,Math.ceil(Math.sqrt(propCount)));
  const visibleData=new Uint8Array(visibleSide*visibleSide).fill(255);
  const visibleTexture=new T.DataTexture(visibleData,visibleSide,visibleSide,T.RedFormat,T.UnsignedByteType);
  visibleTexture.minFilter=T.NearestFilter;visibleTexture.magFilter=T.NearestFilter;
  visibleTexture.generateMipmaps=false;visibleTexture.needsUpdate=true;
  const visibilityUniforms={
    sourcePropVisibleTex:{value:visibleTexture as T.Texture},
    sourcePropVisibleSide:{value:visibleSide},
    sourcePropCulling:{value:0},
  };
  const setVisibleProps=(mask:Uint8Array|null)=>{
    if(disposed)return;
    const start=performance.now();let changed=0;
    for(const owner of submissions)changed+=+owner.select(mask);
    if(pvsAudit)Object.assign(pvsAudit,sourcePVSSubmissionAudit(submissions),{changedGroups:changed,lastUpdateMs:performance.now()-start});
    if(!mask){visibleData.fill(255);visibilityUniforms.sourcePropCulling.value=0;}
    else{
      for(let id=0;id<propCount;id++)visibleData[id]=id>=mask.length||mask[id]?255:0;
      visibilityUniforms.sourcePropCulling.value=1;
    }
    visibleTexture.needsUpdate=true;
  };
  let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;
    for(const owner of submissions)owner.dispose();
    for(const item of merged){item.mesh.removeFromParent();item.mesh.geometry.dispose();item.material.dispose();}
    for(const item of restored)item.parent.add(item.mesh);
    visibleTexture.dispose();
    host.removeFromParent();
  };
  try{
    const vector=new T.Vector3();const width=input.lookup.width;
    for(const group of groups.values()){
      if(!group.bindings.length)continue;
      const positions=new Float32Array(group.vertices*3),uvs=new Float32Array(group.vertices*2);
      const coords=new Float32Array(group.vertices*2);
      const propIds=new Float32Array(group.vertices);
      const decalUvs=(group.decal||group.compound)?new Float32Array(group.vertices*2):undefined;
      const tints=(group.tint||group.compound)?new Float32Array(group.vertices*3):undefined;
      const IndexType=group.vertices>65535?Uint32Array:Uint16Array;
      const indices=new IndexType(group.indices);
      const spans:SourcePVSSpan[]=[];
      let vertexBase=0,indexBase=0;
      for(const binding of group.bindings){
        const mesh=binding.mesh,geometry=mesh.geometry;
        const propId=bindingPropIds.get(binding)!;
        mesh.updateWorldMatrix(true,false);
        const matrix=mesh.matrixWorld;
        const position=geometry.attributes.position,uv=geometry.attributes.uv;
        for(let i=0;i<binding.vertexCount;i++){
          vector.fromBufferAttribute(position,i).applyMatrix4(matrix);
          positions[(vertexBase+i)*3]=vector.x;positions[(vertexBase+i)*3+1]=vector.y;positions[(vertexBase+i)*3+2]=vector.z;
          uvs[(vertexBase+i)*2]=uv.getX(i);uvs[(vertexBase+i)*2+1]=uv.getY(i);
          const address=(binding.lightingVertexOffset+input.remap[binding.mappingOffset+i])*3;
          const [x,y]=lightingPixel(address,width);
          coords[(vertexBase+i)*2]=x;coords[(vertexBase+i)*2+1]=y;
          propIds[vertexBase+i]=propId;
          if(decalUvs&&binding.decalUv){
            const pixels=binding.decalUv.texture.image.data as Float32Array;
            const offset=(binding.decalUv.offset+i)*2;
            decalUvs[(vertexBase+i)*2]=pixels[offset];decalUvs[(vertexBase+i)*2+1]=pixels[offset+1];
          }
          if(tints&&binding.instanceRGB){
            const color=tintColors.get(binding)??tintColors.set(binding,sourceInstanceTint(binding.instanceRGB)).get(binding)!;
            tints[(vertexBase+i)*3]=color[0];tints[(vertexBase+i)*3+1]=color[1];tints[(vertexBase+i)*3+2]=color[2];
          }
        }
        const index=geometry.index!;
        spans.push({id:propId,start:indexBase,count:binding.indexCount});
        for(let i=0;i<binding.indexCount;i++)indices[indexBase+i]=index.getX(i)+vertexBase;
        vertexBase+=binding.vertexCount;indexBase+=binding.indexCount;
      }
      const geometry=new T.BufferGeometry();
      geometry.setAttribute('position',new T.BufferAttribute(positions,3));
      geometry.setAttribute('uv',new T.BufferAttribute(uvs,2));
      geometry.setAttribute('sourceLightCoord',new T.BufferAttribute(coords,2));
      geometry.setAttribute('sourcePropId',new T.BufferAttribute(propIds,1));
      if(decalUvs)geometry.setAttribute('sourceDecalUv',new T.BufferAttribute(decalUvs,2));
      if(tints)geometry.setAttribute('sourceTintColor',new T.BufferAttribute(tints,3));
      geometry.setIndex(new T.BufferAttribute(indices,1));
      geometry.computeBoundingSphere();
      const first=group.bindings[0],source=first.mesh.material as T.MeshBasicMaterial,normal=first.normalMap;
      const material=new T.MeshBasicMaterial({map:source.map,color:source.color.clone(),side:source.side,
        alphaTest:source.alphaTest,opacity:source.opacity,transparent:source.transparent,depthWrite:source.depthWrite,
        depthTest:source.depthTest,toneMapped:source.toneMapped,fog:('fog' in source)?Boolean(source.fog):true});
      material.name=first.source.source+' / original VHV batched';
      material.alphaToCoverage=source.alphaToCoverage;
      const normalTransform=normal?(normal.matrixAutoUpdate?new T.Matrix3().setUvTransform(normal.offset.x,normal.offset.y,normal.repeat.x,normal.repeat.y,
        normal.rotation,normal.center.x,normal.center.y):normal.matrix.clone()):undefined;
      material.onBeforeCompile=shader=>{
        const vc='#include <common>',vb='#include <begin_vertex>',pv='#include <project_vertex>',fc='#include <common>',fm='#include <map_fragment>';
        if(!shader.vertexShader.includes(vc)||!shader.vertexShader.includes(vb)||!shader.vertexShader.includes(pv)||
          !shader.fragmentShader.includes(fc)||!shader.fragmentShader.includes(fm))
          throw Error('Three batched VHV shader contract changed');
        Object.assign(shader.uniforms,{sourceVhvLighting:{value:lookup.lighting},sourceTextureWidth:{value:width}},visibilityUniforms);
        if(group.bumped)Object.assign(shader.uniforms,{sourceNormalMap:{value:normal},sourceNormalTransform:{value:normalTransform},sourceNormalGreenSign:{value:first.normalGreenInverted?-1:1}});
        if(group.decal)Object.assign(shader.uniforms,{sourceDecalMap:{value:first.decalMap},sourceDecalScale:{value:group.decal}});
        if(group.tint)Object.assign(shader.uniforms,{sourceTintMap:{value:first.tintMap},sourceTintBias:{value:String(first.source.parameters.$notint??'0')==='1'?-1:0}});
        if(group.compound)Object.assign(shader.uniforms,{sourceCompoundTintMap:{value:first.tintMap},sourceCompoundDecalMap:{value:first.decalMap},sourceCompoundBias:{value:0}});
        shader.vertexShader=shader.vertexShader
          .replace(vc,vc+vertexDeclarations(group)+visibilityDeclarations())
          .replace(vb,vb+vertexBody(group))
          .replace(pv,pv+visibilityProjection());
        const bumpWeights=group.bumped?`
          vec3 sourceNormal=texture2D(sourceNormalMap,vSourceNormalUv).rgb*2.0-1.0;
          sourceNormal.y*=sourceNormalGreenSign;
          vec3 sourceWeights=clamp(vec3(
            dot(sourceNormal,vec3(0.8164966106414795,0.0,0.5773502588272095)),
            dot(sourceNormal,vec3(-0.40824833512306213,0.7071067690849304,0.5773502588272095)),
            dot(sourceNormal,vec3(-0.4082482159137726,-0.7071068286895752,0.5773502588272095))),0.0,1.0);
          sourceWeights*=sourceWeights;
        `:'';
        shader.fragmentShader=shader.fragmentShader.replace(fc,fc+fragmentDeclarations(group))
          .replace(fm,fm+bumpWeights+fragmentBody(group));
      };
      material.customProgramCacheKey=()=>'source-prop-batch-r2-'+[group.bumped?'bump':'plain',group.decal??'-',group.tint?'tint':'-',group.compound?'compound':'-'].join('-');
      const mesh=new T.Mesh(geometry,material);
      mesh.name='source_prop_batch_'+first.source.source.replaceAll('/','_');
      mesh.matrixAutoUpdate=false;
      submissions.push(createSourcePVSSubmission(mesh,spans));
      host.add(mesh);
      merged.push({mesh,material});
      for(const binding of group.bindings){
        const parent=binding.mesh.parent!;
        restored.push({mesh:binding.mesh,parent});
        binding.mesh.removeFromParent();
      }
    }
    root.add(host);
    const branches={bumped:0,plain:0,decal:0,tint:0,compound:0};
    for(const group of groups.values()){
      if(group.compound)branches.compound++;
      else if(group.decal)branches.decal++;
      else if(group.tint)branches.tint++;
      else if(group.bumped)branches.bumped++;
      else branches.plain++;
    }
    const audit:SourcePropBatchAudit={
      pvs:pvsAudit=sourcePVSSubmissionAudit(submissions),
      groups:groups.size,mergedMeshes:merged.length,sourceMeshes:restored.length,
      mergedTriangles:merged.reduce((n,item)=>n+item.mesh.geometry.index!.count/3,0),
      sourceTriangles:[...groups.values()].reduce((n,group)=>n+group.indices/3,0),
      mergedVertices:[...groups.values()].reduce((n,group)=>n+group.vertices,0),
      vertexBytes:[...groups.values()].reduce((n,group)=>n+group.vertices*(12+8+8+4+(group.decal||group.compound?8:0)+(group.tint||group.compound?12:0)),0),
      indexBytes:[...groups.values()].reduce((n,group)=>n+group.indices*(group.vertices>65535?4:2),0),
      skipped,branches,
    };
    return {audit,setVisibleProps,dispose};
  }catch(error){dispose();throw error;}
}
