import {describe,expect,it,vi} from 'vitest';
import * as T from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {createHash} from 'node:crypto';
import {prepareSourcePropLightingData,type PropVhvDescriptor} from '../scripts/preview-source-prop-lighting';
const sha=(data:ArrayBufferView)=>createHash('sha256').update(new Uint8Array(data.buffer,data.byteOffset,data.byteLength)).digest('hex');
function fixture(){
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setAttribute('normal',new T.Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3));geometry.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,0,1],2));geometry.setIndex([0,1,2]);
  const material=new T.MeshStandardMaterial({map:new T.Texture(),normalMap:new T.Texture()});material.name='short_name';material.userData.full_path='models/full_name';
  const mesh=new T.Mesh(geometry,material),anchor=new T.Group(),scene=new T.Group();mesh.name='static_prop_0_mesh_0';
  anchor.name='static_prop_0';anchor.userData={sourceModel:'models/p.mdl',sourceSkin:0};anchor.add(mesh);scene.add(anchor);
  const gltf={scene,parser:{associations:new Map([[mesh,{meshes:0,primitives:0}]]),getDependency:async()=>material}} as unknown as GLTF;
  const remap=new Uint32Array([0,1,2]),lighting=new Uint8Array(36);
  const descriptor:PropVhvDescriptor={format:'source-prop-vhv-v1',sourceBspSha256:'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc',
    originalGLBSha256:'55937fce28a53461520fa2c531384f65f0f8b69df1a8205245466b6064ab5232',
    files:{remap:{url:'map',bytes:12,sha256:sha(remap)},lighting:{url:'lighting',bytes:36,sha256:sha(lighting)}},
    materials:[{source:'models/full_name',shader:'vertexlitgeneric',parameters:{$basetexture:'b',$bumpmap:'n'},mapped:['tangent normal with green inversion']}],
    instances:[{index:0,model:'models/p.mdl',skin:0,modelIndex:0,lightingVertexOffset:0,lightingVertexCount:3}],
    records:[{mesh:0,primitive:0,model:'models/p.mdl',skin:0,part:0,material:0,materialName:'short_name',materialSource:'models/full_name',
      vertexCount:3,indexCount:3,sourceModelIndex:0,mapOffset:0,mapBytes:12,verified:true,
      attributeSha256:{POSITION:sha(geometry.attributes.position.array),NORMAL:sha(geometry.attributes.normal.array),TEXCOORD_0:sha(geometry.attributes.uv.array)},indexSha256:sha(geometry.index!.array)}]};
  return {gltf,descriptor,remap:remap.buffer,lighting:lighting.buffer,geometry,material,mesh,anchor};
}
describe('private original prop adapter identity gate',()=>{
  it('only admits the exact tint candidate and copies this original instance RGB without its alpha',async()=>{
    const f=fixture();f.descriptor.materials[0].parameters.$tintmasktexture='original/tint';
    const texture=new T.Texture(),rgba=new Uint8Array(3158*4).fill(255);rgba.set([128,64,32,17]);
    const tints={materials:new Map([['models/full_name',{texture,source:'materials/original/tint.vtf'}]]),rgba};
    const off=await prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting);expect(off.bindings).toHaveLength(0);
    const on=await prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting,undefined,false,undefined,tints);
    expect(on.bindings).toHaveLength(1);expect(on.bindings[0].instanceRGB).toEqual([128,64,32]);expect(on.bindings[0].tintMap).toBe(texture);
    tints.materials.clear();const omitted=await prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting,undefined,false,undefined,tints);
    expect(omitted.bindings).toHaveLength(0);expect(omitted.verification.skipped[0].reasons).toContain('outside bounded original tint material candidates');
    tints.materials.set('models/full_name',{texture,source:'materials/wrong.vtf'});
    await expect(prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting,undefined,false,undefined,tints)).rejects.toThrow(/tint\/instance RGB identity/);
    expect(f.mesh.material).toBe(f.material);
  });
  it('requires explicit opt-in for an original plain material with no normal texture',async()=>{
    const f=fixture();f.material.normalMap=null;f.descriptor.materials[0].parameters={$basetexture:'b'};f.descriptor.materials[0].mapped=[];
    expect((await prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting)).bindings).toHaveLength(0);
    const result=await prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting,undefined,true);
    expect(result.bindings).toHaveLength(1);expect(result.bindings[0].normalMap).toBeUndefined();expect(result.enablePlainUnbumped).toBe(true);
  });
  it('honors a cancelled load before preparing any bindings or hashes',async()=>{
    const f=fixture(),controller=new AbortController();controller.abort();
    await expect(prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting,controller.signal)).rejects.toThrow();
    expect(f.mesh.material).toBe(f.material);
  });
  it.each([undefined,{}])('keeps all receipt checks active on an insecure HTTP origin without subtle (%s)',async crypto=>{
    const f=fixture();vi.stubGlobal('crypto',crypto);
    try{
      const result=await prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting);expect(result.bindings).toHaveLength(1);
      f.geometry.attributes.position.setX(0,.1);
      await expect(prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting)).rejects.toThrow(/accessor bytes differ/);
      new Uint8Array(f.lighting)[0]=2;
      await expect(prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting)).rejects.toThrow(/binary receipt differs/);
    }finally{vi.unstubAllGlobals();}
  });
  it('accepts observed short display names only through the original full_path receipt without editing the scene',async()=>{
    const f=fixture(),result=await prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting);
    expect(result.bindings).toHaveLength(1);expect(result.bindings[0].materialName).toBe('short_name');
    expect(result.bindings[0].source.source).toBe('models/full_name');expect(result.verification.uniqueGeometryReceipts).toBe(1);
    expect(f.mesh.geometry).toBe(f.geometry);expect(f.mesh.material).toBe(f.material);
  });
  it('rejects changed source indices even when counts and positions remain identical',async()=>{
    const f=fixture();f.geometry.setIndex([1,0,2]);
    await expect(prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting)).rejects.toThrow(/index bytes differ/);
    expect(f.mesh.material).toBe(f.material);
  });
  it('rejects mismatched instance/material identities and corrupt binary bytes',async()=>{
    const f=fixture();f.anchor.userData.sourceSkin=1;
    await expect(prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting)).rejects.toThrow(/instance identity/);
    f.anchor.userData.sourceSkin=0;f.material.userData.full_path='models/similar_name';
    await expect(prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting)).rejects.toThrow(/material identity/);
    f.material.userData.full_path='models/full_name';new Uint8Array(f.lighting)[0]=1;
    await expect(prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting)).rejects.toThrow(/binary receipt/);
  });
  it('leaves ambiguous original triangles unchanged and accounts for their complete primitive',async()=>{
    const f=fixture();f.descriptor.records[0].verified=false;
    const result=await prepareSourcePropLightingData(f.gltf,f.descriptor,f.remap,f.lighting);
    expect(result.bindings).toHaveLength(0);expect(result.verification.skipped[0].triangles).toBe(1);
    expect(result.verification.skipped[0].reasons).toContain('ambiguous original triangle lighting identity');expect(f.mesh.material).toBe(f.material);
  });
});
