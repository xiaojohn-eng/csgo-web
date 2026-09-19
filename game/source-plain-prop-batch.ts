import * as T from 'three';
import {createSourcePVSSubmission,sourcePVSSubmissionAudit,type SourcePVSSpan,type SourcePVSSubmissionAudit} from './source-map-pvs-index';

/** Merges static props that no original VHV branch owns (plain glTF
 * MeshStandardMaterial/MeshBasicMaterial, opaque, default shader) into one
 * draw call per original material instance. World transforms, normals and
 * tangents are baked exactly as the original shaders consumed them
 * (position/tangent via the world matrix, normal via its inverse transpose),
 * so a merged mesh preserves the source shader inputs. PVS selects original
 * prop index spans before submission, with the VHV batch's same GPU guard. */

export interface SourcePlainPropBatchAudit {
  pvs?:SourcePVSSubmissionAudit;
  groups:number;mergedMeshes:number;sourceMeshes:number;materials:number;
  mergedTriangles:number;sourceTriangles:number;mergedVertices:number;vertexBytes:number;indexBytes:number;
  skipped:{mesh:string;reason:string}[];
}
export interface SourcePlainPropBatchHandle {
  audit:SourcePlainPropBatchAudit;
  /** null = every prop visible (uniform short-circuit, no texture fetch). */
  setVisibleProps(mask:Uint8Array|null):void;
  dispose():void;
}

interface Candidate {
  mesh:T.Mesh;propId:number;
  signature:string;vertices:number;indices:number;
}

/** Materials wrapped by VHV/foliage/olive/tint owners replace
 * customProgramCacheKey; untouched glTF materials still return the shared
 * default key. Comparing against fresh materials catches every wrapped owner
 * without hardcoding their key strings. */
function defaultCacheKeys():Set<string>{
  return new Set([new T.MeshStandardMaterial().customProgramCacheKey(),new T.MeshBasicMaterial().customProgramCacheKey()]);
}

function attributeSignature(geometry:T.BufferGeometry):string|null{
  const entries=Object.entries(geometry.attributes);
  if(!entries.length)return null;
  return entries.map(([name,attribute])=>{
    const itemSize=attribute.itemSize;
    if(!Number.isInteger(itemSize)||itemSize<1)return null;
    const array=(attribute as T.BufferAttribute).array;
    if(!(array instanceof Float32Array||array instanceof Int8Array||array instanceof Uint8Array||
      array instanceof Int16Array||array instanceof Uint16Array||array instanceof Int32Array||array instanceof Uint32Array))return null;
    return name+':'+itemSize+':'+array.constructor.name+':'+(attribute as T.BufferAttribute).normalized;
  }).join('|');
}

function collect(root:T.Object3D,skip:ReadonlySet<number>,defaults:Set<string>):{candidates:Candidate[];skipped:{mesh:string;reason:string}[]}{
  const candidates:Candidate[]=[],skipped:{mesh:string;reason:string}[]=[];
  root.traverse(object=>{
    const mesh=object as T.Mesh;
    if(!mesh.isMesh||(mesh as T.Mesh&{isSkinnedMesh?:boolean;isInstancedMesh?:boolean}).isSkinnedMesh||
      (mesh as T.Mesh&{isInstancedMesh?:boolean}).isInstancedMesh)return;
    const name=mesh.name||mesh.parent?.name||'?';
    if(Array.isArray(mesh.material)){skipped.push({mesh:name,reason:'material array'});return;}
    const material=mesh.material as T.Material;
    if(material.transparent||(material.opacity!==undefined&&material.opacity<1)){skipped.push({mesh:name,reason:'transparent material keeps per-object sort'});return;}
    if(!defaults.has(material.customProgramCacheKey())){skipped.push({mesh:name,reason:'material owned by another shader owner'});return;}
    let anchor:T.Object3D|null=mesh;while(anchor&&!/^static_prop_\d+$/.test(anchor.name))anchor=anchor.parent;
    const propId=anchor?Number(anchor.name.slice(12)):-1;
    if(propId<0){skipped.push({mesh:name,reason:'no static prop anchor (no PVS identity)'});return;}
    if(skip.has(propId)){skipped.push({mesh:name,reason:'sky exclusion'});return;}
    const geometry=mesh.geometry;
    if(!geometry.index||!geometry.attributes.position){skipped.push({mesh:name,reason:'unindexed geometry'});return;}
    if(Object.keys(geometry.morphAttributes).length||mesh.morphTargetInfluences?.length){skipped.push({mesh:name,reason:'morph targets'});return;}
    const drawRange=geometry.drawRange;
    if(drawRange.start!==0||(drawRange.count!==Infinity&&drawRange.count<geometry.index.count)){
      skipped.push({mesh:name,reason:'partial draw range'});return;}
    const signature=attributeSignature(geometry);
    if(!signature){skipped.push({mesh:name,reason:'unsupported attribute set'});return;}
    candidates.push({mesh,propId,signature,vertices:geometry.attributes.position.count,indices:geometry.index.count});
  });
  return {candidates,skipped};
}

/** Same per-vertex PVS lookup contract as the VHV batch: one nearest-sampled
 * R8 texel per prop id parks invisible triangles beyond the far plane. */
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

/** Caller owns the props GLTF; this adapter must be disposed before it. Meshes
 * outside the merged groups keep their original anchors and visibility. */
export function createSourcePlainPropBatch(root:T.Object3D,options:{skipPropIds?:readonly number[]}={}):SourcePlainPropBatchHandle{
  const defaults=defaultCacheKeys();
  const {candidates,skipped}=collect(root,new Set(options.skipPropIds??[]),defaults);
  if(!candidates.length)return {audit:{groups:0,mergedMeshes:0,sourceMeshes:0,materials:0,mergedTriangles:0,
    sourceTriangles:0,mergedVertices:0,vertexBytes:0,indexBytes:0,skipped},setVisibleProps(){},dispose(){}};
  const groups=new Map<string,Candidate[]>();
  for(const candidate of candidates){
    const material=candidate.mesh.material as T.Material;
    const key=material.uuid+'|'+candidate.signature;
    const list=groups.get(key)??[];list.push(candidate);groups.set(key,list);
  }
  const host=new T.Group();host.name='source_plain_prop_batch';
  const restored:{mesh:T.Mesh;parent:T.Object3D}[]=[];
  const merged:{mesh:T.Mesh;material:T.Material}[]=[];
  const submissions:ReturnType<typeof createSourcePVSSubmission>[]=[];
  let pvsAudit:SourcePVSSubmissionAudit|undefined;
  let maxPropId=-1;for(const candidate of candidates)if(candidate.propId>maxPropId)maxPropId=candidate.propId;
  const propCount=maxPropId+1;
  const visibleSide=Math.max(1,Math.ceil(Math.sqrt(propCount)));
  const visibleData=new Uint8Array(Math.max(1,visibleSide*visibleSide)).fill(255);
  const visibleTexture=new T.DataTexture(visibleData,visibleSide,visibleSide,T.RedFormat,T.UnsignedByteType);
  visibleTexture.minFilter=T.NearestFilter;visibleTexture.magFilter=T.NearestFilter;
  visibleTexture.generateMipmaps=false;visibleTexture.needsUpdate=true;
  const visibilityUniforms={
    sourcePropVisibleTex:{value:visibleTexture as T.Texture},
    sourcePropVisibleSide:{value:visibleSide},
    sourcePropCulling:{value:0},
  };
  let disposed=false;
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
  const dispose=()=>{if(disposed)return;disposed=true;
    for(const owner of submissions)owner.dispose();
    for(const item of merged){item.mesh.removeFromParent();item.mesh.geometry.dispose();item.material.dispose();}
    for(const item of restored)item.parent.add(item.mesh);
    visibleTexture.dispose();
    host.removeFromParent();
  };
  let vertexBytes=0,indexBytes=0,mergedVertices=0,mergedTriangles=0;
  try{
    const position=new T.Vector3(),normal=new T.Vector3(),tangent=new T.Vector3();
    const worldMatrix=new T.Matrix4(),normalMatrix=new T.Matrix3(),tangentMatrix=new T.Matrix3();
    for(const list of groups.values()){
      if(!list.length)continue;
      const first=list[0],firstGeometry=first.mesh.geometry;
      const attributeNames=Object.keys(firstGeometry.attributes);
      const totalVertices=list.reduce((n,candidate)=>n+candidate.vertices,0);
      const totalIndices=list.reduce((n,candidate)=>n+candidate.indices,0);
      const buffers=new Map<string,T.TypedArray>();
      for(const name of attributeNames){
        const source=firstGeometry.attributes[name] as T.BufferAttribute;
        const Constructor=source.array.constructor as new(length:number)=>T.TypedArray;
        buffers.set(name,new Constructor(totalVertices*source.itemSize));
      }
      const propIds=new Float32Array(totalVertices);
      const IndexType=totalVertices>65535?Uint32Array:Uint16Array;
      const indices=new IndexType(totalIndices);
      const spans:SourcePVSSpan[]=[];
      let vertexBase=0,indexBase=0;
      for(const candidate of list){
        const geometry=candidate.mesh.geometry;
        candidate.mesh.updateWorldMatrix(true,false);
        worldMatrix.copy(candidate.mesh.matrixWorld);
        normalMatrix.getNormalMatrix(worldMatrix);
        tangentMatrix.setFromMatrix4(worldMatrix);
        for(const name of attributeNames){
          const attribute=geometry.attributes[name] as T.BufferAttribute;
          const target=buffers.get(name)!;
          const itemSize=attribute.itemSize;
          if(name==='position'){
            for(let i=0;i<candidate.vertices;i++){
              position.fromBufferAttribute(attribute,i).applyMatrix4(worldMatrix);
              target[(vertexBase+i)*itemSize]=position.x;
              target[(vertexBase+i)*itemSize+1]=position.y;
              target[(vertexBase+i)*itemSize+2]=position.z;
            }
          }else if(name==='normal'){
            for(let i=0;i<candidate.vertices;i++){
              normal.fromBufferAttribute(attribute,i).applyMatrix3(normalMatrix);
              target[(vertexBase+i)*itemSize]=normal.x;
              target[(vertexBase+i)*itemSize+1]=normal.y;
              target[(vertexBase+i)*itemSize+2]=normal.z;
            }
          }else if(name==='tangent'){
            // glTF tangents carry a handedness w component; only xyz takes the
            // world rotation (three's defaultnormal_vertex does the same).
            for(let i=0;i<candidate.vertices;i++){
              tangent.set(attribute.getComponent(i,0),attribute.getComponent(i,1),attribute.getComponent(i,2)).applyMatrix3(tangentMatrix);
              target[(vertexBase+i)*itemSize]=tangent.x;
              target[(vertexBase+i)*itemSize+1]=tangent.y;
              target[(vertexBase+i)*itemSize+2]=tangent.z;
              if(itemSize>3)target[(vertexBase+i)*itemSize+3]=attribute.getComponent(i,3);
            }
          }else{
            (target as T.TypedArray).set(attribute.array as never,vertexBase*itemSize);
          }
        }
        for(let i=0;i<candidate.vertices;i++)propIds[vertexBase+i]=candidate.propId;
        const index=geometry.index!;
        spans.push({id:candidate.propId,start:indexBase,count:candidate.indices});
        for(let i=0;i<candidate.indices;i++)indices[indexBase+i]=index.getX(i)+vertexBase;
        vertexBase+=candidate.vertices;indexBase+=candidate.indices;
      }
      const geometry=new T.BufferGeometry();
      for(const name of attributeNames){
        const source=firstGeometry.attributes[name] as T.BufferAttribute;
        geometry.setAttribute(name,new T.BufferAttribute(buffers.get(name)!,source.itemSize,source.normalized));
      }
      geometry.setAttribute('sourcePropId',new T.BufferAttribute(propIds,1));
      geometry.setIndex(new T.BufferAttribute(indices,1));
      geometry.computeBoundingSphere();
      const sourceMaterial=first.mesh.material as T.Material;
      const material=sourceMaterial.clone();
      material.name=sourceMaterial.name+' / plain prop batched';
      material.onBeforeCompile=shader=>{
        const vc='#include <common>',pv='#include <project_vertex>';
        if(!shader.vertexShader.includes(vc)||!shader.vertexShader.includes(pv))
          throw Error('Three plain prop batch shader contract changed');
        Object.assign(shader.uniforms,visibilityUniforms);
        shader.vertexShader=shader.vertexShader
          .replace(vc,vc+visibilityDeclarations())
          .replace(pv,pv+visibilityProjection());
      };
      material.customProgramCacheKey=()=>'source-plain-prop-batch-r1';
      const mesh=new T.Mesh(geometry,material);
      mesh.name='source_plain_prop_batch_'+(sourceMaterial.name||'material').replaceAll('/','_');
      mesh.matrixAutoUpdate=false;
      submissions.push(createSourcePVSSubmission(mesh,spans));
      host.add(mesh);
      merged.push({mesh,material});
      for(const candidate of list){
        restored.push({mesh:candidate.mesh,parent:candidate.mesh.parent!});
        candidate.mesh.removeFromParent();
      }
      mergedVertices+=totalVertices;mergedTriangles+=totalIndices/3;
      vertexBytes+=totalVertices*(attributeNames.reduce((n,name)=>n+firstGeometry.attributes[name].itemSize*(firstGeometry.attributes[name] as T.BufferAttribute).array.BYTES_PER_ELEMENT,0)+4);
      indexBytes+=totalIndices*(totalVertices>65535?4:2);
    }
    root.add(host);
    const audit:SourcePlainPropBatchAudit={
      pvs:pvsAudit=sourcePVSSubmissionAudit(submissions),
      groups:merged.length,mergedMeshes:merged.length,sourceMeshes:restored.length,
      materials:new Set(candidates.map(candidate=>(candidate.mesh.material as T.Material).uuid)).size,
      mergedTriangles,sourceTriangles:mergedTriangles,mergedVertices,vertexBytes,indexBytes,
      skipped,
    };
    return {audit,setVisibleProps,dispose};
  }catch(error){dispose();throw error;}
}
