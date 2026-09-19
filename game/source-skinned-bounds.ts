import * as T from 'three';

type Attribute=T.BufferAttribute|T.InterleavedBufferAttribute;
type Envelope={bone:number;base:T.Box3;morphs:T.Box3[]};
type Part={material:number|null;envelopes:Envelope[];weightMin:number;weightMax:number};
type Cached={geometry:T.BufferGeometry;attributes:Attribute[];versions:number[];layout:string;
  skeleton:T.Skeleton|null;bind:T.Matrix4;inverses:{bone:number;matrix:T.Matrix4}[];parts:Part[]};
const version=(attribute:Attribute)=>attribute instanceof T.InterleavedBufferAttribute?attribute.data.version:attribute.version;

/** Conservative world bounds for the meshes an actor actually displays.
 *
 * Only cache construction reads vertices. A nonzero-weight vertex is enclosed
 * in each influencing bone's inverse-bind frame; transforming these boxes and
 * taking their union encloses every nonnegative weighted blend. Unused helper
 * bones therefore have no effect. Morph deltas use interval sums, including
 * negative influences. Non-unit skin weights are bounded about the mesh origin
 * using their actual sum, matching the shader's homogeneous skinning equation.
 *
 * Call after the owner has updated mesh/bone matrixWorld and bindMatrixInverse.
 * This helper deliberately does not update them: detached viewmodel shadows may
 * borrow live bones outside their own subtree. It neither owns nor disposes any
 * model resources. Pass actor/weapon roots, never a released world-map scene.
 */
export class SourceSkinnedBounds {
  private cache=new WeakMap<T.Mesh,Cached>();
  private disposedGeometry=new WeakSet<T.BufferGeometry>();
  private geometryListeners=new Map<T.BufferGeometry,()=>void>();
  private matrix=new T.Matrix4();
  private outer=new T.Matrix4();
  private box=new T.Box3();
  private partBox=new T.Box3();
  private origin=new T.Vector3();
  private disposed=false;
  private builds=0;
  private vertexReads=0;
  private transformedEnvelopes=0;
  private visibleMeshes=0;

  /** Empty means no visible, live geometry. Camera layers are intentionally not
   * tested: borrowed silhouette meshes have disabled ordinary colour layers. */
  update(root:T.Object3D,target=new T.Box3()):T.Box3 {
    if(this.disposed)throw Error('Source skinned bounds disposed');
    target.makeEmpty();this.transformedEnvelopes=0;this.visibleMeshes=0;
    for(let parent:T.Object3D|null=root.parent;parent;parent=parent.parent)if(!parent.visible)return target;
    const visit=(object:T.Object3D)=>{
      if(!object.visible)return;
      if(object instanceof T.Mesh)this.include(object,target);
      for(const child of object.children)visit(child);
    };
    visit(root);return target;
  }

  private include(mesh:T.Mesh,target:T.Box3) {
    const materials=Array.isArray(mesh.material)?mesh.material:null;
    if(materials?!materials.some(material=>material.visible):!(mesh.material as T.Material).visible)return;
    const geometry=mesh.geometry;
    // A renderer may remove a model a frame after its resource owner disposes it.
    // In particular, never inspect attributes of a geometry already released.
    if(this.disposedGeometry.has(geometry))return;
    const position=geometry.getAttribute('position');if(!position)return;
    const skin=mesh instanceof T.SkinnedMesh?mesh:null;
    const attributes=[position,...(geometry.index?[geometry.index]:[]),
      ...(skin?[geometry.getAttribute('skinIndex'),geometry.getAttribute('skinWeight')]:[]),
      ...(geometry.morphAttributes.position??[])];
    if(attributes.some(attribute=>!attribute))throw Error('Source skinned bounds requires skinIndex and skinWeight');
    const layout=JSON.stringify([!!materials,geometry.drawRange,geometry.groups,geometry.morphTargetsRelative]);
    let cached=this.cache.get(mesh);
    if(!cached||cached.geometry!==geometry||cached.layout!==layout||cached.skeleton!==(skin?.skeleton??null)
      ||attributes.length!==cached.attributes.length||attributes.some((attribute,i)=>attribute!==cached!.attributes[i]||version(attribute)!==cached!.versions[i])
      ||(skin&&(!cached.bind.equals(skin.bindMatrix)||cached.inverses.some(row=>!skin.skeleton.boneInverses[row.bone]?.equals(row.matrix))))) {
      cached=this.build(mesh,attributes,layout);this.cache.set(mesh,cached);
    }
    this.visibleMeshes++;
    this.origin.setFromMatrixPosition(mesh.matrixWorld);
    this.outer.copy(mesh.matrixWorld);if(skin)this.outer.multiply(skin.bindMatrixInverse);
    for(const part of cached.parts){
      if(materials&&!materials[part.material!]?.visible)continue;
      this.partBox.makeEmpty();
      for(const envelope of part.envelopes){
        this.box.copy(envelope.base);
        for(let i=0;i<envelope.morphs.length;i++){
          const influence=mesh.morphTargetInfluences?.[i]??0;if(!influence)continue;
          if(!Number.isFinite(influence))throw Error('Non-finite source morph influence');
          const delta=envelope.morphs[i];
          for(const axis of ['x','y','z']as const){
            this.box.min[axis]+=influence*(influence>0?delta.min[axis]:delta.max[axis]);
            this.box.max[axis]+=influence*(influence>0?delta.max[axis]:delta.min[axis]);
          }
        }
        this.matrix.copy(this.outer);
        if(skin)this.matrix.multiply(skin.skeleton.bones[envelope.bone].matrixWorld);
        this.partBox.union(this.box.applyMatrix4(this.matrix));this.transformedEnvelopes++;
      }
      if(skin){
        // The model matrix adds its translation once after skinning. A weight
        // sum s scales the convex bound relative to that translation, not zero.
        if(this.partBox.isEmpty()){if(part.weightMin===0)this.partBox.expandByPoint(this.origin);}
        else for(const axis of ['x','y','z']as const){
          const lo=this.partBox.min[axis]-this.origin[axis],hi=this.partBox.max[axis]-this.origin[axis];
          this.partBox.min[axis]=this.origin[axis]+Math.min(lo*part.weightMin,lo*part.weightMax);
          this.partBox.max[axis]=this.origin[axis]+Math.max(hi*part.weightMin,hi*part.weightMax);
        }
      }
      target.union(this.partBox);
    }
  }

  private build(mesh:T.Mesh,attributes:Attribute[],layout:string):Cached {
    const geometry=mesh.geometry,position=geometry.getAttribute('position'),index=geometry.index;
    const skin=mesh instanceof T.SkinnedMesh?mesh:null;
    const weights=geometry.getAttribute('skinWeight'),indices=geometry.getAttribute('skinIndex');
    const morphs=geometry.morphAttributes.position??[],point=new T.Vector3(),base=new T.Vector3(),delta=new T.Vector3();
    const transforms=new Map<number,{local:T.Matrix4;linear:T.Matrix3}>(),inverses=new Map<number,T.Matrix4>();
    const ranges=Array.isArray(mesh.material)?geometry.groups:[{start:0,count:Infinity,materialIndex:null}];
    const parts:Part[]=[];
    for(const range of ranges){
      const start=Math.max(0,range.start,geometry.drawRange.start);
      const end=Math.min(index?.count??position.count,range.start+range.count,geometry.drawRange.start+geometry.drawRange.count);
      const vertices=new Set<number>();for(let i=start;i<end;i++)vertices.add(index?index.getX(i):i);
      if(!vertices.size)continue;
      const envelopes=new Map<number,Envelope>();let weightMin=Infinity,weightMax=-Infinity;
      for(const vertex of vertices){
        if(!Number.isInteger(vertex)||vertex<0||vertex>=position.count)throw Error('Invalid source bounds vertex index');
        base.fromBufferAttribute(position,vertex);this.vertexReads++;
        if(![base.x,base.y,base.z].every(Number.isFinite))throw Error('Non-finite source bounds position');
        let sum=0;
        for(let channel=0;channel<(skin?4:1);channel++){
          const weight=skin?weights.getComponent(vertex,channel):1;
          if(!Number.isFinite(weight)||weight<0)throw Error('Source bounds requires nonnegative finite skin weights');
          sum+=weight;if(!weight)continue;
          const bone=skin?indices.getComponent(vertex,channel):-1;
          if(skin&&(!Number.isInteger(bone)||!skin.skeleton.bones[bone]||!skin.skeleton.boneInverses[bone]))throw Error('Invalid source bounds bone index');
          let envelope=envelopes.get(bone);
          if(!envelope){envelope={bone,base:new T.Box3(),morphs:morphs.map(()=>new T.Box3())};envelopes.set(bone,envelope);}
          let transform=transforms.get(bone);
          if(!transform){
            const local=new T.Matrix4();if(skin){local.multiplyMatrices(skin.skeleton.boneInverses[bone],skin.bindMatrix);inverses.set(bone,skin.skeleton.boneInverses[bone].clone());}
            transform={local,linear:new T.Matrix3().setFromMatrix4(local)};transforms.set(bone,transform);
          }
          envelope.base.expandByPoint(point.copy(base).applyMatrix4(transform.local));
          morphs.forEach((attribute,i)=>{
            delta.fromBufferAttribute(attribute,vertex);if(!geometry.morphTargetsRelative)delta.sub(base);
            if(![delta.x,delta.y,delta.z].every(Number.isFinite))throw Error('Non-finite source bounds morph');
            envelope!.morphs[i].expandByPoint(delta.applyMatrix3(transform!.linear));
          });
        }
        weightMin=Math.min(weightMin,sum);weightMax=Math.max(weightMax,sum);
      }
      parts.push({material:range.materialIndex??null,envelopes:[...envelopes.values()],weightMin,weightMax});
    }
    if(!this.geometryListeners.has(geometry)){
      const dispose=()=>{this.disposedGeometry.add(geometry);geometry.removeEventListener('dispose',dispose);this.geometryListeners.delete(geometry);};
      geometry.addEventListener('dispose',dispose);this.geometryListeners.set(geometry,dispose);
    }
    this.builds++;
    return{geometry,attributes,versions:attributes.map(version),layout,skeleton:skin?.skeleton??null,
      bind:skin?.bindMatrix.clone()??new T.Matrix4(),inverses:[...inverses].map(([bone,matrix])=>({bone,matrix})),parts};
  }

  audit(){return{cacheBuilds:this.builds,vertexReads:this.vertexReads,visibleMeshes:this.visibleMeshes,
    transformedEnvelopes:this.transformedEnvelopes,liveGeometries:this.geometryListeners.size};}
  dispose(){
    if(this.disposed)return;
    for(const [geometry,listener]of this.geometryListeners)geometry.removeEventListener('dispose',listener);
    this.geometryListeners.clear();this.cache=new WeakMap();this.disposed=true;
  }
}
