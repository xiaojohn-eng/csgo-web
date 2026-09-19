/** Original SpriteCard blend/dual-sequence/zoom branches, based on Valve's
 * source-sdk-2013 b8cfb12 spritecard_ps2x.fxc and spritecard_vsxx.fxc. The web
 * depth attachment contains hardware depth, so it is unprojected before the
 * original linear distance feather is applied (Source PC stored compressed
 * linear depth in destination alpha). Native HDR encoding is not assumed. */
import {AddEquation,BufferAttribute,ClampToEdgeWrapping,CustomBlending,DoubleSide,InstancedBufferAttribute,InstancedBufferGeometry,LinearFilter,Mesh,OneFactor,OneMinusSrcAlphaFactor,ShaderMaterial,SrcAlphaFactor,Vector2,Vector3,type ColorSpace,type Texture,type Object3D} from 'three';
export type SourceSpriteCardDepth={texture:Texture;near:number;far:number;width:number;height:number};
export const SOURCE_SPRITE_CARD_DEPTH_SCALE=50;
/** Build 12426148 spritecard_vs20 COLOR0 log2/mul/exp2 token slice. This
 * transfer is gamma 2.2, distinct from Three's piecewise sRGB conversion. */
export function sourceSpriteCardTintLinear(rgba:readonly number[]){return [...rgba.slice(0,3).map(v=>Math.pow(Math.max(0,v),Math.fround(2.2))),rgba[3]];}
export function sourceSpriteCardDepthFeather(sceneDistance:number,particleDistance:number,scaleMetres=50*.0254){return Math.max(0,Math.min(1,(sceneDistance-particleDistance)/scaleMetres));}
/** The SDK's MAXLUM2 branch deliberately weights its two samples using the
 * first sequence's blend fraction. Keep this detail separate from sequence 2's
 * ordinary interpolation fraction. */
export function sourceSpriteCardDualSequence(first:readonly number[],second0:readonly number[],second1:readonly number[],firstBlend:number,secondBlend:number,maxLum:boolean){
 const a=second0.slice(),b=second1.slice();
 const lum=(c:readonly number[])=>c[0]*.3+c[1]*.59+c[2]*.11;
 const rgb=maxLum?(lum(a)*(1-firstBlend)>lum(b)*firstBlend?a:b):a.map((v,i)=>v+(b[i]-v)*secondBlend);
 return [rgb[0],rgb[1],rgb[2],first[3]];
}
/** ORIENTATION=1 from original SpriteCard: keep world +Z upright and face the
 * camera horizontally. Inputs here are already converted to the draw camera's
 * coordinates (+Y up in WebGL), including a foreground camera's world basis. */
export function sourceSpriteCardZAlignedOffset(corner:readonly number[],radius:number,rotation:number,center:readonly number[],up:readonly number[],yaw=0){
 const v=new Vector3().fromArray(center),vertical=new Vector3().fromArray(up).normalize(),right=new Vector3().crossVectors(v,vertical).normalize(),distance=v.length();
 if(distance<=radius/2)return{offset:[0,0,0],tintScale:0};
 const c=Math.cos(rotation),s=Math.sin(rotation),x=(corner[0]*c-corner[1]*s)*radius,y=(corner[0]*s+corner[1]*c)*radius;
 const yawed=right.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(new Vector3().crossVectors(vertical,right),-Math.sin(yaw));
 const t=Math.max(0,Math.min(1,(distance-radius/2)/(radius/2))),tintScale=t*t*(3-2*t);
 return{offset:yawed.multiplyScalar(x).addScaledVector(vertical,y).toArray(),tintScale};
}
const vertex=`
attribute vec3 particleCenter;attribute vec3 particleTail;attribute vec3 particleWorldUp;attribute float particleYaw;attribute float particleRadius;attribute float particleRotation;attribute vec4 particleTint;
attribute vec4 particleUV0;attribute vec4 particleUV1;attribute float particleBlend;
attribute vec4 particleUV20;attribute vec4 particleUV21;attribute float particleBlend2;
uniform int orientationType;uniform float sequenceZoom;uniform vec2 sizeFade;uniform bool trails;uniform vec4 visibilityAlpha;uniform vec2 visibilityRadius;uniform float sourceUnitMetres;
varying vec2 uv0;varying vec2 uv1;varying vec2 uv20;varying vec2 uv21;varying vec4 tint;varying float frameBlend;varying float frameBlend2;varying float particleDepth;
void main(){
 vec2 corner=position.xy;float c=cos(particleRotation),s=sin(particleRotation);
 vec2 rotated=mat2(c,s,-s,c)*corner*particleRadius;
 vec4 viewCenter=modelViewMatrix*vec4(particleCenter,1.0);
 float proxy=clamp((length(viewCenter.xyz)/sourceUnitMetres-visibilityAlpha.x)/max(.00001,visibilityAlpha.y-visibilityAlpha.x),0.0,1.0);
 float visibility=mix(visibilityAlpha.z,visibilityAlpha.w,proxy);rotated*=mix(visibilityRadius.x,visibilityRadius.y,proxy);
 float size=particleRadius/max(length(viewCenter.xyz),.00001);
 float orientationFade=1.0;float fade=1.0-clamp((size-sizeFade.x)/max(.00001,sizeFade.y-sizeFade.x),0.0,1.0);
 if(trails){
  vec4 tail=modelViewMatrix*vec4(particleTail,1.0);vec2 delta=viewCenter.xy-tail.xy;
  vec2 side=vec2(-delta.y,delta.x)/max(length(delta),.00001);
  viewCenter=mix(tail,viewCenter,corner.y*.5+.5);viewCenter.xy+=side*corner.x*particleRadius;
 }else if(orientationType==1){
  vec3 upright=normalize((modelViewMatrix*vec4(particleWorldUp,0.0)).xyz);
  vec3 side=cross(viewCenter.xyz,upright);side/=max(length(side),.00001);
  side=side*cos(particleYaw)-cross(upright,side)*sin(particleYaw);
  float distance=length(viewCenter.xyz);
  if(distance<=particleRadius*.5){orientationFade=0.0;}
  else{viewCenter.xyz+=side*rotated.x+upright*rotated.y;orientationFade=smoothstep(particleRadius*.5,particleRadius,distance);}
 }else{viewCenter.xy+=rotated;}
 particleDepth=-viewCenter.z;gl_Position=projectionMatrix*viewCenter;
 vec2 t=vec2(corner.x*.5+.5,.5-corner.y*.5);
 uv0=mix(particleUV0.xy,particleUV0.zw,t);uv1=mix(particleUV1.xy,particleUV1.zw,t);
 float oldStart=.5*(1.0+1.0/sequenceZoom),oldScale=mix(oldStart,1.0/sequenceZoom,particleBlend2),newScale=mix(1.0,oldStart,particleBlend2);
 uv20=mix(particleUV20.xy,particleUV20.zw,.5+(t-.5)*oldScale);uv21=mix(particleUV21.xy,particleUV21.zw,.5+(t-.5)*newScale);
 tint=vec4(pow(max(particleTint.rgb,vec3(0.0)),vec3(2.2)),particleTint.a)*fade*orientationFade;tint.a*=visibility;frameBlend=particleBlend;frameBlend2=particleBlend2;
}`;
const fragment=`
uniform sampler2D originalTexture;uniform float addSelf;uniform float overbright;uniform bool dualSequence;uniform bool maxLum2;
uniform sampler2D sceneDepth;uniform bool depthEnabled;uniform vec2 cameraNearFar;uniform vec2 depthViewport;uniform float depthScaleMetres;
varying vec2 uv0;varying vec2 uv1;varying vec2 uv20;varying vec2 uv21;varying vec4 tint;varying float frameBlend;varying float frameBlend2;varying float particleDepth;
void main(){
 vec4 texel=mix(texture2D(originalTexture,uv0),texture2D(originalTexture,uv1),frameBlend);
 if(dualSequence){vec4 a=texture2D(originalTexture,uv20),b=texture2D(originalTexture,uv21);vec3 rgb=mix(a.rgb,b.rgb,frameBlend2);
  if(maxLum2)rgb=dot(a.rgb,vec3(.3,.59,.11))*(1.0-frameBlend)>dot(b.rgb,vec3(.3,.59,.11))*frameBlend?a.rgb:b.rgb;
  texel.rgb=rgb;
 }
 vec4 colour=tint;
 if(depthEnabled){float d=texture2D(sceneDepth,gl_FragCoord.xy/depthViewport).x;
  float linearDepth=cameraNearFar.x*cameraNearFar.y/(cameraNearFar.y-d*(cameraNearFar.y-cameraNearFar.x));
  colour.a*=clamp((linearDepth-particleDepth)/depthScaleMetres,0.0,1.0);
 }
 texel.rgb*=overbright;
 if(addSelf>0.0){texel.a*=colour.a;texel.rgb*=texel.a;texel.rgb+=overbright*addSelf*colour.a*texel.rgb;texel.rgb*=colour.rgb;}
 else {texel*=colour;if(texel.a<=.01)discard;}
 gl_FragColor=texel;
 #include <colorspace_fragment>
}`;
export type SourceSpriteCardBatch=ReturnType<typeof createSourceSpriteCardBatch>;
export function createSourceSpriteCardBatch(options:{name:string;texture:Texture;capacity:number;additive:boolean;addSelf:number;overbright:number;
 orientationType?:0|1;dualSequence?:boolean;maxLum2?:boolean;sequenceZoom?:number;sizeFade?:[number,number];depthBlend?:boolean;depthBlendScale?:number;sourceUnitMetres?:number;trails?:boolean;visibility?:{distance:[number,number];alpha:[number,number];radius:[number,number]}}){
 const {name,texture,capacity,additive,addSelf,overbright}=options;
 if(options.orientationType!==undefined&&options.orientationType!==0&&options.orientationType!==1)throw Error('Unimplemented original SpriteCard orientation');
 const geometry=new InstancedBufferGeometry();
 geometry.setAttribute('position',new BufferAttribute(new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0]),3));geometry.setIndex([0,1,2,0,2,3]);
 const attributes={particleCenter:3,particleTail:3,particleWorldUp:3,particleYaw:1,particleRadius:1,particleRotation:1,particleTint:4,particleUV0:4,particleUV1:4,particleBlend:1,particleUV20:4,particleUV21:4,particleBlend2:1};
 for(const [attribute,size]of Object.entries(attributes))geometry.setAttribute(attribute,new InstancedBufferAttribute(new Float32Array(capacity*size),size));geometry.instanceCount=0;
 const material=new ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,uniforms:{orientationType:{value:options.orientationType??0},originalTexture:{value:texture},addSelf:{value:addSelf},overbright:{value:overbright},
  dualSequence:{value:options.dualSequence??false},maxLum2:{value:options.maxLum2??false},sequenceZoom:{value:options.sequenceZoom??1},sizeFade:{value:new Vector2(...(options.sizeFade??[10,20]))},trails:{value:options.trails??false},
  visibilityAlpha:{value:[...(options.visibility?.distance??[0,1]),...(options.visibility?.alpha??[1,1])]},visibilityRadius:{value:new Vector2(...(options.visibility?.radius??[1,1]))},sourceUnitMetres:{value:options.sourceUnitMetres??.0254},
  sceneDepth:{value:null},depthEnabled:{value:false},cameraNearFar:{value:new Vector2(.1,1000)},depthViewport:{value:new Vector2(1,1)},depthScaleMetres:{value:(options.depthBlendScale??50)*(options.sourceUnitMetres??.0254)}},
  transparent:true,depthWrite:false,depthTest:true,side:DoubleSide,blending:CustomBlending,blendEquation:AddEquation,
  blendSrc:additive||addSelf===0?SrcAlphaFactor:OneFactor,blendDst:additive?OneFactor:OneMinusSrcAlphaFactor,toneMapped:false});
 material.userData.sourceSpriteCard=true;material.userData.sourceDepthBlend=options.depthBlend??false;
 const mesh=new Mesh(geometry,material);mesh.frustumCulled=false;mesh.name=name;
 function set(attribute:string,index:number,values:readonly number[]){const target=geometry.getAttribute(attribute)as InstancedBufferAttribute;target.array.set(values,index*target.itemSize);}
 return {mesh,geometry,material,set,finish(count:number){geometry.instanceCount=count;for(const attribute of Object.keys(attributes))geometry.getAttribute(attribute).needsUpdate=true;},dispose(){geometry.dispose();material.dispose();}};
}
/** Bind only a completed opaque depth pass rendered with THIS group's camera.
 * Pass null to disable; never attach the render target currently being written. */
export function setSourceSpriteCardDepth(root:Object3D,binding:SourceSpriteCardDepth|null){
 if(binding&&(![binding.near,binding.far,binding.width,binding.height].every(Number.isFinite)||binding.near<=0||binding.far<=binding.near||binding.width<=0||binding.height<=0))throw Error('Invalid Source particle depth binding');
 root.traverse(object=>{if(!(object instanceof Mesh))return;for(const material of Array.isArray(object.material)?object.material:[object.material]){
  if(!(material instanceof ShaderMaterial)||!material.userData.sourceSpriteCard)continue;
  material.uniforms.depthEnabled.value=!!binding&&material.userData.sourceDepthBlend===true;
  material.uniforms.sceneDepth.value=binding?.texture??null;
  if(binding){material.uniforms.cameraNearFar.value.set(binding.near,binding.far);material.uniforms.depthViewport.value.set(binding.width,binding.height);}
 }});
}
export function configureSourceParticleTexture(texture:Texture,colourSpace:ColorSpace){
 texture.colorSpace=colourSpace;texture.flipY=false;texture.minFilter=texture.magFilter=LinearFilter;texture.generateMipmaps=false;texture.wrapS=texture.wrapT=ClampToEdgeWrapping;return texture;
}
