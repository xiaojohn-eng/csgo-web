import * as T from 'three';
import {SOURCE_DEFAULT_WEAPON_MATERIAL_DATA} from './source-default-weapon-material-data';
import {createSourceMaterialEnvironment, sourceEnvironmentFragment, SOURCE_ENVIRONMENT_UNIFORMS, type SourceEnvmapParameters} from './source-material-environment';
import {sourceAmbientRimFragment} from './source-ambient-cube';

export type SourceSurfaceTextures = {base:T.Texture;normal:T.Texture;exponent:T.Texture;warp?:T.Texture};
export type SourcePhongParameters = {name:string;boost:number;fresnel:[number,number,number];tint?:[number,number,number];
  normal?:T.Texture;phongMask?:'baseAlpha'|'normalAlpha';warp?:T.Texture;halfLambert?:boolean;rimExponent?:number;albedoBoost?:number;albedoTint?:boolean;
  exponentConstant?:number;envmap?:SourceEnvmapParameters;rimBoost?:number;rimMask?:'exponentAlpha'|'one'};

function replaceRequired(source:string, token:string, replacement:string) {
  if(!source.includes(token))throw new Error('Source material shader contract changed: '+token);
  return source.replace(token,replacement);
}

/** Bounded Source Phong adaptation. Raw channels and formulas follow the pinned
 * SDK in research/source-sdk-shader-index.json. AK albedo boost follows this
 * build's original phong_ps30 and constant upload, recorded in
 * docs/source-redline-phong-worktree.md. Original cubes bind at draw time.
 */
export function createSourcePhongMaterial(base:T.Texture, exponent:T.Texture|null, p:SourcePhongParameters) {
  if((!exponent&&p.exponentConstant===undefined)||(p.exponentConstant!==undefined&&(!Number.isFinite(p.exponentConstant)||p.exponentConstant<=0)))throw Error('Original Source material needs an exponent texture or positive constant');
  const normalMask=p.phongMask==='normalAlpha'||(p.phongMask===undefined&&!!p.normal);
  if(normalMask&&!p.normal)throw Error('Original Source Phong mask needs a normal map');
  if(p.envmap?.mask==='normalAlpha'&&!p.normal)throw Error('Original Source envmap mask needs a normal map');
  const controls=exponent?.clone();if(controls){controls.colorSpace=T.NoColorSpace;controls.needsUpdate=true;}
  const material=new T.MeshPhongMaterial({map:base,normalMap:p.normal??null,color:0xffffff,specular:0xffffff,shininess:30});
  // Raw Source normal images use the opposite tangent-space green direction to
  // glTF. SourceIO does this same conversion before its Blender export.
  if(p.normal)material.normalScale.set(1,-1);
  material.name=p.name;
  material.userData={sourceShader:'VertexLitGeneric',exponentChannels:{r:'phong power',g:'albedo tint mask',a:'rim mask'},
    phongMask:normalMask?'normal alpha (Source default)':'base alpha ($basemapalphaphongmask)',
    sourceParameters:{boost:p.boost,fresnel:p.fresnel,tint:p.tint,halfLambert:!!p.halfLambert,rimExponent:p.rimExponent,rimBoost:p.rimBoost,rimMask:p.rimMask??'exponentAlpha',albedoBoost:p.albedoBoost,albedoTint:!!p.albedoTint},
    sourceAmbientRim:!!p.rimExponent&&p.rimBoost!==undefined,
    limitations:['Original environment/ambient require map-probe binding',...(p.albedoTint?[]:['CSGO-specific material branches']),'original lighting/tone mapping']};
  const environment=p.envmap?createSourceMaterialEnvironment(material,p.envmap):null;
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{sourceExponentMap:{value:controls??null},sourceBoost:{value:p.boost},sourceAlbedoBoost:{value:p.albedoBoost??1},
      sourceFresnelRanges:{value:new T.Vector3(...p.fresnel)},sourceTint:{value:new T.Vector3(...(p.tint??[1,1,1]))},
      sourceRimExponent:{value:p.rimExponent??1},sourceRimBoost:{value:p.rimBoost??0},sourceWarpMap:{value:p.warp??base}});
    if(environment)Object.assign(shader.uniforms,environment);
    shader.fragmentShader=`${environment?SOURCE_ENVIRONMENT_UNIFORMS:''}
      uniform sampler2D sourceExponentMap;
      uniform sampler2D sourceWarpMap;
      uniform float sourceBoost;
      uniform float sourceAlbedoBoost;
      uniform float sourceRimExponent;
      uniform float sourceRimBoost;
      uniform vec3 sourceFresnelRanges;
      uniform vec3 sourceTint;
      vec3 sourceRimRadiance=vec3(0.0);
      ${shader.fragmentShader}`;
    let direct=T.ShaderChunk.lights_phong_pars_fragment;
    direct=replaceRequired(direct,
      'reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;',
      `vec3 sourceReflection=reflect(-geometryViewDir,geometryNormal);
       float sourceLdotR=max(dot(sourceReflection,directLight.direction),0.0);
       float sourceLobe=pow(sourceLdotR,material.specularShininess);
       reflectedLight.directSpecular+=irradiance*sourceLobe*material.specularColor*material.specularStrength;
       sourceRimRadiance+=irradiance*pow(sourceLdotR,sourceRimExponent);`);
    if(p.halfLambert)direct=replaceRequired(direct,
      'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
      `float sourceDiffuse=clamp(dot(geometryNormal,directLight.direction)*.5+.5,0.0,1.0);
       vec3 sourceDiffuseTerm=${p.warp?'2.0*texture2D(sourceWarpMap,vec2(sourceDiffuse,.5)).rgb':'vec3(sourceDiffuse*sourceDiffuse)'};
       reflectedLight.directDiffuse+=directLight.color*sourceDiffuseTerm*BRDF_Lambert(material.diffuseColor);`);
    shader.fragmentShader=replaceRequired(shader.fragmentShader,'#include <lights_phong_pars_fragment>',direct);
    shader.fragmentShader=replaceRequired(shader.fragmentShader,'#include <lights_phong_fragment>',`
      BlinnPhongMaterial material;
      vec4 sourceParameters=${controls?'texture2D(sourceExponentMap,vMapUv)':'vec4(0.0)'};
      float sourceMask=${normalMask?'texture2D(normalMap,vNormalMapUv).a':'texture2D(map,vMapUv).a'};
      float sourceFacing=clamp(1.0-dot(normal,normalize(vViewPosition)),0.0,1.0);
      float sourceFresnelCoordinate=sourceFacing*sourceFacing;
      float sourceFresnel=sourceFresnelCoordinate<=.5
        ?mix(sourceFresnelRanges.x,sourceFresnelRanges.y,sourceFresnelCoordinate*2.0)
        :mix(sourceFresnelRanges.y,sourceFresnelRanges.z,sourceFresnelCoordinate*2.0-1.0);
      material.diffuseColor=diffuseColor.rgb;
      material.specularColor=${p.albedoTint?'mix(vec3(sourceBoost),diffuseColor.rgb*sourceAlbedoBoost,sourceParameters.g)':p.tint?'sourceTint':'mix(vec3(1.0),diffuseColor.rgb,sourceParameters.g)'};
      material.specularShininess=${p.exponentConstant!==undefined?Number(p.exponentConstant).toFixed(8):'1.0+149.0*sourceParameters.r'};
      material.specularStrength=sourceMask*${p.albedoTint?'':'sourceBoost*'}sourceFresnel;
      ${p.envmap?sourceEnvironmentFragment(p.envmap,!!p.albedoTint):''}
    `);
    if(p.rimExponent)shader.fragmentShader=replaceRequired(shader.fragmentShader,'#include <lights_fragment_end>',`
      #include <lights_fragment_end>
      float sourceRimFactor=${p.rimMask==='one'?'1.0':'sourceParameters.a'}*sourceFresnelCoordinate*sourceFresnelCoordinate;
      reflectedLight.directSpecular=max(reflectedLight.directSpecular,sourceRimRadiance*sourceRimFactor*material.specularColor);
      ${p.rimBoost!==undefined?sourceAmbientRimFragment('sourceRimFactor','material.specularColor','sourceRimBoost'):''}
    `);
  };
  material.customProgramCacheKey=()=>p.name+'-source-phong-r5-'+JSON.stringify([!!p.normal,normalMask,!!p.albedoTint,p.tint,p.halfLambert,!!p.warp,p.rimExponent,p.rimMask,p.rimBoost!==undefined,p.exponentConstant,p.envmap]);
  let disposed=false;
  return {material,dispose:()=>{if(disposed)return;disposed=true;material.dispose();controls?.dispose();}};
}

/** The composed finish's draw-material adapter. The caller supplies the clone's
 * `$phongboost`, `$phongalbedoboost` and `$phongfresnelranges`. Style 7 preserves
 * the weapon values; style 5 can raise albedo boost (AWP 395: 40 -> 60):
 * the AK-47's material carries 2/35 and `.83 .83 1`, the M4A1's 2/25 and the same stops,
 * and the AWP's 2/40 and `.8 .8 1`. All of them are read from the original weapon VMT by
 * `scripts/extract-source-kit-inputs.py`. Style 5's native clone explicitly forces
 * albedo tint. Other styles retain this adapter's existing bounded albedo-tint path;
 * this function does not establish every original world-model material branch.
 */
export function createSourceFinishMaterial(finish:{name:string;phongBoost:number;phongAlbedoBoost:number;
  phongFresnelRanges:readonly [number,number,number];envmap?:SourceEnvmapParameters},base:T.Texture,exponent:T.Texture,normal?:T.Texture) {
  return createSourcePhongMaterial(base,exponent,{name:finish.name,boost:finish.phongBoost,albedoBoost:finish.phongAlbedoBoost,
    normal,envmap:finish.envmap,phongMask:'baseAlpha',albedoTint:true,fresnel:[...finish.phongFresnelRanges] as [number,number,number]});
}

export type SourceDefaultWeapon = keyof typeof SOURCE_DEFAULT_WEAPON_MATERIAL_DATA;
/** Exact default gun-body controls from twelve VMTs, including the distinct world USP.
 * Input pixels remain owned by the loader; this factory owns only the exponent view. */
export function createSourceDefaultWeaponMaterial(weapon:SourceDefaultWeapon,base:T.Texture,exponent:T.Texture,world=false) {
  const record=SOURCE_DEFAULT_WEAPON_MATERIAL_DATA[weapon][world?'world':'firstPerson'] as unknown as {
    sourceVMT:string;sha256:string;parameters:SourcePhongParameters};
  const p=record.parameters;
  const handle=createSourcePhongMaterial(base,exponent,{...p,fresnel:[...p.fresnel],
    ...(p.tint?{tint:[...p.tint] as [number,number,number]}:{}),
    ...(p.envmap?{envmap:{...p.envmap,tint:[...p.envmap.tint] as [number,number,number]}}:{})});
  Object.assign(handle.material.userData,{sourceVMT:record.sourceVMT,sourceMaterial:record.sourceVMT,
    sourceVMTSha256:record.sha256,sourceWeapon:weapon,weaponId:weapon});
  Object.assign(handle.material.userData.sourceParameters,{phongAlbedoBoost:p.albedoBoost??null,phongAlbedoTint:!!p.albedoTint});
  return handle;
}

export function createSourceAKMaterial(base:T.Texture,exponent:T.Texture) {
  return createSourceDefaultWeaponMaterial('ak47',base,exponent);
}

/** Existing bounded template for other weapon VMT adapters. AK-specific
 * constants and shader branches must not leak into these independent owners. */
export function createSourceWeaponMaterial(base:T.Texture,exponent:T.Texture) {
  return createSourcePhongMaterial(base,exponent,{name:'Source_Weapon_VertexLitGeneric',boost:2,fresnel:[.83,.83,1]});
}

export function createSourceArmsMaterial(kind:'skin'|'glove',textures:SourceSurfaceTextures) {
  const skin=kind==='skin';
  return createSourcePhongMaterial(textures.base,textures.exponent,{name:skin?'Source_T_Arms_VertexLitGeneric':'Source_T_Gloves_VertexLitGeneric',
    normal:textures.normal,warp:textures.warp,boost:skin?2:.8,fresnel:skin?[.3,.5,1]:[1,1,3],tint:[.7,.8,1],
    halfLambert:true,rimExponent:skin?14:10,rimBoost:skin?.05:.7});
}
