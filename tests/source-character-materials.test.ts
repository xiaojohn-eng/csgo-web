import {describe,expect,it} from 'vitest';
import * as T from 'three';
import {createSourceCharacterMaterial,createSourceWorldAKMaterial} from '../game/source-character-materials';
import {createSourceWorldM4A4Material} from '../game/source-world-m4a4-material';
import {createSourceM4A4Material} from '../game/source-m4a4-viewmodel';

function textures(){
  const make=()=>new T.DataTexture(new Uint8Array([60,90,110,23]),1,1,T.RGBAFormat);
  const base=make(),normal=make(),exponent=make();
  base.colorSpace=T.NoColorSpace;normal.colorSpace=T.SRGBColorSpace;exponent.colorSpace=T.SRGBColorSpace;
  for(const t of [base,normal,exponent])t.flipY=true;
  return {base,normal,exponent};
}
type Shader=Parameters<T.Material['onBeforeCompile']>[0];
function compile(material:T.Material){
  const shader={uniforms:T.UniformsUtils.clone(T.ShaderLib.phong.uniforms),vertexShader:T.ShaderLib.phong.vertexShader,fragmentShader:T.ShaderLib.phong.fragmentShader} as Shader;
  material.onBeforeCompile(shader,{} as T.WebGLRenderer);
  return shader;
}
describe('original character material adaptation',()=>{
  it('uses each rifle VMT albedo strength in both views',()=>{
    const source=textures(),ak=createSourceWorldAKMaterial(source),world=createSourceWorldM4A4Material(source),fp=createSourceM4A4Material(source.base,source.exponent);
    try{
      const a=compile(ak.material);expect(a.uniforms.sourceAlbedoBoost.value).toBe(35);
      expect(ak.material.userData.sourceParameters.albedoTint).toBe(true);
      for(const h of [world,fp]){
        const s=compile(h.material);expect(h.material.userData.sourceParameters.albedoTint).toBe(true);
        expect(s.uniforms.sourceBoost.value).toBe(2);expect(s.uniforms.sourceAlbedoBoost.value).toBe(25);
        expect(s.fragmentShader).toContain('material.specularStrength=sourceMask*sourceFresnel;');
        expect(s.fragmentShader).toContain('diffuseColor.rgb*sourceAlbedoBoost');
        expect(s.uniforms.sourceEnvTint.value.toArray()).toEqual([.15,.15,.15]);
      }
      expect(source.base.colorSpace).toBe(T.NoColorSpace);expect(source.exponent.colorSpace).toBe(T.SRGBColorSpace);
    }finally{for(const h of [ak,world,fp])h.dispose();for(const t of Object.values(source))t.dispose();}
  });
  it('uses color only for albedo, keeps raw control data linear and leaves shared input textures unchanged',()=>{
    const source=textures(),handle=createSourceCharacterMaterial('upperbody',source),material=handle.material;
    expect(material).toBeInstanceOf(T.MeshPhongMaterial);
    expect(material.map).not.toBe(source.base);expect(material.map?.source).toBe(source.base.source);
    expect(material.map?.colorSpace).toBe(T.SRGBColorSpace);expect(material.map?.flipY).toBe(false);
    expect(material.normalMap).not.toBe(source.normal);expect(material.normalMap?.colorSpace).toBe(T.NoColorSpace);
    expect(material.normalMap?.flipY).toBe(false);expect(material.normalScale.toArray()).toEqual([1,-1]);
    const shader=compile(material),exponent=shader.uniforms.sourceCharacterExponentMap.value as T.Texture;
    expect(exponent.colorSpace).toBe(T.NoColorSpace);expect(exponent.flipY).toBe(false);expect(exponent.source).toBe(source.exponent.source);
    expect(source.base.colorSpace).toBe(T.NoColorSpace);expect(source.normal.colorSpace).toBe(T.SRGBColorSpace);expect(source.exponent.flipY).toBe(true);
    expect(material.color.getHex()).toBe(0xffffff);expect(material.transparent).toBe(false);expect(material.opacity).toBe(1);
    handle.dispose();for(const t of Object.values(source))t.dispose();
  });
  it.each(['upperbody','lowerbody','head'] as const)('applies the original %s VMT branch when Three builds its shader',part=>{
    const source=textures(),handle=createSourceCharacterMaterial(part,source),shader=compile(handle.material);
    // Original VMT literals, not values computed by the material implementation.
    expect(shader.uniforms.sourceCharacterBoost.value).toBe(25);
    expect((shader.uniforms.sourceCharacterFresnel.value as T.Vector3).toArray()).toEqual([0,.1,1]);
    expect(shader.uniforms.sourceCharacterRimEnabled.value).toBe(part==='head'?0:1);
    expect(shader.uniforms.sourceCharacterRimExponent.value).toBe(1.2);
    // This is the emitted shader contract: normal alpha is the mask; absent
    // phongalbedotint must not silently enable the AK exponent-G tint branch.
    expect(shader.fragmentShader).toContain('texture2D(normalMap,vNormalMapUv).a');
    expect(shader.fragmentShader).toContain('material.specularColor=vec3(1.0)');
    expect(shader.fragmentShader).not.toContain('BRDF_BlinnPhong( directLight.direction');
    expect(shader.fragmentShader).not.toContain('mix(vec3(1.0),diffuseColor.rgb');
    handle.dispose();for(const t of Object.values(source))t.dispose();
  });
  it('disposes only owned GPU views once, retaining externally cached source textures',()=>{
    const source=textures(),handle=createSourceCharacterMaterial('head',source),shader=compile(handle.material);
    const owned=[handle.material.map!,handle.material.normalMap!,shader.uniforms.sourceCharacterExponentMap.value as T.Texture];
    let ownedDisposed=0,sourceDisposed=0,materialDisposed=0;
    for(const t of owned)t.addEventListener('dispose',()=>ownedDisposed++);
    for(const t of Object.values(source))t.addEventListener('dispose',()=>sourceDisposed++);
    handle.material.addEventListener('dispose',()=>materialDisposed++);
    handle.dispose();handle.dispose();
    expect(ownedDisposed).toBe(3);expect(sourceDisposed).toBe(0);expect(materialDisposed).toBe(1);
    for(const t of Object.values(source))t.dispose();
  });
  it('rejects incompatible shader hooks instead of silently rendering the old PBR approximation',()=>{
    const source=textures(),handle=createSourceCharacterMaterial('head',source);
    expect(()=>handle.material.onBeforeCompile({uniforms:{},vertexShader:'',fragmentShader:'void main(){}'} as Shader,{} as T.WebGLRenderer)).toThrow(/shader contract/);
    handle.dispose();for(const t of Object.values(source))t.dispose();
  });
  it('reuses original AK Phong parameters while configuring and owning its independent texture views',()=>{
    const source=textures(),handle=createSourceWorldAKMaterial(source),shader=compile(handle.material);
    expect(handle.material.map?.colorSpace).toBe(T.SRGBColorSpace);expect(handle.material.map?.flipY).toBe(false);
    expect(handle.material.normalMap).toBeNull();expect(shader.uniforms.sourceBoost.value).toBe(2);
    expect((shader.uniforms.sourceFresnelRanges.value as T.Vector3).toArray()).toEqual([.83,.83,1]);
    expect(shader.uniforms.sourceExponentMap.value.flipY).toBe(false);expect(shader.uniforms.sourceExponentMap.value.colorSpace).toBe(T.NoColorSpace);
    expect(source.base.flipY).toBe(true);expect(source.exponent.colorSpace).toBe(T.SRGBColorSpace);
    let controlDisposed=0;shader.uniforms.sourceExponentMap.value.addEventListener('dispose',()=>controlDisposed++);
    handle.dispose();handle.dispose();expect(controlDisposed).toBe(1);
    for(const t of Object.values(source))t.dispose();
  });
});
