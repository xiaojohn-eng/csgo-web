import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {AudioEngine} from '../game/audio';
import catalog from '../game/source-awp-audio.json';
import {loadSourceAWPAudio} from '../game/source-awp-audio';

const records=catalog.weapons.awp.records;
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

it('verifies all 15 AWP sounds and shares 15 original WAV decodes before draw',async()=>{
 const audio=new AudioEngine({legacySamples:false}),owner=await loadSourceAWPAudio(audio);await audio.loading;
 expect(Object.keys(owner.hashVerified)).toHaveLength(15);expect(decodeCount).toBe(15);
 for(const row of records)expect(audio.buffers.has(row.key)).toBe(true);
 const sample=vi.spyOn(audio,'sample').mockReturnValue(true),random=vi.spyOn(Math,'random').mockReturnValue(0);
 owner.event('Weapon_AWP.Single',.8,0,undefined,false);
 const row=records.find(r=>r.event==='weapon_awp.single')!;expect(sample).toHaveBeenCalledExactlyOnceWith(row.key,.8*row.volume[0],0,undefined,false,row.pitch[0]/100);
 expect(owner.timeline.awp_fire.map(e=>e.event)).toEqual(['weapon_awp.boltback','weapon_awp.boltforward']);expect(records.some(r=>r.event==='weapon_awp.zoom')).toBe(true);expect(records.some(r=>r.event==='default.clipempty_rifle')).toBe(true);owner.dispose();expect(owner.event('Weapon_AWP.Single')).toBe(false);for(const row of records)expect(audio.buffers.has(row.key)).toBe(false);
 sample.mockRestore();random.mockRestore();audio.dispose();
});
it('rejects corrupted AWP audio and removes other completed aliases',async()=>{
 corrupt=true;const audio=new AudioEngine({legacySamples:false});await expect(loadSourceAWPAudio(audio)).rejects.toThrow(/SHA mismatch/);await audio.loading;
 expect(records.some(r=>audio.buffers.has(r.key))).toBe(false);audio.dispose();
});
it('cleans up when disposal occurs during pending original decoding',async()=>{
 hold=new Promise<void>(r=>release=r);const audio=new AudioEngine({legacySamples:false}),pending=loadSourceAWPAudio(audio);
 await vi.waitFor(()=>expect(decodeCount).toBeGreaterThan(0));audio.dispose();release!();await expect(pending).rejects.toThrow('Audio engine disposed');await audio.loading;
 expect(audio.buffers.size).toBe(0);
});
