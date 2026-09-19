import {prepareSourcePistolParticleGraph,sourcePistolParticleParameters,decodeSourcePistolParticleSheet,type SourceParticleNativeDefaults} from '../game/source-pistol-particles-graph';
import {loadSourcePistolParticleRenderer} from '../game/source-pistol-particles-renderer';
import {ArrowHelper,Color,GridHelper,PerspectiveCamera,Scene,Vector3,WebGLRenderer} from 'three';
const base='/data/',get=async(path:string)=>{const r=await fetch(base+path);if(!r.ok)throw Error(path+' HTTP '+r.status);return r;};
const [raw,native]=await Promise.all([(await get('graph.json')).json(),(await get('native-defaults.json')).json()]);
const graph=prepareSourcePistolParticleGraph(raw),defaults=native as SourceParticleNativeDefaults;
const system=document.querySelector('#system')as unknown as HTMLSelectElement,details=document.querySelector('#details')!,status=document.querySelector('#status')!,gallery=document.querySelector('#gallery')!;
for(const item of graph.systems.values()){const option=document.createElement('option');option.value=item.name;option.textContent=item.name;system.appendChild(option);}
system.value='weapon_muzzle_flash_pistol_main';
function show(){const name=system.value,source=graph.systems.get(name)!;
 const resolved=['emitters','initializers','operators','renderers'].map(phase=>({phase,operators:graph.phase(name,phase as 'operators').map(e=>sourcePistolParticleParameters(e,defaults))}));
 details.textContent=JSON.stringify({system:source.name,explicitPCF:source.attributes,resolvedOperators:resolved},null,2);
}system.onchange=show;show();
const decoded=[];
for(const texture of graph.data.textures){
 const card=document.createElement('article'),heading=document.createElement('h3'),img=new Image();heading.textContent=texture.source;img.src=base+texture.images[0].file.path;img.alt=texture.source;
 await img.decode();card.appendChild(heading);card.appendChild(img);const meta=document.createElement('p');meta.textContent=`${texture.width} × ${texture.height} · 原 VTF → 无损 PNG · ${texture.images[0].file.sha256.slice(0,16)}`;card.appendChild(meta);
 for(const resource of texture.resources)if(resource.sheetFile){
  const sheet=decodeSourcePistolParticleSheet(new Uint8Array(await(await get(resource.sheetFile.path)).arrayBuffer()));decoded.push({source:texture.source,sequences:sheet.sequences.length,frames:sheet.sequences.reduce((n,s)=>n+s.frames.length,0)});
  const sequence=document.createElement('select'),frame=document.createElement('input'),canvas=document.createElement('canvas'),label=document.createElement('p');canvas.width=canvas.height=192;frame.type='range';frame.min='0';frame.step='1';
  for(const s of sheet.sequences){const option=document.createElement('option');option.value=String(s.id);option.textContent=`序列 ${s.id} · ${s.frames.length} 帧`;sequence.appendChild(option);}
  function draw(){const s=sheet.sequences.find(s=>s.id===Number(sequence.value))!;frame.max=String(s.frames.length-1);if(Number(frame.value)>s.frames.length-1)frame.value='0';
   const index=Number(frame.value),uv=s.frames[index].images[0],ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,192,192);
   ctx.drawImage(img,uv[0]*img.width,uv[1]*img.height,(uv[2]-uv[0])*img.width,(uv[3]-uv[1])*img.height,0,0,192,192);label.textContent=`原 sheet 图块 ${s.id}/${index}；UV ${uv.join(', ')}`;
  }frame.value='0';sequence.onchange=()=>{frame.value='0';draw();};frame.oninput=draw;draw();for(const node of [sequence,frame,canvas,label])card.appendChild(node);
 }
 gallery.appendChild(card);
}
status.textContent=`10 个原系统 · 124 个元素 · 27 类原算子定义 · 5 份材质 · 4 张纹理 · 原默认值 getter 已执行`;
const canvas=document.querySelector('#particle-canvas')as HTMLCanvasElement,renderer=new WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(920,440,false);
const scene=new Scene();scene.background=new Color('#182027');const camera=new PerspectiveCamera(44,920/440,.001,20);camera.position.set(.23,.24,1.4);camera.lookAt(.15,0,0);
const grid=new GridHelper(1.6,16,'#52616e','#303e48');grid.position.y=-.18;scene.add(grid);
const fx=await loadSourcePistolParticleRenderer('/data/'),direction=new Vector3(1,0,0),arrow=new ArrowHelper(direction,new Vector3(),.52,0x5ac8bd,.04,.02);scene.add(fx.group,arrow);
const clock=document.querySelector('#clock')as HTMLInputElement,yaw=document.querySelector('#yaw')as HTMLInputElement,playing=document.querySelector('#playing')as HTMLInputElement,mode=document.querySelector('#mode')as unknown as HTMLSelectElement,
 readout=document.querySelector('#readout')!,replay=document.querySelector('#replay')as HTMLButtonElement;
let born=performance.now(),proofHeld=false;
function fire(){proofHeld=false;fx.clear();const a=Number(yaw.value)*Math.PI/180;direction.set(Math.cos(a),0,Math.sin(a));arrow.setDirection(direction);fx.fire({position:new Vector3(),forward:direction},0,{main:740,core:740});born=performance.now();}
replay.onclick=()=>{playing.checked=true;fire();};yaw.oninput=fire;clock.oninput=()=>{playing.checked=false;};fire();
const proof={status:'original-main-core-renderer-ready',systems:graph.systems.size,elements:graph.elements.size,functions:graph.functionNames.length,nativeDefaults:defaults.status,
 textureSizes:graph.data.textures.map(t=>[t.width,t.height]),sheets:decoded,particleRendererImplemented:'main/core bounded slice',limitations:fx.program.limitations,loadedImages:true,current:{} as unknown};
(window as unknown as {__sourcePistolParticleProof:unknown}).__sourcePistolParticleProof=proof;
(window as unknown as {__sourcePistolParticleControl:unknown}).__sourcePistolParticleControl={run(deltas:number[],angle=0,seed=740){
 proofHeld=true;playing.checked=false;fx.clear();const radians=angle*Math.PI/180;direction.set(Math.cos(radians),0,Math.sin(radians));arrow.setDirection(direction);
 fx.fire({position:new Vector3(),forward:direction},0,{main:seed,core:seed});let now=0;const frames=[];
 for(const delta of deltas){now+=delta;frames.push(fx.update(now));}
 proof.current=frames.at(-1);renderer.render(scene,camera);readout.textContent='原时间门控验证：'+JSON.stringify((proof.current as {clocks:unknown}).clocks);return frames;
 }};
function render(){
 if(proofHeld){requestAnimationFrame(render);return;}
 if(playing.checked){const t=(performance.now()-born)%2000;clock.value=String(Math.min(40,t/40));}
 const time=Number(clock.value)/1000;proof.current=fx.update(time);
 fx.group.children[0].visible=mode.value!=='core';fx.group.children[1].visible=mode.value!=='main';renderer.render(scene,camera);
 readout.textContent=`${(time*1000).toFixed(2)} ms · ${(proof.current as {counts:{main:number;core:number}}).counts.main} main + ${(proof.current as {counts:{main:number;core:number}}).counts.core} core · 40 倍慢放 · 枪口 +X = ${direction.toArray().map(n=>n.toFixed(2)).join(', ')}`;
 requestAnimationFrame(render);
}render();
