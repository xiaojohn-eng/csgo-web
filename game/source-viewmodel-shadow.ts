import * as T from 'three';
import type {SourceProjectedShadowCaster} from './source-projected-shadows';
import {SourceSkinnedBounds} from './source-skinned-bounds';

/** Shadow-only draws borrow the current viewmodel geometry and skeleton.
 * Detached bind matrices retain the original view-space skinning; the camera
 * transform is applied once by the borrowed mesh's world matrix. No second
 * animation clock or hidden material override is installed on the real gun. */
export class SourceViewmodelShadow {
  readonly group=new T.Group();
  private model:T.Object3D|null=null;
  private meshes:{source:T.Mesh;shadow:T.Mesh}[]=[];
  private boundsOwner=new SourceSkinnedBounds();
  constructor(scene:T.Scene){this.group.name='SourceViewmodelProjectedShadow';scene.add(this.group);}
  update(model:T.Object3D|null,camera:T.Camera):SourceProjectedShadowCaster|null{
    if(this.model!==model){
      this.group.clear();this.meshes=[];this.model=model;
      model?.traverse(object=>{
        const source=object as T.Mesh;if(!source.isMesh)return;
        const shadow=source instanceof T.SkinnedMesh?new T.SkinnedMesh(source.geometry,source.material):new T.Mesh(source.geometry,source.material);
        shadow.matrixAutoUpdate=false;shadow.frustumCulled=false;shadow.layers.disableAll();shadow.castShadow=false;
        if(source instanceof T.SkinnedMesh&&shadow instanceof T.SkinnedMesh){shadow.skeleton=source.skeleton;shadow.bindMode=T.DetachedBindMode;}
        shadow.morphTargetInfluences=source.morphTargetInfluences;this.group.add(shadow);this.meshes.push({source,shadow});
      });
    }
    if(!model||!this.meshes.length)return null;
    model.updateWorldMatrix(true,false);model.updateMatrixWorld(true);camera.updateWorldMatrix(true,false);
    for(const {source,shadow}of this.meshes){
      let visible=true;for(let node:T.Object3D|null=source;node&&node!==model.parent;node=node.parent)visible&&=node.visible;
      shadow.visible=visible;shadow.material=source.material;
      shadow.matrix.multiplyMatrices(camera.matrixWorld,source.matrixWorld);shadow.matrixWorldNeedsUpdate=true;
      if(source instanceof T.SkinnedMesh&&shadow instanceof T.SkinnedMesh){
        shadow.bindMatrix.copy(source.bindMatrix);shadow.bindMatrixInverse.copy(source.bindMatrixInverse);
        // DetachedBindMode refreshes its inverse from bindMatrix. Compensate
        // the borrowed world matrix so an animated attached source transform
        // is still applied exactly once after that refresh.
        shadow.matrix.multiply(source.bindMatrixInverse).multiply(source.bindMatrix);
      }
    }
    this.group.updateMatrixWorld(true);
    const bounds=this.boundsOwner.update(this.group,new T.Box3());
    if(bounds.isEmpty())return null;
    const center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3());
    return{id:'first-person-weapon',object:this.group,origin:new T.Vector3(center.x,bounds.min.y,center.z),radius:Math.max(size.x,size.z)/2,bounds};
  }
  dispose(){this.boundsOwner.dispose();this.group.clear();this.group.removeFromParent();this.meshes=[];this.model=null;}
}
