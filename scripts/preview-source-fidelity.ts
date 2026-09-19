import * as T from 'three';
import {loadSourceGrenadeModels} from '../game/source-grenade-models';

const status=document.querySelector('#status')!;
const canvas=document.querySelector('canvas')!;
const renderer=new T.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(1);renderer.setSize(1600,1000,false);
renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.98;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
const scene=new T.Scene();scene.background=new T.Color('#353e43');
const camera=new T.PerspectiveCamera(35,1.6,.005,10);camera.position.set(.42,.3,.67);camera.lookAt(0,.07,0);
scene.add(new T.HemisphereLight('#d3e2f8','#6e634c',.7));
const sun=new T.DirectionalLight('#fee6c5',3.1);sun.position.set(-.6,1,.9);sun.castShadow=true;
sun.shadow.camera.left=-1;sun.shadow.camera.right=1;sun.shadow.camera.top=1;sun.shadow.camera.bottom=-1;
sun.shadow.camera.near=.01;sun.shadow.camera.far=4;sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.001;scene.add(sun);
const ground=new T.Mesh(new T.PlaneGeometry(4,4),new T.MeshStandardMaterial({color:'#647076',roughness:.95}));
ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
const errors:string[]=[];renderer.debug.onShaderError=(_gl,_program,vs,fs)=>{
 errors.push(renderer.getContext().getShaderInfoLog(vs)??'',renderer.getContext().getShaderInfoLog(fs)??'');
};
try{
 const owner=await loadSourceGrenadeModels();
 const instances:T.Group[]=[];
 for(const [i,kind]of (['he','smoke','flash']as const).entries()){
  const object=owner.create(kind,'intact');const info=owner.audit().models[kind];
  object.position.set((i-1)*.2,info.collider.spanMetres[1]/2+.001,0);scene.add(object);instances.push(object);
 }
 renderer.render(scene,camera);
 const audit={kind:'source-grenade-gpu-v1',...owner.audit(),errors,
  triangles:renderer.info.render.triangles,draws:renderer.info.render.calls,
  models:instances.map(root=>({source:root.userData.sourceGrenade,bounds:new T.Box3().setFromObject(root).getSize(new T.Vector3()).toArray(),
   materials:(()=>{const rows:any[]=[];root.traverse(o=>{if(o instanceof T.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])rows.push({name:m.name,type:m.type,source:m.userData.sourceMaterial,parameters:m.userData.sourceParameters});});return rows;})()}))};
 (window as any).__FIDELITY__={renderer,scene,camera,owner,instances,audit,render:()=>{renderer.render(scene,camera);return canvas.toDataURL('image/png');}};
 status.textContent=errors.length?'着色器错误':'原 HE / 烟雾 / 闪光：模型、原纹理和材质已实际渲染';
 document.querySelector('pre')!.textContent=JSON.stringify(audit,null,2);
}catch(error){status.textContent=String(error);(window as any).__FIDELITY_ERROR__=String(error);throw error;}
