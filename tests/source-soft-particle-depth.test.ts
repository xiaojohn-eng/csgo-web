import * as T from 'three';
import {expect,it} from 'vitest';
import {SourceSoftParticleDepth} from '../game/source-soft-particle-depth';
import {createSourceSpriteCardBatch} from '../game/source-sprite-card';

for(const kind of ['world','foreground']as const)it('samples completed '+kind+' depth and restores camera and renderer after a draw failure',()=>{
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(60,1,.07,400);
  const batch=createSourceSpriteCardBatch({name:'soft',texture:new T.Texture(),capacity:1,additive:false,addSelf:0,overbright:1,depthBlend:true});
  batch.finish(1);scene.add(batch.mesh);
  const opaque=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());scene.add(opaque);
  const target=new T.WebGLRenderTarget(128,80);target.depthTexture=new T.DepthTexture(128,80);
  let current:T.WebGLRenderTarget|null=kind==='world'?target:null,softDraws=0,baseDraws=0;
  const original=current,info={render:{calls:1}};
  const renderer={autoClear:false,info,getDrawingBufferSize:(out:T.Vector2)=>out.set(128,80),getRenderTarget:()=>current,
    setRenderTarget:(next:T.WebGLRenderTarget|null)=>{current=next;},render(s:T.Scene,c:T.Camera){
      if(s!==scene)return;
      if(c.layers.isEnabled(21)){
        softDraws++;expect(batch.material.uniforms.depthEnabled.value).toBe(true);
        const sampled=batch.material.uniforms.sceneDepth.value;
        expect(sampled).not.toBe(current?.depthTexture);expect(sampled).not.toBe(current?.texture);
        expect(batch.material.uniforms.cameraNearFar.value.toArray()).toEqual([.07,400]);
        expect(c.layers.test(opaque.layers)).toBe(false);throw Error('test GPU failure');
      }
    }}as unknown as T.WebGLRenderer;
  const pass=new SourceSoftParticleDepth();
  expect(()=>pass.render(renderer,scene,camera,()=>{baseDraws++;expect(batch.mesh.visible).toBe(false);},kind==='world'?target:null,kind)).toThrow('test GPU failure');
  expect(softDraws).toBe(1);expect(baseDraws).toBe(1);
  expect(current).toBe(original);expect(renderer.autoClear).toBe(false);
  expect(camera.layers.mask).toBe(1);expect(batch.mesh.layers.mask).toBe(1);expect(batch.mesh.visible).toBe(true);
  expect(batch.material.uniforms.depthEnabled.value).toBe(false);expect(batch.material.uniforms.sceneDepth.value).toBeNull();
  pass.dispose();batch.dispose();target.dispose();
});
