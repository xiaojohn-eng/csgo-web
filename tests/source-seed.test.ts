import fs from 'node:fs';
import {expect,it} from 'vitest';
import {sourceCommandSeed,sourceServerSeed} from '../game/source-seed';
const original=fs.existsSync('output/tests/source-seed-native.json')?it:it.skip;
original('matches original MD5 command seed and current-build SHA1 server seed machine code',()=>{
  const oracle=JSON.parse(fs.readFileSync('output/tests/source-seed-native.json','utf8'));
  expect(oracle.status).toBe('original_command_seed_blocks_executed');
  expect(oracle.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');
  expect(oracle.client).toHaveLength(9);expect(oracle.server).toHaveLength(24);
  for(const row of oracle.client)expect(sourceCommandSeed(row.commandNumber)).toBe(row.clientSeed);
  for(const row of oracle.server){
    const seed=sourceServerSeed(row.platformSeconds,row.entropy);
    expect(seed>>>0).toBe(row.serverSeedUnsigned);expect(seed&255).toBe(row.seedByte);
  }
});
it('requires explicit authoritative time and entropy without silently deriving a server seed from command sequence',()=>{
  expect(sourceServerSeed(123.456,1)).not.toBe(sourceServerSeed(123.456,2));
  for(const n of [-1,.5,2**32,NaN])expect(()=>sourceCommandSeed(n)).toThrow();
  for(const time of [-1,NaN,Infinity])expect(()=>sourceServerSeed(time,1)).toThrow();
  for(const n of [-1,.5,2**31,NaN])expect(()=>sourceServerSeed(1,n)).toThrow();
});
