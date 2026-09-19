import type {SourceScenario} from '../../game/source-scenario';
export function sourceSimulationFixture():SourceScenario{
 const bounds={min:[-20,-8,-20] as [number,number,number],max:[20,10,20] as [number,number,number]};
 const box=(x:number,y:number,z:number)=>[-x,-y,-z,-x,-y,z,-x,y,-z,-x,y,z,x,-y,-z,x,-y,z,x,y,-z,x,y,z];
 const level:SourceScenario['level']={format:'source-level-v1',id:'source-fixture',name:'Source fixture',sourceBspSha256:'fixture',metersPerSourceUnit:.0254,
  worldBounds:bounds,boundsMeaning:'fixture',spawns:(['blue','amber']as const).map((team,i)=>({id:team,team,x:i?4:-4,y:-3.75,z:0,yaw:0,pitch:0,
   sourceClassname:'fixture',sourceOrigin:[0,0,0],sourceAngles:[0,0,0]})),sites:[{name:'A',sourceModel:1,hammerid:'A',bounds},{name:'B',sourceModel:2,hammerid:'B',bounds}],
  siteBinding:'fixture',navigation:null,navigationStatus:'none',sourceNavSha256:'nav-fixture',player:{standing:{halfExtents:[.4064,.9144,.4064],eyeHeight:1.6256},
   crouching:{halfExtents:[.4064,.6858,.4064],eyeHeight:1.1684},gravity:20.32,stepHeight:.4572,standableNormal:.7,sourceServerSha256:'fixture',hullMeaning:'Source AABB'}};
 const instance=(geometry:number,translation:[number,number,number],roles:('player'|'bullet'|'projectile')[],source={})=>({geometry,translation,roles,source,rotation:[0,0,0,1]as[number,number,number,number],scale:1});
 return{level,collision:{format:'source-map-collision-v1',sourceMap:level.id,sourceBspSha256:'fixture',metersPerSourceUnit:.0254,missingPHY:[],limits:[],
  geometries:[{id:0,kind:'convex',vertices:box(20,.5,20),source:{}},{id:1,kind:'convex',vertices:box(1,2,1),source:{}},
   {id:2,kind:'convex',vertices:box(20,3,.05),source:{}}],colliders:[instance(0,[0,-4.5,0],['player','bullet','projectile']),instance(2,[0,-1,-2],['player'])],
  sensors:[instance(1,[-4,-3,0],[],{classname:'func_bomb_target',model:1,hammerid:'A'}),instance(1,[4,-3,0],[],{classname:'func_bomb_target',model:2,hammerid:'B'})]},
  navigation:{format:'source-navigation-v1',version:16,subVersion:1,sourceBspSha256:'fixture',sourceNavSha256:'nav-fixture',metersPerSourceUnit:.0254,places:[],ladders:[],areas:[
   {id:1,flags:0,nw:[-300,-100,-4/.0254],se:[0,100,-4/.0254],neZ:-4/.0254,swZ:-4/.0254,place:0,connections:[[],[2],[],[]],ladders:[[],[]]},
   {id:2,flags:0,nw:[0,-100,-4/.0254],se:[300,100,-4/.0254],neZ:-4/.0254,swZ:-4/.0254,place:0,connections:[[],[],[],[1]],ladders:[[],[]]}]}};
}
