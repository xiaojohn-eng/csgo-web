import {describe,expect,it} from 'vitest';
import * as T from 'three';
import {createSourceSkyBatch} from '../game/source-sky-batch';
import type {SourcePropLightingBinding} from '../game/source-prop-lighting';
import type {SourceOliveBinding} from '../game/source-olive-lighting';

/** Mirrors the sky renderer contract: copies in a separate Source_Original_3D_Sky
 * scene, each mapped back to the original GLTF mesh it borrowed geometry and
 * material from, and the VHV/olive owners installed per-original bindings. */
function fixture(){
  const scene=new T.Scene();scene.name='Source_Original_3D_Sky';
  const props=new T.Group();
  const sourceMeshes=new Map<T.Mesh,T.Mesh>();
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setAttribute('normal',new T.Float32BufferAttribute([0,1,0,0,1,0,0,1,0],3));
  geometry.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,0,1],2));
  geometry.setIndex([0,1,2]);
  const map=new T.Texture();map.channel=0;
  const placements=[[10,0,0,Math.PI/2],[0,20,0,0]] as const;
  const addPair=(name:string,material:T.Material)=>{
    const origins: T.Mesh[]=[],copies: T.Mesh[]=[];
    placements.forEach(([x,y,z,rotation],n)=>{
      const origin=new T.Mesh(geometry,material);origin.name=name+'_origin_'+n;
      origin.position.set(x,y,z);origin.rotation.z=rotation;props.add(origin);origins.push(origin);
      const copy=new T.Mesh(geometry,material);copy.name=name+'_copy_'+n;
      copy.position.set(x,y,z);copy.rotation.z=rotation;scene.add(copy);copies.push(copy);
      sourceMeshes.set(copy,origin);
    });
    return {origins,copies};
  };
  const vhvMaterial=(n:number)=>{
    // Same state as the R5 plain-unbumped replacement the prop owner installs.
    const material=new T.MeshBasicMaterial({map,color:0xffffff});
    material.name='models/skybox/vhv_'+n;
    material.customProgramCacheKey=()=>'source-original-vhv-plain-unbumped-r1';
    return material;
  };
  const oliveMaterial=(n:number)=>{
    const material=new T.MeshBasicMaterial({map,color:0xffffff,side:T.DoubleSide,alphaTest:.3});
    material.name='models/foliage/olive_'+n;
    material.customProgramCacheKey=()=>'source-olive-no-csm-vhv-r1|source-olive-vs128-register-round-r2';
    return material;
  };
  const plainPair=addPair('plain',new T.MeshBasicMaterial({map}));
  const vhvPair=addPair('vhv',vhvMaterial(0));
  // Distinct per-mesh instances with equal render state, like the 48 olives.
  const oliveA=addPair('olive',oliveMaterial(0)),oliveB=addPair('olive',oliveMaterial(1));
  const source={source:'models/test',shader:'vertexlitgeneric',parameters:{$basetexture:'base'},mapped:[]};
  const makeVhv=(mesh:T.Mesh,mappingOffset:number,lightingVertexOffset:number):SourcePropLightingBinding=>
    ({mesh,source,mappingOffset,vertexCount:3,indexCount:3,lightingVertexOffset,lightingVertexCount:3});
  const makeOlive=(mesh:T.Mesh,mappingOffset:number,lightingVertexOffset:number):SourceOliveBinding=>
    ({...makeVhv(mesh,mappingOffset,lightingVertexOffset),
      sourceModelRows:[[1,0,0,0],[0,1,0,0],[0,0,1,0]]});
  const remap=new Uint32Array([2,0,1,1,2,0]);
  const lookup={lighting:new T.DataTexture(new Uint8Array(64*2*4),64,2),width:64};
  const timeWind=new T.Vector4(0,.125,2,0);
  const vhv={bindings:vhvPair.origins.map((mesh,n)=>makeVhv(mesh,n*3,n*5)),remap,lookup};
  const olive={bindings:[...oliveA.origins,...oliveB.origins].map((mesh,n)=>makeOlive(mesh,n*3,n*5)),remap,lookup,timeWind};
  return {scene,props,sourceMeshes,geometry,plain:plainPair,vhv,olive,oliveA,oliveB,map};
}

describe('createSourceSkyBatch',()=>{
  /** Baked matrix math carries ~1e-16 rotation noise (cos(π/2)); compare with
   * tolerance instead of exact float equality. */
  const expectClose=(array:Iterable<number>,expected:number[],precision=12)=>{
    const received=[...array];
    expect(received.length).toBe(expected.length);
    received.forEach((value,i)=>expect(Math.abs(value-expected[i])).toBeLessThan(10**-precision));
  };

  it('merges plain, VHV and olive copies into one draw call per material state',()=>{
    const f=fixture();
    const batch=createSourceSkyBatch({scene:f.scene,sourceMeshes:f.sourceMeshes,vhv:f.vhv,olive:f.olive});
    // The two olive pairs carry distinct material instances with equal render
    // state (like the 48 sky olives), so all four merge into the olive group.
    expect(batch.audit).toMatchObject({groups:3,mergedMeshes:3,sourceMeshes:8,
      mergedTriangles:8,keptTriangles:0,categories:{vhvPlain:1,olive:1,plain:1},skipped:[]});
    const host=f.scene.children.find(child=>child.name==='source_sky_batch');
    expect(host).toBeTruthy();
    batch.dispose();
  });

  it('bakes world transforms exactly and keeps uv/normal attributes',()=>{
    const f=fixture();
    const batch=createSourceSkyBatch({scene:f.scene,sourceMeshes:f.sourceMeshes,vhv:f.vhv,olive:f.olive});
    const merged=(f.scene.getObjectByName('source_sky_batch')!.children.find(child=>child.name==='source_sky_batch_plain') as T.Mesh);
    const position=merged.geometry.getAttribute('position');
    // Copy 0 sits at x=10 with a 90° Z rotation: local (1,0,0) becomes world
    // (10,1,0) and local (0,1,0) becomes world (9,0,0). Copy 1 sits at y=20.
    expectClose(position.array as unknown as number[],[10,0,0,10,1,0,9,0,0, 0,20,0,1,20,0,0,21,0]);
    const normal=merged.geometry.getAttribute('normal');
    expectClose(normal.array as unknown as number[],[-1,0,0,-1,0,0,-1,0,0, 0,1,0,0,1,0,0,1,0]);
    const uv=merged.geometry.getAttribute('uv');
    expect([...uv.array]).toEqual([0,0,1,0,0,1, 0,0,1,0,0,1]);
    const index=merged.geometry.getIndex()!;
    expect([...index.array]).toEqual([0,1,2,3,4,5]);
    expect(index.array).toBeInstanceOf(Uint16Array);
    batch.dispose();
  });

  it('bakes VHV lighting pixels identical to the original gl_VertexID remap',()=>{
    const f=fixture();
    const batch=createSourceSkyBatch({scene:f.scene,sourceMeshes:f.sourceMeshes,vhv:f.vhv,olive:f.olive});
    const merged=f.scene.getObjectByName('source_sky_batch')!.children.find(child=>child.name==='source_sky_batch_vhvPlain') as T.Mesh;
    // (instanceOffset+remap[mappingOffset+i])*3 split into (x,y) at width 64.
    expect([...merged.geometry.getAttribute('sourceLightCoord').array])
      .toEqual([6,0,0,0,3,0, 18,0,21,0,15,0]);
    const material=merged.material as T.MeshBasicMaterial;
    expect(material.map).toBe(f.map);
    expect(material.customProgramCacheKey()).toBe('source-sky-batch-vhv-plain-r1');
    const shader={vertexShader:'void main(){\n#include <common>\n#include <begin_vertex>\n}\n',
      fragmentShader:'void main(){\n#include <common>\n#include <map_fragment>\n}\n',
      uniforms:{} as Record<string,{value:unknown}>};
    material.onBeforeCompile!(shader as never,undefined as never);
    expect(shader.uniforms.sourceVhvLighting).toEqual({value:f.vhv.lookup.lighting});
    expect(shader.vertexShader).toContain('vSourceLight0=sourceDecode(ivec2(int(sourceLightCoord.x),int(sourceLightCoord.y)));');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb*=vSourceLight0;');
    batch.dispose();
  });

  it('bakes olive wind rest/rows/world columns and shares the animated wind vector',()=>{
    const f=fixture();
    const batch=createSourceSkyBatch({scene:f.scene,sourceMeshes:f.sourceMeshes,vhv:f.vhv,olive:f.olive});
    const merged=f.scene.getObjectByName('source_sky_batch')!.children.find(child=>child.name==='source_sky_batch_olive') as T.Mesh;
    // Original local positions stay per vertex for the treesway rest term;
    // the group carries all four olive copies (12 vertices).
    const rest=[0,0,0,1,0,0,0,1,0];
    expect([...merged.geometry.getAttribute('sourceOliveRest').array])
      .toEqual([...rest,...rest,...rest,...rest]);
    // Identity model rows are baked for every vertex of all four source meshes.
    const rows=merged.geometry.getAttribute('sourceOliveRow0');
    expect([...rows.array]).toEqual(new Array(12*4).fill(0).map((_,i)=>[1,0,0,0][i%4]));
    // Wind displacement must not be frustum-culled beyond the static bounds.
    expect(merged.frustumCulled).toBe(false);
    const material=merged.material as T.MeshBasicMaterial;
    expect(material.side).toBe(T.DoubleSide);expect(material.alphaTest).toBe(.3);
    expect(material.customProgramCacheKey()).toBe('source-sky-batch-olive-r1');
    const shader={vertexShader:'void main(){\n#include <common>\n#include <begin_vertex>\n}\n',
      fragmentShader:'void main(){\n#include <common>\n#include <map_fragment>\n}\n',
      uniforms:{} as Record<string,{value:unknown}>};
    material.onBeforeCompile!(shader as never,undefined as never);
    expect(shader.uniforms.sourceLeafLighting).toEqual({value:f.olive.lookup.lighting});
    // The shared animated instance keeps the merged leaves in lock-step wind.
    expect(shader.uniforms.sourceTreeTimeWind.value).toBe(f.olive.timeWind);
    expect(shader.uniforms.sourceOliveRoundMask).toEqual({value:0});
    expect(shader.vertexShader).toContain('sourceOlivePosition(sourceTreeRest,sourceTreeTimeWind,sourceOliveRow0,sourceOliveRow1,sourceOliveRow2)');
    expect(shader.vertexShader).toContain('sourceOliveWorldCol0*sourceTreeLocal.x');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb*=vSourceLeafLight;');
    batch.dispose();
  });

  it('keeps transparent, single-mesh and shader-owned copies on the sky path',()=>{
    const f=fixture();
    const transparent=new T.MeshBasicMaterial({map:f.map});transparent.transparent=true;
    const owned=new T.MeshBasicMaterial({map:f.map});owned.customProgramCacheKey=()=>'source-original-hdr-base-r1';
    const original=new T.Mesh(f.geometry,transparent);original.name='origin_transparent';
    const copy=new T.Mesh(f.geometry,transparent);copy.name='copy_transparent';
    f.props.add(original);f.scene.add(copy);f.sourceMeshes.set(copy,original);
    const ownedCopy=new T.Mesh(f.geometry,owned);ownedCopy.name='copy_owned';
    f.scene.add(ownedCopy);
    const batch=createSourceSkyBatch({scene:f.scene,sourceMeshes:f.sourceMeshes,vhv:f.vhv,olive:f.olive});
    const reasons=batch.audit.skipped.map(s=>s.reason);
    expect(reasons).toEqual(expect.arrayContaining(['no source origin','transparent material keeps per-object sort']));
    expect(batch.audit.groups).toBe(3);
    batch.dispose();
    expect(f.scene.children).toContain(copy);
  });

  it('single-mesh material states keep their original draw call',()=>{
    const f=fixture();
    // Replace the plain copies' shared material with two distinct maps.
    const copies=[...f.sourceMeshes.keys()].filter(mesh=>mesh.name.startsWith('plain_copy_'));
    copies[1].material=new T.MeshBasicMaterial({map:new T.Texture()});
    const batch=createSourceSkyBatch({scene:f.scene,sourceMeshes:f.sourceMeshes,vhv:f.vhv,olive:f.olive});
    expect(batch.audit.groups).toBe(2);
    expect(batch.audit.skipped.map(s=>s.reason)).toContain('single-mesh group keeps original path');
    batch.dispose();
  });

  it('counts kept triangles as scene total minus merged',()=>{
    const f=fixture();
    const transparent=new T.MeshBasicMaterial({map:f.map});transparent.transparent=true;
    const stray=new T.Mesh(f.geometry,transparent);stray.name='stray';
    f.scene.add(stray);
    const batch=createSourceSkyBatch({scene:f.scene,sourceMeshes:f.sourceMeshes,vhv:f.vhv,olive:f.olive});
    expect(batch.audit).toMatchObject({mergedTriangles:8,keptTriangles:1});
    batch.dispose();
  });

  it('restores every merged copy on dispose and never touches the originals',()=>{
    const f=fixture();
    const copies=[...f.sourceMeshes.keys()];
    const parents=new Map(copies.map(mesh=>[mesh,mesh.parent!]));
    const batch=createSourceSkyBatch({scene:f.scene,sourceMeshes:f.sourceMeshes,vhv:f.vhv,olive:f.olive});
    batch.dispose();
    expect(f.scene.children.find(child=>child.name==='source_sky_batch')).toBeUndefined();
    for(const copy of copies)expect(parents.get(copy)!.children).toContain(copy);
    expect(f.props.children.length).toBe(8);
    expect(f.geometry.attributes.position.count).toBe(3);
  });

  it('no-ops without sky copies',()=>{
    const scene=new T.Scene();
    const batch=createSourceSkyBatch({scene,sourceMeshes:new Map()});
    expect(batch.audit).toMatchObject({groups:0,mergedMeshes:0,sourceMeshes:0});
    expect(scene.children.length).toBe(0);
  });
});
