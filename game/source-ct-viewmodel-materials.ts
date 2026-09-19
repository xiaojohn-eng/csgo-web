import * as T from 'three';
import type {SourceViewmodelArmsProfile} from './source-viewmodel';
import {sourceAmbientRimFragment} from './source-ambient-cube';

export type SourceCTArmTextures={sleeve:{base:T.Texture;normal:T.Texture};glove:{base:T.Texture;normal:T.Texture;exponent:T.Texture}};
export const SOURCE_CT_ARM_MATERIALS=['ct_arms_idf','models/weapons/v_models/arms/ct_base_glove'] as const;

function replace(source:string,token:string,value:string){
  if(!source.includes(token))throw Error('CT Source Phong shader contract changed: '+token);
  return source.replace(token,value);
}
/** Actual CT VMT inputs with the bounded SDK2013 direct-light implementation.
 * Ambient cube/rim binds at draw time. Envmap and CSGO albedo terms remain separate.
 * Sleeve disablehalflambert is the original explicit VMT flag; no T skin warp.
 */
export function createSourceCTArmMaterial(kind:'sleeve'|'glove',textures:SourceCTArmTextures){
  const sleeve=kind==='sleeve',maps=textures[kind],exponent=sleeve?undefined:textures.glove.exponent.clone();
  if(exponent){exponent.colorSpace=T.NoColorSpace;exponent.needsUpdate=true;}
  const material=new T.MeshPhongMaterial({map:maps.base,normalMap:maps.normal,color:0xffffff,specular:0xffffff,shininess:sleeve?12:30});
  material.normalScale.set(1,-1);
  material.name=sleeve?'Source_CT_IDF_Sleeves_VertexLitGeneric':'Source_CT_Gloves_VertexLitGeneric';
  material.userData={sourceShader:'VertexLitGeneric',sourceMaterial:SOURCE_CT_ARM_MATERIALS[sleeve?0:1],
    sourceArmsProfile:'ct_arms_idf',phongMask:'raw normal alpha',
    sourceAmbientRim:true,
    sourceParameters:{boost:sleeve?1:.8,exponent:sleeve?12:'1 + 149 * raw exponent R',fresnel:sleeve?[.2,.2,1]:[1,1,3],
      tint:sleeve?[1,1,1]:[.7,.8,1],halfLambert:!sleeve,rimExponent:sleeve?15:4,rimMask:sleeve?'one':'raw exponent alpha',
      ambientRimBoost:sleeve?.2:1,envMap:sleeve?null:'env_cubemap',envMapTint:sleeve?null:[.01,.01,.02],phongAlbedoBoost:sleeve?null:15},
    limitations:['Original ambient cube needs map-probe binding; local envmap remains','CSGO-specific phongalbedoboost','Original client lighting and tone mapping']};
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{sourceCTExponent:{value:exponent},sourceCTBoost:{value:sleeve?1:.8},
      sourceCTFresnel:{value:new T.Vector3(...(sleeve?[.2,.2,1]:[1,1,3]))},
      sourceCTTint:{value:new T.Vector3(...(sleeve?[1,1,1]:[.7,.8,1]))},sourceCTRimExponent:{value:sleeve?15:4},sourceCTRimBoost:{value:sleeve?.2:1}});
    shader.fragmentShader=`uniform sampler2D sourceCTExponent;
      uniform float sourceCTBoost; uniform float sourceCTRimExponent; uniform float sourceCTRimBoost;
      uniform vec3 sourceCTFresnel; uniform vec3 sourceCTTint;
      vec3 sourceCTRimRadiance=vec3(0.0);
      ${shader.fragmentShader}`;
    let direct=T.ShaderChunk.lights_phong_pars_fragment;
    direct=replace(direct,'reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;',
      `float sourceCTLdotR=max(dot(reflect(-geometryViewDir,geometryNormal),directLight.direction),0.0);
       reflectedLight.directSpecular+=irradiance*pow(sourceCTLdotR,material.specularShininess)*material.specularColor*material.specularStrength;
       sourceCTRimRadiance+=irradiance*pow(sourceCTLdotR,sourceCTRimExponent);`);
    if(!sleeve)direct=replace(direct,'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
      `float sourceCTDiffuse=clamp(dot(geometryNormal,directLight.direction)*.5+.5,0.0,1.0);
       reflectedLight.directDiffuse+=directLight.color*(sourceCTDiffuse*sourceCTDiffuse)*BRDF_Lambert(material.diffuseColor);`);
    shader.fragmentShader=replace(shader.fragmentShader,'#include <lights_phong_pars_fragment>',direct);
    shader.fragmentShader=replace(shader.fragmentShader,'#include <lights_phong_fragment>',`
      BlinnPhongMaterial material;
      vec4 sourceCTParams=${sleeve?'vec4(0.0,0.0,0.0,1.0)':'texture2D(sourceCTExponent,vMapUv)'};
      float sourceCTMask=texture2D(normalMap,vNormalMapUv).a;
      float sourceCTFacing=clamp(1.0-dot(normal,normalize(vViewPosition)),0.0,1.0);
      float sourceCTF2=sourceCTFacing*sourceCTFacing;
      float sourceCTF=sourceCTF2<=.5?mix(sourceCTFresnel.x,sourceCTFresnel.y,sourceCTF2*2.0):mix(sourceCTFresnel.y,sourceCTFresnel.z,sourceCTF2*2.0-1.0);
      material.diffuseColor=diffuseColor.rgb; material.specularColor=sourceCTTint;
      material.specularShininess=${sleeve?'12.0':'1.0+149.0*sourceCTParams.r'};
      material.specularStrength=sourceCTMask*sourceCTBoost*sourceCTF;
    `);
    shader.fragmentShader=replace(shader.fragmentShader,'#include <lights_fragment_end>',`
      #include <lights_fragment_end>
      reflectedLight.directSpecular=max(reflectedLight.directSpecular,sourceCTRimRadiance*sourceCTParams.a*sourceCTF2*sourceCTF2*sourceCTTint);
      ${sourceAmbientRimFragment('sourceCTParams.a*sourceCTF2*sourceCTF2','sourceCTTint','sourceCTRimBoost')}
    `);
  };
  material.customProgramCacheKey=()=>material.name+'-source-ct-phong-v2';
  return {material,dispose:()=>{material.dispose();exponent?.dispose();}};
}
export function sourceCTArmsProfile(textures:SourceCTArmTextures):SourceViewmodelArmsProfile{
  return {id:'ct_arms_idf',createMaterials:()=>new Map([
    [SOURCE_CT_ARM_MATERIALS[0],createSourceCTArmMaterial('sleeve',textures)],
    [SOURCE_CT_ARM_MATERIALS[1],createSourceCTArmMaterial('glove',textures)],
  ])};
}
