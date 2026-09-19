import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import * as T from 'three';
import {createSourceRopesRender,createSourceRopeMotion,sourceRopeInitialNodes,sourceRopeSpline} from '../game/source-ropes-render';
import {prepareSourceVisibility} from '../game/source-visibility';
import {SOURCE_ROPES} from '../game/source-ropes';
import native from './fixtures/source-rope-native-hang.json';
import nativeWind from './fixtures/source-rope-native-wind.json';
const base=new URL('../public/source/csgo-12426148/dust2/',import.meta.url);
const visibility=prepareSourceVisibility(JSON.parse(readFileSync(new URL('visibility.json',base),'utf8')));
const sky=JSON.parse(readFileSync(new URL('sky.json',base),'utf8'));
function owner(){const texture=new T.Texture();texture.image={width:32,height:512};return {texture,rope:createSourceRopesRender({texture,visibility,skyLeafIds:sky.skyLeafIds})};}
it('matches original x86-64 five-second hang for four actual spans within .05 Source units',()=>{
 let worst=0;
 for(const row of native.cases){const result=sourceRopeInitialNodes(row.start,row.end,row.slack);
  expect(result.sourceLength).toBe(row.sourceLength);expect(result.springLength).toBe(row.springLength);
  row.predicted.flat().forEach((value,i)=>{worst=Math.max(worst,Math.abs(result.positions[i]-value));});
 }
 expect(worst).toBeLessThan(.05);
});
it('matches 24 original native wind continuation frames and preserves fixed endpoints',()=>{
 let worst=0;
 for(const row of nativeWind.cases){const motion=createSourceRopeMotion(row.start,row.end,row.slack);
  for(const frame of row.frames){motion.advance(frame.dt,nativeWind.force.rawWind);
   frame.predicted.flat().forEach((value,i)=>{worst=Math.max(worst,Math.abs(motion.predicted[i]-value));});
   expect([...motion.predicted.slice(0,3)]).toEqual(row.start);expect([...motion.predicted.slice(-3)]).toEqual(row.end);
  }
 }
 expect(worst).toBeLessThan(.05);
});
it('moves nearby ribbons from the raw wind clock, pauses unchanged, and resets the motion epoch',()=>{
 const {rope}=owner(),camera=new T.PerspectiveCamera(),first=SOURCE_ROPES.ropes.find(r=>r.nextKey)!;
 camera.position.set(first.origin[0]*.0254,first.origin[2]*.0254,-first.origin[1]*.0254);
 rope.setWind([4,-2,0],0,'a');rope.update(camera);
 const firstMesh=rope.world.children[0]as T.Mesh,initial=Array.from(firstMesh.geometry.getAttribute('position').array);
 for(let i=1;i<=60;i++){rope.setWind([4,-2,0],i/60,'a');rope.update(camera);}
 expect(rope.audit.activeSpans).toBeGreaterThan(0);expect(rope.audit.physicsSteps).toBeGreaterThan(0);
 expect(Array.from(firstMesh.geometry.getAttribute('position').array)).not.toEqual(initial);
 const paused=Array.from(firstMesh.geometry.getAttribute('position').array),steps=rope.audit.physicsSteps;
 rope.setWind([4,-2,0],1,'a');rope.update(camera);expect(rope.audit.physicsSteps).toBe(steps);
 expect(Array.from(firstMesh.geometry.getAttribute('position').array)).toEqual(paused);
 rope.setWind([0,0,0],0,'b');rope.update(camera);
 expect(Array.from(firstMesh.geometry.getAttribute('position').array)).toEqual(initial);
 expect(()=>rope.setWind([4,-2,0],-1,'b')).toThrow();rope.dispose();
});
it('preserves every authored endpoint and subdivision rather than inventing ropes for terminal keys',()=>{
 for(const row of SOURCE_ROPES.ropes){if(!row.nextKey)continue;
  const end=SOURCE_ROPES.byName.get(row.nextKey)!,initial=sourceRopeInitialNodes(row.origin,end.origin,row.slack),curve=sourceRopeSpline(initial.positions,row.subdiv);
  expect(curve.length/3).toBe(28);expect(Array.from(curve.slice(0,3))).toEqual(row.origin.map(Math.fround));
  expect(Array.from(curve.slice(-3))).toEqual(end.origin.map(Math.fround));
 }
 const {rope}=owner();expect(rope.audit).toMatchObject({entities:142,spans:120,chainEnds:22,nodes:1200,splinePoints:3360,triangles:6480});
 expect(rope.audit.drawCalls).toBeLessThanOrEqual(2);expect(rope.audit.worldSpans+rope.audit.skySpans).toBe(120);rope.dispose();
});
it('uses original receiver-region PVS, keeps sky separate, and writes supplied ambient strength without another normalization',()=>{
 const {rope}=owner(),camera=new T.PerspectiveCamera();camera.position.set(-24.384,10,11.379);rope.update(camera);
 expect(rope.audit.visibleWorldSpans).toBeGreaterThan(0);expect(rope.audit.visibleWorldSpans).toBeLessThanOrEqual(rope.audit.worldSpans);
 rope.setLighting(()=>[.3,.5,.9]);expect(rope.audit.lightingBound).toBe(true);
 for(const mesh of [...rope.world.children,...rope.sky.children]as T.Mesh[]){const c=mesh.geometry.getAttribute('color');expect(c.getX(0)).toBeCloseTo(.3);expect(c.getZ(0)).toBeCloseTo(.9);}
 rope.update(camera,false);expect(rope.audit.visibleWorldSpans).toBe(rope.audit.worldSpans);rope.dispose();
});
it('retains texture ownership and rejects updates after a repeat-safe release',()=>{
 const {rope,texture}=owner(),dispose=vi.fn();texture.addEventListener('dispose',dispose);rope.dispose();rope.dispose();
 expect(dispose).not.toHaveBeenCalled();expect(()=>rope.update(new T.PerspectiveCamera())).toThrow(/disposed/);
});
