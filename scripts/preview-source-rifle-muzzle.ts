/** The original rifle third-person muzzle, baked at fixed clock times so a 15 ms
 * effect can actually be looked at.
 *
 * It draws the same original programs and the same staged bytes the game draws:
 * the `weapon_muzzle_flash_assaultrifle_vent` sprite, the `_glow` flare and the
 * `_main` rolling flame, spread along the barrel axis (local +X) from the
 * dispatcher's own control point. The page prints what each frame drew so the
 * image and the numbers travel together, and exposes a control hook that steps
 * exact deltas instead of relying on the browser's own timing.
 */
import {ArrowHelper,Color,GridHelper,PerspectiveCamera,Scene,Vector3,WebGLRenderer} from 'three';
import {decodeSourcePistolParticleSheet,prepareSourcePistolParticleGraph,type SourceParticleNativeDefaults} from '../game/source-pistol-particles-graph';
import {loadSourceRifleMuzzleRenderer} from '../game/source-rifle-muzzle-renderer';
import {loadSourceAwpMuzzleRenderer} from '../game/source-awp-muzzle-renderer';
import {SOURCE_RIFLE_MUZZLE_LIMITATIONS,SOURCE_AWP_MUZZLE_LIMITATIONS} from '../game/source-rifle-muzzle-particles';

const base='/data/',get=async(path:string)=>{const r=await fetch(base+path);if(!r.ok)throw Error(path+' HTTP '+r.status);return r;};
const [raw,native]=await Promise.all([(await get('graph.json')).json(),(await get('native-defaults.json')).json()]);
const graph=prepareSourcePistolParticleGraph(raw),defaults=native as SourceParticleNativeDefaults;
const status=document.querySelector('#status')!,gallery=document.querySelector('#gallery')!;
// Every original texture this closure ships, next to the sheet frames the flame's own
// system addresses, so the atlas and the rect the flame uses can be compared by eye.
const sheets:unknown[]=[];
for(const texture of graph.data.textures){
 const card=document.createElement('article'),heading=document.createElement('h3'),img=new Image();
 heading.textContent=texture.source;img.src=base+texture.images[0].file.path;img.alt=texture.source;
 // A texture the closure ships but no ported subsystem draws is not staged, so its
 // image may be absent: the card says so instead of failing the whole page.
 let decodedImage=true;
 try{await img.decode();}catch{decodedImage=false;}
 card.appendChild(heading);
 if(decodedImage)card.appendChild(img);
 const meta=document.createElement('p');
 meta.textContent=`${texture.width} × ${texture.height} · `
  +(decodedImage?`原 VTF → PNG · ${texture.images[0].file.sha256.slice(0,16)}`:'此贴图尚未入库（无已移植子系统使用）');
 card.appendChild(meta);
 for(const resource of texture.resources)if(resource.sheetFile){
  let bytes:Uint8Array;
  try{bytes=new Uint8Array(await(await get(resource.sheetFile.path)).arrayBuffer());}
  catch{const note=document.createElement('p');note.textContent='该图集字节尚未入库';card.appendChild(note);continue;}
  const sheet=decodeSourcePistolParticleSheet(bytes);
  sheets.push({source:texture.source,sequences:sheet.sequences.length,frames:sheet.sequences.reduce((n,s)=>n+s.frames.length,0)});
  const label=document.createElement('p');
  if(!decodedImage){label.textContent=`原图集：${sheet.sequences.length} 序列 / ${sheet.sequences.reduce((n,s)=>n+s.frames.length,0)} 帧（图像未入库，仅解码结构）`;card.appendChild(label);continue;}
  // The flame asks this sheet for sequences 5..18, and the sheet holds five, so the
  // original fixup lands every request on the first sequence. Its sixteen frames are
  // drawn here as one strip: the atlas really does hold the whole fire animation.
  const sequence=sheet.sequences[0],side=64,strip=document.createElement('canvas');
  strip.width=Math.max(1,sequence.frames.length)*side;strip.height=side;
  const ctx=strip.getContext('2d')!;
  for(const [index,frame] of sequence.frames.entries()){
   const uv=frame.images[0];
   ctx.drawImage(img,uv[0]*img.width,uv[1]*img.height,(uv[2]-uv[0])*img.width,(uv[3]-uv[1])*img.height,
    index*side,0,side,side);
  }
  label.textContent=`原 sheet：${sheet.sequences.length} 序列 / ${sheet.sequences.reduce((n,s)=>n+s.frames.length,0)} 帧；`
   +`序列 ${sequence.id} 共 ${sequence.frames.length} 帧（左起），首帧 UV ${sequence.frames[0].images[0].map(v=>v.toFixed(4)).join(', ')}`;
  card.appendChild(strip);card.appendChild(label);
 }
 gallery.appendChild(card);
}
const dispatcher=graph.systems.get('weapon_muzzle_flash_assaultrifle')!;
status.textContent=`${graph.systems.size} 个原系统 · ${graph.data.textures.length} 张原纹理 · `
 +`派发器 ${(dispatcher.attributes.children as unknown[]).length} 个子系 · 原默认值 getter 已执行（${defaults.status}）`;
const canvas=document.querySelector('#particle-canvas')as HTMLCanvasElement,renderer=new WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(1080,460,false);
const scene=new Scene();scene.background=new Color('#141b21');
const camera=new PerspectiveCamera(42,1080/460,.001,40);camera.position.set(.34,.46,1.2);camera.lookAt(.19,-.09,0);
const grid=new GridHelper(2,20,'#4b5a66','#2b3740');grid.position.set(.25,-.13,0);scene.add(grid);
const fx=await loadSourceRifleMuzzleRenderer('/data/',{capacity:64});
const direction=new Vector3(1,0,0),arrow=new ArrowHelper(direction,new Vector3(),.6,0x6ad2c8,.05,.025);
scene.add(fx.group,arrow);
const clock=document.querySelector('#clock')as HTMLInputElement,yaw=document.querySelector('#yaw')as HTMLInputElement,
 playing=document.querySelector('#playing')as HTMLInputElement,mode=document.querySelector('#mode')as unknown as HTMLSelectElement,
 readout=document.querySelector('#readout')!,replay=document.querySelector('#replay')as HTMLButtonElement;
let born=performance.now(),held=false,current:unknown={};
function fire(){
 held=false;fx.clear();
 const angle=Number(yaw.value)*Math.PI/180;direction.set(Math.cos(angle),0,Math.sin(angle));arrow.setDirection(direction);
 fx.fire({position:new Vector3(),forward:direction},0,{vent:740});
 born=performance.now();
}
replay.onclick=()=>{playing.checked=true;fire();};
yaw.oninput=fire;
clock.oninput=()=>{playing.checked=false;};
fire();
const proof={status:'original-assaultrifle-muzzle-renderer-ready',systems:graph.systems.size,elements:graph.data.elements.length,
 nativeDefaults:defaults.status,sheets,limitations:SOURCE_RIFLE_MUZZLE_LIMITATIONS,
 configuration:{vent:fx.program.configuration,glow:fx.glow.configuration,flame:fx.flame.configuration,
   continuousFlame:fx.continuous.configuration},
 particleRendererImplemented:'vent, glow, _main flame and the dispatcher\'s other flame',current:{}as unknown};
(window as unknown as {__sourceRifleMuzzleProof:unknown}).__sourceRifleMuzzleProof=proof;
(window as unknown as {__sourceRifleMuzzleControl:unknown}).__sourceRifleMuzzleControl={
 /** Fire once and step exact deltas, so the bake does not depend on frame timing. */
 run(deltas:number[],angle=0,seed=740){
  held=true;playing.checked=false;fx.clear();
  const radians=angle*Math.PI/180;direction.set(Math.cos(radians),0,Math.sin(radians));arrow.setDirection(direction);
  fx.fire({position:new Vector3(),forward:direction,up:new Vector3(0,1,0)},0,{vent:seed});
  let now=0;const frames=[];
  for(const delta of deltas){now+=delta;frames.push(fx.update(now));}
  proof.current=frames.at(-1)as unknown;
  // The bake is the rendered frame, not just the numbers: draw it before returning.
  renderer.render(scene,camera);
  readout.textContent=readoutFor(frames.at(-1)as Frame);
  return frames;
 }};
type Frame={count:number;glowCount:number;flameCount:number;continuousCount:number;dropped:number;
 particles:{radius:number;alpha:number}[];flame:{distance:number;radius:number;alpha:number;sequence:number;frame:number}[];
 continuous:{distance:number;radius:number;alpha:number;sequence:number;frame:number}[]};
function readoutFor(frame:Frame){
 const flame=frame.flame??[],continuous=frame.continuous??[];
 const span=flame.length?`${(Math.min(...flame.map(f=>f.distance))*.0254).toFixed(3)}–${(Math.max(...flame.map(f=>f.distance))*.0254).toFixed(3)} m`:'—';
 return `vent ${frame.count} · glow ${frame.glowCount} · flame ${frame.flameCount}（丢弃 ${frame.dropped}）`
  +` · 火焰半径 ${flame.length?`${Math.min(...flame.map(f=>f.radius)).toFixed(3)}–${Math.max(...flame.map(f=>f.radius)).toFixed(3)}`:'—'} m`
  +` · alpha ${flame.length?`${Math.min(...flame.map(f=>f.alpha)).toFixed(3)}–${Math.max(...flame.map(f=>f.alpha)).toFixed(3)}`:'—'}`
  +` · 距枪口 ${span} · 图集序列 ${flame.length?[...new Set(flame.map(f=>f.sequence))].join('/'):'—'}`
  // The dispatcher's other flame emits continuously, so it is reported separately: it
  // sweeps out as its particles are born rather than all appearing on the shot.
  +` · 连续火焰 ${frame.continuousCount}（半径 ${continuous.length?`${Math.min(...continuous.map(f=>f.radius)).toFixed(3)}–${Math.max(...continuous.map(f=>f.radius)).toFixed(3)}`:'—'} m`
  +` · alpha ${continuous.length?`${Math.min(...continuous.map(f=>f.alpha)).toFixed(3)}–${Math.max(...continuous.map(f=>f.alpha)).toFixed(3)}`:'—'}`
  +` · 到 ${continuous.length?(Math.max(...continuous.map(f=>f.distance))*.0254).toFixed(3):'—'} m）`;
}
function render(){
 if(held){requestAnimationFrame(render);return;}
 if(playing.checked){const t=(performance.now()-born)%2000;clock.value=String(Math.min(40,t/40));}
 const time=Number(clock.value)/1000;const frame=fx.update(time)as Frame;
 const flameMesh=fx.group.children[2]as {visible:boolean},glowMesh=fx.group.children[1]as {visible:boolean},
  continuousMesh=fx.group.children[3]as {visible:boolean};
 flameMesh.visible=mode.value!=='vent';glowMesh.visible=mode.value!=='vent';
 continuousMesh.visible=mode.value!=='vent';
 renderer.render(scene,camera);
 readout.textContent=`${(time*1000).toFixed(2)} ms · ${readoutFor(frame)} · ${awpReadout(time)} · 40 倍慢放`;
 requestAnimationFrame(render);
}
// The AWP's own dispatcher: the hunting rifle's continuous flame and the flare it
// parents, on its own graph, atlases and batch recipes. It is drawn beside the rifle's
// from the same view so both original chains can be compared directly.
const awp=await loadSourceAwpMuzzleRenderer('/data/',{capacity:64});
awp.group.position.set(0,-.17,0);scene.add(awp.group);
function awpReadout(seconds:number){
 const frame=awp.update(seconds);
 return `AWP flame ${frame.flameCount} · glow ${frame.glowCount}`;
}
function fireAwp(angle=0){
 const radians=angle*Math.PI/180;awp.clear();
 awp.fire({position:new Vector3(0,-.17,0),forward:new Vector3(Math.cos(radians),0,Math.sin(radians)),up:new Vector3(0,1,0)},0,{awp:740});
}
(window as unknown as {__sourceAwpMuzzleControl:unknown}).__sourceAwpMuzzleControl={
 run(deltas:number[],angle=0,seed=740){
  held=true;playing.checked=false;awp.clear();
  const radians=angle*Math.PI/180;
  awp.fire({position:new Vector3(0,-.17,0),forward:new Vector3(Math.cos(radians),0,Math.sin(radians)),up:new Vector3(0,1,0)},0,{awp:seed});
  let now=0;const frames=[];
  for(const delta of deltas){now+=delta;frames.push(awp.update(now));}
  renderer.render(scene,camera);
  const frame=frames.at(-1) as {flameCount:number;glowCount:number;dropped:number;
   flame:{distance:number;radius:number;alpha:number;sequence:number;frame:number}[];glow:{distance:number;radius:number;alpha:number}[]};
  return {flameCount:frame.flameCount,glowCount:frame.glowCount,dropped:frame.dropped,
   flame:frame.flame.map(row=>({distance:+row.distance.toFixed(3),radius:+row.radius.toFixed(3),alpha:+row.alpha.toFixed(3),sequence:row.sequence,frame:row.frame})),
   glow:frame.glow.map(row=>({distance:+row.distance.toFixed(3),radius:+row.radius.toFixed(3),alpha:+row.alpha.toFixed(3)}))};
 }};
// Fire the AWP once for the animated view as well, and let the replay button restart it.
replay.addEventListener('click',()=>fireAwp());
fireAwp();
(window as unknown as {__sourceAwpMuzzleProof:unknown}).__sourceAwpMuzzleProof={status:'original-awp-muzzle-renderer-ready',
 configuration:{flame:awp.flame.configuration,glow:awp.glow.configuration},limitations:SOURCE_AWP_MUZZLE_LIMITATIONS};
render();
