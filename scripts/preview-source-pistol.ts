import * as T from 'three';
import {loadSourcePistolViewmodel,inspectSourcePistolViewmodel,sourcePistolAttachment,type SourcePistolWeapon,type SourcePistolTeam} from '../game/source-pistol-viewmodel';
import {AudioEngine} from '../game/audio';
import soundCatalog from '../game/source-pistol-audio.json';
import {advanceSourceSoundEvents,type SourceSoundCursor} from '../game/source-sound-timeline';
const canvas=document.querySelector('canvas')!,status=document.querySelector('#status')!;
const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false});renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
const scene=new T.Scene();scene.background=new T.Color('#26333f');
const camera=new T.PerspectiveCamera(70,innerWidth/innerHeight,.01,20);
scene.add(new T.HemisphereLight('#cfdef0','#6e634c',.35));const light=new T.DirectionalLight('#ffdfb3',3.1);light.position.set(-1,2,1);scene.add(light);
let owner:Awaited<ReturnType<typeof loadSourcePistolViewmodel>>|null=null,gun:T.Group|null=null,generation=0;
let sequence='',time=0,playing=false,attached=true,last=performance.now(),soundGeneration=0;
let soundCursor:SourceSoundCursor|undefined,audioReady=false;
const audio=new AudioEngine({legacySamples:false});
void Promise.all([audio.prepare(true),audio.preparePistols()]).then(()=>{audioReady=true;(document.querySelector('#play') as HTMLButtonElement).disabled=false;}).catch(error=>{status.textContent=String(error);});
// The workspace also includes Cloudflare HTMLRewriter's global select type.
// Use the DOM capabilities this preview actually consumes.
type DOMSelect=HTMLElement&Pick<HTMLInputElement,'value'|'onchange'>;
const weapon=document.querySelector('#weapon') as DOMSelect,team=document.querySelector('#team') as DOMSelect,clip=document.querySelector('#clip') as DOMSelect;
const timeline=document.querySelector('#time') as HTMLInputElement;
function render(){if(owner&&gun)owner.sampleViewmodel(gun,{sequence,timeSeconds:time,silencerAttached:attached});renderer.render(scene,camera);}
function sample(name:string,seconds:number,silencerAttached=true){if(!owner)throw Error('Pistol is not loaded');sequence=name;time=seconds;attached=silencerAttached;playing=false;clip.value=name;timeline.value=String(seconds);render();return audit();}
function audit(){return{loaded:!!gun,hashVerified:owner?.hashVerified??false,weapon:owner?.weaponId,team:owner?.team,detail:gun?inspectSourcePistolViewmodel(gun):null,
  audio:{ready:audioReady,hashes:Object.fromEntries(audio.sourcePistolHashes),decoded:[...audio.buffers.keys()].filter(k=>k.startsWith('source_glock_')||k.startsWith('source_usp_')),events:audio.sourceEvents,playing,context:audio.ctx?.state},
  attachment:gun?sourcePistolAttachment(gun,'1',camera).elements:null,memory:{...renderer.info.memory,programs:renderer.info.programs?.length},draw:{...renderer.info.render},scope:'Original first-person owner, fixed source-time sampling; neutral preview lights, no gameplay state machine'};}
function unload(){++generation;owner?.dispose();owner=null;gun=null;playing=false;clip.replaceChildren();render();status.textContent='已卸载';return audit();}
async function load(w:SourcePistolWeapon,t:SourcePistolTeam){unload();const token=generation;status.textContent='校验原始资源…';const next=await loadSourcePistolViewmodel({weapon:w,team:t});if(token!==generation){next.dispose();return;}
  owner=next;gun=next.createViewmodel();scene.add(gun);weapon.value=w;team.value=t;
  for(const row of Object.values(owner.manifest.clips)){const option=document.createElement('option');option.value=row.sourceSequence;option.textContent=row.sourceSequence+' · '+row.activity;clip.appendChild(option);}
  sequence=w==='glock'?'glock_idle':'idle';time=0;attached=true;clip.value=sequence;render();status.textContent='原文件校验通过 · '+w+' / '+t;return audit();}
weapon.onchange=team.onchange=()=>{void load(weapon.value as SourcePistolWeapon,team.value as SourcePistolTeam).catch(e=>{status.textContent=String(e);});};
clip.onchange=()=>{sequence=clip.value;time=0;playing=false;render();};timeline.oninput=()=>{sample(sequence,Number(timeline.value),attached);};
(document.querySelector('#play') as HTMLButtonElement).onclick=()=>{if(!audioReady||!owner)return;audio.unlock();time=0;playing=true;soundCursor=undefined;soundGeneration++;};
(document.querySelector('#stop') as HTMLButtonElement).onclick=()=>{playing=false;};
(document.querySelector('#unload') as HTMLButtonElement).onclick=unload;
function frame(now:number){const dt=Math.min(.05,(now-last)/1000);last=now;if(playing&&owner){time+=dt;const d=Object.values(owner.manifest.clips).find(c=>c.sourceSequence===sequence)!.duration;if(time>d){time=d;playing=false;}timeline.value=String(time);
  const eventTimeline=soundCatalog.weapons[owner.weaponId].timeline as Record<string,{time:number;event:string}[]>;
  const sampled=advanceSourceSoundEvents(soundCursor,{pose:sequence,time,generation:soundGeneration},eventTimeline[sequence]??[]);soundCursor=sampled.cursor;
  sampled.events.forEach(event=>audio.sourcePistolEvent(owner!.weaponId,event));
}render();requestAnimationFrame(frame);}requestAnimationFrame(frame);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
(window as unknown as Record<string,unknown>).__SOURCE_PISTOL_PREVIEW__={load,sample,unload,audit,disposeAudio:()=>{playing=false;audio.dispose();return audit();}};
void load('glock','t').catch(e=>{status.textContent=String(e);});
