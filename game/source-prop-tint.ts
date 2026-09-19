import * as T from 'three';

const parameters=new Set(['$basetexture','$bumpmap','$surfaceprop','$model','$notint','$nocull','$nodecal',
  '$alphatest','$alphatestreference','$allowalphatocoverage','$tintmasktexture']);

/** Installed bump PS static983044(alias994052)/dynamic80. Compound decal,
 * envmap, phong, selfillum, unbumped and material color overrides stay excluded. */
export function sourcePropTintCandidate(source:Record<string,unknown>){
  return !!source.$basetexture&&!!source.$bumpmap&&!!source.$tintmasktexture&&Object.keys(source).every(key=>parameters.has(key));
}

/** Original engine float32 byte normalization followed by installed command13
 * GammaToLinearSIMD. Each original SSE multiplication/addition rounds to f32.
 * Input is the original BSP RGB byte triple; render alpha is a separate path. */
export function sourceInstanceTint(rgb:readonly number[]):[number,number,number]{
  if(rgb.length!==3||!rgb.every(v=>Number.isInteger(v)&&v>=0&&v<=255))throw Error('Invalid original instance RGB');
  const f=Math.fround,norm=f(1/255),a=f(.1731),b=f(.8717),c=f(-.0452),d=f(.0012);
  return rgb.map(byte=>{
    const x=f(byte*norm);
    return x>=1?x:f(f(f(f(f(f(a*x)+b)*x)+c)*x)+d);
  }) as [number,number,number];
}

export function validateSourcePropTint(texture:T.Texture|undefined,rgb:readonly number[]|undefined,source:Record<string,unknown>,material:T.Material){
  if(!sourcePropTintCandidate(source))throw Error('Unsupported original tint material branch');
  if(!texture?.isTexture||texture.colorSpace!==T.SRGBColorSpace||texture.channel!==0||texture.flipY||texture.offset.x!==0||texture.offset.y!==0||
    texture.repeat.x!==1||texture.repeat.y!==1||texture.rotation!==0||!texture.matrix.equals(new T.Matrix3()))throw Error('Original tint texture sampling differs');
  if(!rgb)throw Error('Original instance RGB missing');sourceInstanceTint(rgb);
  const color=(material as T.Material&{color?:T.Color}).color;
  if(!color||color.r!==1||color.g!==1||color.b!==1)throw Error('Original tint subset requires white material color');
}

/** Borrows the exact original tint texture and owns only uniforms. Installed
 * sampler13 enables sRGB read; selected PS consumes green (not alpha), bias is
 * NOTINT?-1:0 for an existing tint texture. No manual exposure/color correction. */
export function attachSourcePropTint(material:T.Material,texture:T.Texture,rgb:readonly number[],noTint:boolean){
  const previous=material.onBeforeCompile,cache=material.customProgramCacheKey(),color=new T.Vector3(...sourceInstanceTint(rgb));
  material.onBeforeCompile=(shader,renderer)=>{
    previous.call(material,shader,renderer);
    const common='#include <common>',begin='#include <begin_vertex>',map='#include <map_fragment>';
    if(!shader.vertexShader.includes(common)||!shader.vertexShader.includes(begin)||!shader.fragmentShader.includes(common)||!shader.fragmentShader.includes(map))throw Error('Three original tint shader contract changed');
    Object.assign(shader.uniforms,{sourceTintMap:{value:texture},sourceTintColor:{value:color},sourceTintBias:{value:noTint?-1:0}});
    shader.vertexShader=shader.vertexShader.replace(common,common+'\nvarying vec2 vSourceTintUv;')
      .replace(begin,begin+'\nvSourceTintUv=uv;');
    shader.fragmentShader=shader.fragmentShader.replace(common,common+'\nvarying vec2 vSourceTintUv; uniform sampler2D sourceTintMap; uniform vec3 sourceTintColor; uniform float sourceTintBias;')
      .replace(map,map+'\nfloat sourceTintMask=clamp(texture2D(sourceTintMap,vSourceTintUv).g+sourceTintBias,0.0,1.0);\ndiffuseColor.rgb*=vec3(1.0)+sourceTintMask*(sourceTintColor-vec3(1.0));');
  };
  material.customProgramCacheKey=()=>cache+'/source-tint-green-srgb-instance-r1';
}
