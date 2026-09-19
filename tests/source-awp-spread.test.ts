import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {sourceAWPSpread} from '../game/source-awp-accuracy';
const oracle=JSON.parse(readFileSync('output/tests/source-awp-spread-native.json','utf8'));
it('matches both AWP modes through all 256 native seed bytes and R8/Negev exclusion branches',()=>{
 expect(oracle.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');expect(oracle.rows).toHaveLength(2048);
 for(const row of oracle.rows)expect(sourceAWPSpread(row.mode,row.seedByte,row.inaccuracy)).toEqual(row.original);
});
it('retains separate original command and server seeds including signed integer boundaries',()=>{
 expect(oracle.commandSeeds).toHaveLength(8);
 for(const row of oracle.commandSeeds){
  expect(row.original).toEqual({commandGlobal:row.commandSeed>>>0,serverGlobal:row.serverSeed>>>0,bulletBytes:[row.serverSeed&255,row.serverSeed&255,row.serverSeed&255],afterScope:[0xffffffff,0xffffffff]});
  expect(sourceAWPSpread(1,row.serverSeed,.1)).toEqual(sourceAWPSpread(1,row.serverSeed&255,.1));
 }
});
