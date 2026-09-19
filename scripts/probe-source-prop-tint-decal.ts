import * as T from 'three';
import {SOURCE_TINT_DECAL_DECLARATIONS,SOURCE_TINT_DECAL_FRAGMENT} from '../game/source-prop-tint-decal';
type Oracle={base:number[];bakedDiffuse:number[];shaderC1:number[];sampledTintRGBA:number[];sampledDecalRGBA:number[];bias:number;originalTokenFloat32RGB:number[]};
/** Separate 1px GPU probe of the same exported ordered fragment. Inputs are
 * already sampled linear texels from the independent DX9-token oracle; full
 * map screenshots separately exercise original PNG/sRGB and exact UV2. */
export function runSourcePropTintDecalProbe(samples:Oracle[]){
  if(samples.length!==64)throw Error('Original compound oracle case count differs');
  const renderer=new T.WebGLRenderer({antialias:false,alpha:false,premultipliedAlpha:false});renderer.setSize(1,1,false);
  const memory=()=>({geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs?.length??0});
  const baseline=memory(),scene=new T.Scene(),camera=new T.Camera(),geometry=new T.PlaneGeometry(2,2);
  const target=new T.WebGLRenderTarget(1,1,{depthBuffer:false,stencilBuffer:false});
  const tint=new T.DataTexture(new Float32Array(4),1,1,T.RGBAFormat,T.FloatType),decal=new T.DataTexture(new Float32Array(4),1,1,T.RGBAFormat,T.FloatType);
  for(const t of [tint,decal]){t.colorSpace=T.NoColorSpace;t.minFilter=t.magFilter=T.NearestFilter;t.generateMipmaps=false;t.flipY=false;}
  const uniforms={sourceCompoundTintMap:{value:tint},sourceCompoundDecalMap:{value:decal},sourceCompoundTintColor:{value:new T.Vector3()},sourceCompoundBias:{value:0},sourceBakedDiffuse:{value:new T.Vector3()},sourceBase:{value:new T.Vector4()}};
  const material=new T.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,toneMapped:false,
    vertexShader:'varying vec2 vSourceCompoundTintUv,vSourceCompoundDecalUv; void main(){vSourceCompoundTintUv=vec2(.2,.3);vSourceCompoundDecalUv=vec2(.7,.8);gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:SOURCE_TINT_DECAL_DECLARATIONS+'\nuniform vec3 sourceBakedDiffuse; uniform vec4 sourceBase; void main(){vec4 diffuseColor=sourceBase;'+SOURCE_TINT_DECAL_FRAGMENT+'gl_FragColor=vec4(diffuseColor.rgb,1.);}' });
  scene.add(new T.Mesh(geometry,material));const pixel=new Uint8Array(4),rows:{case:number;actualByteRGB:number[];originalTokenFloat32RGB:number[];maxError:number}[]=[];
  let maximum=0,released:ReturnType<typeof memory>|undefined;
  try{
    for(const [i,sample] of samples.entries()){
      uniforms.sourceBase.value.fromArray(sample.base);uniforms.sourceBakedDiffuse.value.fromArray(sample.bakedDiffuse);uniforms.sourceCompoundTintColor.value.fromArray(sample.shaderC1);uniforms.sourceCompoundBias.value=sample.bias;
      (tint.image.data as Float32Array).set(sample.sampledTintRGBA);(decal.image.data as Float32Array).set(sample.sampledDecalRGBA);tint.needsUpdate=decal.needsUpdate=true;
      renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,1,1,pixel);
      const actual=Array.from(pixel.subarray(0,3)),error=Math.max(...actual.map((v,j)=>Math.abs(v/255-Math.min(1,Math.max(0,sample.originalTokenFloat32RGB[j]!)))));maximum=Math.max(maximum,error);
      rows.push({case:i,actualByteRGB:actual,originalTokenFloat32RGB:sample.originalTokenFloat32RGB,maxError:error});
      if(error>1.5/255)throw Error('Original compound GPU numeric difference: '+i+'/'+error);
    }
  }finally{renderer.setRenderTarget(null);target.dispose();tint.dispose();decal.dispose();geometry.dispose();material.dispose();scene.clear();released=memory();renderer.dispose();renderer.forceContextLoss();}
  if(JSON.stringify(baseline)!==JSON.stringify(released))throw Error('Compound numeric GPU cleanup differs');
  return {cases:rows,maximumError:maximum,tolerance:1.5/255,baseline,released,boundary:'Same ordered production fragment, independently decoded token float32 RGB; 8-bit render-target quantization, not bit-exact D3D/fused-MAD acceptance.'};
}
