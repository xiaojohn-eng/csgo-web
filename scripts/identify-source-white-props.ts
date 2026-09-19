/** Exact ray-to-original-triangle identification for the recorded R2 camera.
 * Reads existing GLB only; no image edits, nearest-vertex matching or GPU claim. */
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='.reference-assets/source-exports/dust2/';
const raw=new Uint8Array(readFileSync(root+'props.glb'));
const loader=new GLTFLoader();
loader.register(()=>({name:'IDENTIFICATION_NO_IMAGE_DECODE',loadTexture:async()=>{const t=new T.Texture();t.flipY=false;return t;}}));
const gltf=await loader.parseAsync(raw.buffer,''),metadata=JSON.parse(readFileSync(root+'map-metadata.json','utf8'));
const catalog=JSON.parse(readFileSync('research/source-prop-material-branches.json','utf8'));
gltf.scene.updateMatrixWorld(true);
const samples:[string,string,number,number][]=[
  ['t','large_crate',420,580],['t','upper_crate',420,400],['t','left_window_frame',663,246],['t','right_window_frame',1008,313],
  ['t','cable',841,184],['ct','left_crate',64,506],['ct','hanging_lamp',712,284],
  ['ct','cable',950,255],['ct','cable_precise_1',1000,191],['ct','cable_precise_2',1160,177],['t','cable_precise_1',1000,156],['t','cable_precise_2',600,205],['t','cable_precise_3',800,186],['ct','gate_frame',669,362],
];
const projectedLights:unknown[]=[];
for(const team of ['ct','t']){
  const spawn=metadata.spawns.find((s:{classname:string})=>s.classname===`info_player_${team==='ct'?'counterterrorist':'terrorist'}`);
  const camera=new T.PerspectiveCamera(75,1440/900,.02,2000);camera.position.fromArray(spawn.browserMetresPosition);camera.position.y+=64*.0254;
  camera.lookAt(camera.position.clone().add(new T.Vector3().fromArray(spawn.browserForward)));camera.updateMatrixWorld(true);
  gltf.scene.traverse(object=>{const mesh=object as T.Mesh;if(!mesh.isMesh||Array.isArray(mesh.material)||!/(dust_lights|dust_wire_connectors)\//.test(String(mesh.material.userData.full_path)))return;
    const center=new T.Box3().setFromObject(mesh).getCenter(new T.Vector3()),distance=center.distanceTo(camera.position),projected=center.clone().project(camera);
    if(distance>30||projected.z<0||projected.z>1||Math.abs(projected.x)>1||Math.abs(projected.y)>1)return;
    projectedLights.push({team,mesh:mesh.name,material:mesh.material.userData.full_path,centerPixel:[(projected.x+1)*720,(1-projected.y)*450],distance});
  });
}
const results=samples.map(([team,label,x,y])=>{
  const spawn=metadata.spawns.find((s:{classname:string})=>s.classname===`info_player_${team==='ct'?'counterterrorist':'terrorist'}`);
  const camera=new T.PerspectiveCamera(75,1440/900,.02,2000);
  camera.position.fromArray(spawn.browserMetresPosition);camera.position.y+=64*.0254;
  camera.lookAt(camera.position.clone().add(new T.Vector3().fromArray(spawn.browserForward)));camera.updateMatrixWorld(true);
  const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(x/1440*2-1,1-y/900*2),camera);
  const hits=ray.intersectObject(gltf.scene,true).slice(0,3).map(hit=>{
    const mesh=hit.object as T.Mesh;const material=Array.isArray(mesh.material)?mesh.material[hit.face?.materialIndex??0]:mesh.material;
    let anchor:T.Object3D|null=mesh;while(anchor&&!/^static_prop_\d+$/.test(anchor.name))anchor=anchor.parent;
    const source=material.userData.full_path??material.name;
    const original=catalog.materials.find((m:{source:string})=>m.source===source);
    return {mesh:mesh.name,anchor:anchor?.name,identity:anchor?.userData,distance:hit.distance,point:hit.point.toArray(),
      faceIndex:hit.faceIndex,uv:hit.uv?.toArray(),material:source,displayName:material.name,sourceMaterial:original??null};
  });
  return {team,label,pixel:[x,y],camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray()},hits};
});
const result={method:'Exact Three Raycaster intersections on unchanged original props GLB; original first CT/T spawn at same 1440x900 FOV75 camera',
  originalGLBSha256:createHash('sha256').update(raw).digest('hex'),imagesDecoded:false,
  boundary:'Prop geometry only; no image-alpha test or world occlusion inferred. Target labels are visual hypotheses, nearest actual triangle gives identity.',results,projectedLights};
writeFileSync('research/source-white-props.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({team:r.team,label:r.label,hits:r.hits.map(h=>({anchor:h.anchor,material:h.material,distance:h.distance,parameters:h.sourceMaterial?.parameters}))})),null,2));
console.log(JSON.stringify({projectedLights},null,2));
