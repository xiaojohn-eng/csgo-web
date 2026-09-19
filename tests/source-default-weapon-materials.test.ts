import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import * as T from 'three';
import reference from '../research/source-default-weapon-materials.json';
import {createSourceAKMaterial} from '../game/source-materials';
import {createSourceWorldAKMaterial} from '../game/source-character-materials';
import {createSourceM4A4Material} from '../game/source-m4a4-viewmodel';
import {createSourceWorldM4A4Material} from '../game/source-world-m4a4-material';
import {createSourcePistolMaterial} from '../game/source-pistol-viewmodel';
import {createSourceWorldPistolMaterial} from '../game/source-pistol-character-surfaces';
import {createSourceDeagleMaterial} from '../game/source-deagle-viewmodel';
import {createSourceWorldDeagleMaterial} from '../game/source-deagle-character-surfaces';
import {createSourceAWPMaterial} from '../game/source-awp-materials';
import {setSourceMaterialEnvironment} from '../game/source-material-environment';

function compile(material:T.Material){
  const shader={uniforms:T.UniformsUtils.clone(T.ShaderLib.phong.uniforms),vertexShader:T.ShaderLib.phong.vertexShader,
    fragmentShader:T.ShaderLib.phong.fragmentShader} as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader,{} as T.WebGLRenderer);return shader;
}
it('uses the twelve original gun-body VMTs in actual FP/world factories and preserves the world USP exception',()=>{
  const base=new T.Texture(),exponent=new T.Texture(),textures={base,exponent},cube=new T.CubeTexture();
  const factories={ak47:[()=>createSourceAKMaterial(base,exponent),()=>createSourceWorldAKMaterial(textures)],
    m4a4:[()=>createSourceM4A4Material(base,exponent),()=>createSourceWorldM4A4Material(textures)],
    awp:[()=>createSourceAWPMaterial('awp',base,exponent),()=>createSourceAWPMaterial('awp',base,exponent,true)],
    glock:[()=>createSourcePistolMaterial('glock',base,exponent),()=>createSourceWorldPistolMaterial('glock',textures)],
    usp:[()=>createSourcePistolMaterial('usp',base,exponent),()=>createSourceWorldPistolMaterial('usp',textures)],
    deagle:[()=>createSourceDeagleMaterial('deagle',base,exponent),()=>createSourceWorldDeagleMaterial('deagle',textures)]};
  let sourcesDisposed=0;for(const texture of[base,exponent,cube])texture.addEventListener('dispose',()=>sourcesDisposed++);
  expect(reference.cases).toHaveLength(12);
  for(const row of reference.cases){
    const raw=readFileSync(`.reference-assets/source-exports/fidelity-materials-20260913/default-weapons/${row.weapon}-${row.variant}.vmt`);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(row.sha256);
    const original=row.originalParameters as unknown as Record<string,string>,lineNumbers=row.originalLineNumbers as unknown as Record<string,number>;
    for(const [key,value]of Object.entries(original)){
      const line=raw.toString().split(/\r?\n/)[lineNumbers[key]-1].toLowerCase();
      expect(line).toContain('"'+key+'"');expect(line).toContain('"'+value.toLowerCase()+'"');
    }
    const h=factories[row.weapon as keyof typeof factories][row.variant==='world'?1:0](),s=compile(h.material);
    try{
      expect(h.material.userData.sourceVMT).toBe(row.sourceVMT);
      expect(h.material.userData.sourceVMTSha256).toBe(row.sha256);
      expect(s.uniforms.sourceBoost.value).toBe(Number(original.$phongboost));
      expect(s.uniforms.sourceFresnelRanges.value.toArray()).toEqual(original.$phongfresnelranges.slice(1,-1).split(/\s+/).map(Number));
      expect(s.fragmentShader).toContain('float sourceMask=texture2D(map,vMapUv).a');
      if(original.$phongalbedotint==='1'){
        expect(s.uniforms.sourceAlbedoBoost.value).toBe(Number(original.$phongalbedoboost));
        expect(s.fragmentShader).toContain('mix(vec3(sourceBoost),diffuseColor.rgb*sourceAlbedoBoost,sourceParameters.g)');
        expect(s.uniforms.sourceEnvTint.value.toArray()).toEqual(original.$envmaptint.slice(1,-1).split(/\s+/).map(Number));
        expect(setSourceMaterialEnvironment(h.material,{cube,viewToSource:new T.Matrix3(),probeId:'original-probe',scale:1})).toBe(true);
        expect(s.uniforms.sourceEnvMap.value).toBe(cube);
      }else{
        expect([row.weapon,row.variant]).toEqual(['usp','world']);
        expect(original.$envmap).toBeUndefined();expect(original.$phongdisablehalflambert).toBe('0');
        expect(s.fragmentShader).toContain('material.specularColor=sourceTint');
        expect(s.uniforms.sourceTint.value.toArray()).toEqual([1,1,1]);
        expect(s.fragmentShader).toContain('vec3(sourceDiffuse*sourceDiffuse)');
        expect(s.uniforms.sourceEnvMap).toBeUndefined();
        expect(setSourceMaterialEnvironment(h.material,null)).toBe(false);
      }
    }finally{h.dispose();h.dispose();}
  }
  expect(sourcesDisposed).toBe(0);for(const texture of[base,exponent,cube])texture.dispose();
});
