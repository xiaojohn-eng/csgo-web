import {describe,expect,it,vi} from 'vitest';
import * as T from 'three';
import {applySourcePropLighting,sourcePropBranch,type SourcePropLightingBinding} from '../game/source-prop-lighting';

function fixture(){
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,0,1],2));geometry.setIndex([0,1,2]);
  const original=new T.MeshStandardMaterial({map:new T.Texture(),normalMap:new T.Texture()});original.name='models/plain';
  const root=new T.Group(),a=new T.Mesh(geometry,original),b=new T.Mesh(geometry,original);root.add(a,b);
  const source={source:original.name,shader:'vertexlitgeneric',parameters:{$basetexture:'base',$bumpmap:'normal'},mapped:['tangent normal with green inversion']};
  const make=(mesh:T.Mesh,offset:number):SourcePropLightingBinding=>({mesh,source,normalMap:original.normalMap!,normalGreenInverted:true,
    mappingOffset:0,vertexCount:3,indexCount:3,lightingVertexOffset:offset,lightingVertexCount:3});
  const lighting=new Uint8Array(72);lighting.fill(64,0,36);lighting.fill(128,36);
  return {root,a,b,geometry,original,bindings:[make(a,0),make(b,3)],remap:new Uint32Array([2,0,1]),lighting};
}

function uvFixture(){
  const texture=new T.DataTexture(new Float32Array([.25,.75,.5,.125,.625,.375]),3,1,T.RGFormat,T.FloatType);
  texture.flipY=false;texture.generateMipmaps=false;texture.minFilter=texture.magFilter=T.NearestFilter;
  return {texture,width:3,offset:0,vertexCount:3};
}
type Shader=Parameters<T.Material['onBeforeCompile']>[0];
function compile(material:T.Material){
  const shader={uniforms:{},vertexShader:T.ShaderLib.basic.vertexShader,fragmentShader:T.ShaderLib.basic.fragmentShader} as Shader;
  material.onBeforeCompile(shader,{} as T.WebGLRenderer);return shader;
}
describe('original prop VHV ownership and shader contract',()=>{
  it('keeps tint opt-in, retains separate original instance colors, and rolls back a late invalid binding',()=>{
    const f=fixture(),tint=new T.Texture();tint.colorSpace=T.SRGBColorSpace;tint.flipY=false;
    for(const [index,b] of f.bindings.entries()){
      b.source={...b.source,parameters:{...b.source.parameters,$tintmasktexture:'original/tint'}};
      b.tintMap=tint;b.instanceRGB=index?[128,64,32]:[255,255,255];
    }
    const off=applySourcePropLighting(f.root,f);expect(off.audit.appliedMeshes).toBe(0);expect(f.a.material).toBe(f.original);off.dispose();
    f.bindings[1].instanceRGB=[256,64,32];
    expect(()=>applySourcePropLighting(f.root,{...f,enableTintMask:true})).toThrow(/RGB/);expect(f.a.material).toBe(f.original);expect(f.b.material).toBe(f.original);
    f.bindings[1].instanceRGB=[128,64,32];
    const on=applySourcePropLighting(f.root,{...f,enableTintMask:true}),a=compile(f.a.material),b=compile(f.b.material);
    expect(on.audit.tintMaskMeshes).toBe(2);expect(a.uniforms.sourceTintMap.value).toBe(b.uniforms.sourceTintMap.value);
    expect(a.uniforms.sourceTintColor.value.toArray()).toEqual([1,1,1]);expect(b.uniforms.sourceTintColor.value.x).toBeLessThan(1);
    expect(a.uniforms.sourceTintColor.value).not.toBe(b.uniforms.sourceTintColor.value);expect(f.a.geometry).toBe(f.geometry);
    const disposed=vi.fn();tint.addEventListener('dispose',disposed);on.dispose();on.dispose();
    expect(f.a.material).toBe(f.original);expect(f.b.material).toBe(f.original);expect(disposed).not.toHaveBeenCalled();
  });
  it('opts into original multiplicative decal with original sRGB read, UV2 and unchanged geometry',()=>{
    const f=fixture(),decal=new T.Texture();decal.colorSpace=T.SRGBColorSpace;decal.flipY=false;const decalUv=uvFixture();
    for(const b of f.bindings){b.source={...b.source,parameters:{...b.source.parameters,$decaltexture:'original/decal',$decalblendmode:'1'}};b.decalMap=decal;b.decalUv=decalUv;}
    const off=applySourcePropLighting(f.root,f);expect(off.audit.appliedMeshes).toBe(0);off.dispose();
    const on=applySourcePropLighting(f.root,{...f,enableDecalMultiply:true}),shader=compile(f.a.material);
    expect(on.audit.appliedMeshes).toBe(2);expect(shader.uniforms.sourceDecalMap.value).toBe(decal);
    expect(shader.uniforms.sourceDecalUvMap.value).toBe(decalUv.texture);expect(shader.uniforms.sourceDecalScale.value).toBe(1);expect(shader.fragmentShader).toContain('texture2D(sourceDecalMap,vSourceDecalUv).rgb');
    expect(shader.vertexShader).not.toContain('vSourceDecalUv=uv;');expect(shader.vertexShader).toContain('sourceDecalUvOffset+gl_VertexID');
    expect(shader.fragmentShader).toContain('sourceDecalScale');expect(f.a.geometry).toBe(f.geometry);
    const disposed=vi.fn();decal.addEventListener('dispose',disposed);on.dispose();expect(f.a.material).toBe(f.original);expect(disposed).not.toHaveBeenCalled();
    for(const b of f.bindings)b.source.parameters.$decalblendmode='2';
    const mode2=applySourcePropLighting(f.root,{...f,enableDecalMultiply:true});expect(compile(f.a.material).uniforms.sourceDecalScale.value).toBe(2);mode2.dispose();
  });
  it('rejects wrong decal sampling before changing any mesh and keeps compound tint or unknown decal modes excluded',()=>{
    const f=fixture(),decal=new T.Texture();decal.colorSpace=T.NoColorSpace;decal.flipY=false;const decalUv=uvFixture();
    for(const b of f.bindings){b.source={...b.source,parameters:{...b.source.parameters,$decaltexture:'original/decal',$decalblendmode:'1'}};b.decalMap=decal;b.decalUv=decalUv;}
    expect(()=>applySourcePropLighting(f.root,{...f,enableDecalMultiply:true})).toThrow(/decal.*texture/);expect(f.a.material).toBe(f.original);
    decal.colorSpace=T.SRGBColorSpace;f.bindings[1].decalUv=undefined;
    expect(()=>applySourcePropLighting(f.root,{...f,enableDecalMultiply:true})).toThrow(/UV2 binding missing/);expect(f.a.material).toBe(f.original);
    f.bindings[1].decalUv=decalUv;f.bindings[0].source.parameters.$decalblendmode='0';f.bindings[1].source.parameters.$tintmasktexture='original/tint';
    const handle=applySourcePropLighting(f.root,{...f,enableDecalMultiply:true});expect(handle.audit.appliedMeshes).toBe(0);handle.dispose();
  });
  it('keeps plain unbumped disabled by default and opts into the observed first COLOR1 term without a normal sampler',()=>{
    const f=fixture();for(const b of f.bindings)b.source={...b.source,parameters:{$basetexture:'base'}};
    const off=applySourcePropLighting(f.root,f);expect(off.audit.appliedMeshes).toBe(0);off.dispose();
    const on=applySourcePropLighting(f.root,{...f,enablePlainUnbumped:true}),shader=compile(f.a.material);
    expect(on.audit.appliedMeshes).toBe(2);expect(shader.vertexShader).toContain('vSourceLight0=sourceDecode(sourceAddress)');
    expect(shader.vertexShader).not.toContain('sourceAddress+1');expect(shader.fragmentShader).toContain('diffuseColor.rgb*=vSourceLight0');
    expect(shader.fragmentShader).not.toContain('sourceNormalMap');expect(shader.fragmentShader).not.toContain('sourceWeights');on.dispose();
  });
  it('preserves original geometry and uses separate instance offsets with shared bounded lookup textures',()=>{
    const f=fixture(),position=f.geometry.attributes.position,indices=f.geometry.index,uv=f.geometry.attributes.uv;
    const handle=applySourcePropLighting(f.root,f),sa=compile(f.a.material),sb=compile(f.b.material);
    expect(f.a.geometry).toBe(f.geometry);expect(f.b.geometry).toBe(f.geometry);
    expect(f.geometry.attributes.position).toBe(position);expect(f.geometry.index).toBe(indices);expect(f.geometry.attributes.uv).toBe(uv);
    expect(sa.uniforms.sourceInstanceOffset.value).toBe(0);expect(sb.uniforms.sourceInstanceOffset.value).toBe(3);
    expect(sa.uniforms.sourceVhvLighting.value).toBe(sb.uniforms.sourceVhvLighting.value);
    expect(sa.uniforms.sourceVhvRemap.value).toBe(sb.uniforms.sourceVhvRemap.value);
    expect(handle.audit.appliedMeshes).toBe(2);expect(handle.audit.geometryModified).toBe(false);handle.dispose();
  });
  it('decodes BGR before interpolation, combines original three bump bases, and never treats alpha as an exponent',()=>{
    const f=fixture(),handle=applySourcePropLighting(f.root,f),shader=compile(f.a.material);
    expect(shader.vertexShader).toContain('sourceMappingOffset+gl_VertexID');
    expect(shader.vertexShader).toContain('pow(encoded.bgr*2.0,vec3(2.200000047683716))');
    expect(shader.vertexShader).not.toContain('encoded.a');
    expect(shader.fragmentShader).toContain('sourceNormal.y*=sourceNormalGreenSign');
    expect(shader.fragmentShader).toContain('vec3(0.8164966106414795,0.0,0.5773502588272095)');
    expect(shader.fragmentShader).toContain('sourceWeights*=sourceWeights');
    expect(shader.fragmentShader).toContain('max(dot(sourceWeights,vec3(1.0)),1e-8)');
    expect(shader.fragmentShader).not.toContain('pow(encoded');handle.dispose();
  });
  it('restores materials and disposes only the owned lookup textures/materials once',()=>{
    const f=fixture(),handle=applySourcePropLighting(f.root,f),shader=compile(f.a.material);
    const disposeTexture=vi.fn(),disposeOriginal=vi.fn(),disposeMaterial=vi.fn();
    for(const key of ['sourceVhvLighting','sourceVhvRemap'])shader.uniforms[key].value.addEventListener('dispose',disposeTexture);
    for(const object of [f.original,f.original.map!,f.original.normalMap!,f.geometry])object.addEventListener('dispose',disposeOriginal);
    f.a.material.addEventListener('dispose',disposeMaterial);handle.dispose();handle.dispose();
    expect(f.a.material).toBe(f.original);expect(f.b.material).toBe(f.original);expect(disposeTexture).toHaveBeenCalledTimes(2);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);expect(disposeOriginal).not.toHaveBeenCalled();
    const next=applySourcePropLighting(f.root,f);next.dispose();
  });
  it('rejects corrupt indices or a late bad binding before modifying either mesh',()=>{
    const f=fixture();f.bindings[1].lightingVertexCount=2;
    expect(()=>applySourcePropLighting(f.root,f)).toThrow(/lighting/);expect(f.a.material).toBe(f.original);
    f.bindings[1].lightingVertexCount=3;f.remap[1]=0xffffffff;
    expect(()=>applySourcePropLighting(f.root,f)).toThrow(/referenced vertex/);expect(f.a.material).toBe(f.original);
  });
  it('enforces texture/memory budgets and rejects repeat ownership without losing the first handle',()=>{
    const f=fixture();expect(()=>applySourcePropLighting(f.root,{...f,maxTextureSize:2})).toThrow(/texture/);
    expect(()=>applySourcePropLighting(f.root,{...f,maxBytes:32})).toThrow(/budget/);
    const handle=applySourcePropLighting(f.root,f);expect(()=>applySourcePropLighting(f.root,f)).toThrow(/already owned/);handle.dispose();
  });
  it('keeps unsupported shader features original and reports their exact reasons',()=>{
    const f=fixture();f.bindings[1]={...f.bindings[1],source:{...f.bindings[1].source,parameters:{$basetexture:'b',$bumpmap:'n',$envmap:'env_cubemap'}}};
    const handle=applySourcePropLighting(f.root,f);expect(f.b.material).toBe(f.original);expect(handle.audit.skipped[0].reasons).toContain('$envmap');handle.dispose();
    expect(sourcePropBranch({...f.bindings[0].source,parameters:{$basetexture:'b'}})).toContain('missing $bumpmap');
  });
  it('rejects a changed Three shader contract instead of silently leaving an unlit result',()=>{
    const f=fixture(),handle=applySourcePropLighting(f.root,f);
    expect(()=>f.a.material.onBeforeCompile({uniforms:{},vertexShader:'',fragmentShader:''} as Shader,{} as T.WebGLRenderer)).toThrow(/shader contract/);handle.dispose();
  });
});
