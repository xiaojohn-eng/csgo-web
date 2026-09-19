import * as T from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadSourceDust2} from '../game/source-dust2';
import {loadSourceOlive} from '../game/source-olive-loader';

/** Private deterministic frame API for the actual integrated map owner. */
export function createSourceOlivePreview(){
 const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1280,720);renderer.setPixelRatio(1);
 renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.98;
 document.body.appendChild(renderer.domElement);
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(78,1280/720,.02,1000);camera.rotation.order='YXZ';
 const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.04);room.dispose();pmrem.dispose();
 scene.environment=environment.texture;scene.environmentIntensity=.45;scene.background=new T.Color('#d5cbac');
 const sun=new T.DirectionalLight('#ffdfb3',3.1);sun.position.set(-30,48,15);scene.add(sun,new T.HemisphereLight('#cfdef0','#6e634c',.35));
 let map:Awaited<ReturnType<typeof loadSourceDust2>>|undefined,pvsEnabled=false,lastVisibility:unknown=null;
 let olive:Awaited<ReturnType<typeof loadSourceOlive>>|undefined;
 const skyBorrowed:{mesh:T.Mesh;material:T.Material|T.Material[];frustum:boolean}[]=[];
 const memory=()=>({...renderer.info.memory,programs:renderer.info.programs?.length??0});
 const render=()=>{
  camera.updateMatrixWorld(true);
  if(map){lastVisibility=map.updateVisibility(camera.position,pvsEnabled);const sky=map.updateSky(camera);
   if(sky?.enabled&&map.sky){renderer.autoClear=true;renderer.render(map.sky.scene,map.sky.camera);renderer.autoClear=false;renderer.clearDepth();
    const bg=scene.background;scene.background=null;renderer.render(scene,camera);scene.background=bg;renderer.autoClear=true;return;}}
  renderer.render(scene,camera);
 };
 render();const baseline=memory();
 const unload=()=>{const old=map;for(const b of skyBorrowed){b.mesh.material=b.material;b.mesh.frustumCulled=b.frustum;}skyBorrowed.length=0;olive?.dispose();olive=undefined;map?.dispose();map=undefined;render();return {memory:memory(),windDisposed:old?.stats.wind?.disposed??null};};
 const setWind=(time:number,epoch:string)=>{const value=map?.updateWind(time,epoch);if(value)olive?.setState({timeSeconds:value.levelTime,windSourceXY:value.windSourceXY});return value;};
 const load=async(enableOlive=true,integrated=false)=>{
  unload();map=await loadSourceDust2({sky:true,propLighting:{maxTextureSize:renderer.capabilities.maxTextureSize,
    enablePlainUnbumped:true,enableDecalMultiply:true,enableTintMask:true,enableTintDecal:true,enableFoliage:true,enableOlive:integrated}});
  scene.add(map.root);
  if(map.sky){map.sky.scene.background=new T.Color('#d5cbac');map.sky.scene.add(sun.clone(),new T.HemisphereLight('#cfdef0','#6e634c',.35));}
  if(enableOlive&&!integrated){
   olive=await loadSourceOlive(map.props,{enabled:true,csm:false,baseURL:'/assets/source-exports/dust2-vhv/olive-foliage/',state:{timeSeconds:0,windSourceXY:[0,0]},maxTextureSize:renderer.capabilities.maxTextureSize});
   // Private preview loads the new owner after map construction. Match each
   // original sky copy to the same source prop/child, with independent VHV.
   for(const copy of map.sky?.scene.children??[]){if(!/^static_prop_\d+$/.test(copy.name))continue;const source=map.props.scene.getObjectByName(copy.name);if(!source)throw Error('Sky source prop missing');
    const originals:T.Object3D[]=[],copies:T.Object3D[]=[];source.traverse(o=>originals.push(o));copy.traverse(o=>copies.push(o));
    if(originals.length!==copies.length)throw Error('Sky/source hierarchy mismatch');
    for(let i=0;i<copies.length;i++){const a=originals[i]as T.Mesh,b=copies[i]as T.Mesh;if(!a.isMesh||Array.isArray(a.material)||!a.material.name.endsWith(' / original olive no-CSM + VHV'))continue;
     skyBorrowed.push({mesh:b,material:b.material,frustum:b.frustumCulled});b.material=a.material;b.frustumCulled=false;
    }
   }
   if(skyBorrowed.length!==48)throw Error('Original olive sky coverage mismatch');
  }
  setWind(0,'preview-room-a');render();return {map:map.stats,olive:olive?.audit??map.stats.olive,skyOliveCopies:skyOliveCount()};
 };
 const focus=(name:'t'|'ct'|'palm'|'sumac')=>{
  if(name==='t'){camera.position.set(-20.888071,4.604088560391119,20.2093068);camera.rotation.set(0,.29670597,0);}
  if(name==='ct'){camera.position.set(-43.7,-2.83,-51.1);camera.lookAt(-40,1,-45);}
  if(name==='palm'){camera.position.set(-52,6,10);camera.lookAt(-55.9308,10,5.4102);}
  if(name==='sumac'){camera.position.set(-5.85,2.9,37);camera.lookAt(-5.85,2,32.25);}
  render();return {position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov};
 };
 const skyOliveCount=()=>{let n=0;map?.sky?.scene.traverse(o=>{const m=o as T.Mesh;if(m.isMesh&&!Array.isArray(m.material)&&m.material.name.endsWith(' / original olive no-CSM + VHV'))n++;});return n;};
 const leafReadback=()=>{
  const result:{name:string;gpuTimeWind:number[]|null}[]=[],gl=renderer.getContext();
  map?.props.scene.traverse(o=>{const m=o as T.Mesh;if(!m.isMesh||Array.isArray(m.material))return;
   const item=m.material;
   if(item.name.endsWith(' / original treesway + VHV')||item.name.endsWith(' / original olive no-CSM + VHV')){
    const properties=renderer.properties.get(item) as {currentProgram?:{program?:WebGLProgram}};
    const program=properties.currentProgram?.program;
    const location=program?gl.getUniformLocation(program,'sourceTreeTimeWind'):null;
    const value=program&&location?gl.getUniform(program,location) as Float32Array:null;
    result.push({name:m.name,gpuTimeWind:value?Array.from(value):null});
   }
  });return result;
 };
 const audit=()=>({map:map?.stats??null,olive:olive?.audit??map?.stats.olive??null,skyOliveCopies:skyOliveCount(),wind:map?.windSnapshot()??null,memory:memory(),visibility:lastVisibility,
   originalLeafMeshes:leafReadback().length,compiledLeafUniforms:leafReadback(),render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles},
   camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray()}});
 return {load,loadIntegrated:()=>load(true,true),focus,render,memory,baseline,audit,unload,
  tick:(time:number,epoch='preview-room-a')=>{if(!map)throw Error('Map not loaded');const value=setWind(time,epoch);render();return value;},
  advance:(from:number,to:number,hz=60,epoch='preview-room-a')=>{
   if(!map||!Number.isFinite(from)||!Number.isFinite(to)||to<from||to-from>300||hz<1||hz>240)throw Error('Invalid private frame schedule');
   const count=Math.ceil((to-from)*hz);for(let i=0;i<=count;i++)setWind(from+(to-from)*(count?i/count:0),epoch);render();return audit();
  },
  setPVS:(enabled:boolean)=>{pvsEnabled=enabled;render();return lastVisibility;},
  dispose:()=>{unload();environment.dispose();renderer.dispose();renderer.domElement.remove();}};
}
