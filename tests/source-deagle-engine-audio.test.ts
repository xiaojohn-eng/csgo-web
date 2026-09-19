import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AudioEngine} from '../game/audio';
import catalog from '../game/source-deagle-audio.json';
import commands from '../game/source-pistol-command-audio.json';
const records=catalog.weapons.deagle.records;
let decodeCount=0,corrupt=false;
beforeEach(()=>{
 decodeCount=0;corrupt=false;
 vi.stubGlobal('fetch',async(url:string)=>{
  if(![...records,...commands].some(r=>r.url===url))return new Response(null,{status:404});
  const data=await readFile(resolve('public',url.replace(/^\//,'')));if(corrupt&&url===records[0].url)data[20]^=1;
  return new Response(data);
 });
 vi.stubGlobal('OfflineAudioContext',class{async decodeAudioData(data:ArrayBuffer){decodeCount++;return{length:data.byteLength,numberOfChannels:1,sampleRate:44100}as AudioBuffer;}});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it('awaits all original Deagle aliases once and shares each WAV decode before the first draw',async()=>{
 const audio=new AudioEngine({legacySamples:false}),pending=audio.prepareDeagle();expect(audio.prepareDeagle()).toBe(pending);
 await pending;await audio.loading;
 expect(audio.sourceDeagleHashes.size).toBe(22);expect(decodeCount).toBe(21);
 expect(records.every(r=>audio.buffers.has(r.key)&&audio.sourceDeagleHashes.get(r.key))).toBe(true);
 expect(audio.sourcePistolHashes.size).toBe(0);
 const sample=vi.spyOn(audio,'sample').mockReturnValue(true);vi.spyOn(Math,'random').mockReturnValue(0);
 expect(audio.sourcePistolEvent('deagle','Weapon_DEagle.Draw')).toBe(true);
 expect(sample).toHaveBeenCalledExactlyOnceWith('source_deagle_3',.65*.3,0,undefined,false,1);
 audio.dispose();expect(audio.buffers.size).toBe(0);
});
it.each([['source_deagle_13',0],['source_deagle_14',.999]]as const)('routes accepted Deagle shots through %s with original pitch/gain and unchanged spatial arguments',async(key,value)=>{
 const audio=new AudioEngine({legacySamples:false});await audio.loading;
 const sample=vi.spyOn(audio,'sample').mockReturnValue(true),event=vi.spyOn(audio,'sourcePistolEvent');vi.spyOn(Math,'random').mockReturnValue(value);
 const position={x:4,y:1.6,z:-5};audio.shot('deagle',.8,-.25,position,true);
 expect(event).toHaveBeenCalledExactlyOnceWith('deagle','weapon_deagle.single',.8,-.25,position,true);
 expect(sample).toHaveBeenCalledExactlyOnceWith(key,.8,-.25,position,true,1);
 audio.dispose();
});
it('keeps command and timeline dispatch separate from shots with original event parameters',async()=>{
 const audio=new AudioEngine({legacySamples:false});await Promise.all([audio.prepareDeagle(),audio.preparePistolCommands(),audio.loading]);
 const sample=vi.spyOn(audio,'sample').mockReturnValue(true);vi.spyOn(Math,'random').mockReturnValue(.5);
 const position={x:2,y:1,z:9};
 expect(audio.sourcePistolEvent('deagle','Default.ClipEmpty_Pistol',.8,.1,position,true)).toBe(true);
 expect(sample).toHaveBeenLastCalledWith('source_pistol_command_empty',.8,.1,position,true,1);
 expect(audio.sourcePistolEvent('deagle','Weapon_DEagle.WeaponMove1',.6)).toBe(true);
 expect(sample.mock.calls[1][0]).toBe('source_deagle_18');expect(sample.mock.calls[1][1]).toBeCloseTo(.6*.075,12);expect(sample.mock.calls[1][5]).toBe(.995);
 const count=sample.mock.calls.length;expect(audio.sourcePistolEvent('deagle','Weapon_USP.Single')).toBe(false);expect(sample).toHaveBeenCalledTimes(count);
 audio.shot('deagle');expect(sample).toHaveBeenCalledTimes(count+1);
 audio.dispose();
});
it('does not synthesize or replay animation events when an original Deagle shot is unavailable',async()=>{
 const audio=new AudioEngine({legacySamples:false});await audio.loading;
 const sample=vi.spyOn(audio,'sample').mockReturnValue(false),hiss=vi.spyOn(audio,'hiss'),tone=vi.spyOn(audio,'tone');vi.spyOn(Math,'random').mockReturnValue(0);
 audio.shot('deagle',1,0,undefined,false,0);
 expect(sample).toHaveBeenCalledExactlyOnceWith('source_deagle_13',1,0,undefined,false,1);
 expect(hiss).not.toHaveBeenCalled();expect(tone).not.toHaveBeenCalled();audio.dispose();
});
it('rejects a corrupt original Deagle WAV and leaves no verified or decoded partial owner',async()=>{
 corrupt=true;const audio=new AudioEngine({legacySamples:false});await expect(audio.prepareDeagle()).rejects.toThrow(/SHA mismatch/);await audio.loading;
 expect(audio.sourceDeagleHashes.size).toBe(0);expect(records.some(r=>audio.buffers.has(r.key))).toBe(false);audio.dispose();
});
