import {describe,expect,it} from 'vitest';
import * as T from 'three';
import {createSourcePropBatch,type SourcePropBatchInput} from '../game/source-prop-batch';
import type {SourcePropLightingBinding} from '../game/source-prop-lighting';
import {sourceInstanceTint} from '../game/source-prop-tint';

function baseFixture(){
  const map=new T.Texture();map.channel=0;
  const material=new T.MeshBasicMaterial({map});material.name='models/test';
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,0,1],2));geometry.setIndex([0,1,2]);
  const root=new T.Group();
  const anchors=[0,1].map(n=>{
    const anchor=new T.Group();anchor.name='static_prop_'+n;
    anchor.position.set(n===0?10:0,n===0?0:20,0);
    anchor.userData.sourceModel='models/test.mdl';root.add(anchor);return anchor;
  });
  const meshes=anchors.map(anchor=>{const mesh=new T.Mesh(geometry,material);anchor.add(mesh);return mesh;});
  const source={source:'models/test',shader:'vertexlitgeneric',parameters:{$basetexture:'base'},mapped:[]};
  const make=(mesh:T.Mesh,mappingOffset:number,lightingVertexOffset:number):SourcePropLightingBinding=>({mesh,source,
    mappingOffset,vertexCount:3,indexCount:3,lightingVertexOffset,lightingVertexCount:3});
  const bindings=[make(meshes[0],0,0),make(meshes[1],3,5)];
  const remap=new Uint32Array([2,0,1,1,2,0]);
  const lookup={lighting:new T.DataTexture(new Uint8Array(64*2*4),64,2),width:64};
  const input:SourcePropBatchInput={bindings,remap,lookup,enableDecalMultiply:false,enableTintMask:false,enableTintDecal:false};
  return {root,anchors,meshes,geometry,material,input};
}

describe('createSourcePropBatch',()=>{
  it('merges one material state into one draw call with baked attributes',()=>{
    const {root,anchors,meshes,input}=baseFixture();
    const batch=createSourcePropBatch(root,input);
    expect(batch.audit).toMatchObject({groups:1,mergedMeshes:1,sourceMeshes:2,mergedTriangles:2,sourceTriangles:2,skipped:[]});
    const host=root.children.find(child=>child.name==='source_prop_batch');
    expect(host).toBeTruthy();
    const merged=host!.children[0] as T.Mesh;
    expect(anchors.every(anchor=>anchor.children.length===0)).toBe(true);
    const position=merged.geometry.getAttribute('position');
    expect([...position.array]).toEqual([10,0,0,11,0,0,10,1,0, 0,20,0,1,20,0,0,21,0]);
    const uv=merged.geometry.getAttribute('uv');
    expect([...uv.array]).toEqual([0,0,1,0,0,1, 0,0,1,0,0,1]);
    // Baked lighting pixels: (instanceOffset+remap[mappingOffset+i])*3 split
    // into (x,y) with width 64 — identical to the original texelFetch remap.
    const coords=merged.geometry.getAttribute('sourceLightCoord');
    expect([...coords.array]).toEqual([6,0,0,0,3,0, 18,0,21,0,15,0]);
    const index=merged.geometry.getIndex()!;
    expect([...index.array]).toEqual([0,1,2,3,4,5]);
    expect(index.array).toBeInstanceOf(Uint16Array);
    const material=merged.material as T.MeshBasicMaterial;
    expect(material.map).toBe(meshes[0].material.map);
    expect(material.name).toContain('original VHV batched');
    batch.dispose();
  });

  it('keeps sky-excluded props on their original anchors',()=>{
    const {root,anchors,input}=baseFixture();
    const batch=createSourcePropBatch(root,input,{skipPropIds:[0]});
    expect(batch.audit).toMatchObject({groups:1,sourceMeshes:1,mergedTriangles:1});
    expect(anchors[0].children).toContain(input.bindings[0].mesh);
    expect(anchors[1].children.length).toBe(0);
    batch.dispose();
  });

  it('splits groups whenever the original material state differs',()=>{
    const {root,meshes,input}=baseFixture();
    const other=new T.MeshBasicMaterial({map:new T.Texture()});other.map!.channel=0;
    meshes[1].material=other;
    const batch=createSourcePropBatch(root,input);
    expect(batch.audit).toMatchObject({groups:2,mergedMeshes:2});
    batch.dispose();
  });

  it('restores every mesh and anchor on dispose',()=>{
    const {root,anchors,meshes,input}=baseFixture();
    const batch=createSourcePropBatch(root,input);
    batch.dispose();
    expect(root.children.find(child=>child.name==='source_prop_batch')).toBeUndefined();
    expect(anchors[0].children).toContain(meshes[0]);
    expect(anchors[1].children).toContain(meshes[1]);
  });

  it('bakes decal UV2 and instance tint RGB as vertex attributes',()=>{
    const {root,meshes,input}=baseFixture();
    const normal=new T.Texture();normal.colorSpace=T.NoColorSpace;normal.channel=0;
    const decalMap=new T.Texture();decalMap.colorSpace=T.SRGBColorSpace;decalMap.channel=0;
    const tintMap=new T.Texture();tintMap.colorSpace=T.SRGBColorSpace;tintMap.channel=0;
    const parameters={...input.bindings[0].source.parameters,$bumpmap:'normal',$decaltexture:'decal',$decalblendmode:'1',$tintmasktexture:'tint'};
    for(const binding of input.bindings){
      binding.source.parameters=parameters;
      binding.normalMap=normal;binding.decalMap=decalMap;binding.tintMap=tintMap;
      binding.decalUv={texture:new T.DataTexture(new Float32Array([.1,.2,.3,.4,.5,.6,.7,.8,.9,.95,.85,.75]),64,1,T.RGFormat,T.FloatType),width:64,offset:binding===input.bindings[0]?0:3,vertexCount:3};
      binding.instanceRGB=[255,128,0];
    }
    input.enableDecalMultiply=true;input.enableTintMask=true;input.enableTintDecal=true;
    const batch=createSourcePropBatch(root,input);
    expect(batch.audit.branches).toEqual({bumped:0,plain:0,decal:0,tint:0,compound:1});
    const host=root.children.find(child=>child.name==='source_prop_batch')!;
    const merged=host.children[0] as T.Mesh;
    expect([...merged.geometry.getAttribute('sourceDecalUv').array])
      .toEqual([...new Float32Array([.1,.2,.3,.4,.5,.6,.7,.8,.9,.95,.85,.75])]);
    const tint=merged.geometry.getAttribute('sourceTintColor');
    const expected=sourceInstanceTint([255,128,0]);
    expect([...tint.array]).toEqual([...expected,...expected,...expected,...expected,...expected,...expected]);
    batch.dispose();
  });

  it('no-ops without bindings or a lighting lookup',()=>{
    const {root,input}=baseFixture();
    const empty=createSourcePropBatch(root,{...input,bindings:[]});
    expect(empty.audit).toMatchObject({groups:0,mergedMeshes:0});
    const noLookup=createSourcePropBatch(root,{...input,lookup:undefined});
    expect(noLookup.audit.groups).toBe(0);
  });

  it('bakes the owning static prop id per vertex for GPU PVS culling',()=>{
    const {root,input}=baseFixture();
    const batch=createSourcePropBatch(root,input);
    const host=root.children.find(child=>child.name==='source_prop_batch')!;
    const merged=host.children[0] as T.Mesh;
    expect([...merged.geometry.getAttribute('sourcePropId').array]).toEqual([0,0,0,1,1,1]);
    batch.dispose();
  });

  it('keeps transparent materials off the merged path',()=>{
    const {root,meshes,input}=baseFixture();
    const shared=meshes[0].material as T.MeshBasicMaterial;
    const transparent=shared.clone();transparent.transparent=true;
    meshes[1].material=transparent;
    const batch=createSourcePropBatch(root,input);
    expect(batch.audit).toMatchObject({groups:1,sourceMeshes:1,mergedTriangles:1});
    expect(batch.audit.skipped).toEqual([{mesh:meshes[1].name,reason:'unsupported merged material state'}]);
    batch.dispose();
  });

  it('injects the shared visibility uniforms and far-plane projection into every merged shader',()=>{
    const {root,input}=baseFixture();
    const batch=createSourcePropBatch(root,input);
    const host=root.children.find(child=>child.name==='source_prop_batch')!;
    const merged=host.children[0] as T.Mesh;
    const shader={
      vertexShader:'void main(){\n#include <common>\n#include <begin_vertex>\n#include <project_vertex>\n}\n',
      fragmentShader:'void main(){\n#include <common>\n#include <map_fragment>\n}\n',
      uniforms:{} as Record<string,{value:unknown}>,
    };
    (merged.material as T.MeshBasicMaterial).onBeforeCompile!(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('attribute float sourcePropId;');
    expect(shader.vertexShader).toContain('float sourcePropVisibleFactor(){');
    expect(shader.vertexShader).toContain('gl_Position=mix(vec4(0.0,0.0,2.0,1.0),gl_Position,sourcePropVisibleFactor());');
    expect(shader.uniforms.sourcePropVisibleTex).toBeTruthy();
    expect(shader.uniforms.sourcePropVisibleSide).toEqual({value:2});
    expect(shader.uniforms.sourcePropCulling).toEqual({value:0});
    // setVisibleProps toggles the shared culling flag consumed by that uniform.
    batch.setVisibleProps(new Uint8Array([1,0]));
    expect(merged.geometry.drawRange.count).toBe(3);
    expect(batch.audit.pvs?.submittedTriangles).toBe(1);
    expect(shader.uniforms.sourcePropCulling).toEqual({value:1});
    batch.setVisibleProps(null);
    expect(merged.geometry.drawRange.count).toBe(6);
    expect(shader.uniforms.sourcePropCulling).toEqual({value:0});
    batch.dispose();
  });
});
