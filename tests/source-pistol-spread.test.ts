import {existsSync,readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {sourcePistolSpread,createSourcePistolHandlingState,sourcePistolHandlingUspMode} from '../game/source-pistol-handling';
const path='output/tests/source-pistol-spread-native.json',native=existsSync(path)?it:it.skip;
native('matches 4096 original pistol spread paths including actual R8/Negev exclusion branches',()=>{
 const d=JSON.parse(readFileSync(path,'utf8'));expect(d.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');expect(d.rows).toHaveLength(4096);
 for(const r of d.rows)expect(sourcePistolSpread(r.weapon,r.mode,r.seedByte,r.inaccuracy)).toEqual(r.original);
});
native('matches completed original USP silencer events without resetting accuracy or punch',()=>{
 const d=JSON.parse(readFileSync(path,'utf8'));expect(d.modes).toHaveLength(8);
 for(const r of d.modes){
  const s=createSourcePistolHandlingState('usp-s',{glock18:0,'usp-s':r.beforeMode});s.weapons['usp-s']={penalty:Math.fround(.07),recoilIndex:4,lastShotTime:1,lastUpdateTime:2};
  const next=sourcePistolHandlingUspMode(s,r.enabled?1:0);expect(next.modes['usp-s']).toBe(r.original.mode);expect(r.original.silencerOn).toBe(r.enabled);
  expect({...next.weapons['usp-s'],...next.punch}).toEqual(r.original.state);
 }
});
native('reads the same authority seed byte for primary and queued bullets in one native command scope',()=>{
 const d=JSON.parse(readFileSync(path,'utf8'));expect(d.commandSeeds).toHaveLength(8);
 for(const r of d.commandSeeds){expect(r.original).toEqual({commandGlobal:r.commandSeed>>>0,serverGlobal:r.serverSeed>>>0,bulletBytes:[r.serverSeed&255,r.serverSeed&255,r.serverSeed&255],afterScope:[0xffffffff,0xffffffff]});
  expect(sourcePistolSpread('glock18',1,r.serverSeed,.1)).toEqual(sourcePistolSpread('glock18',1,r.original.bulletBytes[0],.1));
 }
});
