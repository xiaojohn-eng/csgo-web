import * as T from 'three';
import {sourceFogMaxDensity,setSourceFogMaxDensity} from './source-fog';
import {SourceAutoExposure} from './source-autoexposure';
import {SourceSoftParticleDepth} from './source-soft-particle-depth';
import type {SourceSun} from './source-sun';

/** Keep world radiance available to the separate first-person transmission pass. */
export class WorldComposite {
  private target: T.WebGLRenderTarget | null = null;
  private size = new T.Vector2();
  autoExposure:SourceAutoExposure|null=null;
  readonly softParticles=new SourceSoftParticleDepth();
  sun:SourceSun|null=null;
  private copyScene=new T.Scene();
  private copyCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  private copyMaterial=new T.MeshBasicMaterial({depthTest:false,depthWrite:false});
  private copyGeometry=new T.PlaneGeometry(2,2);
  constructor(){
    this.copyScene.add(new T.Mesh(this.copyGeometry,this.copyMaterial));
    this.copyMaterial.onBeforeCompile=shader=>{
      shader.uniforms.sourceColorCorrection={get value(){return owner.sun?.lut??null;}};
      shader.uniforms.sourceColorCorrectionEnabled={get value(){return !!owner.sun;}};
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
        '#include <common>\nuniform highp sampler3D sourceColorCorrection;uniform bool sourceColorCorrectionEnabled;')
        .replace('#include <colorspace_fragment>','#include <colorspace_fragment>\nif(sourceColorCorrectionEnabled){gl_FragColor.rgb=texture(sourceColorCorrection,(clamp(gl_FragColor.rgb,0.0,1.0)*31.0+.5)/32.0).rgb;}');
    };
    const owner=this;
    this.copyMaterial.customProgramCacheKey=()=> 'source-final-colour-correction-v1';
  }
  lastCalls: { sky: number; world: number; foreground: number } = { sky: 0, world: 0, foreground: 0 };

  render(renderer: T.WebGLRenderer, world: T.Scene, camera: T.Camera,
    foreground: T.Scene, foregroundCamera: T.Camera | null,backdrop?:{scene:T.Scene;camera:T.Camera}) {
    const previousTarget = renderer.getRenderTarget();
    const previousClear = renderer.autoClear;
    const previousBackground = foreground.background;
    const calls={sky:0,world:0,foreground:0};
    // renderer.info auto-resets at the start of every render() call, so each
    // read below is exactly that pass's own draw-call count, not a cumulative.
    const renderWorld=()=>{
      if(!backdrop){renderer.autoClear=true;renderer.render(world,camera);calls.world=renderer.info.render.calls;return;}
      renderer.autoClear=true;
      const mainFogCap=sourceFogMaxDensity(),skyFogCap=backdrop.scene.userData.sourceFogMaxDensity;
      try{
        if(typeof skyFogCap==='number')setSourceFogMaxDensity(skyFogCap);
        renderer.render(backdrop.scene,backdrop.camera);
      }finally{setSourceFogMaxDensity(mainFogCap);}
      calls.sky=renderer.info.render.calls;
      renderer.autoClear=false;renderer.clearDepth();
      const background=world.background;world.background=null;
      try{renderer.render(world,camera);}finally{world.background=background;}
      calls.world=renderer.info.render.calls;
    };
    let transmission = false;
    if (foregroundCamera) foreground.traverseVisible(object => {
      const mesh = object as T.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some(m => (m as T.MeshPhysicalMaterial).transmission > 0)) transmission = true;
    });
    try {
      renderer.autoClear = true;
      if(this.autoExposure){
        renderer.getDrawingBufferSize(this.size);
        if(!this.target)this.target=new T.WebGLRenderTarget(this.size.x,this.size.y,{
          type:renderer.extensions.has('EXT_color_buffer_float')?T.HalfFloatType:T.UnsignedByteType,
          colorSpace:T.LinearSRGBColorSpace,samples:4,depthBuffer:true,stencilBuffer:false});
        this.target.setSize(this.size.x,this.size.y);
        if(!this.target.depthTexture)this.target.depthTexture=new T.DepthTexture(this.size.x,this.size.y,T.UnsignedIntType);
        renderer.setRenderTarget(this.target);
        const softWorld=this.softParticles.render(renderer,world,camera,renderWorld,this.target,'world');
        if(softWorld===null)renderWorld();else calls.world=softWorld;
        if(this.sun?.visible(camera)){
          const depth=this.softParticles.copyDepth(renderer,this.target);
          this.sun.render(renderer,camera,depth);
        }
        this.autoExposure.capture(renderer,this.target.texture);
        // Draw the viewmodel with its own camera into the same linear HDR
        // colour buffer, after resetting depth. Both views receive the final
        // tone map and original map LUT once; only world feeds auto-exposure.
        if(foregroundCamera){
          renderer.autoClear=false;renderer.clearDepth();
          const draw=()=>renderer.render(foreground,foregroundCamera);
          const softForeground=this.softParticles.render(renderer,foreground,foregroundCamera,draw,null,'foreground');
          if(softForeground===null)draw();
          calls.foreground=softForeground??renderer.info.render.calls;
        }
        renderer.setRenderTarget(previousTarget);
        renderer.autoClear=true;this.copyMaterial.map=this.target.texture;
        renderer.render(this.copyScene,this.copyCamera);
        this.lastCalls=calls;return;
      }
      if (!transmission || !foregroundCamera) {
        renderWorld();
        if (foregroundCamera) {
          renderer.autoClear = false;
          renderer.clearDepth();
          renderer.render(foreground, foregroundCamera);
          calls.foreground=renderer.info.render.calls;
        }
        this.lastCalls=calls;
        return;
      }
      renderer.getDrawingBufferSize(this.size);
      if (!this.target) this.target = new T.WebGLRenderTarget(this.size.x, this.size.y, {
        type: renderer.extensions.has('EXT_color_buffer_float')
          ? T.HalfFloatType : T.UnsignedByteType,
        colorSpace: T.LinearSRGBColorSpace,
        samples: 4,
        depthBuffer: true,
        stencilBuffer: false,
      });
      this.target.setSize(this.size.x, this.size.y);
      renderer.setRenderTarget(this.target);
      renderWorld();
      renderer.setRenderTarget(previousTarget);
      // A linear HDR background enters Three's opaque transmission prepass.
      // Tone mapping and sRGB conversion happen only at the final output.
      foreground.background = this.target.texture;
      renderer.autoClear = true;
      renderer.render(foreground, foregroundCamera);
      calls.foreground=renderer.info.render.calls;
      this.lastCalls=calls;
    } finally {
      renderer.setRenderTarget(previousTarget);
      foreground.background = previousBackground;
      renderer.autoClear = previousClear;
    }
  }

  inspect() {
    return this.target ? {
      width: this.target.width, height: this.target.height,
      halfFloat: this.target.texture.type === T.HalfFloatType,
      samples: this.target.samples,
    } : null;
  }

  dispose() { this.target?.dispose(); this.target = null;this.autoExposure?.dispose();this.autoExposure=null;this.softParticles.dispose();this.sun?.dispose();this.sun=null;this.copyGeometry.dispose();this.copyMaterial.dispose(); }
}
