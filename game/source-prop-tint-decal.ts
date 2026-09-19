import * as T from 'three';
import {sourceInstanceTint,validateSourcePropTint} from './source-prop-tint';
import {validateSourcePropDecal} from './source-prop-decal';
import {validateSourcePropDecalUv,type SourcePropDecalUvBinding} from './source-prop-decal-uv';

const allowed=new Set(['$basetexture','$bumpmap','$tintmasktexture','$decaltexture','$decalblendmode','$surfaceprop']);
export const SOURCE_TINT_DECAL_ANCHOR='/* SOURCE_TINT_DECAL_COMPOSITE */';
/** Installed static786436/dynamic80; only the two opaque crate VMTs' mode1
 * feature set. NOTINT, alpha/decal lerp, transform and material color overrides
 * remain excluded here even when separately implemented by other branches. */
export function sourcePropTintDecalCandidate(p:Record<string,unknown>){
  return !!p.$basetexture&&!!p.$bumpmap&&!!p.$tintmasktexture&&!!p.$decaltexture&&String(p.$decalblendmode)==='1'&&Object.keys(p).every(k=>allowed.has(k));
}
export function validateSourcePropTintDecal(tint:T.Texture|undefined,decal:T.Texture|undefined,uv:SourcePropDecalUvBinding|undefined,rgb:readonly number[]|undefined,p:Record<string,unknown>,material:T.Material,vertices:number){
  if(!sourcePropTintDecalCandidate(p))throw Error('Unsupported original tint+decal material');
  const {$decaltexture:_, $decalblendmode:__,...tintOnly}=p;
  validateSourcePropTint(tint,rgb,tintOnly,material);validateSourcePropDecal(decal);validateSourcePropDecalUv(uv,vertices);
  if(material.transparent||material.opacity!==1||material.alphaTest!==0)throw Error('Original compound subset requires opaque material');
}

/** Single ordered fragment, also consumed unchanged by the private numeric GPU
 * probe. The original DX9 words285..318 tint baked light, multiply base, then
 * multiply the UV2 decal. It never chains competing map-fragment hooks. */
export const SOURCE_TINT_DECAL_FRAGMENT=`
float sourceCompoundMask=clamp(texture2D(sourceCompoundTintMap,vSourceCompoundTintUv).g+sourceCompoundBias,0.0,1.0);
vec3 sourceCompoundTint=vec3(1.0)+sourceCompoundMask*(sourceCompoundTintColor-vec3(1.0));
vec3 sourceCompoundLighting=sourceBakedDiffuse*sourceCompoundTint;
diffuseColor.rgb*=sourceCompoundLighting;
vec3 sourceCompoundDecal=texture2D(sourceCompoundDecalMap,vSourceCompoundDecalUv).rgb;
diffuseColor.rgb*=sourceCompoundDecal;
`;
export const SOURCE_TINT_DECAL_DECLARATIONS=`
varying vec2 vSourceCompoundTintUv,vSourceCompoundDecalUv;
uniform sampler2D sourceCompoundTintMap,sourceCompoundDecalMap;
uniform vec3 sourceCompoundTintColor;
uniform float sourceCompoundBias;
`;
export function attachSourcePropTintDecal(material:T.Material,tint:T.Texture,decal:T.Texture,uv:SourcePropDecalUvBinding,rgb:readonly number[]){
  const previous=material.onBeforeCompile,cache=material.customProgramCacheKey(),color=new T.Vector3(...sourceInstanceTint(rgb));
  material.onBeforeCompile=(shader,renderer)=>{
    previous.call(material,shader,renderer);
    if(shader.fragmentShader.split(SOURCE_TINT_DECAL_ANCHOR).length!==2||!shader.fragmentShader.includes('#include <common>')||!shader.vertexShader.includes('#include <begin_vertex>'))throw Error('Original compound shader anchor missing or repeated');
    Object.assign(shader.uniforms,{sourceCompoundTintMap:{value:tint},sourceCompoundDecalMap:{value:decal},sourceCompoundTintColor:{value:color},sourceCompoundBias:{value:0},
      sourceCompoundUvMap:{value:uv.texture},sourceCompoundUvWidth:{value:uv.width},sourceCompoundUvOffset:{value:uv.offset}});
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vSourceCompoundTintUv,vSourceCompoundDecalUv; uniform highp sampler2D sourceCompoundUvMap; uniform int sourceCompoundUvWidth,sourceCompoundUvOffset;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvSourceCompoundTintUv=uv;\nint sourceCompoundAddress=sourceCompoundUvOffset+gl_VertexID;\nvSourceCompoundDecalUv=texelFetch(sourceCompoundUvMap,ivec2(sourceCompoundAddress%sourceCompoundUvWidth,sourceCompoundAddress/sourceCompoundUvWidth),0).rg;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+SOURCE_TINT_DECAL_DECLARATIONS).replace(SOURCE_TINT_DECAL_ANCHOR,SOURCE_TINT_DECAL_FRAGMENT);
  };
  material.customProgramCacheKey=()=>cache+'/source-original-tint-decal-mode1-r1';
}
