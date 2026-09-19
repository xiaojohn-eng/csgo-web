import {describe,expect,it,vi} from 'vitest';
import * as T from 'three';
import {readFileSync} from 'node:fs';
import {sourcePropTintCandidate,sourceInstanceTint,validateSourcePropTint,attachSourcePropTint} from '../game/source-prop-tint';

describe('installed Source prop tint subset',()=>{
  it('matches independent original x64 getter/copy/SSE output for all 256 channel probes',()=>{
    const evidence=JSON.parse(readFileSync('.reference-assets/source-exports/dust2-vhv/encoding/tint/tint-evidence.json','utf8'));
    expect(evidence.renderHandoff.samples).toHaveLength(256);
    for(const sample of evidence.renderHandoff.samples)expect(sourceInstanceTint(sample.sourceRGB)).toEqual(sample.originalShaderConstant.slice(0,3));
    for(const input of [[0,0],[256,0,0],[-1,0,0],[NaN,0,0],[.5,0,0]])expect(()=>sourceInstanceTint(input)).toThrow(/RGB/);
  });
  it('only selects pure bumped tint, preserving compound, transformed and nonwhite material branches',()=>{
    const parameters={$basetexture:'base',$bumpmap:'normal',$tintmasktexture:'tint'};
    expect(sourcePropTintCandidate(parameters)).toBe(true);
    for(const extra of [{$color:'[1 1 1]'},{ $decaltexture:'decal'},{$envmap:'cube'},{$selfillum:'1'},{$linearwrite:'0'},{$tintmasktransform:'identity'},{$bumpmap:''}])
      expect(sourcePropTintCandidate({...parameters,...extra})).toBe(false);
  });
  it('preserves shader ownership and applies original green/sRGB mask with independent instance color uniforms',()=>{
    const texture=new T.Texture();texture.colorSpace=T.SRGBColorSpace;texture.flipY=false;
    const parameters={$basetexture:'base',$bumpmap:'normal',$tintmasktexture:'tint'},material=new T.MeshBasicMaterial();
    const before=vi.fn(),textureDisposed=vi.fn();texture.addEventListener('dispose',textureDisposed);material.onBeforeCompile=before;
    validateSourcePropTint(texture,[233,230,224],parameters,material);
    attachSourcePropTint(material,texture,[233,230,224],false);
    const shader={uniforms:{},vertexShader:T.ShaderLib.basic.vertexShader,fragmentShader:T.ShaderLib.basic.fragmentShader} as Parameters<T.Material['onBeforeCompile']>[0];
    material.onBeforeCompile(shader,{} as T.WebGLRenderer);
    expect(before).toHaveBeenCalledTimes(1);expect(shader.uniforms.sourceTintColor.value).toEqual(new T.Vector3(...sourceInstanceTint([233,230,224])));
    expect(shader.uniforms.sourceTintBias.value).toBe(0);expect(shader.fragmentShader).toContain('texture2D(sourceTintMap,vSourceTintUv).g');
    expect(shader.fragmentShader).not.toContain('texture2D(sourceTintMap,vSourceTintUv).a');
    expect(shader.vertexShader).toContain('vSourceTintUv=uv;');expect(shader.fragmentShader).not.toContain('pow(');
    material.dispose();expect(textureDisposed).not.toHaveBeenCalled();
  });
  it('rejects wrong sampling/nonwhite material and respects original NOTINT bias',()=>{
    const texture=new T.Texture(),material=new T.MeshBasicMaterial(),parameters={$basetexture:'base',$bumpmap:'normal',$tintmasktexture:'tint'};
    expect(()=>validateSourcePropTint(texture,[255,255,255],parameters,material)).toThrow(/sampling/);
    texture.colorSpace=T.SRGBColorSpace;texture.flipY=false;material.color.setRGB(.99,1,1);
    expect(()=>validateSourcePropTint(texture,[255,255,255],parameters,material)).toThrow(/white/);
    material.color.setRGB(1,1,1);attachSourcePropTint(material,texture,[255,255,255],true);
    const shader={uniforms:{},vertexShader:T.ShaderLib.basic.vertexShader,fragmentShader:T.ShaderLib.basic.fragmentShader} as Parameters<T.Material['onBeforeCompile']>[0];
    material.onBeforeCompile(shader,{} as T.WebGLRenderer);expect(shader.uniforms.sourceTintBias.value).toBe(-1);
  });
});
