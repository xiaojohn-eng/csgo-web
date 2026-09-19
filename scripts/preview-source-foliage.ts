import * as T from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadSourceDust2} from '../game/source-dust2';
import {loadSourceFoliage} from '../game/source-foliage-loader';
import {probeSourceTreeswayGPU} from './probe-source-treesway-gpu';
export async function createSourceFoliagePreview(){
 const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1280,720);renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.98;
 document.body.appendChild(renderer.domElement);const scene=new T.Scene(),camera=new T.PerspectiveCamera(78,1280/720,.02,1000);camera.rotation.order='YXZ';
 const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.04);room.dispose();pmrem.dispose();scene.environment=environment.texture;scene.environmentIntensity=.45;scene.background=new T.Color('#d5cbac');scene.fog=new T.FogExp2('#d5cbac',0);
 const sun=new T.DirectionalLight('#ffdfb3',3.1);sun.position.set(-30,48,15);scene.add(sun,new T.HemisphereLight('#cfdef0','#6e634c',.35));
 let map:Awaited<ReturnType<typeof loadSourceDust2>>|undefined,foliage:Awaited<ReturnType<typeof loadSourceFoliage>>|undefined;
 const memory=()=>({...renderer.info.memory,programs:renderer.info.programs?.length??0});
 const render=()=>{
  camera.updateMatrixWorld(true);if(map){map.updateVisibility(camera.position,false);const sky=map.updateSky(camera);if(sky?.enabled&&map.sky){renderer.autoClear=true;renderer.render(map.sky.scene,map.sky.camera);renderer.autoClear=false;renderer.clearDepth();const bg=scene.background;scene.background=null;renderer.render(scene,camera);scene.background=bg;renderer.autoClear=true;return;}}
  renderer.render(scene,camera);
 };
 const unload=()=>{foliage?.dispose();foliage=undefined;map?.dispose();map=undefined;render();};render();const baseline=memory();
 const load=async()=>{unload();map=await loadSourceDust2({sky:true,propLighting:{maxTextureSize:renderer.capabilities.maxTextureSize,enablePlainUnbumped:true,enableDecalMultiply:true,enableTintMask:true,enableTintDecal:true}});scene.add(map.root);if(map.sky){map.sky.scene.background=new T.Color('#d5cbac');map.sky.scene.add(sun.clone(),new T.HemisphereLight('#cfdef0','#6e634c',.35));}render();return map.stats;};
 const enable=async(enabled=true)=>{if(!map)throw Error('Load original map first');foliage?.dispose();foliage=undefined;if(enabled)foliage=await loadSourceFoliage(map.props,{enabled:true,baseURL:'/assets/source-exports/dust2-vhv/foliage/',state:{timeSeconds:.125,windSourceXY:[2,0]},maxTextureSize:renderer.capabilities.maxTextureSize});render();return foliage?.audit??{enabled:false};};
 const focus=(name:'t'|'sumac'|'palm')=>{
  if(name==='t'){camera.position.set(-20.888071,4.604088560391119,20.2093068);camera.rotation.set(0,.29670597,0);}
  if(name==='palm'){camera.position.set(-52,6.0,10);camera.lookAt(-55.9308,10.0,5.4102);}
  if(name==='sumac'){camera.position.set(-5.85,2.9,37);camera.lookAt(-5.85,2.0,32.25);}
  render();return {position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov};
 };
 return {load,enable,focus,memory,baseline,render,unload,probe:probeSourceTreeswayGPU,setState:(time:number,wind:readonly number[])=>{foliage?.setState({timeSeconds:time,windSourceXY:wind});render();},
  audit:()=>({map:map?.stats,foliage:foliage?.audit,memory:memory(),camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray()}}),
  dispose:()=>{unload();environment.dispose();renderer.dispose();renderer.domElement.remove();}};
}
