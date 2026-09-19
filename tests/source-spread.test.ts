import fs from 'node:fs';
import {expect,it} from 'vitest';
import {SourceUniformRandomStream,sourceRifleSpread,sourceSpreadDirection} from '../game/source-spread';
const original=fs.existsSync('output/tests/source-spread-native.json')?it:it.skip;
original('matches 10400 original vstdlib random values including full shuffle state and signed seed edges',()=>{
  const oracle=JSON.parse(fs.readFileSync('output/tests/source-spread-native.json','utf8'));
  expect(oracle.sourceVstdlibSha256).toBe('bed32bd6bc26d6808b3e003fdf57066e0df884f2b264255450bdc75f64b314af');
  expect(oracle.sequences).toHaveLength(260);
  for(const row of oracle.sequences){
    const random=new SourceUniformRandomStream(row.seed);
    expect(Array.from({length:40},()=>random.randomFloat(-2,7))).toEqual(row.values);
  }
});
original('matches all 1280 original normal rifle offsets and normalized basis directions exactly',()=>{
  const oracle=JSON.parse(fs.readFileSync('output/tests/source-spread-native.json','utf8'));
  expect(oracle.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');
  expect(oracle.rows).toHaveLength(1280);
  let maxError=0;
  for(const row of oracle.rows){
    const result=sourceRifleSpread(row.seedByte,row.inaccuracy,row.spread);
    expect(result.draws).toEqual(row.draws);
    maxError=Math.max(maxError,Math.abs(result.x-row.x),Math.abs(result.y-row.y));
    const direction=sourceSpreadDirection(row.basis,result);
    maxError=Math.max(maxError,...direction.map((value,i)=>Math.abs(value-row.direction[i])));
  }
  expect(maxError).toBe(0);
  fs.writeFileSync('output/tests/source-spread-verification.json',JSON.stringify({randomValues:10400,spreadCases:1280,maxError},null,2)+'\n');
});
it('keeps each shot deterministic and streams isolated, rejecting unsupported input ranges',()=>{
  const a=new SourceUniformRandomStream(12),b=new SourceUniformRandomStream(12);
  const first=a.randomFloat();a.randomFloat();
  expect(b.randomFloat()).toBe(first);
  expect(sourceRifleSpread(4,.01,.02)).toEqual(sourceRifleSpread(4,.01,.02));
  for(const seed of [-1,256,.1,NaN])expect(()=>sourceRifleSpread(seed,.01,.02)).toThrow();
  for(const n of [-1,NaN,Infinity,1.01])expect(()=>sourceRifleSpread(1,n,.02)).toThrow();
  expect(()=>new SourceUniformRandomStream(2**31)).toThrow();
});
