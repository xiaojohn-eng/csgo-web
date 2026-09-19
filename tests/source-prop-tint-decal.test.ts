import {expect,it,vi} from 'vitest';
import * as T from 'three';
import {applySourcePropLighting,type SourcePropLightingData} from '../game/source-prop-lighting';
function fixture(){
  const root=new T.Group(),g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));g.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,0,1],2));g.setIndex([0,1,2]);
  const original=new T.MeshBasicMaterial({map:new T.Texture()}),normal=new T.Texture(),tint=new T.Texture(),decal=new T.Texture();original.name='models/compound';
  for(const t of [tint,decal]){t.colorSpace=T.SRGBColorSpace;t.flipY=false;}
  const uvTexture=new T.DataTexture(new Float32Array([.2,.4,.3,.9,.8,.1]),3,1,T.RGFormat,T.FloatType);uvTexture.minFilter=uvTexture.magFilter=T.NearestFilter;uvTexture.generateMipmaps=false;uvTexture.flipY=false;
  const a=new T.Mesh(g,original),b=new T.Mesh(g,original);root.add(a,b);
  const source={source:original.name,shader:'vertexlitgeneric',parameters:{$basetexture:'base',$bumpmap:'normal',$tintmasktexture:'mask',$decaltexture:'decal',$decalblendmode:'1'}};
  const data={enableTintDecal:true,enableTintMask:true,enableDecalMultiply:true,lighting:new Uint8Array(72).fill(64),remap:new Uint32Array([0,1,2]),bindings:[a,b].map((mesh,i)=>({mesh,source,normalMap:normal,normalGreenInverted:true,tintMap:tint,instanceRGB:i?[128,64,32]:[255,255,255],decalMap:decal,decalUv:{texture:uvTexture,width:3,offset:0,vertexCount:3},mappingOffset:0,vertexCount:3,indexCount:3,lightingVertexOffset:i*3,lightingVertexCount:3}))};
  return {root,g,original,a,b,data,tint,decal,uvTexture};
}
const compile=(m:T.Material)=>{const s={uniforms:{},vertexShader:T.ShaderLib.basic.vertexShader,fragmentShader:T.ShaderLib.basic.fragmentShader} as Parameters<T.Material['onBeforeCompile']>[0];m.onBeforeCompile(s,{} as T.WebGLRenderer);return s;};
it('keeps R4 compound excluded and independently opts into one original-order compound shader',()=>{
  const f=fixture(),off=applySourcePropLighting(f.root,{...f.data,enableTintDecal:false} as SourcePropLightingData);expect(off.audit.appliedMeshes).toBe(0);off.dispose();
  const on=applySourcePropLighting(f.root,f.data);expect(on.audit.appliedMeshes).toBe(2);
  const s=compile(f.a.material),shader=s.fragmentShader;
  expect(shader.match(/float sourceCompoundMask=/g)).toHaveLength(1);
  expect(shader).not.toContain('float sourceTintMask=');expect(shader).not.toContain('sourceDecalScale');
  const order=['float sourceCompoundMask=','vec3 sourceCompoundTint=','vec3 sourceCompoundLighting=','diffuseColor.rgb*=sourceCompoundLighting;','vec3 sourceCompoundDecal=','diffuseColor.rgb*=sourceCompoundDecal;'];
  expect(order.map(v=>shader.indexOf(v))).toEqual(order.map(v=>shader.indexOf(v)).sort((a,b)=>a-b));
  expect(s.vertexShader).toContain('sourceCompoundUvOffset+gl_VertexID');expect(s.vertexShader).toContain('vSourceCompoundTintUv=uv;');
  const sb=compile(f.b.material);expect(s.uniforms.sourceCompoundTintColor.value).not.toBe(sb.uniforms.sourceCompoundTintColor.value);expect(f.a.geometry).toBe(f.g);
  const disposed=vi.fn();for(const t of [f.tint,f.decal,f.uvTexture])t.addEventListener('dispose',disposed);on.dispose();on.dispose();expect(disposed).not.toHaveBeenCalled();expect(f.a.material).toBe(f.original);
});
it('fails a late corrupt compound RGB or UV2 before either material is changed',()=>{
  const f=fixture();f.data.bindings[1].instanceRGB=[-1,0,0];
  expect(()=>applySourcePropLighting(f.root,f.data)).toThrow(/RGB/);expect(f.a.material).toBe(f.original);
  f.data.bindings[1].instanceRGB=[128,64,32];f.data.bindings[1].decalUv.offset=5;
  expect(()=>applySourcePropLighting(f.root,f.data)).toThrow(/UV2/);expect(f.a.material).toBe(f.original);
});
