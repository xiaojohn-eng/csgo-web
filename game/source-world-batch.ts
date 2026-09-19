import * as T from 'three';
import {createSourcePVSSubmission,sourcePVSTriangleSpans,sourcePVSSubmissionAudit,type SourcePVSSubmissionAudit} from './source-map-pvs-index';

/** Merges the original BSP world faces (post-lightmap, one
 * MeshBasicMaterial+HDR-lightmap shader per glTF mesh) into one draw call per
 * original material STATE (same base texture + render state can span several
 * glTF material instances). Original contiguous face index spans are selected
 * on PVS cluster changes before GPU submission; no vertex edits or triangle
 * reordering. A shared R8 face-id mask remains a shader guard. Sky-owned face
 * spans stay excluded, including when the world PVS is disabled. */

export interface SourceWorldBatchAudit {
  pvs?:SourcePVSSubmissionAudit;
  groups:number;mergedMeshes:number;sourceMeshes:number;
  mergedTriangles:number;sourceTriangles:number;mergedVertices:number;vertexBytes:number;indexBytes:number;
  faceTextureSide:number;faceCount:number;
  skipped:{mesh:string;reason:string}[];
}
export interface SourceWorldBatchHandle {
  audit:SourceWorldBatchAudit;
  /** null = every face visible (short-circuits the texture fetch unless the
   * sky pass borrowed faces, which stay culled in every mask). */
  setVisibleFaces(mask:Uint8Array|null,firstFace:number):void;
  dispose():void;
}

interface Candidate {
  mesh:T.Mesh;
  signature:string;vertices:number;indices:number;
}

/** Group key spans distinct material instances: only the actual render state
 * (base texture, colour, lightmap atlas, blend flags) matters for merging. */
function materialSignature(material:T.Material):string|null{
  const basic=material as T.MeshBasicMaterial;
  if(!basic.isMeshBasicMaterial)return null;
  return [basic.map?.uuid??'none',basic.lightMap?.uuid??'none',
    '#'+basic.color.getHexString(),basic.side,basic.transparent?'1':'0',basic.opacity,
    basic.alphaTest,basic.depthWrite?'1':'0',basic.depthTest?'1':'0',basic.toneMapped?'1':'0',
    ('fog'in basic?String(basic.fog):'?'),basic.customProgramCacheKey()].join('|');
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

function collect(root:T.Object3D):{candidates:Candidate[];skipped:{mesh:string;reason:string}[]}{
  const candidates:Candidate[]=[],skipped:{mesh:string;reason:string}[]=[];
  root.traverse(object=>{
    const mesh=object as T.Mesh;
    if(!mesh.isMesh||(mesh as T.Mesh&{isSkinnedMesh?:boolean}).isSkinnedMesh||
      (mesh as T.Mesh&{isInstancedMesh?:boolean}).isInstancedMesh)return;
    const name=mesh.name||mesh.parent?.name||'?';
    if(Array.isArray(mesh.material)){skipped.push({mesh:name,reason:'material array'});return;}
    if(!materialSignature(mesh.material)){skipped.push({mesh:name,reason:'non-basic material'});return;}
    const material=mesh.material as T.MeshBasicMaterial;
    if(material.transparent||(material.opacity!==undefined&&material.opacity<1)){
      skipped.push({mesh:name,reason:'transparent material keeps per-object sort'});return;}
    const geometry=mesh.geometry;
    if(!geometry.index||!geometry.attributes.position||!geometry.attributes.uv2){
      skipped.push({mesh:name,reason:'unindexed geometry or missing Source face ids'});return;}
    if(Object.keys(geometry.morphAttributes).length||mesh.morphTargetInfluences?.length){
      skipped.push({mesh:name,reason:'morph targets'});return;}
    const drawRange=geometry.drawRange;
    if(drawRange.start!==0||(drawRange.count!==Infinity&&drawRange.count<geometry.index.count)){
      skipped.push({mesh:name,reason:'partial draw range'});return;}
    const signature=attributeSignature(geometry);
    if(!signature){skipped.push({mesh:name,reason:'unsupported attribute set'});return;}
    candidates.push({mesh,signature,vertices:geometry.attributes.position.count,indices:geometry.index.count});
  });
  return {candidates,skipped};
}

/** Per-vertex PVS lookup, same contract as the prop batches: one
 * nearest-sampled R8 texel per Source face id parks invisible triangles
 * beyond the far plane, so culling costs only the vertex fetch itself. */
function visibilityDeclarations():string{
  return `
  attribute float sourceFaceId;
  uniform sampler2D sourceWorldVisibleTex;
  uniform float sourceWorldVisibleSide;
  uniform float sourceWorldCulling;
  float sourceWorldVisibleFactor(){
    if(sourceWorldCulling<0.5)return 1.0;
    float column=mod(sourceFaceId,sourceWorldVisibleSide);
    float row=floor(sourceFaceId/sourceWorldVisibleSide);
    return texture2D(sourceWorldVisibleTex,vec2((column+0.5)/sourceWorldVisibleSide,(row+0.5)/sourceWorldVisibleSide)).r;
  }
  `;
}
function visibilityProjection():string{
  return `
  gl_Position=mix(vec4(0.0,0.0,2.0,1.0),gl_Position,sourceWorldVisibleFactor());
  `;
}

/** Caller owns the world GLTF and its lightmap adapter; dispose this batch
 * first so meshes return to their original materials and parents. Skipped
 * meshes keep the CPU PVS filter path unchanged. */
export function createSourceWorldBatch(root:T.Object3D,options:{excludedFaceIds?:readonly number[]}={}):SourceWorldBatchHandle{
  const excluded=new Set(options.excludedFaceIds??[]);
  const {candidates,skipped}=collect(root);
  if(!candidates.length)return {audit:{groups:0,mergedMeshes:0,sourceMeshes:0,
    mergedTriangles:0,sourceTriangles:0,mergedVertices:0,vertexBytes:0,indexBytes:0,
    faceTextureSide:0,faceCount:0,skipped},setVisibleFaces(){},dispose(){}};
  const groups=new Map<string,Candidate[]>();
  for(const candidate of candidates){
    const key=materialSignature(candidate.mesh.material as T.Material)+'|'+candidate.signature;
    const list=groups.get(key)??[];list.push(candidate);groups.set(key,list);
  }
  const host=new T.Group();host.name='source_world_batch';
  const restored:{mesh:T.Mesh;parent:T.Object3D}[]=[];
  const merged:{mesh:T.Mesh;material:T.Material}[]=[];
  const submissions:ReturnType<typeof createSourcePVSSubmission>[]=[];
  let pvsAudit:SourcePVSSubmissionAudit|undefined;
  let maxFaceId=-1;
  for(const candidate of candidates){
    const faces=candidate.mesh.geometry.getAttribute('uv2') as T.BufferAttribute;
    for(let i=0;i<candidate.vertices;i++){const id=faces.getX(i);if(id>maxFaceId)maxFaceId=id;}
  }
  const faceCount=maxFaceId+1;
  const visibleSide=Math.max(1,Math.ceil(Math.sqrt(Math.max(1,faceCount))));
  const visibleData=new Uint8Array(Math.max(1,visibleSide*visibleSide)).fill(255);
  for(const id of excluded)if(id>=0&&id<visibleData.length)visibleData[id]=0;
  const visibleTexture=new T.DataTexture(visibleData,visibleSide,visibleSide,T.RedFormat,T.UnsignedByteType);
  visibleTexture.minFilter=T.NearestFilter;visibleTexture.magFilter=T.NearestFilter;
  visibleTexture.generateMipmaps=false;visibleTexture.needsUpdate=true;
  const visibilityUniforms={
    sourceWorldVisibleTex:{value:visibleTexture as T.Texture},
    sourceWorldVisibleSide:{value:visibleSide},
    sourceWorldCulling:{value:excluded.size?1:0},
  };
  let disposed=false;
  const setVisibleFaces=(mask:Uint8Array|null,firstFace:number)=>{
    if(disposed)return;
    const start=performance.now();let changed=0;
    for(const owner of submissions)changed+=+owner.select(mask,firstFace,excluded);
    if(pvsAudit)Object.assign(pvsAudit,sourcePVSSubmissionAudit(submissions),{changedGroups:changed,lastUpdateMs:performance.now()-start});
    if(!mask){
      visibleData.fill(255);
      for(const id of excluded)if(id>=0&&id<visibleData.length)visibleData[id]=0;
      visibilityUniforms.sourceWorldCulling.value=excluded.size?1:0;
    }else{
      visibleData.fill(255);
      const until=Math.min(mask.length,visibleData.length-firstFace);
      for(let i=0;i<until;i++)visibleData[firstFace+i]=mask[i]?255:0;
      for(const id of excluded)if(id>=0&&id<visibleData.length)visibleData[id]=0;
      visibilityUniforms.sourceWorldCulling.value=1;
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
    const position=new T.Vector3(),normal=new T.Vector3();
    const worldMatrix=new T.Matrix4(),normalMatrix=new T.Matrix3();
    for(const list of groups.values()){
      if(!list.length)continue;
      const first=list[0],firstGeometry=first.mesh.geometry;
      // uv2 carries the Source face id only; it is re-encoded as sourceFaceId.
      const attributeNames=Object.keys(firstGeometry.attributes).filter(name=>name!=='uv2');
      const totalVertices=list.reduce((n,candidate)=>n+candidate.vertices,0);
      const totalIndices=list.reduce((n,candidate)=>n+candidate.indices,0);
      const buffers=new Map<string,T.TypedArray>();
      for(const name of attributeNames){
        const source=firstGeometry.attributes[name] as T.BufferAttribute;
        const Constructor=source.array.constructor as new(length:number)=>T.TypedArray;
        buffers.set(name,new Constructor(totalVertices*source.itemSize));
      }
      const faceIds=new Float32Array(totalVertices);
      const IndexType=totalVertices>65535?Uint32Array:Uint16Array;
      const indices=new IndexType(totalIndices);
      let vertexBase=0,indexBase=0;
      for(const candidate of list){
        const geometry=candidate.mesh.geometry;
        candidate.mesh.updateWorldMatrix(true,false);
        worldMatrix.copy(candidate.mesh.matrixWorld);
        normalMatrix.getNormalMatrix(worldMatrix);
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
          }else{
            (target as T.TypedArray).set(attribute.array as never,vertexBase*itemSize);
          }
        }
        const faces=geometry.getAttribute('uv2') as T.BufferAttribute;
        for(let i=0;i<candidate.vertices;i++)faceIds[vertexBase+i]=faces.getX(i);
        const index=geometry.index!;
        for(let i=0;i<candidate.indices;i++)indices[indexBase+i]=index.getX(i)+vertexBase;
        vertexBase+=candidate.vertices;indexBase+=candidate.indices;
      }
      const geometry=new T.BufferGeometry();
      for(const name of attributeNames){
        const source=firstGeometry.attributes[name] as T.BufferAttribute;
        geometry.setAttribute(name,new T.BufferAttribute(buffers.get(name)!,source.itemSize,source.normalized));
      }
      geometry.setAttribute('sourceFaceId',new T.BufferAttribute(faceIds,1));
      geometry.setIndex(new T.BufferAttribute(indices,1));
      geometry.computeBoundingSphere();
      const source=first.mesh.material as T.MeshBasicMaterial;
      const material=new T.MeshBasicMaterial({map:source.map,lightMap:source.lightMap,color:source.color.clone(),
        side:source.side,transparent:source.transparent,opacity:source.opacity,alphaTest:source.alphaTest,
        depthWrite:source.depthWrite,depthTest:source.depthTest,toneMapped:source.toneMapped,fog:source.fog});
      material.name=(source.name||'world')+' / original world batched';
      const originalOnCompile=source.onBeforeCompile;
      // Chain after the HDR lightmap decode injection so one program carries
      // both the original per-texel decode and the per-vertex PVS lookup.
      material.onBeforeCompile=(shader,renderer)=>{
        // The lightmap adapter installs an arrow function (no `this`), so a
        // direct call chains its HDR decode injection into this program.
        originalOnCompile?.(shader,renderer);
        const vc='#include <common>',pv='#include <project_vertex>';
        if(!shader.vertexShader.includes(vc)||!shader.vertexShader.includes(pv))
          throw Error('Three world batch shader contract changed');
        Object.assign(shader.uniforms,visibilityUniforms);
        shader.vertexShader=shader.vertexShader
          .replace(vc,vc+visibilityDeclarations())
          .replace(pv,pv+visibilityProjection());
      };
      material.customProgramCacheKey=()=>(source.customProgramCacheKey?.()??'world')+'+source-world-batch-r1';
      const mesh=new T.Mesh(geometry,material);
      mesh.name='source_world_batch_'+(source.name||'material').replaceAll('/','_');
      mesh.matrixAutoUpdate=false;
      mesh.userData.sourceWorldBatch=true;
      submissions.push(createSourcePVSSubmission(mesh,sourcePVSTriangleSpans(indices,faceIds)));
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
    const audit:SourceWorldBatchAudit={
      pvs:pvsAudit=sourcePVSSubmissionAudit(submissions),
      groups:merged.length,mergedMeshes:merged.length,sourceMeshes:restored.length,
      mergedTriangles,sourceTriangles:mergedTriangles,mergedVertices,vertexBytes,indexBytes,
      faceTextureSide:visibleSide,faceCount,skipped,
    };
    setVisibleFaces(null,0);
    return {audit,setVisibleFaces,dispose};
  }catch(error){dispose();throw error;}
}
