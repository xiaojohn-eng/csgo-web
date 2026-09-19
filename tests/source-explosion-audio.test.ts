import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {AudioEngine} from '../game/audio';
import {Game} from '../game/runtime';
import catalog from '../game/source-explosion-audio.json';
import evidence from '../research/source-explosion-audio.json';
import {loadSourceExplosionAudio} from '../game/source-explosion-audio';
import type {Event} from '../game/types';

let corrupt=false,decodeCount=0;
beforeEach(()=>{
  corrupt=false;decodeCount=0;
  vi.stubGlobal('fetch',async(url:string)=>{
    const data=await readFile(resolve('public',url.replace(/^\//,'')));
    if(corrupt&&url===catalog[0].url)data[20]^=1;
    return new Response(data);
  });
  vi.stubGlobal('OfflineAudioContext',class{
    async decodeAudioData(data:ArrayBuffer){decodeCount++;return{length:data.byteLength}as AudioBuffer;}
  });
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it('stages the three enabled original WAVs and exact original pitch/volume',async()=>{
  expect(evidence.soundScript.sha256).toBe('24833a684bcc0908fe775db74b1dbda4815e6c7ed1a78a59237eab6d1cb34b4d');
  expect(catalog.filter(row=>row.kind==='he').map(row=>row.source)).toEqual([
    'sound/weapons/hegrenade/hegrenade_detonate_02.wav','sound/weapons/hegrenade/hegrenade_detonate_03.wav']);
  for(const row of catalog){
    const bytes=await readFile(resolve('public',row.url.slice(1)));
    expect(bytes.length).toBe(row.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256);
    expect(new TextDecoder().decode(bytes.subarray(0,4))).toBe('RIFF');
    expect(new TextDecoder().decode(bytes.subarray(8,12))).toBe('WAVE');
    expect(row.pitch).toEqual(row.kind==='he'?[97,103]:[100,100]);expect(row.volume).toEqual([1,1]);
  }
});

it('loads before play, maps HE position and keeps C4 SNDLVL_NONE unattenuated',async()=>{
  const audio={buffers:new Map<string,AudioBuffer>(),disposed:false,sample:vi.fn(()=>true)};
  const owner=await loadSourceExplosionAudio(audio);vi.spyOn(Math,'random').mockReturnValue(0);
  expect(decodeCount).toBe(3);expect(Object.keys(owner.hashVerified)).toHaveLength(3);
  const at={x:4,y:-3,z:5};
  expect(owner.event('he',at,0)).toBe(true);
  expect(audio.sample).toHaveBeenLastCalledWith(catalog[0].key,1,0,at,false,.97);
  expect(owner.event('he',at,.999)).toBe(true);
  expect(audio.sample).toHaveBeenLastCalledWith(catalog[1].key,1,0,at,false,.97);
  expect(owner.event('c4',at,0)).toBe(true);
  expect(audio.sample).toHaveBeenLastCalledWith(catalog[2].key,1,0,undefined,false,1);
  expect(owner.played).toEqual({'basegrenade.explode':2,'c4.explode':1});
  owner.dispose();expect(audio.buffers.size).toBe(0);expect(owner.event('he',at)).toBe(false);
});

it('rejects corrupted original audio and rolls back all partially loaded samples',async()=>{
  corrupt=true;const audio={buffers:new Map<string,AudioBuffer>(),disposed:false,sample:vi.fn(()=>true)};
  await expect(loadSourceExplosionAudio(audio)).rejects.toThrow(/SHA mismatch/);
  expect(audio.buffers.size).toBe(0);
});

it('deduplicates AudioEngine preparation and exposes sample verification',async()=>{
  const audio=Object.assign(Object.create(AudioEngine.prototype),{
    buffers:new Map<string,AudioBuffer>(),disposed:false,sourceExplosionHashes:new Map(),
  })as AudioEngine;
  const first=audio.prepareExplosions();expect(audio.prepareExplosions()).toBe(first);await first;
  expect(decodeCount).toBe(3);expect(audio.sourceExplosionHashes.size).toBe(3);
  expect(audio.sourceExplosionAudit()?.hashVerified).toHaveProperty(catalog[0].key,true);
});

it('routes both authority explosion events to original audio and preserves legacy synthesis',()=>{
  const game=Object.assign(Object.create(Game.prototype),{
    sourceScenario:{},art:{explosion:vi.fn()},
    audio:{sourceExplosionEvent:vi.fn(),explosion:vi.fn()},
  })as Game;
  const bomb={x:2,y:-4,z:6};
  game.presentExplosion({id:1,type:'grenade',x:0,y:-3,z:0}as Event,bomb);
  expect(game.audio.sourceExplosionEvent).toHaveBeenLastCalledWith('he',{x:0,y:-3,z:0});
  expect(game.art.explosion).toHaveBeenLastCalledWith(0,0,-3);
  game.presentExplosion({id:2,type:'explode'}as Event,bomb);
  expect(game.audio.sourceExplosionEvent).toHaveBeenLastCalledWith('c4',bomb);
  expect(game.audio.explosion).not.toHaveBeenCalled();
  delete game.sourceScenario;game.presentExplosion({id:3,type:'grenade'}as Event,bomb);
  expect(game.audio.explosion).toHaveBeenCalledOnce();
});
