import * as T from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadSourceDust2} from '../game/source-dust2';

/** Private deterministic frame API for the actual integrated map owner. */
export function createSourceMapWindPreview(){
 const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1280,720);renderer.setPixelRatio(1);
 renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.98;
 document.body.appendChild(renderer.domElement);
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(78,1280/720,.02,1000);camera.rotation.order='YXZ';
 const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.04);room.dispose();pmrem.dispose();
 scene.environment=environment.texture;scene.environmentIntensity=.45;scene.background=new T.Color('#d5cbac');
 const sun=new T.DirectionalLight('#ffdfb3',3.1);sun.position.set(-30,48,15);scene.add(sun,new T.HemisphereLight('#cfdef0','#6e634c',.35));
 let map:Awaited<ReturnType<typeof loadSourceDust2>>|undefined,pvsEnabled=false,lastVisibility:unknown=null;
 const memory=()=>({...renderer.info.memory,programs:renderer.info.programs?.length??0});
 const render=()=>{
  camera.updateMatrixWorld(true);
  if(map){lastVisibility=map.updateVisibility(camera.position,pvsEnabled);const sky=map.updateSky(camera);
   if(sky?.enabled&&map.sky){renderer.autoClear=true;renderer.render(map.sky.scene,map.sky.camera);renderer.autoClear=false;renderer.clearDepth();
    const bg=scene.background;scene.background=null;renderer.render(scene,camera);scene.background=bg;renderer.autoClear=true;return;}}
  renderer.render(scene,camera);
 };
 render();const baseline=memory();
 const unload=()=>{const old=map;map?.dispose();map=undefined;render();return {memory:memory(),windDisposed:old?.stats.wind?.disposed??null};};
 const load=async(enableFoliage=true)=>{
  unload();map=await loadSourceDust2({sky:true,propLighting:{maxTextureSize:renderer.capabilities.maxTextureSize,
    enablePlainUnbumped:true,enableDecalMultiply:true,enableTintMask:true,enableTintDecal:true,enableFoliage}});
  scene.add(map.root);
  if(map.sky){map.sky.scene.background=new T.Color('#d5cbac');map.sky.scene.add(sun.clone(),new T.HemisphereLight('#cfdef0','#6e634c',.35));}
  if(enableFoliage)map.updateWind(0,'preview-room-a');render();return map.stats;
 };
 const focus=(name:'t'|'ct'|'palm'|'sumac')=>{
  if(name==='t'){camera.position.set(-20.888071,4.604088560391119,20.2093068);camera.rotation.set(0,.29670597,0);}
  if(name==='ct'){camera.position.set(-43.7,-2.83,-51.1);camera.lookAt(-40,1,-45);}
  if(name==='palm'){camera.position.set(-52,6,10);camera.lookAt(-55.9308,10,5.4102);}
  if(name==='sumac'){camera.position.set(-5.85,2.9,37);camera.lookAt(-5.85,2,32.25);}
  render();return {position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov};
 };
 const leafReadback=()=>{
  const result:{name:string;gpuTimeWind:number[]|null}[]=[],gl=renderer.getContext();
  map?.props.scene.traverse(o=>{const m=o as T.Mesh;if(!m.isMesh||Array.isArray(m.material))return;
   const item=m.material;
   if(item.name.endsWith(' / original treesway + VHV')){
    const properties=renderer.properties.get(item) as {currentProgram?:{program?:WebGLProgram}};
    const program=properties.currentProgram?.program;
    const location=program?gl.getUniformLocation(program,'sourceTreeTimeWind'):null;
    const value=program&&location?gl.getUniform(program,location) as Float32Array:null;
    result.push({name:m.name,gpuTimeWind:value?Array.from(value):null});
   }
  });return result;
 };
 const audit=()=>({map:map?.stats??null,wind:map?.windSnapshot()??null,memory:memory(),visibility:lastVisibility,
   originalLeafMeshes:leafReadback().length,compiledLeafUniforms:leafReadback(),render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles},
   camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray()}});
 return {load,focus,render,memory,baseline,audit,unload,
  tick:(time:number,epoch='preview-room-a')=>{if(!map)throw Error('Map not loaded');const value=map.updateWind(time,epoch);render();return value;},
  advance:(from:number,to:number,hz=60,epoch='preview-room-a')=>{
   if(!map||!Number.isFinite(from)||!Number.isFinite(to)||to<from||to-from>300||hz<1||hz>240)throw Error('Invalid private frame schedule');
   const count=Math.ceil((to-from)*hz);for(let i=0;i<=count;i++)map.updateWind(from+(to-from)*(count?i/count:0),epoch);render();return audit();
  },
  setPVS:(enabled:boolean)=>{pvsEnabled=enabled;render();return lastVisibility;},
  dispose:()=>{unload();environment.dispose();renderer.dispose();renderer.domElement.remove();}};
}
