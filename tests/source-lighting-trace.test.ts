import {beforeAll,describe,expect,it} from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {createSourceLightingTrace,type SourceLightingTraceData} from '../game/source-lighting-trace';
import {attachSourceMapCollision,type SourceMapCollisionData} from '../game/source-map-collision';
function data():SourceLightingTraceData{return {format:'source-lighting-trace-v1',build:12426148,sourceBspSha256:'test',collisionSha256:'test',
 tree:{head:0,planes:[[1,0,0,12],[-1,0,0,-10],[0,1,0,1],[0,-1,0,1],[0,0,1,1],[0,0,-1,1],[0,0,1,0]],nodes:[{plane:6,children:[-1,-2]}],leafContents:[0,1]},
 brushes:[{id:71,contents:128,sides:[[0,0,0],[1,4,1],[2,0,2],[3,0,3],[4,0,4],[5,0,5]],bounds:[[10,-1,-1],[12,1,1]]}],
 displacements:[],props:[],limitations:[]};}
describe('independent original lighting trace',()=>{
 beforeAll(async()=>{await RAPIER.init();});
 it('retains original opaque/SKY side identity and 1/32-unit margin',()=>{
  const owner=createSourceLightingTrace(data());
  const hit=owner.trace([0,0,0],[20,0,0]);expect(hit.fraction).toBeCloseTo((10-.03125)/20,7);expect(hit.surfaceFlags).toBe(4);
  expect(hit.source).toMatchObject({brush:71,side:1,contents:128});
  expect(owner.trace([0,3,0],[20,3,0])).toEqual({fraction:1,surfaceFlags:0});
  expect(owner.leafAt([0,0,1])).toEqual({leaf:0,contents:0});expect(owner.leafAt([0,0,-1])).toEqual({leaf:1,contents:1});owner.dispose();
 });
 it('distinguishes exact lighting/cache masks and preserves inside-brush semantics',()=>{
  const value=data();value.brushes[0].contents=0x400;const owner=createSourceLightingTrace(value);
  expect(owner.trace([0,0,0],[20,0,0],{mask:0x4081}).fraction).toBe(1);
  expect(owner.trace([0,0,0],[20,0,0],{mask:0x4481}).fraction).toBeLessThan(1);
  expect(owner.trace([11,0,0],[11.5,0,0])).toMatchObject({fraction:0,startSolid:true,allSolid:true,surfaceFlags:0});
  expect(owner.trace([11,0,0],[20,0,0])).toMatchObject({fraction:1,startSolid:true,surfaceFlags:0});owner.dispose();
 });
 it('adds only original solid static props, excluding grate and generic brush entities independent of role',()=>{
  const world=new RAPIER.World({x:0,y:0,z:0}),vertices=[];
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])vertices.push(x*.0254,y*.0254,z*.0254);
  const collision:SourceMapCollisionData={format:'source-map-collision-v1',sourceMap:'test',sourceBspSha256:'test',metersPerSourceUnit:.0254,
   geometries:[{id:0,kind:'convex',vertices,source:{}}],colliders:[
    {geometry:0,translation:[5*.0254,0,0],rotation:[0,0,0,1],scale:1,roles:['player'],source:{layer:'propPhy',prop:0,model:'solid'}},
    {geometry:0,translation:[3*.0254,0,0],rotation:[0,0,0,1],scale:1,roles:['bullet'],source:{layer:'propPhy',prop:1,model:'grate'}},
    {geometry:0,translation:[1*.0254,0,0],rotation:[0,0,0,1],scale:1,roles:['projectile'],source:{layer:'brush',contents:1}},
   ],sensors:[],missingPHY:[],limits:[]};
  const map=attachSourceMapCollision(world,collision);world.step();const value=data();value.props=[{model:'solid',contents:1,mdlSha256:'a'},{model:'grate',contents:8,mdlSha256:'b'}];
  const owner=createSourceLightingTrace(value,{world,map});
  expect(owner.trace([0,0,0],[20,0,0]).surfaceFlags).toBe(4);
  const props=owner.trace([0,0,0],[20,0,0],{includeProps:true});expect(props.fraction).toBeCloseTo(.2,6);expect(props.source).toMatchObject({layer:'propPhy',prop:0,contents:1});expect(props.surfaceFlags).toBe(0);
  owner.dispose();map.dispose();world.free();
 });
 it('reports the hit displacement triangle texinfo flags from the original group ranges',()=>{
  const world=new RAPIER.World({x:0,y:0,z:0}),collision:SourceMapCollisionData={format:'source-map-collision-v1',sourceMap:'test',sourceBspSha256:'test',metersPerSourceUnit:.0254,
   geometries:[{id:0,kind:'trimesh',vertices:[0,0,0,1,0,0,0,0,1,1,0,1],indices:[0,2,1,1,2,3],source:{}}],
   colliders:[{geometry:0,translation:[0,0,0],rotation:[0,0,0,1],scale:1,roles:['player'],source:{layer:'displacement',grid:[0,0,0],contents:1}}],sensors:[],missingPHY:[],limits:[]};
  const map=attachSourceMapCollision(world,collision);world.step();const value=data();value.brushes=[];value.displacements=[{key:'0,0,0,1',contents:1,geometry:0,ranges:[[1,2048,0],[1,0,1]]}];
  const owner=createSourceLightingTrace(value,{world,map});
  for(const [v,flags] of [[.2,2048],[.8,0]]){
   const hit=owner.trace([v/.0254,-v/.0254,1/.0254],[v/.0254,-v/.0254,-1/.0254]);expect(hit.fraction).toBeCloseTo(.5,6);expect(hit.surfaceFlags).toBe(flags);
  }
  owner.dispose();map.dispose();world.free();
 });
});
