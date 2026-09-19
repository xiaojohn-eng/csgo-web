import {describe, expect, it} from 'vitest';
import * as T from 'three';
import {createSourceAWPMaterial, createSourceAWPScopeMaterial} from '../game/source-awp-materials';
import {createSourcePhongMaterial} from '../game/source-materials';
import {setSourceMaterialEnvironment} from '../game/source-material-environment';
import reference from '../research/source-material-environment.json';

function compile(material:T.Material) {
  const shader={uniforms:T.UniformsUtils.clone(T.ShaderLib.phong.uniforms),
    vertexShader:T.ShaderLib.phong.vertexShader,fragmentShader:T.ShaderLib.phong.fragmentShader};
  material.onBeforeCompile(shader as T.WebGLProgramParametersWithUniforms,{} as T.WebGLRenderer);return shader;
}
describe('original AWP material environment contract',()=>{
  it('binds the actual FP/world albedo branch without losing the world boost',()=>{
    const base=new T.Texture(),exp=new T.Texture();
    for(const world of [false,true]){
      const h=createSourceAWPMaterial('awp',base,exp,world),shader=compile(h.material);
      expect(h.material.userData.sourceParameters).toMatchObject({albedoTint:true,albedoBoost:40,boost:world?1:2});
      expect(shader.uniforms.sourceAlbedoBoost.value).toBe(40);
      expect(shader.uniforms.sourceBoost.value).toBe(world?1:2);
      expect(shader.fragmentShader).toContain('mix(vec3(sourceBoost),diffuseColor.rgb*sourceAlbedoBoost,sourceParameters.g)');
      expect(shader.fragmentShader).toContain('mix(vec3(1.0),diffuseColor.rgb*sourceAlbedoBoost,sourceParameters.g)*sourceParameters.r');
      expect(shader.uniforms.sourceEnvTint.value.toArray()).toEqual([.1,.1,.1]);
      h.dispose();
    }
    base.dispose();exp.dispose();
  });
  it('keeps scope base-alpha environment masking distinct from normal-alpha Phong',()=>{
    const base=new T.Texture(),normal=new T.Texture(),h=createSourceAWPScopeMaterial(base,normal),shader=compile(h.material);
    expect(shader.fragmentShader).toContain('float sourceMask=texture2D(normalMap,vNormalMapUv).a');
    expect(shader.fragmentShader).toContain('float sourceCubeMask=texture2D(map,vMapUv).a');
    expect(shader.fragmentShader).not.toContain('sourceCubeColor*=mix(vec3(1.0),diffuseColor.rgb*sourceAlbedoBoost');
    expect(shader.uniforms.sourceEnvTint.value.toArray()).toEqual([.16,.2,.16]);
    expect(shader.uniforms.sourceExponentMap.value).toBeNull();
    expect(shader.fragmentShader).toContain('material.specularShininess=200.00000000');
    h.dispose();base.dispose();normal.dispose();
  });
  it('changes actual uniform references on bind/clear and never owns original probe textures',()=>{
    const base=new T.Texture(),exp=new T.Texture(),cube=new T.CubeTexture(),h=createSourceAWPMaterial('awp',base,exp),shader=compile(h.material);
    let disposed=0;cube.addEventListener('dispose',()=>disposed++);
    expect(shader.uniforms.sourceEnvEnabled.value).toBe(0);
    const transform=new T.Matrix3().set(0,0,-1,-1,0,0,0,1,0);
    expect(setSourceMaterialEnvironment(h.material,{cube,viewToSource:transform,probeId:'original-0',scale:1})).toBe(true);
    expect(shader.uniforms.sourceEnvMap.value).toBe(cube);
    expect(shader.uniforms.sourceViewToCube.value.equals(transform)).toBe(true);
    expect(shader.uniforms.sourceEnvEnabled.value).toBe(1);
    expect(setSourceMaterialEnvironment(new T.MeshBasicMaterial(),null)).toBe(false);
    expect(()=>setSourceMaterialEnvironment(h.material,{cube,viewToSource:transform,probeId:'bad',scale:NaN})).toThrow('Invalid Source map probe');
    setSourceMaterialEnvironment(h.material,null);expect(shader.uniforms.sourceEnvEnabled.value).toBe(0);
    expect(shader.uniforms.sourceEnvMap.value).toBeNull();h.dispose();expect(disposed).toBe(0);
    cube.dispose();base.dispose();exp.dispose();
  });
  it('preserves original token-oracle cases for mask, Fresnel, inversion and albedo tint',()=>{
    expect(reference.cases).toHaveLength(16);
    expect(reference.materials.map(row=>row.sha256)).toContain('a8da3373f5baacc039f83a5f63e64a4bbcc7fc29b3e2d648aa0f3eac88b8fd83');
    expect(reference.materials.map(row=>row.sha256)).toContain('068241bb4e2657856218b482bf78fcaecbb5776c018f4ffd47daf3a9a0000f7c');
    for(const row of reference.cases){
      let mask=row.maskSource==='baseAlpha'?row.baseRGBA[3]:row.phongMask;if(row.invert)mask=1-mask;
      const result=row.cubeRGB.map((c,i)=>c*row.tint[i]*mask*(row.fresnelEnabled?row.fresnel:1)*row.scale
        *(row.albedoTint?(1-row.exponentRG[1]+row.exponentRG[1]*row.baseRGBA[i]*row.albedoBoost)*row.exponentRG[0]:1));
      result.forEach((value,i)=>expect(value).toBeCloseTo(row.nativeTokenResult[i],6));
    }
    expect(reference.program.exactFinalAWPSelectorVerified).toBe(false);
  });
  it('requires explicit original constant exponent and real normal-mask input',()=>{
    const base=new T.Texture();const p={name:'grenade',boost:1,fresnel:[.2,.5,1] as [number,number,number]};
    expect(()=>createSourcePhongMaterial(base,null,p)).toThrow('exponent texture');
    expect(()=>createSourcePhongMaterial(base,null,{...p,exponentConstant:32,envmap:{tint:[1,1,1],fresnel:true,mask:'normalAlpha'}})).toThrow('needs a normal map');
    const h=createSourcePhongMaterial(base,null,{...p,exponentConstant:32});
    expect(compile(h.material).fragmentShader).toContain('material.specularShininess=32.00000000');
    h.dispose();base.dispose();
  });
});
