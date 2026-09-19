import {describe,expect,it} from 'vitest';
import * as T from 'three';
import {createSourcePlainPropBatch} from '../game/source-plain-prop-batch';

function fixture(){
  const material=new T.MeshStandardMaterial({map:new T.Texture()});
  material.name='models/props/test/wood';
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setAttribute('normal',new T.Float32BufferAttribute([0,1,0,0,1,0,0,1,0],3));
  geometry.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,0,1],2));
  geometry.setIndex([0,1,2]);
  const root=new T.Group();
  const anchors=[0,1].map(n=>{
    const anchor=new T.Group();anchor.name='static_prop_'+n;
    anchor.position.set(n===0?10:0,n===0?0:20,0);
    anchor.rotation.z=Math.PI/2;
    anchor.userData.sourceModel='models/props/test/wood.mdl';root.add(anchor);return anchor;
  });
  const meshes=anchors.map(anchor=>{const mesh=new T.Mesh(geometry,material);anchor.add(mesh);return mesh;});
  return {root,anchors,meshes,geometry,material};
}

describe('createSourcePlainPropBatch',()=>{
  it('merges meshes sharing one material instance into a single draw call',()=>{
    const {root,anchors}=fixture();
    const batch=createSourcePlainPropBatch(root);
    expect(batch.audit).toMatchObject({groups:1,mergedMeshes:1,sourceMeshes:2,materials:1,
      mergedTriangles:2,sourceTriangles:2,skipped:[]});
    const host=root.children.find(child=>child.name==='source_plain_prop_batch');
    expect(host).toBeTruthy();
    const merged=host!.children[0] as T.Mesh;
    expect(anchors.every(anchor=>anchor.children.length===0)).toBe(true);
    expect([...merged.geometry.getAttribute('sourcePropId').array]).toEqual([0,0,0,1,1,1]);
    batch.dispose();
  });

  it('bakes world positions, inverse-transpose normals and raw uvs exactly',()=>{
    const {root}=fixture();
    const batch=createSourcePlainPropBatch(root);
    const merged=root.children.find(child=>child.name==='source_plain_prop_batch')!.children[0] as T.Mesh;
    // Anchor 0 sits at x=10 with a 90° Z rotation: local (1,0,0) becomes world (10,1,0)
    // and local (0,1,0) becomes world (9,0,0).
    const position=merged.geometry.getAttribute('position');
    expect(position.array[0]).toBeCloseTo(10,5);expect(position.array[1]).toBeCloseTo(0,5);
    expect(position.array[3]).toBeCloseTo(10,5);expect(position.array[4]).toBeCloseTo(1,5);
    expect(position.array[6]).toBeCloseTo(9,5);expect(position.array[7]).toBeCloseTo(0,5);
    // Anchor 1 sits at y=20: its vertex (0,0,0) maps to (0,20,0) and (1,0,0) to (0,21,0).
    expect(position.array[9]).toBeCloseTo(0,5);expect(position.array[10]).toBeCloseTo(20,5);
    expect(position.array[12]).toBeCloseTo(0,5);expect(position.array[13]).toBeCloseTo(21,5);
    // Normals take the same pure rotation: (0,1,0) becomes (-1,0,0) for both anchors.
    const normal=merged.geometry.getAttribute('normal');
    for(let i=0;i<6;i++){expect(normal.array[i*3]).toBeCloseTo(-1,5);expect(normal.array[i*3+1]).toBeCloseTo(0,5);}
    const uv=merged.geometry.getAttribute('uv');
    expect([...uv.array]).toEqual([0,0,1,0,0,1, 0,0,1,0,0,1]);
    const index=merged.geometry.getIndex()!;
    expect([...index.array]).toEqual([0,1,2,3,4,5]);
    expect(index.array).toBeInstanceOf(Uint16Array);
    batch.dispose();
  });

  it('splits groups per material instance and per attribute signature',()=>{
    const {root,meshes}=fixture();
    const other=new T.MeshStandardMaterial({map:new T.Texture()});
    meshes[1].material=other;
    const batch=createSourcePlainPropBatch(root);
    expect(batch.audit.groups).toBe(2);
    batch.dispose();
    const {root:root2,meshes:meshes2}=fixture();
    const withoutNormal=meshes2[1].geometry.clone();
    delete withoutNormal.attributes.normal;
    meshes2[1].geometry=withoutNormal;
    const batch2=createSourcePlainPropBatch(root2);
    expect(batch2.audit.groups).toBe(2);
    batch2.dispose();
  });

  it('keeps transparent, wrapped and sky-excluded meshes on their anchors',()=>{
    const {root,meshes,anchors}=fixture();
    const transparent=meshes[0].material.clone();transparent.transparent=true;
    meshes[0].material=transparent;
    const wrapped=meshes[1].material.clone();
    wrapped.onBeforeCompile=shader=>{shader.uniforms.custom={value:1};};
    wrapped.customProgramCacheKey=()=>'other-owner-r1';
    meshes[1].material=wrapped;
    const batch=createSourcePlainPropBatch(root);
    expect(batch.audit).toMatchObject({groups:0,mergedMeshes:0,sourceMeshes:0});
    expect(batch.audit.skipped.map(s=>s.reason)).toEqual(
      expect.arrayContaining(['transparent material keeps per-object sort','material owned by another shader owner']));
    expect(anchors[0].children).toContain(meshes[0]);
    expect(anchors[1].children).toContain(meshes[1]);
    batch.dispose();
  });

  it('excludes sky prop ids like the VHV batch',()=>{
    const {root,anchors,meshes}=fixture();
    const batch=createSourcePlainPropBatch(root,{skipPropIds:[0]});
    expect(batch.audit).toMatchObject({groups:1,sourceMeshes:1});
    expect(anchors[0].children).toContain(meshes[0]);
    expect(anchors[1].children.length).toBe(0);
    batch.dispose();
  });

  it('restores every mesh on dispose',()=>{
    const {root,anchors,meshes}=fixture();
    const batch=createSourcePlainPropBatch(root);
    batch.dispose();
    expect(root.children.find(child=>child.name==='source_plain_prop_batch')).toBeUndefined();
    expect(anchors[0].children).toContain(meshes[0]);
    expect(anchors[1].children).toContain(meshes[1]);
  });

  it('injects the shared visibility uniforms and far-plane projection',()=>{
    const {root}=fixture();
    const batch=createSourcePlainPropBatch(root);
    const merged=root.children.find(child=>child.name==='source_plain_prop_batch')!.children[0] as T.Mesh;
    const material=merged.material as T.MeshStandardMaterial;
    expect(material.map).toBeTruthy();
    const shader={
      vertexShader:'void main(){\n#include <common>\n#include <project_vertex>\n}\n',
      fragmentShader:'void main(){}\n',
      uniforms:{} as Record<string,{value:unknown}>,
    };
    material.onBeforeCompile!(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('attribute float sourcePropId;');
    expect(shader.vertexShader).toContain('gl_Position=mix(vec4(0.0,0.0,2.0,1.0),gl_Position,sourcePropVisibleFactor());');
    expect(shader.uniforms.sourcePropVisibleTex).toBeTruthy();
    expect(shader.uniforms.sourcePropVisibleSide).toEqual({value:2});
    expect(shader.uniforms.sourcePropCulling).toEqual({value:0});
    batch.setVisibleProps(new Uint8Array([1,0]));
    expect(merged.geometry.drawRange.count).toBe(3);
    expect(batch.audit.pvs?.submittedTriangles).toBe(1);
    expect(shader.uniforms.sourcePropCulling).toEqual({value:1});
    batch.setVisibleProps(null);
    expect(merged.geometry.drawRange.count).toBe(6);
    expect(shader.uniforms.sourcePropCulling).toEqual({value:0});
    batch.dispose();
  });

  it('no-ops without candidates',()=>{
    const root=new T.Group();
    const batch=createSourcePlainPropBatch(root);
    expect(batch.audit).toMatchObject({groups:0,mergedMeshes:0,sourceMeshes:0});
    expect(root.children.length).toBe(0);
  });
});
