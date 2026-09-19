import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {applySourceOliveLighting} from '../game/source-olive-lighting';
import {sourcePropOliveCandidate} from '../game/source-prop-olive';
const runtime=JSON.parse(readFileSync('.reference-assets/source-exports/dust2-vhv/remap/runtime.json','utf8'));
const source=runtime.materials.find((m:{source:string})=>m.source.endsWith('/olive_branch_01'));
function fixture(){
 const root=new T.Group(),geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([1,100,1,2,100,1,3,100,2],3));geometry.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,1,1],2));geometry.setIndex([0,1,2]);
 const map=new T.Texture(),material=new T.MeshStandardMaterial({map,alphaTest:.3,side:T.DoubleSide});material.name=source.source;
 const meshes=[new T.Mesh(geometry,material),new T.Mesh(geometry,material)];root.add(...meshes);
 const bindings=meshes.map((mesh,i)=>({mesh,source,sourceModelRows:[[1,0,0,i*100],[0,1,0,50],[0,0,1,0]],mappingOffset:0,lightingVertexOffset:i*3,lightingVertexCount:3,vertexCount:3,indexCount:3}));
 return {root,geometry,map,material,meshes,bindings,remap:new Uint32Array([0,1,2]),lighting:new Uint8Array(72).fill(64)};
}
const compile=(m:T.Material)=>{const s={uniforms:{},vertexShader:T.ShaderLib.basic.vertexShader,fragmentShader:T.ShaderLib.basic.fragmentShader} as Parameters<T.Material['onBeforeCompile']>[0];m.onBeforeCompile(s,{} as T.WebGLRenderer);return s;};
it('uses explicit per-instance original sway and VHV without modifying geometry/base/alpha; restores all owned state',()=>{
 const f=fixture(),handle=applySourceOliveLighting(f.root,{...f,csm:false,state:{timeSeconds:.125,windSourceXY:[2,0]}});
 expect(handle.audit.meshes).toBe(2);const a=compile(f.meshes[0].material),b=compile(f.meshes[1].material);
 expect(a.uniforms.sourceTreeRow0.value).not.toEqual(b.uniforms.sourceTreeRow0.value);expect(a.uniforms.sourceTreeTimeWind.value).toBe(b.uniforms.sourceTreeTimeWind.value);
 expect(a.vertexShader).toContain('sourceOlivePosition');expect(a.fragmentShader).toContain('diffuseColor.rgb*=vSourceLeafLight;');
 expect(f.meshes[0].geometry).toBe(f.geometry);expect(f.meshes[0].material.alphaTest).toBe(.3);expect(f.meshes[0].material.side).toBe(T.DoubleSide);expect((f.meshes[0].material as unknown as T.MeshBasicMaterial).map).toBe(f.map);
 handle.setState({timeSeconds:2,windSourceXY:[-3,4]});expect(a.uniforms.sourceTreeTimeWind.value.toArray()).toEqual([0,2,-3,4]);
 const release=vi.fn();f.map.addEventListener('dispose',release);f.geometry.addEventListener('dispose',release);f.material.addEventListener('dispose',release);
 handle.dispose();handle.dispose();expect(release).not.toHaveBeenCalled();for(const mesh of f.meshes){expect(mesh.material).toBe(f.material);expect(mesh.frustumCulled).toBe(true);}
 expect(()=>handle.setState({timeSeconds:3,windSourceXY:[1,1]})).toThrow(/disposed/);
});
it('rejects invalid late source bindings, referenced remap and non-finite state before scene mutation',()=>{
 const f=fixture();f.bindings[1].sourceModelRows[1][2]=NaN;
 expect(()=>applySourceOliveLighting(f.root,{...f,csm:false,state:{timeSeconds:0,windSourceXY:[0,0]}})).toThrow(/rows/);expect(f.meshes[0].material).toBe(f.material);
 f.bindings[1].sourceModelRows[1][2]=0;f.remap[1]=0xffffffff;
 expect(()=>applySourceOliveLighting(f.root,{...f,csm:false,state:{timeSeconds:0,windSourceXY:[0,0]}})).toThrow(/remap/);
 f.remap[1]=1;expect(()=>applySourceOliveLighting(f.root,{...f,csm:false,state:{timeSeconds:Infinity,windSourceXY:[0,0]}})).toThrow(/time\/wind/);
});
it('requires the exact original olive parameters and refuses an unspecified or enabled CSM path',()=>{
 const f=fixture();expect(sourcePropOliveCandidate(source)).toBe(true);
 for(const change of [{$vertexcolorpower:'1'},{$treeswayheight:'100'},{$treeswayscrumblestrength:'.5'},{$treeswaystatic:'1'}])expect(sourcePropOliveCandidate({...source,parameters:{...source.parameters,...change}})).toBe(false);
 for(const csm of [undefined,true])expect(()=>applySourceOliveLighting(f.root,{...f,csm,state:{timeSeconds:0,windSourceXY:[0,0]}}as any)).toThrow(/no-CSM/);
 expect(f.meshes[0].material).toBe(f.material);
});
