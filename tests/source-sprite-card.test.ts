import {expect,it} from 'vitest';
import {Group,Texture,Quaternion,Vector3,Euler,SrcAlphaFactor,OneFactor,OneMinusSrcAlphaFactor} from 'three';
import {createSourceSpriteCardBatch,setSourceSpriteCardDepth,sourceSpriteCardDepthFeather,sourceSpriteCardDualSequence,sourceSpriteCardZAlignedOffset,sourceSpriteCardTintLinear} from '../game/source-sprite-card';
import originalColour from './fixtures/source-sprite-color.json';
const create=(extra:Record<string,unknown>={})=>createSourceSpriteCardBatch({name:'fixture',texture:new Texture(),capacity:8,additive:false,addSelf:0,overbright:1,...extra});
it('matches the installed SpriteCard COLOR0 transfer before fades, without changing alpha or white fire',()=>{
 for(const row of originalColour.cases){
  const actual=sourceSpriteCardTintLinear(row.input);
  actual.forEach((v,i)=>expect(v).toBeCloseTo(row.output[i],12));
  expect(actual[3]).toBe(row.input[3]);
 }
 expect(sourceSpriteCardTintLinear([1,1,1,.75])).toEqual([1,1,1,.75]);
 const batch=create();
 expect(batch.material.vertexShader).toContain('vec4(pow(max(particleTint.rgb,vec3(0.0)),vec3(2.2)),particleTint.a)*fade*orientationFade');
 batch.dispose();
});
it('gives ordinary smoke its original alpha blend while preserving additive and addself fire',()=>{
 const smoke=create(),additive=create({additive:true}),fire=create({addSelf:1,overbright:6});
 expect([smoke.material.blendSrc,smoke.material.blendDst]).toEqual([SrcAlphaFactor,OneMinusSrcAlphaFactor]);
 expect([additive.material.blendSrc,additive.material.blendDst]).toEqual([SrcAlphaFactor,OneFactor]);
 expect([fire.material.blendSrc,fire.material.blendDst]).toEqual([OneFactor,OneMinusSrcAlphaFactor]);
 expect(fire.material.uniforms.overbright.value).toBe(6);expect(fire.material.fragmentShader).toContain('texel.rgb+=overbright*addSelf*colour.a*texel.rgb');
 [smoke,additive,fire].forEach(b=>b.dispose());
});
it('takes alpha exclusively from sequence 1 and RGB from sequence 2',()=>{
 const a=[1,0,0,.13],b=[0,1,0,.9],c=[0,0,1,.2];
 expect(sourceSpriteCardDualSequence(a,b,c,.9,.25,false)).toEqual([0,.75,.25,.13]);
 // Native MAXLUM2 uses the first sequence blend in its luminance comparison.
 expect(sourceSpriteCardDualSequence(a,b,c,0,.99,true)).toEqual([0,1,0,.13]);
 expect(sourceSpriteCardDualSequence(a,b,c,1,0,true)).toEqual([0,0,1,.13]);
});
it('feathers a real intersection using linear distances in metres and the original 50-unit scale',()=>{
 expect(sourceSpriteCardDepthFeather(10,10)).toBe(0);
 expect(sourceSpriteCardDepthFeather(10,11)).toBe(0);
 expect(sourceSpriteCardDepthFeather(10+.635,10)).toBeCloseTo(.5);
 expect(sourceSpriteCardDepthFeather(10+1.27,10)).toBeCloseTo(1);
 expect(sourceSpriteCardDepthFeather(100,10)).toBe(1);
});
it('binds completed depth only to depthblend materials and keeps foreground/world depth independent',()=>{
 const world=new Group(),gun=new Group(),soft=create({depthBlend:true}),hard=create(),foreground=create({depthBlend:true});world.add(soft.mesh,hard.mesh);gun.add(foreground.mesh);
 const binding={texture:new Texture(),near:.06,far:400,width:1920,height:1080};setSourceSpriteCardDepth(world,binding);
 expect(soft.material.uniforms.sceneDepth.value).toBe(binding.texture);expect(soft.material.uniforms.depthEnabled.value).toBe(true);
 expect(hard.material.uniforms.depthEnabled.value).toBe(false);expect(foreground.material.uniforms.sceneDepth.value).toBeNull();
 expect(soft.material.uniforms.cameraNearFar.value.toArray()).toEqual([.06,400]);expect(soft.material.uniforms.depthViewport.value.toArray()).toEqual([1920,1080]);
 setSourceSpriteCardDepth(world,null);expect(soft.material.uniforms.depthEnabled.value).toBe(false);expect(soft.material.uniforms.sceneDepth.value).toBeNull();
 expect(()=>setSourceSpriteCardDepth(world,{...binding,far:.01})).toThrow(/Invalid/);
 [soft,hard,foreground].forEach(b=>b.dispose());
});
it('allocates independent dual-sequence frame attributes and camera-facing trail endpoints',()=>{
 const batch=create({trails:true,dualSequence:true,sequenceZoom:24,sizeFade:[.4,.7]});batch.set('particleTail',1,[1,2,3]);batch.set('particleUV20',1,[.1,.2,.3,.4]);batch.finish(2);
 expect(batch.geometry.instanceCount).toBe(2);expect([...batch.geometry.getAttribute('particleTail').array].slice(3,6)).toEqual([1,2,3]);
 expect(batch.material.uniforms.sequenceZoom.value).toBe(24);expect(batch.material.uniforms.sizeFade.value.toArray()).toEqual([.4,.7]);expect(batch.material.vertexShader).toContain('mix(tail,viewCenter');batch.dispose();
});

it('keeps original world-Z smoke upright through camera pitch and roll, including yaw reflection and near fade',()=>{
 for(const angles of [[0,0,0],[.9,.6,.2],[-1.2,-.8,.7]]){
  const view=new Quaternion().setFromEuler(new Euler(...angles as [number,number,number])),center=new Vector3(0,0,-10).applyQuaternion(view),up=new Vector3(0,1,0).applyQuaternion(view);
  const result=sourceSpriteCardZAlignedOffset([1,1],1,0,center.toArray(),up.toArray());
  expect(new Vector3().fromArray(result.offset).applyQuaternion(view.clone().invert()).distanceTo(new Vector3(1,1,0))).toBeLessThan(1e-12);
  const rotated=sourceSpriteCardZAlignedOffset([1,1],1,Math.PI/2,center.toArray(),up.toArray());
  expect(new Vector3().fromArray(rotated.offset).applyQuaternion(view.clone().invert()).distanceTo(new Vector3(-1,1,0))).toBeLessThan(1e-12);
  const mirrored=sourceSpriteCardZAlignedOffset([1,1],1,0,center.toArray(),up.toArray(),Math.PI);
  expect(new Vector3().fromArray(mirrored.offset).applyQuaternion(view.clone().invert()).distanceTo(new Vector3(-1,1,0))).toBeLessThan(1e-12);
 }
 expect(sourceSpriteCardZAlignedOffset([1,1],2,0,[0,0,-1],[0,1,0])).toEqual({offset:[0,0,0],tintScale:0});
 expect(sourceSpriteCardZAlignedOffset([1,1],2,0,[0,0,-1.5],[0,1,0]).tintScale).toBe(.5);
 expect(sourceSpriteCardZAlignedOffset([1,1],2,0,[0,0,-2],[0,1,0]).tintScale).toBe(1);
 const batch=create({orientationType:1});expect(batch.material.uniforms.orientationType.value).toBe(1);expect(batch.material.vertexShader).toContain('side*rotated.x+upright*rotated.y');batch.dispose();
});
