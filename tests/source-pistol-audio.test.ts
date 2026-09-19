import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {AudioEngine} from '../game/audio';
import catalog from '../game/source-pistol-audio.json';
import commands from '../game/source-pistol-command-audio.json';

const records=[...catalog.weapons.glock.records,...catalog.weapons.usp.records];
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
it('prepares original control WAVs separately and plays the native mode sound at script pitch and gain',async()=>{
 const audio=new AudioEngine({legacySamples:false});await audio.preparePistolCommands();await audio.loading;
 expect(audio.sourcePistolCommandHashes.size).toBe(2);for(const row of commands)expect(audio.buffers.has(row.key)).toBe(true);
 const sample=vi.spyOn(audio,'sample').mockReturnValue(true);expect(audio.sourcePistolEvent('glock','Weapon.AutoSemiAutoSwitch',.8)).toBe(true);
 expect(sample).toHaveBeenCalledWith('source_pistol_command_mode',.8,0,undefined,false,1);sample.mockRestore();audio.dispose();
});

it('verifies every pistol alias before readiness and shares identical decoded WAVs',async()=>{
 const audio=new AudioEngine({legacySamples:false});await audio.preparePistols();await audio.loading;
 expect(audio.sourcePistolHashes.size).toBe(34);
 expect([...audio.sourcePistolHashes.values()].every(Boolean)).toBe(true);
 expect(decodeCount).toBe(new Set(records.map(r=>r.sha256)).size);
 for(const row of records){const same=records.filter(r=>r.sha256===row.sha256);for(const alias of same)expect(audio.buffers.get(row.key)).toBe(audio.buffers.get(alias.key));}
 audio.dispose();
});

it('rejects a modified original wave instead of silently using a substitute',async()=>{
 corrupt=true;const audio=new AudioEngine({legacySamples:false});
 await expect(audio.preparePistols()).rejects.toThrow('Original pistol sound checksum differs');
 expect(audio.sourcePistolHashes.has(records[0].key)).toBe(false);await audio.loading;audio.dispose();
});

it('does not publish buffers after disposal while decoding is pending',async()=>{
 hold=new Promise<void>(r=>release=r);const audio=new AudioEngine({legacySamples:false});
 const pending=audio.preparePistols();await vi.waitFor(()=>expect(decodeCount).toBeGreaterThan(0));
 audio.dispose();release!();await expect(pending).rejects.toThrow('Audio engine disposed');await audio.loading;
 expect(audio.buffers.size).toBe(0);expect(audio.sourcePistolHashes.size).toBe(0);
});
