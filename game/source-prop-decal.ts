import * as T from 'three';
import type {SourcePropDecalUvBinding} from './source-prop-decal-uv';

/** Installed bump PS DECAL_BLEND_MODE=1, sampler12, dynamic80. CPU selects
 * the same multiply program for original mode2, with c3.w=2 instead of 1.
 * The installed dynamic command uses sRGB sampler12 when detailblendmode=0.
 * Its shadow API no-op must not override the actual command consumer. Other branches are not
 * implied: no tintmask, alpha decal, phong, transformed decal UV, or envmap. */
export function sourcePropDecalMode(parameters:Record<string,unknown>):1|2|undefined {
  if(!parameters.$decaltexture||!parameters.$bumpmap)return;
  const mode=String(parameters.$decalblendmode);
  if(mode==='1'||mode==='2')return Number(mode) as 1|2;
}

export function validateSourcePropDecal(texture:T.Texture|undefined){
  if(!texture?.isTexture||texture.colorSpace!==T.SRGBColorSpace||texture.channel!==0||texture.flipY)
    throw Error('Original multiply decal texture sampling differs');
}

/** Attaches to an already owned VHV material. Texture is borrowed; its loader
 * owns disposal. No geometry attributes or shader gamma approximation added. */
export function attachSourcePropDecal(material:T.Material,texture:T.Texture,mode:1|2,uv:SourcePropDecalUvBinding){
  const previous=material.onBeforeCompile,cache=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    previous.call(material,shader,renderer);
    const common='#include <common>',begin='#include <begin_vertex>',map='#include <map_fragment>';
    if(!shader.vertexShader.includes(common)||!shader.vertexShader.includes(begin)||!shader.fragmentShader.includes(map))throw Error('Three multiply decal shader contract changed');
    shader.uniforms.sourceDecalMap={value:texture};shader.uniforms.sourceDecalScale={value:mode};
    Object.assign(shader.uniforms,{sourceDecalUvMap:{value:uv.texture},sourceDecalUvWidth:{value:uv.width},sourceDecalUvOffset:{value:uv.offset}});
    shader.vertexShader=shader.vertexShader.replace(common,common+'\nvarying vec2 vSourceDecalUv; uniform highp sampler2D sourceDecalUvMap; uniform int sourceDecalUvWidth,sourceDecalUvOffset;')
      .replace(begin,begin+'\nint sourceDecalAddress=sourceDecalUvOffset+gl_VertexID;\nvSourceDecalUv=texelFetch(sourceDecalUvMap,ivec2(sourceDecalAddress%sourceDecalUvWidth,sourceDecalAddress/sourceDecalUvWidth),0).rg;');
    shader.fragmentShader=shader.fragmentShader.replace(common,common+'\nvarying vec2 vSourceDecalUv; uniform sampler2D sourceDecalMap; uniform float sourceDecalScale;')
      .replace(map,map+'\ndiffuseColor.rgb*=texture2D(sourceDecalMap,vSourceDecalUv).rgb*sourceDecalScale;');
  };
  material.customProgramCacheKey=()=>cache+'/source-decal-multiply-raw-uv2-r1';
}
