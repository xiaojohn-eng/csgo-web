import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AudioEngine} from '../game/audio';
import catalog from '../game/source-pistol-audio.json';

beforeEach(()=>{
 // This suite exercises dispatch; the existing pistol audio suite verifies
 // original WAV hashes and decoding from the staged public assets.
 vi.stubGlobal('fetch',async()=>new Response(null,{status:404}));
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it.each([
 {mode:1 as const,keys:['source_usp_8','source_usp_9','source_usp_10'],gain:.7,event:'weapon_usp.silencedshot'},
 {mode:0 as const,keys:['source_usp_19','source_usp_20','source_usp_21'],gain:.8,event:'weapon_usp.single'},
])('selects only original USP shot variants for accepted mode $mode',async({mode,keys,gain,event})=>{
 const audio=new AudioEngine({legacySamples:false});await audio.loading;
 const sample=vi.spyOn(audio,'sample').mockReturnValue(true),random=vi.spyOn(Math,'random');
 const position={x:7,y:1.6,z:-3};
 expect(catalog.weapons.usp.records.filter(row=>row.event===event).map(row=>row.key)).toEqual(keys);
 for(let i=0;i<keys.length;i++){
  random.mockReturnValue((i+.5)/keys.length);sample.mockClear();
  audio.shot('usp',.5,-.2,position,true,mode);
  expect(sample).toHaveBeenCalledExactlyOnceWith(keys[i],.5*gain,-.2,position,true,1);
 }
 audio.dispose();
});

it('plays each accepted shot mode independently as delayed reports arrive',async()=>{
 const audio=new AudioEngine({legacySamples:false});await audio.loading;
 const sample=vi.spyOn(audio,'sample').mockReturnValue(true);vi.spyOn(Math,'random').mockReturnValue(0);
 for(const mode of [1,0,1]as const)audio.shot('usp',1,0,undefined,false,mode);
 expect(sample.mock.calls.map(call=>call[0])).toEqual(['source_usp_8','source_usp_19','source_usp_8']);
 audio.dispose();
});

it('keeps old shot callers working and defaults a USP without mode to its attached state',async()=>{
 const audio=new AudioEngine({legacySamples:false});await audio.loading;
 const sample=vi.spyOn(audio,'sample').mockReturnValue(true);vi.spyOn(Math,'random').mockReturnValue(0);
 audio.shot('glock',.5);expect(sample.mock.calls[0]?.[0]).toBe('source_glock_6');
 sample.mockClear();audio.shot('usp',.5);
 expect(sample).toHaveBeenCalledExactlyOnceWith('source_usp_8',.35,0,undefined,false,1);
 audio.dispose();
});

it('does not replace a missing original USP shot with synthesis or animation sounds',async()=>{
 const audio=new AudioEngine({legacySamples:false});await audio.loading;
 const sample=vi.spyOn(audio,'sample').mockReturnValue(false),tone=vi.spyOn(audio,'tone'),hiss=vi.spyOn(audio,'hiss');
 vi.spyOn(Math,'random').mockReturnValue(0);
 audio.shot('usp',1,0,undefined,false,0);
 expect(sample).toHaveBeenCalledExactlyOnceWith('source_usp_19',.8,0,undefined,false,1);
 expect(tone).not.toHaveBeenCalled();expect(hiss).not.toHaveBeenCalled();
 audio.dispose();
});
