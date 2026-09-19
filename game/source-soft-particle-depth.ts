import * as T from 'three';
import {setSourceSpriteCardDepth} from './source-sprite-card';

// Upper layers 22..31 belong to the ten projected-shadow slots.
const PARTICLE_LAYER=21;
/** Finish opaque depth before sampling it. A separate texture copy is essential:
 * sampling a depth attachment while drawing into that attachment is a WebGL
 * feedback loop, even when depthWrite is disabled. */
export class SourceSoftParticleDepth {
  private copyTarget:T.WebGLRenderTarget|null=null;
  private foregroundTarget:T.WebGLRenderTarget|null=null;
  private colorTarget:T.WebGLRenderTarget|null=null;
  sceneColor:((binding:{texture:T.Texture;width:number;height:number}|null)=>void)|null=null;
  private scene=new T.Scene();
  private camera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  private geometry=new T.PlaneGeometry(2,2);
  private material=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
    uniforms:{opaqueDepth:{value:null},copyColor:{value:false}},
    vertexShader:'varying vec2 tex;void main(){tex=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:'uniform sampler2D opaqueDepth;uniform bool copyColor;varying vec2 tex;void main(){vec4 s=texture2D(opaqueDepth,tex);gl_FragColor=copyColor?s:vec4(s.r,0.0,0.0,1.0);}'});
  private size=new T.Vector2();
  private frames={world:0,foreground:0};
  constructor(){this.scene.add(new T.Mesh(this.geometry,this.material));}

  copyDepth(renderer:T.WebGLRenderer,target:T.WebGLRenderTarget){
    if(!target.depthTexture)throw Error('Opaque depth is missing');
    const output=renderer.getRenderTarget(),clear=renderer.autoClear;
    if(!this.copyTarget)this.copyTarget=new T.WebGLRenderTarget(target.width,target.height,{
      type:T.FloatType,format:T.RedFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,
      depthBuffer:false,stencilBuffer:false});
    this.copyTarget.setSize(target.width,target.height);
    try{
      this.material.uniforms.opaqueDepth.value=target.depthTexture;
      this.material.uniforms.copyColor.value=false;
      renderer.setRenderTarget(this.copyTarget);renderer.autoClear=true;
      renderer.render(this.scene,this.camera);return this.copyTarget.texture;
    }finally{renderer.setRenderTarget(output);renderer.autoClear=clear;}
  }

  private copyColor(renderer:T.WebGLRenderer,target:T.WebGLRenderTarget){
    const output=renderer.getRenderTarget(),clear=renderer.autoClear;
    if(!this.colorTarget)this.colorTarget=new T.WebGLRenderTarget(target.width,target.height,{
      type:T.HalfFloatType,colorSpace:T.LinearSRGBColorSpace,depthBuffer:false,stencilBuffer:false});
    this.colorTarget.setSize(target.width,target.height);
    try{
      this.material.uniforms.opaqueDepth.value=target.texture;this.material.uniforms.copyColor.value=true;
      renderer.setRenderTarget(this.colorTarget);renderer.autoClear=true;renderer.render(this.scene,this.camera);
      return this.colorTarget.texture;
    }finally{renderer.setRenderTarget(output);renderer.autoClear=clear;this.material.uniforms.copyColor.value=false;}
  }

  /** Returns null when there are no live soft particles; no extra pass then. */
  render(renderer:T.WebGLRenderer,scene:T.Scene,camera:T.Camera,
    base:()=>void,target:T.WebGLRenderTarget|null,kind:'world'|'foreground'):number|null {
    if(!(camera instanceof T.PerspectiveCamera))return null;
    const particles:{mesh:T.Mesh;mask:number}[]=[];
    let soft=false,refract=false;
    scene.traverseVisible(object=>{
      const mesh=object as T.Mesh;if(!mesh.isMesh)return;
      if((mesh.geometry as T.InstancedBufferGeometry).instanceCount===0)return;
      const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      if(!materials.some(m=>m.userData.sourceSpriteCard))return;
      soft ||= materials.some(m=>m.userData.sourceDepthBlend);
      refract ||= materials.some(m=>m.userData.sourceRefract);
      particles.push({mesh,mask:mesh.layers.mask});
    });
    if(!soft&&!refract)return null;
    renderer.getDrawingBufferSize(this.size);
    if(kind==='world'&&!target?.depthTexture)throw Error('World soft particles require an opaque depth attachment');
    const previousTarget=renderer.getRenderTarget(),previousClear=renderer.autoClear;
    const previousMask=camera.layers.mask,background=scene.background;
    let draws=0;
    try{
      for(const {mesh} of particles){mesh.visible=false;mesh.layers.enable(PARTICLE_LAYER);}
      let depthTarget=target!;
      if(kind==='foreground'){
        if(!this.foregroundTarget)this.foregroundTarget=new T.WebGLRenderTarget(this.size.x,this.size.y,{depthBuffer:true,stencilBuffer:false});
        depthTarget=this.foregroundTarget;depthTarget.setSize(this.size.x,this.size.y);
        if(!depthTarget.depthTexture)depthTarget.depthTexture=new T.DepthTexture(this.size.x,this.size.y,T.UnsignedIntType);
        renderer.setRenderTarget(depthTarget);renderer.autoClear=true;scene.background=null;
        renderer.render(scene,camera);draws+=renderer.info.render.calls;
        renderer.setRenderTarget(previousTarget);renderer.autoClear=previousClear;scene.background=background;
      }
      base();draws+=renderer.info.render.calls;
      if(kind==='world'&&refract&&this.sceneColor){
        this.sceneColor({texture:this.copyColor(renderer,depthTarget),width:depthTarget.width,height:depthTarget.height});
        draws+=renderer.info.render.calls;
      }
      const depth=this.copyDepth(renderer,depthTarget);draws+=renderer.info.render.calls;
      setSourceSpriteCardDepth(scene,{texture:depth,near:camera.near,far:camera.far,width:this.size.x,height:this.size.y});
      renderer.setRenderTarget(previousTarget);renderer.autoClear=false;
      for(const {mesh} of particles)mesh.visible=true;
      camera.layers.set(PARTICLE_LAYER);scene.background=null;
      renderer.render(scene,camera);draws+=renderer.info.render.calls;
      this.frames[kind]++;return draws;
    }finally{
      for(const {mesh,mask}of particles){mesh.visible=true;mesh.layers.mask=mask;}
      camera.layers.mask=previousMask;scene.background=background;
      renderer.setRenderTarget(previousTarget);renderer.autoClear=previousClear;
      // Foreground reuses the copy only after world drawing has completed.
      // Unbind on both success and exception so a later unrelated draw cannot
      // accidentally sample a different camera's depth.
      setSourceSpriteCardDepth(scene,null);
      if(kind==='world')this.sceneColor?.(null);
    }
  }
  audit(){return{...this.frames,depthCopySize:this.copyTarget?[this.copyTarget.width,this.copyTarget.height]:null,feedbackFree:true,separateForegroundCamera:true};}
  dispose(){this.copyTarget?.dispose();this.foregroundTarget?.dispose();this.colorTarget?.dispose();this.sceneColor?.(null);this.sceneColor=null;this.geometry.dispose();this.material.dispose();this.copyTarget=null;this.foregroundTarget=null;this.colorTarget=null;}
}
