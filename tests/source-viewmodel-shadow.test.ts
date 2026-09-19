import * as T from 'three';
import {expect,it,vi} from 'vitest';
import {SourceViewmodelShadow} from '../game/source-viewmodel-shadow';
it('maps the current skinned vertex from view to world once without owning the source resources',()=>{
  const scene=new T.Scene(),model=new T.Group(),geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute([.1,.2,-.4],3));
  geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute([0,0,0,0],4));
  geometry.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0],4));
  const material=new T.MeshBasicMaterial(),source=new T.SkinnedMesh(geometry,material),bone=new T.Bone();
  model.add(source,bone);model.updateMatrixWorld(true);source.bind(new T.Skeleton([bone]));
  bone.rotation.z=.8;bone.position.y=.05;model.position.z=-.2;
  const camera=new T.PerspectiveCamera();camera.position.set(10,2,-4);camera.rotation.set(.3,1.1,.1);camera.updateMatrixWorld(true);
  const owner=new SourceViewmodelShadow(scene);const caster=owner.update(model,camera)!;
  const shadow=owner.group.children[0]as T.SkinnedMesh;shadow.updateMatrixWorld(true);
  // The subsequent real colour pass refresh must match the borrowed shadow.
  model.updateMatrixWorld(true);
  const expected=source.applyBoneTransform(0,new T.Vector3(.1,.2,-.4)).applyMatrix4(source.matrixWorld).applyMatrix4(camera.matrixWorld);
  const actual=shadow.applyBoneTransform(0,new T.Vector3(.1,.2,-.4)).applyMatrix4(shadow.matrixWorld);
  expect(actual.distanceTo(expected)).toBeLessThan(1e-7);expect(shadow.layers.mask).toBe(0);
  expect(shadow.skeleton).toBe(source.skeleton);expect(caster.bounds!.isEmpty()).toBe(false);
  const freed=vi.fn();geometry.addEventListener('dispose',freed);material.addEventListener('dispose',freed);
  owner.dispose();expect(freed).not.toHaveBeenCalled();expect(model.children).toEqual([source,bone]);
});
