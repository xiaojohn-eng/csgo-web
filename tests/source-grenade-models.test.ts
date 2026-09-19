import fs from 'node:fs';
import crypto from 'node:crypto';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {describe,it,expect} from 'vitest';
import {SOURCE_GRENADE_COLLIDERS} from '../game/source-grenade-colliders';
import contract from '../game/source-grenade-contract.json';

const base='public/source/csgo-12426148/grenade-models/';
const available=fs.existsSync(base+'manifest.json');
describe.skipIf(!available)('original grenade model receipts and collider alignment',()=>{
 it('checks every staged byte and material input against its frozen manifest',()=>{
  const raw=fs.readFileSync(base+'manifest.json');
  expect(crypto.createHash('sha256').update(raw).digest('hex')).toBe(contract.manifestSha256);
  const manifest=JSON.parse(raw.toString());
  for(const file of manifest.files){
   const data=fs.readFileSync(base+file.path);
   expect(data.length).toBe(file.bytes);
   expect(crypto.createHash('sha256').update(data).digest('hex')).toBe(file.sha256);
  }
  expect(Object.keys(manifest.models).sort()).toEqual(['flash','he','smoke']);
  for(const input of Object.values(manifest.materials)as any[]){
   expect(input.shader.toLowerCase()).toBe('vertexlitgeneric');
   expect(input.textures.$basetexture).toBeTruthy();
   expect(crypto.createHash('sha256').update(input.rawVmt).digest('hex')).toBe(input.sourceSha256);
  }
 });
 for(const kind of ['he','smoke','flash']as const)it(kind+' physical centre and span match the actually skinned glTF body',async()=>{
  const raw=fs.readFileSync(base+kind+'.glb');
  const gltf=await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'');
  const collider=SOURCE_GRENADE_COLLIDERS[kind];
  gltf.scene.scale.setScalar(.0254);
  gltf.scene.position.fromArray(collider.centreMetres).negate();
  gltf.scene.updateMatrixWorld(true);
  const bounds=new T.Box3();let triangles=0;
  gltf.scene.traverse(o=>{
   if(!(o instanceof T.Mesh)||/_pin$|_spoon$/.test(o.name))return;
   if(o instanceof T.SkinnedMesh)o.skeleton.update();
   const point=new T.Vector3(),p=o.geometry.attributes.position;
   for(let i=0;i<p.count;i++){
    point.fromBufferAttribute(p,i);
    if(o instanceof T.SkinnedMesh)o.applyBoneTransform(i,point);
    bounds.expandByPoint(point.applyMatrix4(o.matrixWorld));
   }
   triangles+=(o.geometry.index?.count??p.count)/3;
  });
  const span=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
  expect(center.length()).toBeLessThan(1e-5);
  for(let i=0;i<3;i++)expect(span.getComponent(i)).toBeCloseTo(collider.spanMetres[i],5);
  expect(triangles).toBeGreaterThan(300);
  expect(span.y).toBeLessThan(.25);
  expect(collider.hullMetres.length).toBeGreaterThan(300);
 });
});
