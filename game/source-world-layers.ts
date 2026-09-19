import * as T from 'three';

export interface WorldLayerFile{file:string;bytes:number;sha256:string}
export interface WorldLayerMaterial{index:number;source:string;shader:string;parameters:Record<string,string>;maps:Record<string,string>;vmtSha256:string}
export interface WorldLayersManifest{
  format:'source-world-layers-v1';sourceBspSha256:string;sourceWorldSha256:string;width:number;height:number;
  attributes:WorldLayerFile;atlases:(WorldLayerFile&{layer:number})[];
  primitives:{mesh:number;primitive:number;material:number;vertices:number;byteOffset:number;positionSha256:string;uv1Sha256:string;uv2Sha256:string}[];
  materials:WorldLayerMaterial[];
  textures:(WorldLayerFile&{source:string;width:number;height:number;clampS:boolean;clampT:boolean})[];
  audit:Record<string,unknown>;
}
const sat=(n:number)=>Math.max(0,Math.min(1,n));
/** Original PS30 ramp; the zero-width case has an explicit finite step for WebGL. */
export function sourceWorldBlendRamp(alpha:number,green:number,softness:number){
  const lo=sat(green-softness),hi=sat(green+softness);
  const x=hi>lo?sat((alpha-lo)/(hi-lo)):alpha>=hi?1:0;
  return x*x*(3-2*x);
}
export function sourceWorldLayerBlend(alpha:number,mod:[number,number],p:Record<string,string>){
  if(p.$newlayerblending==='1'){
    const blend=sourceWorldBlendRamp(alpha,mod[1],Number(p.$blendsoftness??.5));
    // Original upload 0x82baa/82baf negates authored border offset in c46.z;
    // the PS subtracts that constant, hence addition here.
    const border=sourceWorldBlendRamp(sat(alpha+Number(p.$layerborderoffset??0)),mod[1],Number(p.$layerbordersoftness??.5));
    return {blend,border:(1-Math.abs(2*border-1))*Number(p.$layerborderstrength??0)};
  }
  return {blend:p.$maskedblending==='1'?mod[1]:sourceWorldBlendRamp(alpha,mod[1],mod[0]),border:0};
}
/** Source GammaToLinear uses a 256-entry gamma 2.2 table, rounded input bytes. */
export function sourceWorldTint(text:string|undefined):T.Vector3{
  if(text===undefined)return new T.Vector3(1,1,1);
  const values=text.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number);
  if(!values||values.length!==3||values.some(v=>!Number.isFinite(v)))throw Error('Invalid original layer tint');
  return new T.Vector3(...values.map(v=>{
    const n=text.includes('{')?v/255:v;
    return n>1?n:n>=Math.fround(.95)?1:Math.fround(Math.pow(Math.fround(Math.round(sat(n)*255)*Math.fround(1/255)),Math.fround(2.2)));
  })as[number,number,number]);
}
export function sourceWorldUVTransform(text:string|undefined):T.Matrix3{
  if(!text)return new T.Matrix3();
  const match=/^center\s+([-\d.]+)\s+([-\d.]+)\s+scale\s+([-\d.]+)\s+([-\d.]+)\s+rotate\s+([-\d.]+)\s+translate\s+([-\d.]+)\s+([-\d.]+)\s*$/i.exec(text);
  if(!match)throw Error('Unsupported original world texture transform: '+text);
  const [cx,cy,sx,sy,degrees,tx,ty]=match.slice(1).map(Number),a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  return new T.Matrix3().set(c*sx,-s*sy,cx+tx-c*sx*cx+s*sy*cy,s*sx,c*sy,cy+ty-s*sx*cx-c*sy*cy,0,0,1);
}
export const SOURCE_WORLD_BUMP_BASIS=[
  [.8164966106414795,0,.5773502588272095],
  [-.40824833512306213,.7071067690849304,.5773502588272095],
  [-.4082482159137726,-.7071068286895752,.5773502588272095],
]as const;
export function sourceWorldDirectionalWeights(n:readonly number[]){
  const w=SOURCE_WORLD_BUMP_BASIS.map(b=>sat(b[0]*n[0]+b[1]*n[1]+b[2]*n[2])**2),sum=w.reduce((a,b)=>a+b,0);
  return w.map(x=>sum>0?x/sum:1/3);
}

/** Extends the existing verified HDR material; it owns no texture or geometry. */
export function decorateSourceWorldLayer(material:T.MeshBasicMaterial,record:WorldLayerMaterial,textures:Map<string,T.Texture>,atlases:readonly T.Texture[]){
  const p=record.parameters,hasSecond=Boolean(record.maps.$basetexture2),hasNormal=Boolean(record.maps.$bumpmap),
    hasNormal2=hasSecond&&Boolean(record.maps.$bumpmap2),hasMod=hasSecond&&Boolean(record.maps.$blendmodulatetexture),fresh=p.$newlayerblending==='1';
  if(p.$ssbump==='1')throw Error('SSBUMP requires its own world branch');
  const get=(key:string)=>{const t=textures.get(record.maps[key]);if(!t)throw Error('Missing original world texture '+record.maps[key]);return t;};
  const uniforms:Record<string,T.IUniform>={sourceTint1:{value:sourceWorldTint(p.$layertint1)},sourceTint2:{value:sourceWorldTint(p.$layertint2)},
    sourceBorderTint:{value:sourceWorldTint(p.$layerbordertint)},sourceBlendParams:{value:new T.Vector4(Number(p.$blendsoftness??.5),Number(p.$layerborderstrength??0),-Number(p.$layerborderoffset??0),Number(p.$layerbordersoftness??.5))},
    sourceBase2UV:{value:sourceWorldUVTransform(p.$basetexturetransform2)},sourceNormal2UV:{value:sourceWorldUVTransform(p.$bumptransform2)},
    sourceBlendUV:{value:sourceWorldUVTransform(p.$blendmodulatetransform)}};
  if(hasSecond)uniforms.sourceBase2={value:get('$basetexture2')};
  if(hasMod)uniforms.sourceBlendMod={value:get('$blendmodulatetexture')};
  if(hasNormal){uniforms.sourceNormal1={value:get('$bumpmap')};atlases.forEach((t,i)=>uniforms['sourceDirectional'+i]={value:t});}
  if(hasNormal2)uniforms.sourceNormal2={value:get('$bumpmap2')};
  const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
  // Uniform contents matter to batching as well as shader variants: two VMTs
  // can share their first map but differ in second layer, transforms and tint.
  const signature=JSON.stringify([hasSecond,hasNormal,hasNormal2,hasMod,fresh,p.$maskedblending==='1',
    ...Object.values(uniforms).map(u=>u.value?.isTexture?u.value.uuid:u.value?.toArray?.()??u.value)]);
  material.customProgramCacheKey=()=>key+'|source-world-layers-r1|'+signature;
  material.userData={...material.userData,sourceWorldLayers:{source:record.source,second:hasSecond,normal:hasNormal,normal2:hasNormal2,newLayer:fresh},
    inactiveAuthoredParameters:Object.keys(p).filter(k=>k==='$blendtintbybasealpha'||k.startsWith('$dropshadow')),
    limitations:['Exact Source vertex-alpha GPU quantization and zero-width ramp NaN behavior are not claimed']};
  material.onBeforeCompile=(shader,renderer)=>{
    compile.call(material,shader,renderer);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute vec2 sourceWorldBlend;
      varying vec2 vSourceWorldBlend;
      varying vec2 vSourceWorldUV;`)
      .replace('#include <uv_vertex>',`#include <uv_vertex>
        vSourceWorldBlend=sourceWorldBlend;vSourceWorldUV=uv;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec2 vSourceWorldBlend;
      varying vec2 vSourceWorldUV;
      uniform vec3 sourceTint1,sourceTint2,sourceBorderTint;
      uniform vec4 sourceBlendParams;
      uniform mat3 sourceBase2UV,sourceNormal2UV,sourceBlendUV;
      ${hasSecond?'uniform sampler2D sourceBase2;':''}
      ${hasMod?'uniform sampler2D sourceBlendMod;':''}
      ${hasNormal?'uniform sampler2D sourceNormal1,sourceDirectional0,sourceDirectional1,sourceDirectional2;':''}
      ${hasNormal2?'uniform sampler2D sourceNormal2;':''}
      float sourceLayerRamp(float a,float g,float softness){
        float lo=clamp(g-softness,0.0,1.0),hi=clamp(g+softness,0.0,1.0);
        float x=hi>lo?clamp((a-lo)/(hi-lo),0.0,1.0):step(hi,a);
        return x*x*(3.0-2.0*x);
      }
      ${hasNormal?`
      vec3 sourceDirectionalTexel(sampler2D atlas,ivec2 pixel){
        vec4 e=texelFetch(atlas,clamp(pixel,ivec2(0),ivec2(sourceAtlasSize)-1),0);
        float exponent=floor(e.a*255.0+.5);if(exponent>=128.0)exponent-=256.0;
        return e.rgb*exp2(exponent);
      }
      vec3 sourceDirectionalSample(sampler2D atlas,vec2 uv){
        vec2 t=uv*sourceAtlasSize-.5,w=fract(t);ivec2 p=ivec2(floor(t));
        return mix(mix(sourceDirectionalTexel(atlas,p),sourceDirectionalTexel(atlas,p+ivec2(1,0)),w.x),
          mix(sourceDirectionalTexel(atlas,p+ivec2(0,1)),sourceDirectionalTexel(atlas,p+ivec2(1,1)),w.x),w.y);
      }`:''}`);
    // sourceAtlasSize must be declared before the helpers above, not only in
    // the later Three lightmap chunk.
    if(hasNormal){shader.fragmentShader=shader.fragmentShader.replace('uniform vec2 sourceAtlasSize;','');
      shader.fragmentShader=shader.fragmentShader.replace('varying vec2 vSourceWorldBlend;','uniform vec2 sourceAtlasSize;\nvarying vec2 vSourceWorldBlend;');}
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      float sourceLayerWeight=${hasSecond?'clamp(vSourceWorldBlend.x,0.0,1.0)':'0.0'};
      vec3 sourceBaseColor1=diffuseColor.rgb*sourceTint1;
      ${hasMod?`vec4 sourceMod=texture2D(sourceBlendMod,(sourceBlendUV*vec3(vSourceWorldUV,1.0)).xy);
        sourceLayerWeight=sourceLayerRamp(vSourceWorldBlend.x,sourceMod.g,${fresh?'sourceBlendParams.x':'sourceMod.r'});
        ${!fresh&&p.$maskedblending==='1'?'sourceLayerWeight=sourceMod.g;':''}
        ${fresh?`float border=sourceLayerRamp(clamp(vSourceWorldBlend.x-sourceBlendParams.z,0.0,1.0),sourceMod.g,sourceBlendParams.w);
          float borderAmount=(1.0-abs(2.0*border-1.0))*sourceBlendParams.y;
          sourceBaseColor1*=mix(vec3(1.0),sourceBorderTint,borderAmount);`:''}`:''}
      diffuseColor.rgb=${hasSecond?'mix(sourceBaseColor1,texture2D(sourceBase2,(sourceBase2UV*vec3(vSourceWorldUV,1.0)).xy).rgb*sourceTint2,sourceLayerWeight)':'sourceBaseColor1'};
    `);
    if(hasNormal){
      const target='reflectedLight.indirectDiffuse += sourceHDRLight(vLightMapUv);';
      if(!shader.fragmentShader.includes(target))throw Error('Original HDR layer shader contract changed');
      shader.fragmentShader=shader.fragmentShader.replace(target,`
        vec3 sourceWorldLight=sourceHDRLight(vLightMapUv);
        if(vSourceWorldBlend.y>.5){
          vec3 sourceN=texture2D(sourceNormal1,vSourceWorldUV).rgb*2.0-1.0;
          ${hasNormal2?'sourceN=mix(sourceN,texture2D(sourceNormal2,(sourceNormal2UV*vec3(vSourceWorldUV,1.0)).xy).rgb*2.0-1.0,sourceLayerWeight);':''}
          vec3 weights=clamp(vec3(${SOURCE_WORLD_BUMP_BASIS.map(b=>`dot(sourceN,vec3(${b.join(',')}))`).join(',')}),0.0,1.0);
          weights*=weights;float total=weights.x+weights.y+weights.z;
          if(total>0.0)sourceWorldLight=(weights.x*sourceDirectionalSample(sourceDirectional0,vLightMapUv)+
            weights.y*sourceDirectionalSample(sourceDirectional1,vLightMapUv)+weights.z*sourceDirectionalSample(sourceDirectional2,vLightMapUv))/total;
        }
        reflectedLight.indirectDiffuse+=sourceWorldLight;`);
    }
  };
}
