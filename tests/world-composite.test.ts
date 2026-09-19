import * as T from 'three';
import {expect,it} from 'vitest';
import {WorldComposite} from '../game/world-composite';
import {sourceFogMaxDensity,setSourceFogMaxDensity} from '../game/source-fog';

it('draws the sky first, clears its depth and draws world then first person while restoring renderer state',()=>{
  const events:string[]=[],world=new T.Scene(),sky=new T.Scene(),foreground=new T.Scene(),camera=new T.PerspectiveCamera();
  const background=new T.Color('red');world.background=background;sky.userData.sourceFogMaxDensity=.6;setSourceFogMaxDensity(.4);
  const info={render:{calls:0}};
  const renderer={autoClear:false,info,getRenderTarget:()=>null,setRenderTarget:()=>{},clearDepth:()=>events.push('depth'),
    render(scene:T.Scene){events.push(scene===world?'world':scene===sky?'sky':'foreground');
      expect(sourceFogMaxDensity()).toBe(scene===sky?.6:.4);
      info.render.calls=0;info.render.calls++;
      if(scene===world)expect(scene.background).toBeNull();}} as unknown as T.WebGLRenderer;
  const composite=new WorldComposite();
  composite.render(renderer,world,camera,foreground,camera,{scene:sky,camera});
  expect(events).toEqual(['sky','depth','world','depth','foreground']);expect(world.background).toBe(background);expect(renderer.autoClear).toBe(false);
  expect(composite.lastCalls).toEqual({sky:1,world:1,foreground:1});
});
it('restores the world background and renderer state when its background pass fails',()=>{
  const world=new T.Scene(),sky=new T.Scene(),foreground=new T.Scene(),camera=new T.PerspectiveCamera(),background=new T.Color('red');world.background=background;
  const renderer={autoClear:false,info:{render:{calls:0}},getRenderTarget:()=>null,setRenderTarget:()=>{},clearDepth:()=>{},render(scene:T.Scene){if(scene===world)throw Error('GPU error');}} as unknown as T.WebGLRenderer;
  expect(()=>new WorldComposite().render(renderer,world,camera,foreground,camera,{scene:sky,camera})).toThrow('GPU error');
  expect(world.background).toBe(background);expect(renderer.autoClear).toBe(false);
});
