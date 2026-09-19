import * as T from 'three';

export interface SourceLightmapDescriptor {
  format:'source-hdr-lightmaps-v1';sourceBspSha256:string;width:number;height:number;
  verifiedOriginalSamples:number;
  atlasFiles:{layer:number;file:string;bytes:number;sha256:string}[];
}
type LitMaterial=T.Material & {map?:T.Texture|null;color?:T.Color};

/** Original HDR base samples with decode-before-filtering. An optional
 * sidecar decorator adds original material layers and directional samples.
 * Borrows the scene/materials. dispose restores them before releasing its atlas.
 */
export function applySourceWorldLightmaps(root:T.Object3D,descriptor:SourceLightmapDescriptor,bytes:ArrayBuffer,
  decorateMaterial?:(material:T.MeshBasicMaterial,original:T.Material)=>void){
  if(descriptor.format!=='source-hdr-lightmaps-v1'||!Number.isInteger(descriptor.width)||!Number.isInteger(descriptor.height)||
    descriptor.width<1||descriptor.height<1||descriptor.width>16384||descriptor.height>16384||
    bytes.byteLength!==descriptor.width*descriptor.height*4)throw Error('Original HDR lightmap data is incomplete');
  const bindings:{mesh:T.Mesh;original:T.Material|T.Material[]}[]=[];
  root.traverse(object=>{const mesh=object as T.Mesh;if(!mesh.isMesh)return;
    if(!mesh.geometry.attributes.uv1||!mesh.geometry.attributes.uv2)throw Error('Original HDR UV/face attribution missing');
    bindings.push({mesh,original:mesh.material});
  });
  if(!bindings.length)throw Error('Original HDR world has no geometry');
  const atlas=new T.DataTexture(new Uint8Array(bytes),descriptor.width,descriptor.height,T.RGBAFormat,T.UnsignedByteType);
  atlas.channel=1;atlas.flipY=false;atlas.colorSpace=T.NoColorSpace;atlas.generateMipmaps=false;
  atlas.magFilter=atlas.minFilter=T.NearestFilter;atlas.needsUpdate=true;
  const cache=new Map<T.Material,T.MeshBasicMaterial>();
  const make=(original:LitMaterial)=>{
    const existing=cache.get(original);if(existing)return existing;
    const material=new T.MeshBasicMaterial({map:original.map,color:original.color??0xffffff,lightMap:atlas,
      side:original.side,transparent:original.transparent,opacity:original.opacity,alphaTest:original.alphaTest,depthWrite:original.depthWrite});
    material.name=original.name+' / original HDR base lightmap';
    material.userData={...original.userData,sourceLightmap:'original ColorRGBExp32; decode each texel before bilinear interpolation',
      limitations:['Directional bump lightmap channels','WorldVertexTransition second layer','Source exposure and complete shader']};
    material.onBeforeCompile=shader=>{
      shader.uniforms.sourceAtlasSize={value:new T.Vector2(descriptor.width,descriptor.height)};
      const pars='#include <lightmap_pars_fragment>';
      if(!shader.fragmentShader.includes(pars))throw Error('Three lightmap shader contract changed');
      shader.fragmentShader=shader.fragmentShader.replace(pars,pars+`
        uniform vec2 sourceAtlasSize;
        vec3 sourceDecodedTexel(ivec2 pixel) {
          vec4 encoded=texelFetch(lightMap,clamp(pixel,ivec2(0),ivec2(sourceAtlasSize)-1),0);
          float exponentByte=floor(encoded.a*255.0+.5);
          float exponent=exponentByte>=128.0?exponentByte-256.0:exponentByte;
          return encoded.rgb*exp2(exponent);
        }
        vec3 sourceHDRLight(vec2 uv) {
          vec2 texel=uv*sourceAtlasSize-.5,weight=fract(texel);
          ivec2 p=ivec2(floor(texel));
          return mix(mix(sourceDecodedTexel(p),sourceDecodedTexel(p+ivec2(1,0)),weight.x),
            mix(sourceDecodedTexel(p+ivec2(0,1)),sourceDecodedTexel(p+ivec2(1,1)),weight.x),weight.y);
        }
      `);
      const token='reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;';
      if(!shader.fragmentShader.includes(token))throw Error('Three baked light accumulation changed');
      shader.fragmentShader=shader.fragmentShader.replace(token,'reflectedLight.indirectDiffuse += sourceHDRLight(vLightMapUv);');
    };
    material.customProgramCacheKey=()=> 'source-original-hdr-base-r1';cache.set(original,material);
    decorateMaterial?.(material,original);return material;
  };
  let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;
    for(const binding of bindings)binding.mesh.material=binding.original;
    for(const material of cache.values())material.dispose();atlas.dispose();
  };
  try{for(const binding of bindings)binding.mesh.material=Array.isArray(binding.original)?binding.original.map(make):make(binding.original);}
  catch(error){dispose();throw error;}
  // Detail receivers use the same verified HDR atlas; this owner owns their
  // generated materials too and must outlive their mesh/texture owner.
  return {width:descriptor.width,height:descriptor.height,samples:descriptor.verifiedOriginalSamples,
    get materials(){return cache.size;},createMaterial:(original:LitMaterial)=>{
      if(disposed)throw Error('Original HDR owner disposed');return make(original);
    },dispose};
}
