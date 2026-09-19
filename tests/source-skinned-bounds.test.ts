import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {SourceSkinnedBounds} from '../game/source-skinned-bounds';

afterEach(()=>vi.unstubAllGlobals());
function actor(){
 const root=new T.Group(),geometry=new T.BufferGeometry(),material=new T.MeshBasicMaterial();
 geometry.setAttribute('position',new T.Float32BufferAttribute([-.3,0,0,.4,.8,0,.2,1.8,.1],3));
 geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute([0,1,0,0,0,1,0,0,1,0,0,0],4));
 geometry.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0,.5,.5,0,0,1,0,0,0],4));
 const mesh=new T.SkinnedMesh(geometry,material),a=new T.Bone(),b=new T.Bone(),helper=new T.Bone();
 a.add(b,helper);b.position.y=.4;helper.position.set(200,100,300);root.add(mesh,a);
 root.updateMatrixWorld(true);mesh.bind(new T.Skeleton([a,b,helper]));
 return{root,mesh,geometry,material,bones:[a,b,helper]};
}
// Independent evaluation of the actual shader's vec4 blend. In particular this
// preserves a non-unit weight sum until bindMatrixInverse has been applied.
function shaderPoint(mesh:T.SkinnedMesh,index:number){
 const base=T.Mesh.prototype.getVertexPosition.call(mesh,index,new T.Vector3());
 const v=new T.Vector4(base.x,base.y,base.z,1).applyMatrix4(mesh.bindMatrix),blend=new T.Vector4(0,0,0,0);
 const indices=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
 for(let j=0;j<4;j++){const weight=weights.getComponent(index,j);if(!weight)continue;
  const bone=indices.getComponent(index,j),matrix=new T.Matrix4().multiplyMatrices(mesh.skeleton.bones[bone].matrixWorld,mesh.skeleton.boneInverses[bone]);
  blend.addScaledVector(v.clone().applyMatrix4(matrix),weight);
 }
 blend.applyMatrix4(mesh.bindMatrixInverse);return new T.Vector3(blend.x,blend.y,blend.z).applyMatrix4(mesh.matrixWorld);
}
function contains(mesh:T.SkinnedMesh,bounds:T.Box3){
 let error=0;for(let i=0;i<mesh.geometry.getAttribute('position').count;i++)error=Math.max(error,bounds.distanceToPoint(shaderPoint(mesh,i)));
 expect(error).toBeLessThan(1e-8);
}

describe('visible skinned geometry bounds',()=>{
 it('encloses every animated vertex without far-away helper bones or repeated vertex reads',()=>{
  const f=actor(),owner=new SourceSkinnedBounds(),bounds=new T.Box3();
  f.root.position.set(14,2,-11);f.root.rotation.y=.45;f.root.scale.set(1,1.2,.8);
  for(let frame=0;frame<8;frame++){
   f.bones[1].rotation.z=frame*.14;f.bones[1].position.x=frame*.04;f.root.updateMatrixWorld(true);
   expect(owner.update(f.root,bounds)).toBe(bounds);contains(f.mesh,bounds);
   expect(bounds.getSize(new T.Vector3()).length()).toBeLessThan(4);
  }
  expect(owner.audit()).toMatchObject({cacheBuilds:1,vertexReads:3,transformedEnvelopes:2});owner.dispose();
 });
 it('keeps actors with shared geometry and separate skeletons independent',()=>{
  const a=actor(),b=actor(),owner=new SourceSkinnedBounds();b.mesh.geometry=a.geometry;
  b.root.position.x=20;b.bones[1].rotation.z=1.1;a.root.updateMatrixWorld(true);b.root.updateMatrixWorld(true);
  const first=owner.update(a.root),second=owner.update(b.root);
  contains(a.mesh,first);contains(b.mesh,second);expect(first.max.x).toBeLessThan(second.min.x);
  expect(owner.audit()).toMatchObject({cacheBuilds:2,liveGeometries:1});owner.dispose();
 });
 it('encloses detached borrowed viewmodel bones under a camera transform exactly once',()=>{
  const f=actor(),owner=new SourceSkinnedBounds(),camera=new T.PerspectiveCamera();
  f.root.position.set(.2,-.3,-.6);f.bones[1].rotation.z=.7;f.root.updateMatrixWorld(true);
  camera.position.set(12,3,-17);camera.rotation.set(.3,1.1,.2);camera.updateMatrixWorld(true);
  const shadow=new T.SkinnedMesh(f.geometry,f.material);shadow.bindMode=T.DetachedBindMode;shadow.skeleton=f.mesh.skeleton;
  shadow.bindMatrix.copy(f.mesh.bindMatrix);shadow.bindMatrixInverse.copy(f.mesh.bindMatrixInverse);
  // Detached mode recomputes inverse(bindMatrix). Preserve the source's live
  // attached inverse in the borrowed model transform, where it cannot be reset.
  shadow.matrixAutoUpdate=false;shadow.matrix.multiplyMatrices(camera.matrixWorld,f.mesh.matrixWorld)
   .multiply(f.mesh.bindMatrixInverse).multiply(f.mesh.bindMatrix);shadow.layers.disableAll();
  const root=new T.Group();root.add(shadow);root.updateMatrixWorld(true);
  const bounds=owner.update(root);contains(shadow,bounds);
  for(let i=0;i<3;i++)expect(bounds.distanceToPoint(shaderPoint(f.mesh,i).applyMatrix4(camera.matrixWorld))).toBeLessThan(1e-8);
  expect(shadow.skeleton).toBe(f.mesh.skeleton);owner.dispose();
 });
 it('bounds zero and non-unit positive weights about the world mesh origin without normalizing the asset',()=>{
  const f=actor(),owner=new SourceSkinnedBounds();
  f.geometry.setAttribute('skinWeight',new T.Float32BufferAttribute([0,0,0,0,.7,.7,0,0,.3,0,0,0],4));
  f.root.position.set(30,-2,17);f.mesh.position.set(1,2,3);f.root.updateMatrixWorld(true);
  const bounds=owner.update(f.root);contains(f.mesh,bounds);
  expect(f.geometry.getAttribute('skinWeight').getX(1)).toBeCloseTo(.7);owner.dispose();
 });
 it('ignores hidden weapon wrappers, bodygroups, material groups and ancestors above the supplied root',()=>{
  const f=actor(),owner=new SourceSkinnedBounds(),wrapper=new T.Group(),outer=new T.Group();
  const gun=new T.Mesh(new T.BoxGeometry(2,1,1),new T.MeshBasicMaterial());gun.position.x=50;
  wrapper.name='SourceHeldWeaponVisibility';wrapper.add(gun);f.root.add(wrapper);outer.add(f.root);outer.updateMatrixWorld(true);
  expect(owner.update(f.root).max.x).toBe(51);wrapper.visible=false;
  expect(owner.update(f.root).max.x).toBeLessThan(1);wrapper.visible=true;(gun.material as T.Material).visible=false;
  expect(owner.update(f.root).max.x).toBeLessThan(1);outer.visible=false;expect(owner.update(f.root).isEmpty()).toBe(true);outer.visible=true;
  f.mesh.visible=false;expect(owner.update(f.root).isEmpty()).toBe(true);owner.dispose();
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0,50,0,0,51,0,0,50,1,0],3));
  geometry.addGroup(0,3,0);geometry.addGroup(3,3,1);const one=new T.MeshBasicMaterial(),two=new T.MeshBasicMaterial();two.visible=false;
  const mesh=new T.Mesh(geometry,[one,two]),groups=new SourceSkinnedBounds();mesh.updateMatrixWorld(true);
  expect(groups.update(mesh).max.x).toBe(1);two.visible=true;expect(groups.update(mesh).max.x).toBe(51);
  expect(groups.audit().cacheBuilds).toBe(1);groups.dispose();
 });
 it('respects index/drawRange and rebuilds after live position or bind changes',()=>{
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,2,1,0,1000,1000,1000],3));geometry.setIndex([0,1,2]);geometry.setDrawRange(0,2);
  const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial()),owner=new SourceSkinnedBounds();mesh.updateMatrixWorld(true);
  expect(owner.update(mesh).max.x).toBe(2);const position=geometry.getAttribute('position');position.setX(1,3);position.needsUpdate=true;
  expect(owner.update(mesh).max.x).toBe(3);geometry.setDrawRange(0,3);expect(owner.update(mesh).max.x).toBe(1000);
  expect(owner.audit().cacheBuilds).toBe(3);
  const f=actor();f.root.updateMatrixWorld(true);owner.update(f.root);f.mesh.bindMatrix.makeTranslation(0,2,0);contains(f.mesh,owner.update(f.root));
  f.mesh.skeleton.boneInverses[1].makeRotationX(.4);contains(f.mesh,owner.update(f.root));expect(owner.audit().cacheBuilds).toBe(6);owner.dispose();
 });
 it.each([false,true])('bounds changing positive and negative morph influences (relative=%s) from cached deltas',relative=>{
  const f=actor(),owner=new SourceSkinnedBounds();f.geometry.morphTargetsRelative=relative;
  f.geometry.morphAttributes.position=[new T.Float32BufferAttribute([1,2,3,-4,-5,6,7,8,9],3)];f.mesh.updateMorphTargets();
  f.bones[1].rotation.y=.5;f.root.updateMatrixWorld(true);
  for(const influence of [0,1,-.7,2]){f.mesh.morphTargetInfluences![0]=influence;contains(f.mesh,owner.update(f.root));}
  expect(owner.audit().cacheBuilds).toBe(1);owner.dispose();
 });
 it('does not revisit disposed geometry or dispose borrowed resources, and follows replacement geometry',()=>{
  const f=actor(),owner=new SourceSkinnedBounds();f.root.updateMatrixWorld(true);owner.update(f.root);
  f.geometry.dispose();const getAttribute=vi.spyOn(f.geometry,'getAttribute');expect(owner.update(f.root).isEmpty()).toBe(true);expect(getAttribute).not.toHaveBeenCalled();
  const replacement=f.geometry.clone();f.mesh.geometry=replacement;expect(owner.update(f.root).isEmpty()).toBe(false);
  const dispose=vi.fn();replacement.addEventListener('dispose',dispose);f.material.addEventListener('dispose',dispose);owner.dispose();owner.dispose();
  expect(dispose).not.toHaveBeenCalled();expect(owner.audit().liveGeometries).toBe(0);expect(()=>owner.update(f.root)).toThrow('disposed');getAttribute.mockRestore();
 });
 it('refuses a negative weight rather than claiming its convex bound is safe',()=>{
  const f=actor(),owner=new SourceSkinnedBounds();f.geometry.getAttribute('skinWeight').setX(0,-.1);
  expect(()=>owner.update(f.root)).toThrow('nonnegative');owner.dispose();
 });
 it('encloses all actual original T/AWP character vertices in multiple poses with no repeated vertex walk',async()=>{
  const path=resolve('public/source/csgo-12426148/character-t-awp'),manifest=JSON.parse(readFileSync(path+'/manifest.json','utf8'));
  const bytes=readFileSync(path+'/'+manifest.model),size=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(12,true),doc=JSON.parse(bytes.subarray(20,20+size).toString()),binary=bytes.subarray(28+size);
  doc.materials=doc.materials.map((material:{name:string})=>({name:material.name}));delete doc.images;delete doc.textures;delete doc.extensionsUsed;delete doc.extensionsRequired;
  doc.buffers=[{byteLength:binary.byteLength,uri:'data:application/octet-stream;base64,'+Buffer.from(binary).toString('base64')}];
  if(!globalThis.ProgressEvent)vi.stubGlobal('ProgressEvent',class{constructor(type:string,values:object){Object.assign(this,{type},values);}});
  const gltf=await new GLTFLoader().parseAsync(JSON.stringify(doc),''),owner=new SourceSkinnedBounds(),meshes:T.SkinnedMesh[]=[],bones=new Set<T.Bone>();
  gltf.scene.traverse(object=>{if(object instanceof T.SkinnedMesh){meshes.push(object);object.skeleton.bones.forEach(bone=>bones.add(bone));}});
  gltf.scene.scale.setScalar(.0254);gltf.scene.position.set(10,2,-13);
  expect(meshes.length).toBeGreaterThan(1);let firstReads=0;
  for(let frame=0;frame<3;frame++){
   if(frame)for(const bone of bones)bone.rotation.z+=.03;
   gltf.scene.updateMatrixWorld(true);const bounds=owner.update(gltf.scene);
   meshes.forEach(mesh=>contains(mesh,bounds));if(!frame)firstReads=owner.audit().vertexReads;
   expect(owner.audit().vertexReads).toBe(firstReads);
  }
  expect(firstReads).toBeGreaterThan(10000);expect(owner.audit().cacheBuilds).toBe(meshes.length);owner.dispose();
 });
});
