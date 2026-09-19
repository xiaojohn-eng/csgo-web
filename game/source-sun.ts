import * as T from 'three';
import type {SourceEnvironment} from './source-environment';
import {sourceSha256} from './source-sha256';

export function sourceSunDirection(environment:SourceEnvironment){
  const yaw=environment.sun.sourceAngles[1]*Math.PI/180,pitch=environment.sun.sourcePitch*Math.PI/180;
  return new T.Vector3(Math.cos(pitch)*Math.cos(yaw),-Math.sin(pitch),-Math.cos(pitch)*Math.sin(yaw));
}
export function decodeSourceColorCorrection(bytes:Uint8Array){
  if(bytes.length!==32**3*3)throw Error('Original colour correction dimensions changed');
  const rgba=new Uint8Array(32**3*4);
  // off.raw established B-fast input with BGR output; WebGL x is R-fast.
  for(let r=0;r<32;r++)for(let g=0;g<32;g++)for(let b=0;b<32;b++){
    const from=((r*32+g)*32+b)*3,to=((b*32+g)*32+r)*4;
    rgba.set([bytes[from+2],bytes[from+1],bytes[from],255],to);
  }
  const texture=new T.Data3DTexture(rgba,32,32,32);texture.format=T.RGBAFormat;
  texture.type=T.UnsignedByteType;texture.minFilter=texture.magFilter=T.LinearFilter;
  texture.unpackAlignment=1;texture.needsUpdate=true;return texture;
}
/** Installed sun sprite, SDK C_SunGlowOverlay core basis/size, and an opaque
 * depth visibility query. The 25 sample proxy is a WebGL adaptation of the
 * native asynchronous occlusion query; it is not native query scheduling. */
export async function loadSourceSun(environment:SourceEnvironment,signal?:AbortSignal){
  async function bytes(path:string,sha256:string){
    const response=await fetch('/source/csgo-12426148/sun/'+path,{signal});
    if(!response.ok)throw Error('Original sun asset HTTP '+response.status);
    const raw=new Uint8Array(await response.arrayBuffer());
    if(await sourceSha256(raw,signal)!==sha256)throw Error('Original sun asset hash mismatch: '+path);
    return raw;
  }
  const [png,lutBytes]=await Promise.all([
    bytes('sun.png','9974e99a61f55e3a279cfc1b66761453fc1262aa546d7f273fb6500bc076bd86'),
    bytes('cc_dust2.raw',environment.colorCorrection.lutSha256),
  ]);
  const bitmap=await createImageBitmap(new Blob([png.slice().buffer]),{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});
  const texture=new T.Texture(bitmap);texture.colorSpace=T.SRGBColorSpace;texture.needsUpdate=true;
  const lut=decodeSourceColorCorrection(lutBytes),scene=new T.Scene();
  const geometry=new T.PlaneGeometry(2,2),direction=sourceSunDirection(environment),position=new T.Vector3();
  const right=new T.Vector3().crossVectors(direction,new T.Vector3(0,1,0)).normalize();
  const up=new T.Vector3().crossVectors(right,direction).normalize();
  const color=environment.sun.renderColor,max=Math.max(...color)||255;
  const material=new T.ShaderMaterial({depthTest:false,depthWrite:false,transparent:true,blending:T.AdditiveBlending,toneMapped:false,
    uniforms:{original:{value:texture},opaqueDepth:{value:null},proxyCenter:{value:new T.Vector2()},
      sunColor:{value:new T.Vector3(...color.map(c=>c/max*environment.sun.hdrColorScale))}},
    vertexShader:'varying vec2 tex;void main(){tex=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`uniform sampler2D original;uniform sampler2D opaqueDepth;uniform vec2 proxyCenter;uniform vec3 sunColor;varying vec2 tex;
    void main(){float visible=0.0;for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){
      vec2 q=proxyCenter+vec2(float(x),float(y))*.0125;
      if(all(greaterThanEqual(q,vec2(0.0)))&&all(lessThanEqual(q,vec2(1.0))))visible+=step(.99999,texture2D(opaqueDepth,q).r);
    }vec4 sprite=texture2D(original,tex);gl_FragColor=vec4(sprite.rgb*sunColor,sprite.a*visible/25.0);}`});
  const mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;
  mesh.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(right,up,direction.clone().negate()));
  mesh.scale.setScalar(environment.sun.size*environment.metersPerSourceUnit);scene.add(mesh);
  let draws=0;
  return{lut,
    visible(camera:T.Camera){return camera.getWorldDirection(position).dot(direction)>0;},
    render(renderer:T.WebGLRenderer,camera:T.Camera,completedDepth:T.Texture){
      mesh.position.copy(camera.getWorldPosition(position)).addScaledVector(direction,100*environment.metersPerSourceUnit);
      const projected=mesh.position.clone().project(camera);
      material.uniforms.proxyCenter.value.set(projected.x*.5+.5,projected.y*.5+.5);
      material.uniforms.opaqueDepth.value=completedDepth;
      const clear=renderer.autoClear;renderer.autoClear=false;
      try{renderer.render(scene,camera);draws++;}finally{renderer.autoClear=clear;material.uniforms.opaqueDepth.value=null;}
    },
    audit(){return{draws,originalTexture:true,direction:direction.toArray(),sourceSize:environment.sun.size,
      colorCorrection:true,overlayEnabled:environment.sun.overlaySize>0,
      limitations:['SDK sun basis and 25-sample WebGL depth visibility; native query timing and output tone curve remain unmeasured.']};},
    dispose(){geometry.dispose();material.dispose();texture.dispose();bitmap.close();lut.dispose();},
  };
}
export type SourceSun=Awaited<ReturnType<typeof loadSourceSun>>;
