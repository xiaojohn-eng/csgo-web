import type {AudioEngine} from './audio';
import catalog from './source-deagle-audio.json';
import {sourceSha256} from './source-sha256';

/** Explicit Deagle sound owner. The caller awaits readiness before first draw,
 * dispatches original accepted shot events and owns animation audio cursors. */
export async function loadSourceDeagleAudio(audio:AudioEngine,options:{signal?:AbortSignal}={}){
 const {signal}=options,records=catalog.weapons.deagle.records;
 if(audio.disposed)throw Error('Audio engine disposed');
 signal?.throwIfAborted();
 if(typeof OfflineAudioContext==='undefined')throw Error('Original Deagle audio decoder unavailable');
 const decoder=new OfflineAudioContext(1,1,44100),decoded=new Map<string,Promise<AudioBuffer>>();
 const owned=new Map<string,AudioBuffer>(),hashVerified:Record<string,boolean>={};let disposed=false;
 function dispose(){if(disposed)return;disposed=true;for(const[key,buffer]of owned)if(audio.buffers.get(key)===buffer)audio.buffers.delete(key);owned.clear();}
 try{
  const pending=await Promise.allSettled(records.map(async row=>{
   let buffer=decoded.get(row.sha256);
   if(!buffer){buffer=(async()=>{
    const response=await fetch(row.url,{cache:'no-cache',signal});if(!response.ok)throw Error('Deagle sound HTTP '+response.status);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.byteLength!==row.bytes||await sourceSha256(bytes,signal)!==row.sha256)throw Error('Original Deagle sound SHA mismatch');
    return decoder.decodeAudioData(bytes.buffer as ArrayBuffer);
   })();decoded.set(row.sha256,buffer);}
   const value=await buffer;signal?.throwIfAborted();if(audio.disposed)throw Error('Audio engine disposed');
   owned.set(row.key,value);audio.buffers.set(row.key,value);hashVerified[row.key]=true;
  }));
  for(const r of pending)if(r.status==='rejected')throw r.reason;
  signal?.throwIfAborted();if(audio.disposed)throw Error('Audio engine disposed');
  function event(name:string,volume=.65,pan=0,position?:{x:number;y:number;z:number},occluded=false){
   if(disposed||audio.disposed)return false;
   const choices=records.filter(r=>r.event===name.toLowerCase());if(!choices.length)return false;
   const row=choices[Math.floor(Math.random()*choices.length)],pitch=row.pitch[0]+Math.random()*(row.pitch[1]-row.pitch[0]),gain=row.volume[0]+Math.random()*(row.volume[1]-row.volume[0]);
   return audio.sample(row.key,volume*gain,pan,position,occluded,pitch/100);
  }
  return{hashVerified,records,timeline:catalog.weapons.deagle.timeline,event,dispose};
 }catch(error){dispose();throw error;}
}
