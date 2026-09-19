import * as T from 'three';
import type {SourceEnvironment} from './source-environment';

/** Valve SDK histogram law; frozen Dust2 supplies target, bright %, range and
 * rate. WebGL reads a small GPU sample asynchronously instead of issuing Source
 * occlusion queries. This is a stated renderer adaptation, not binary parity. */
export const SOURCE_EXPOSURE_BINS=Array.from({length:17},(_,i)=>(i/16)**1.5);
export function sourceBrightnessBorder(counts:readonly number[],percent:number,snap=-1) {
  const total=counts.reduce((a,b)=>a+b,0);if(!total)return -1;
  let tested=0;
  for(let i=15;i>=0;i--){
    const fraction=counts[i]/total,needed=percent/100-tested;
    if(fraction>0&&fraction>=needed){
      const low=SOURCE_EXPOSURE_BINS[i],high=SOURCE_EXPOSURE_BINS[i+1];
      if(snap>=0&&low<=snap/100&&high>=snap/100)return snap/100;
      return Math.max(low,Math.min(high,high-(high-low)*needed/fraction));
    }
    tested+=fraction;
  }
  return -1;
}
export function sourceExposureTarget(counts:readonly number[],previous:number,parameters:SourceEnvironment['tonemap']) {
  const border=sourceBrightnessBorder(counts,parameters.percentBrightPixels,parameters.percentTarget);
  if(border<0)return previous;
  const median=sourceBrightnessBorder(counts,50);
  const primary=(parameters.percentTarget/100)/Math.max(.0001,border);
  const secondary=median>0?.03/median:0;
  return T.MathUtils.clamp(Math.max(primary,secondary)*previous,parameters.autoExposureMin,parameters.autoExposureMax);
}

export class SourceAutoExposure {
  exposure:number;
  target:number;
  private samples=0;
  private elapsed=1;
  private pending=false;
  private disposed=false;
  private failures:string[]=[];
  private counts=Array<number>(16).fill(0);
  private history:number[]=[];
  private targetRT=new T.WebGLRenderTarget(64,36,{type:T.UnsignedByteType,colorSpace:T.NoColorSpace,depthBuffer:false});
  private camera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  private scene=new T.Scene();
  private material=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
    uniforms:{radiance:{value:null},exposure:{value:1}},
    vertexShader:'varying vec2 sampleUv;void main(){sampleUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:'uniform sampler2D radiance;uniform float exposure;varying vec2 sampleUv;void main(){vec2 uv=(sampleUv-.5)*vec2(.9,.85)+.5;vec3 c=texture2D(radiance,uv).rgb*exposure;float l=clamp(dot(c,vec3(.2126,.7152,.0722)),0.0,1.0);gl_FragColor=vec4(l,l,l,1.0);}',
  });
  private geometry=new T.PlaneGeometry(2,2);
  constructor(readonly parameters:SourceEnvironment['tonemap'],initial=.98){
    this.exposure=this.target=T.MathUtils.clamp(initial,parameters.autoExposureMin,parameters.autoExposureMax);
    this.scene.add(new T.Mesh(this.geometry,this.material));
  }
  advance(dt:number) {
    if(this.disposed)return this.exposure;
    this.elapsed+=Math.max(0,dt);
    const rate=this.parameters.rate*(this.target<this.exposure?3:1);
    this.exposure+=(this.target-this.exposure)*(1-Math.exp(-rate*Math.max(0,dt)));
    return this.exposure;
  }
  capture(renderer:T.WebGLRenderer,radiance:T.Texture) {
    if(this.disposed||this.pending||this.elapsed<.125)return;
    this.elapsed=0;this.pending=true;
    const previous=renderer.getRenderTarget(),clear=renderer.autoClear;
    const exposureAtCapture=this.exposure;
    try{
      this.material.uniforms.radiance.value=radiance;this.material.uniforms.exposure.value=exposureAtCapture;
      renderer.autoClear=true;renderer.setRenderTarget(this.targetRT);renderer.render(this.scene,this.camera);
      const bytes=new Uint8Array(64*36*4);
      void renderer.readRenderTargetPixelsAsync(this.targetRT,0,0,64,36,bytes).then(()=>{
        if(this.disposed)return;
        this.counts.fill(0);
        for(let i=0;i<bytes.length;i+=4){
          const l=bytes[i]/255;let bucket=15;
          while(bucket>0&&l<SOURCE_EXPOSURE_BINS[bucket])bucket--;
          this.counts[bucket]++;
        }
        const next=sourceExposureTarget(this.counts,exposureAtCapture,this.parameters);
        this.history.push(next);if(this.history.length>10)this.history.shift();
        if(this.history.length<10)this.target=next;
        else{
          // The public Source implementation's ten-sample weighting.
          let sum=0,weight=0;this.history.forEach((v,i)=>{const w=Math.abs(i-5)/5;sum+=v*w;weight+=w;});
          this.target=sum/weight;
        }
        this.samples++;
      }).catch(error=>{if(!this.disposed&&this.failures.length<3)this.failures.push(String(error));})
        .finally(()=>{this.pending=false;if(this.disposed)this.targetRT.dispose();});
    }catch(error){this.pending=false;throw error;}
    finally{renderer.setRenderTarget(previous);renderer.autoClear=clear;}
  }
  audit(){return {exposure:this.exposure,target:this.target,histogram:[...this.counts],samples:this.samples,
    pending:this.pending,failures:[...this.failures],parameters:this.parameters,sampleSize:[64,36],
    source:'Valve SDK 16-bin histogram with frozen Dust2 parameters; asynchronous WebGL sampling',
    limitations:['SDK algorithm and exponential rate adaptation; exact CSGO engine rate/crop and final tone-curve equivalence remain unmeasured.']};}
  dispose(){if(this.disposed)return;this.disposed=true;this.geometry.dispose();this.material.dispose();if(!this.pending)this.targetRT.dispose();}
}
