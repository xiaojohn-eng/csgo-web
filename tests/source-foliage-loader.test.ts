import {expect,it,vi} from 'vitest';
import * as T from 'three';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {loadSourceFoliage,prepareSourceFoliageData,type SourceFoliageDescriptor} from '../game/source-foliage-loader';
const descriptor=JSON.parse(readFileSync('.reference-assets/source-exports/dust2-vhv/foliage/bindings.json','utf8')) as SourceFoliageDescriptor;
const sha=(a:ArrayBufferView)=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
function fixture(){
 const d=structuredClone(descriptor),r=d.records[0];d.records=[r];
 const root=new T.Group(),anchor=new T.Group();anchor.name='static_prop_'+r.propId;anchor.userData.sourceModel=r.model;root.add(anchor);
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));geometry.setAttribute('normal',new T.Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3));geometry.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,0,1],2));geometry.setIndex([0,1,2]);
 const material=new T.MeshStandardMaterial();material.name=r.materialName;material.userData.full_path=r.material;const mesh=new T.Mesh(geometry,material);mesh.matrixAutoUpdate=false;mesh.matrix.fromArray(r.meshToSceneMatrix);anchor.add(mesh);
 r.vertexCount=3;r.indexCount=3;r.mappingOffset=0;r.lightingVertexOffset=0;r.lightingVertexCount=3;
 r.attributeSha256={POSITION:sha(geometry.attributes.position.array),NORMAL:sha(geometry.attributes.normal.array),TEXCOORD_0:sha(geometry.attributes.uv.array)};r.indexSha256=sha(geometry.index!.array);
 const remap=new Uint32Array([0,1,2]),lighting=new Uint8Array(36).fill(64);
 d.files={'remap.u32':{url:'remap.u32',bytes:remap.byteLength,sha256:sha(remap)},'lighting.bin':{url:'lighting.bin',bytes:lighting.byteLength,sha256:sha(lighting)}};
 const gltf={scene:root,parser:{associations:new Map([[mesh,{meshes:r.mesh,primitives:r.primitive}]])}} as unknown as GLTF;
 return {d,mesh,material,gltf,remap:remap.buffer,lighting:lighting.buffer};
}
it('is off by default and performs no fetch or scene work',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);try{const f=fixture(),owner=await loadSourceFoliage(f.gltf,{baseURL:'http://lan/vhv/foliage/',state:{timeSeconds:0,windSourceXY:[0,0]}});expect(owner.audit.enabled).toBe(false);expect(fetch).not.toHaveBeenCalled();expect(f.mesh.material).toBe(f.material);}finally{vi.unstubAllGlobals();}
});
it('verifies exact original matrices/accessors and refuses changed bytes before material mutation',async()=>{
 const f=fixture();const result=await prepareSourceFoliageData(f.gltf,f.d,f.remap,f.lighting);expect(result.bindings).toHaveLength(1);expect(result.verification.hashVerified).toBe(true);expect(f.mesh.material).toBe(f.material);
 f.mesh.matrix.elements[12]+=.1;await expect(prepareSourceFoliageData(f.gltf,f.d,f.remap,f.lighting)).rejects.toThrow(/transform/);f.mesh.matrix.elements[12]-=.1;
 f.mesh.geometry.attributes.uv.setY(0,.1);await expect(prepareSourceFoliageData(f.gltf,f.d,f.remap,f.lighting)).rejects.toThrow(/SHA/);expect(f.mesh.material).toBe(f.material);
});
it('enforces compact-byte identity and cancellation before binding',async()=>{
 const f=fixture(),bad=f.lighting.slice(0);new Uint8Array(bad)[0]^=1;await expect(prepareSourceFoliageData(f.gltf,f.d,f.remap,bad)).rejects.toThrow(/receipt/);
 const abort=new AbortController();abort.abort();await expect(prepareSourceFoliageData(f.gltf,f.d,f.remap,f.lighting,abort.signal)).rejects.toThrow();expect(f.mesh.material).toBe(f.material);
});
