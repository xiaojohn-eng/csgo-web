import {describe,expect,it} from 'vitest';
import * as T from 'three';
import {attachSourceAmbientCube,setSourceAmbientCube} from '../game/source-ambient-cube';
import {createSourceArmsMaterial} from '../game/source-materials';
import {createSourceCharacterMaterial} from '../game/source-character-materials';
import {createSourceCTCharacterMaterial} from '../game/source-ct-character-materials';
import {createSourceCTArmMaterial} from '../game/source-ct-viewmodel-materials';

function compile(material:T.Material){const s={uniforms:T.UniformsUtils.clone(T.ShaderLib.phong.uniforms),vertexShader:T.ShaderLib.phong.vertexShader,fragmentShader:T.ShaderLib.phong.fragmentShader}as T.WebGLProgramParametersWithUniforms;material.onBeforeCompile(s,{}as T.WebGLRenderer);return s;}
describe('original ambient rim material terms',()=>{
 it('uses the VMT-specific rim boosts and masks, including head disable and unmasked sleeve',()=>{
  const t={base:new T.Texture(),normal:new T.Texture(),exponent:new T.Texture()};
  const handles=[
   [createSourceArmsMaterial('skin',t),'sourceRimBoost',.05,'sourceRimFactor'],
   [createSourceArmsMaterial('glove',t),'sourceRimBoost',.7,'sourceRimFactor'],
   [createSourceCharacterMaterial('upperbody',t),'sourceCharacterRimBoost',.6,'sourceCharacterRimMask'],
   [createSourceCTCharacterMaterial('head',t),'sourceCharacterRimBoost',1,'sourceCharacterRimMask'],
   [createSourceCTArmMaterial('sleeve',{sleeve:t,glove:t}),'sourceCTRimBoost',.2,'sourceCTParams.a*sourceCTF2*sourceCTF2'],
   [createSourceCTArmMaterial('glove',{sleeve:t,glove:t}),'sourceCTRimBoost',1,'sourceCTParams.a*sourceCTF2*sourceCTF2'],
  ]as const;
  for(const [h,name,value,mask] of handles){
   const bare=compile(h.material);expect(bare.uniforms[name].value).toBe(value);
   expect(bare.fragmentShader).not.toContain('#define SOURCE_AMBIENT_CUBE');
   attachSourceAmbientCube(h.material);const shader=compile(h.material);
   expect(shader.fragmentShader).toContain('#define SOURCE_AMBIENT_CUBE');
   expect(shader.fragmentShader).toContain(`clamp((${mask})*sourceRimNormal.z,0.0,1.0)`);
   expect(shader.fragmentShader).toContain('sourceAmbientRadiance(sourceRimEye)');
   expect(shader.uniforms.sourceAmbientEnabled.value).toBe(0);
   setSourceAmbientCube(h.material,Array.from({length:6},()=>[.25,.5,1]),new T.Matrix3());
   expect(shader.uniforms.sourceAmbientEnabled.value).toBe(1);
   expect(h.material.userData.sourceAmbientCube.ambientRimImplemented).toBe(true);h.dispose();
  }
  const head=createSourceCharacterMaterial('head',t);expect(compile(head.material).uniforms.sourceCharacterRimEnabled.value).toBe(0);head.dispose();
  Object.values(t).forEach(texture=>texture.dispose());
 });
});
