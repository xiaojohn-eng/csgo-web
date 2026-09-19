import {describe,expect,it} from 'vitest';
import * as T from 'three';
import {createSourceWorldBatch} from '../game/source-world-batch';

function fixture(){
  // Mirrors the post-lightmap world material: MeshBasicMaterial with the
  // shared HDR atlas and the decode injection installed by the adapter.
  const map=new T.Texture();map.channel=0;
  const atlas=new T.DataTexture(new Uint8Array(4*4*4),4,4);atlas.channel=1;
  const makeMaterial=(name:string,color=0xffffff)=>{
    const material=new T.MeshBasicMaterial({map,color,lightMap:atlas});
    material.name=name;
    material.onBeforeCompile=shader=>{
      shader.uniforms.sourceAtlasSize={value:new T.Vector2(4,4)};
      const pars='#include <lightmap_pars_fragment>';
      shader.fragmentShader=shader.fragmentShader.replace(pars,pars+'\n// original HDR decode');
    };
    material.customProgramCacheKey=()=>'source-original-hdr-base-r1';
    return material;
  };
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setAttribute('normal',new T.Float32BufferAttribute([0,1,0,0,1,0,0,1,0],3));
  geometry.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,0,1],2));
  geometry.setAttribute('uv1',new T.Float32BufferAttribute([0.1,0.1,0.2,0.1,0.1,0.2],2));
  geometry.setAttribute('uv2',new T.Float32BufferAttribute([7,7,7],1));
  geometry.setIndex([0,1,2]);
  const root=new T.Group();
  const anchors=[0,1].map(n=>{
    const anchor=new T.Group();anchor.name='world_node_'+n;
    anchor.position.set(n===0?10:0,n===0?0:20,0);
    anchor.rotation.z=Math.PI/2;
    root.add(anchor);return anchor;
  });
  const materials=[makeMaterial('TOOLS/BLACK'),makeMaterial('TOOLS/BLACK')];
  const meshes=anchors.map((anchor,n)=>{const mesh=new T.Mesh(geometry,materials[n]);anchor.add(mesh);return mesh;});
  return {root,anchors,meshes,geometry,materials,atlas};
}

describe('createSourceWorldBatch',()=>{
  it('merges meshes with equal material STATE (not instance) into one draw call',()=>{
    const {root}=fixture();
    const batch=createSourceWorldBatch(root);
    expect(batch.audit).toMatchObject({groups:1,mergedMeshes:1,sourceMeshes:2,
      mergedTriangles:2,sourceTriangles:2,faceTextureSide:3,faceCount:8,skipped:[]});
    const host=root.children.find(child=>child.name==='source_world_batch');
    expect(host).toBeTruthy();
    batch.dispose();
  });

  it('bakes world positions, inverse-transpose normals and keeps uvs exactly',()=>{
    const {root}=fixture();
    const batch=createSourceWorldBatch(root);
    const merged=root.children.find(child=>child.name==='source_world_batch')!.children[0] as T.Mesh;
    // Anchor 0 sits at x=10 with a 90° Z rotation: local (1,0,0) becomes world
    // (10,1,0) and local (0,1,0) becomes world (9,0,0).
    const position=merged.geometry.getAttribute('position');
    expect(position.array[0]).toBeCloseTo(10,5);expect(position.array[1]).toBeCloseTo(0,5);
    expect(position.array[3]).toBeCloseTo(10,5);expect(position.array[4]).toBeCloseTo(1,5);
    expect(position.array[6]).toBeCloseTo(9,5);expect(position.array[7]).toBeCloseTo(0,5);
    // Anchor 1 sits at y=20: its vertex (0,0,0) maps to (0,20,0).
    expect(position.array[9]).toBeCloseTo(0,5);expect(position.array[10]).toBeCloseTo(20,5);
    const normal=merged.geometry.getAttribute('normal');
    for(let i=0;i<6;i++){expect(normal.array[i*3]).toBeCloseTo(-1,5);expect(normal.array[i*3+1]).toBeCloseTo(0,5);}
    const uv=merged.geometry.getAttribute('uv');
    expect([...uv.array]).toEqual([0,0,1,0,0,1, 0,0,1,0,0,1]);
    const index=merged.geometry.getIndex()!;
    expect([...index.array]).toEqual([0,1,2,3,4,5]);
    batch.dispose();
  });

  it('re-encodes uv2 face ids into sourceFaceId and drops uv2',()=>{
    const {root}=fixture();
    const batch=createSourceWorldBatch(root);
    const merged=root.children.find(child=>child.name==='source_world_batch')!.children[0] as T.Mesh;
    expect(merged.geometry.getAttribute('uv2')).toBeUndefined();
    expect([...merged.geometry.getAttribute('sourceFaceId').array]).toEqual([7,7,7,7,7,7]);
    batch.dispose();
  });

  it('splits groups whenever the material state differs',()=>{
    const {root,meshes}=fixture();
    (meshes[1].material as T.MeshBasicMaterial).map=new T.Texture();
    const batch=createSourceWorldBatch(root);
    expect(batch.audit.groups).toBe(2);
    batch.dispose();
    const {root:root2,meshes:meshes2}=fixture();
    (meshes2[1].material as T.MeshBasicMaterial).color.set(0x808080);
    const batch2=createSourceWorldBatch(root2);
    expect(batch2.audit.groups).toBe(2);
    batch2.dispose();
  });

  it('keeps transparent and malformed meshes on their anchors',()=>{
    const {root,meshes,anchors}=fixture();
    const transparent=(meshes[0].material as T.MeshBasicMaterial).clone();
    transparent.transparent=true;
    meshes[0].material=transparent;
    const unindexed=meshes[1].geometry.clone();
    delete unindexed.attributes.uv2;
    meshes[1].geometry=unindexed;
    const batch=createSourceWorldBatch(root);
    expect(batch.audit).toMatchObject({groups:0,mergedMeshes:0,sourceMeshes:0});
    expect(batch.audit.skipped.map(s=>s.reason)).toEqual(
      expect.arrayContaining(['transparent material keeps per-object sort','unindexed geometry or missing Source face ids']));
    expect(anchors[0].children).toContain(meshes[0]);
    expect(anchors[1].children).toContain(meshes[1]);
    batch.dispose();
  });

  it('chains the HDR decode injection and adds the far-plane PVS projection',()=>{
    const {root,meshes}=fixture();
    const batch=createSourceWorldBatch(root);
    const merged=root.children.find(child=>child.name==='source_world_batch')!.children[0] as T.Mesh;
    const material=merged.material as T.MeshBasicMaterial;
    const shader={
      vertexShader:'void main(){\n#include <common>\n#include <project_vertex>\n}\n',
      fragmentShader:'void main(){\n#include <lightmap_pars_fragment>\n}\n',
      uniforms:{} as Record<string,{value:unknown}>,
    };
    material.onBeforeCompile!(shader as never, undefined as never);
    // Original HDR decode survives the chain (uniform + fragment edit).
    expect(shader.uniforms.sourceAtlasSize).toBeTruthy();
    expect(shader.fragmentShader).toContain('// original HDR decode');
    // Visibility injection adds the per-vertex face lookup and projection.
    expect(shader.vertexShader).toContain('attribute float sourceFaceId;');
    expect(shader.vertexShader).toContain('gl_Position=mix(vec4(0.0,0.0,2.0,1.0),gl_Position,sourceWorldVisibleFactor());');
    expect(shader.uniforms.sourceWorldVisibleTex).toBeTruthy();
    expect(shader.uniforms.sourceWorldCulling).toEqual({value:0});
    expect(material.customProgramCacheKey()).toBe('source-original-hdr-base-r1+source-world-batch-r1');
    expect(material.lightMap).toBe(meshes[0].material.lightMap);
    batch.dispose();
  });

  it('updates the face texture with firstFace offsets and permanent sky exclusions',()=>{
    const {root}=fixture();
    const batch=createSourceWorldBatch(root,{excludedFaceIds:[7]});
    const merged=root.children.find(child=>child.name==='source_world_batch')!.children[0] as T.Mesh;
    const shader={vertexShader:'#include <common>\n#include <project_vertex>\n',fragmentShader:'',
      uniforms:{} as Record<string,{value:unknown}>};
    (merged.material as T.MeshBasicMaterial).onBeforeCompile!(shader as never, undefined as never);
    // Sky owns face 7: culling stays armed even when every face is visible.
    expect(shader.uniforms.sourceWorldCulling).toEqual({value:1});
    let data=(shader.uniforms.sourceWorldVisibleTex.value as T.DataTexture).image.data as Uint8Array;
    expect(data[7]).toBe(0);
    expect(merged.geometry.drawRange.count).toBe(0);
    expect(merged.visible).toBe(false);
    expect(batch.audit.pvs?.submittedTriangles).toBe(0);
    // A mask with firstFace=5 marks faces 5,6 visible; 7 stays excluded.
    batch.setVisibleFaces(new Uint8Array([1,1,0]),5);
    data=(shader.uniforms.sourceWorldVisibleTex.value as T.DataTexture).image.data as Uint8Array;
    expect(data[5]).toBe(255);expect(data[6]).toBe(255);expect(data[7]).toBe(0);
    // Face 8 lies outside this mask's declared range: keep unknown identities
    // visible, matching isSourceFaceVisible's conservative contract.
    expect(data[8]).toBe(255);
    expect(shader.uniforms.sourceWorldCulling).toEqual({value:1});
    // null = all visible, still with the sky exclusion armed.
    batch.setVisibleFaces(null,0);
    data=(shader.uniforms.sourceWorldVisibleTex.value as T.DataTexture).image.data as Uint8Array;
    expect(data[5]).toBe(255);expect(data[7]).toBe(0);
    expect(shader.uniforms.sourceWorldCulling).toEqual({value:1});
    batch.dispose();
    // Without sky exclusions null disarms the texture fetch entirely.
    const {root:root2}=fixture();
    const batch2=createSourceWorldBatch(root2);
    const merged2=root2.children.find(child=>child.name==='source_world_batch')!.children[0] as T.Mesh;
    const shader2={vertexShader:'#include <common>\n#include <project_vertex>\n',fragmentShader:'',
      uniforms:{} as Record<string,{value:unknown}>};
    (merged2.material as T.MeshBasicMaterial).onBeforeCompile!(shader2 as never, undefined as never);
    expect(shader2.uniforms.sourceWorldCulling).toEqual({value:0});
    batch2.dispose();
  });

  it('selects the original face indices before GPU submission and preserves unknown faces',()=>{
    const {root,meshes}=fixture();
    meshes[1].geometry=meshes[1].geometry.clone();
    meshes[1].geometry.setAttribute('uv2',new T.Float32BufferAttribute([8,8,8],1));
    const batch=createSourceWorldBatch(root),merged=root.children.find(child=>child.name==='source_world_batch')!.children[0] as T.Mesh;
    batch.setVisibleFaces(new Uint8Array([0,1]),7);
    expect(merged.geometry.drawRange.count).toBe(3);expect([...merged.geometry.index!.array].slice(0,3)).toEqual([3,4,5]);
    expect(batch.audit.pvs?.submittedTriangles).toBe(1);
    // Face 8 is outside the shorter declared mask and stays visible.
    batch.setVisibleFaces(new Uint8Array([0]),7);expect(merged.geometry.drawRange.count).toBe(3);
    batch.setVisibleFaces(null,0);expect([...merged.geometry.index!.array]).toEqual([0,1,2,3,4,5]);batch.dispose();
  });

  it('restores every mesh on dispose',()=>{
    const {root,anchors,meshes}=fixture();
    const batch=createSourceWorldBatch(root);
    batch.dispose();
    expect(root.children.find(child=>child.name==='source_world_batch')).toBeUndefined();
    expect(anchors[0].children).toContain(meshes[0]);
    expect(anchors[1].children).toContain(meshes[1]);
  });

  it('no-ops without candidates',()=>{
    const root=new T.Group();
    const batch=createSourceWorldBatch(root);
    expect(batch.audit).toMatchObject({groups:0,mergedMeshes:0,sourceMeshes:0});
    expect(root.children.length).toBe(0);
  });
});
