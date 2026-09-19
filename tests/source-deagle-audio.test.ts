import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {AudioEngine} from '../game/audio';
import catalog from '../game/source-deagle-audio.json';
import {loadSourceDeagleAudio} from '../game/source-deagle-audio';

const records=catalog.weapons.deagle.records;
let corrupt=false,decodeCount=0,hold:Promise<void>|undefined,release:(()=>void)|undefined;
beforeEach(()=>{
 corrupt=false;decodeCount=0;hold=undefined;release=undefined;
 vi.stubGlobal('fetch',async(url:string)=>{
  const data=await readFile(resolve('public',url.replace(/^\//,'')));
  if(corrupt&&url===records[0].url)data[20]^=1;
  return new Response(data);
 });
 vi.stubGlobal('OfflineAudioContext',class{
  async decodeAudioData(data:ArrayBuffer){decodeCount++;await hold;
   return{length:data.byteLength,numberOfChannels:1,sampleRate:44100}as AudioBuffer;
  }
 });
});
afterEach(()=>{release?.();vi.unstubAllGlobals();});

it('verifies all 22 Deagle aliases and shares 21 original WAV decodes before draw',async()=>{
 const audio=new AudioEngine({legacySamples:false}),owner=await loadSourceDeagleAudio(audio);await audio.loading;
 expect(Object.keys(owner.hashVerified)).toHaveLength(22);expect(decodeCount).toBe(21);
 for(const row of records)expect(audio.buffers.has(row.key)).toBe(true);
 const sample=vi.spyOn(audio,'sample').mockReturnValue(true),random=vi.spyOn(Math,'random').mockReturnValue(0);
 owner.event('Weapon_DEagle.Single',.8,0,undefined,false);
 const row=records.find(r=>r.event==='weapon_deagle.single')!;expect(sample).toHaveBeenCalledExactlyOnceWith(row.key,.8*row.volume[0],0,undefined,false,row.pitch[0]/100);
 expect(owner.timeline.lookat02).toHaveLength(9);owner.dispose();expect(owner.event('Weapon_DEagle.Single')).toBe(false);for(const row of records)expect(audio.buffers.has(row.key)).toBe(false);
 sample.mockRestore();random.mockRestore();audio.dispose();
});
it('rejects corrupted Deagle audio and removes other completed aliases',async()=>{
 corrupt=true;const audio=new AudioEngine({legacySamples:false});await expect(loadSourceDeagleAudio(audio)).rejects.toThrow(/SHA mismatch/);await audio.loading;
 expect(records.some(r=>audio.buffers.has(r.key))).toBe(false);audio.dispose();
});
it('cleans up when disposal occurs during pending original decoding',async()=>{
 hold=new Promise<void>(r=>release=r);const audio=new AudioEngine({legacySamples:false}),pending=loadSourceDeagleAudio(audio);
 await vi.waitFor(()=>expect(decodeCount).toBeGreaterThan(0));audio.dispose();release!();await expect(pending).rejects.toThrow('Audio engine disposed');await audio.loading;
 expect(audio.buffers.size).toBe(0);
});
