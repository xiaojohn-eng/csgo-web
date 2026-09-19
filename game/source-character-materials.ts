import * as T from 'three';
import {createSourceAKMaterial,createSourceDefaultWeaponMaterial,type SourceSurfaceTextures} from './source-materials';
import {sourceAmbientRimFragment} from './source-ambient-cube';

export type SourceCharacterPart='upperbody'|'lowerbody'|'head';

const materialNames:Record<SourceCharacterPart,string>={
  upperbody:'tm_leet_upperbody_variantA',
  lowerbody:'tm_leet_lowerbody_variantA',
  head:'tm_elite_head_variantA',
};

function textureView(source:T.Texture,color:boolean){
  // Separate sampler/color-space ownership; image pixels remain shared and raw.
  const view=source.clone();view.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;
  view.flipY=false;view.needsUpdate=true;return view;
}

function replaceRequired(source:string,token:string,replacement:string){
  if(!source.includes(token))throw new Error('Source character shader contract changed: '+token);
  return source.replace(token,replacement);
}

/** Original tm_leet variant A VMT adaptation for the private source-unit GLB.
 * Three supplies light attenuation, shadows, diffuse/ambient irradiance and tone
 * mapping. Original Source ambient cubes and ambient rim bind at draw time;
 * original client lighting and final pixels remain a separate GPU review.
 * Owns one material + three texture views. Share a handle across actor clones,
 * then dispose it when that asset cache leaves the world. No frame allocations.
 */
export function createSourceCharacterMaterial(part:SourceCharacterPart,textures:SourceSurfaceTextures){
  const base=textureView(textures.base,true),normal=textureView(textures.normal,false),exponent=textureView(textures.exponent,false);
  const material=new T.MeshPhongMaterial({map:base,normalMap:normal,color:0xffffff,specular:0xffffff,shininess:30});
  const rim=part==='head'?0:1;
  material.name='Source_'+materialNames[part];material.normalScale.set(1,-1);
  material.userData={sourceShader:'VertexLitGeneric',sourceVMT:'materials/models/player/tm_leet/'+materialNames[part]+'.vmt',
    sourceParameters:{phongboost:25,phongfresnelranges:[0,.1,1],phongdisablehalflambert:1,
      rimlight:rim,rimmask:rim,rimlightexponent:1.2,rimlightboost:.6,phongalbedotint:0},
    phongMask:'normal alpha (Source default)',exponentChannels:{r:'1 + 149 * R',g:'unused: no phongalbedotint',a:'rim mask for upper/lower body'},
    sourceAmbientRim:true,
    limitations:['original Source ambient cube requires map-probe binding',
      'original light intensities, attenuation and tone mapping','CSGO client shader parity and GPU visual acceptance remain unverified']};
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{sourceCharacterExponentMap:{value:exponent},sourceCharacterBoost:{value:25},
      sourceCharacterFresnel:{value:new T.Vector3(0,.1,1)},sourceCharacterRimEnabled:{value:rim},sourceCharacterRimExponent:{value:1.2},sourceCharacterRimBoost:{value:.6}});
    shader.fragmentShader=`uniform sampler2D sourceCharacterExponentMap;
      uniform float sourceCharacterBoost;
      uniform vec3 sourceCharacterFresnel;
      uniform float sourceCharacterRimEnabled;
      uniform float sourceCharacterRimExponent;
      uniform float sourceCharacterRimBoost;
      vec3 sourceCharacterRimRadiance=vec3(0.0);
      ${shader.fragmentShader}`;
    const direct=replaceRequired(T.ShaderChunk.lights_phong_pars_fragment,
      'reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;',
      `vec3 sourceCharacterReflection=reflect(-geometryViewDir,geometryNormal);
       float sourceCharacterLdotR=max(dot(sourceCharacterReflection,directLight.direction),0.0);
       reflectedLight.directSpecular+=irradiance*pow(sourceCharacterLdotR,material.specularShininess)*material.specularColor*material.specularStrength;
       sourceCharacterRimRadiance+=irradiance*pow(sourceCharacterLdotR,sourceCharacterRimExponent);`);
    shader.fragmentShader=replaceRequired(shader.fragmentShader,'#include <lights_phong_pars_fragment>',direct);
    shader.fragmentShader=replaceRequired(shader.fragmentShader,'#include <lights_phong_fragment>',`
      BlinnPhongMaterial material;
      vec4 sourceCharacterParameters=texture2D(sourceCharacterExponentMap,vMapUv);
      float sourceCharacterMask=texture2D(normalMap,vNormalMapUv).a;
      float sourceCharacterFacing=clamp(1.0-dot(normal,normalize(vViewPosition)),0.0,1.0);
      float sourceCharacterF=sourceCharacterFacing*sourceCharacterFacing;
      float sourceCharacterSpecularFresnel=sourceCharacterF<=.5
        ?mix(sourceCharacterFresnel.x,sourceCharacterFresnel.y,sourceCharacterF*2.0)
        :mix(sourceCharacterFresnel.y,sourceCharacterFresnel.z,sourceCharacterF*2.0-1.0);
      material.diffuseColor=diffuseColor.rgb;
      material.specularColor=vec3(1.0);
      material.specularShininess=1.0+149.0*sourceCharacterParameters.r;
      material.specularStrength=sourceCharacterMask*sourceCharacterBoost*sourceCharacterSpecularFresnel;
    `);
    // Direct rim is a separate lobe folded with max. The original .6 boost
    // applies only to the following ambient-cube contribution.
    shader.fragmentShader=replaceRequired(shader.fragmentShader,'#include <lights_fragment_end>',`
      #include <lights_fragment_end>
      float sourceCharacterRimMask=sourceCharacterParameters.a*sourceCharacterF*sourceCharacterF*sourceCharacterRimEnabled;
      reflectedLight.directSpecular=max(reflectedLight.directSpecular,sourceCharacterRimRadiance*sourceCharacterRimMask);
      ${sourceAmbientRimFragment('sourceCharacterRimMask','material.specularColor','sourceCharacterRimBoost')}
    `);
  };
  material.customProgramCacheKey=()=> 'source-character-phong-v2';
  let disposed=false;
  return {material,dispose:()=>{
    if(disposed)return;disposed=true;material.dispose();base.dispose();normal.dispose();exponent.dispose();
  }};
}

/** Same original AK VMT as the first-person factory. Two uploaded texture views;
 * no normal is fabricated for this VMT, which has no bumpmap. */
export function createSourceWorldAKMaterial(textures:Pick<SourceSurfaceTextures,'base'|'exponent'>){
  return createSourceWorldMaterial(textures,(base,exponent)=>createSourceDefaultWeaponMaterial('ak47',base,exponent,true),
    'materials/models/weapons/w_models/w_rif_ak47/ak47.vmt');
}

/** Borrowed texture views are shared infrastructure; the weapon factory is
 * explicit so a different world weapon cannot inherit AK-specific controls. */
export function createSourceWorldMaterial(textures:Pick<SourceSurfaceTextures,'base'|'exponent'>,factory:typeof createSourceAKMaterial,sourceVMT:string){
  const base=textureView(textures.base,true),exponent=textureView(textures.exponent,false);
  const adapted=factory(base,exponent);
  // The existing factory owns another exponent view. This staging view is never
  // attached to a shader and can be released immediately without touching pixels.
  exponent.dispose();
  adapted.material.userData.sourceVMT=sourceVMT;
  let disposed=false;
  return {material:adapted.material,dispose:()=>{if(disposed)return;disposed=true;adapted.dispose();base.dispose();}};
}
