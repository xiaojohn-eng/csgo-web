import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {createSourceWind,updateSourceWind,restoreSourceWind,DUST2_WIND_PARAMETERS} from '../game/source-wind';

const oracle=JSON.parse(readFileSync(new URL('../output/tests/source-wind-native.json',import.meta.url),'utf8'));
const init={seed:0,startTime:0,initialDirection:0,initialSpeed:0};
function compare(actual:any,expected:any,path='state'){
  if(Array.isArray(expected)){expect(actual.length,path).toBe(expected.length);expected.forEach((v,i)=>compare(actual[i],v,`${path}.${i}`));}
  else if(expected!==null&&typeof expected==='object')for(const [k,v]of Object.entries(expected))compare(actual[k],v,`${path}.${k}`);
  else if(typeof expected==='number'){
    const vector=/currentWind|currentSway|previousSway|renderParameter3/.test(path);
    expect(Math.abs(actual-expected),path).toBeLessThanOrEqual(vector?1e-6:0);
  }else expect(actual,path).toEqual(expected);
}
describe('App740 original CEnvWindShared client/native parity',()=>{
  for(const sample of oracle.cases)it(`${sample.name}: original scalar, RNG, cache and gust events`,()=>{
    const state=createSourceWind(sample.config,{...init,...sample.init});
    if(sample.initial)compare(state,sample.initial);
    for(const row of sample.rows){
      const out=updateSourceWind(state,row.time);
      compare(state,row.state);
      expect(out.nextThinkTime).toBe(row.nextThink);
      compare(out.events,row.events,'events');
      compare(out.windSourceXY,row.state.renderParameter3.slice(0,2),'renderParameter3');
      expect(out.timeSeconds).toBe(row.time);
    }
  });
  it('JSON restoration preserves both shuffled streams and cached preceding-frame wind',()=>{
    const a=createSourceWind(DUST2_WIND_PARAMETERS,init);
    for(let i=0;i<=611;i++)updateSourceWind(a,i/60);
    const b=restoreSourceWind(JSON.parse(JSON.stringify(a)));
    expect(b).not.toBe(a);expect(b.averageRandom.iv).not.toBe(a.averageRandom.iv);
    for(let i=612;i<4000;i++){
      expect(updateSourceWind(b,i/60)).toEqual(updateSourceWind(a,i/60));
    }
    expect(b).toEqual(a);
  });
  it('retains call schedule dependence instead of replacing cache sampling with instantaneous wind',()=>{
    const fine=createSourceWind(DUST2_WIND_PARAMETERS,init),sparse=createSourceWind(DUST2_WIND_PARAMETERS,init);
    for(let i=0;i<=300;i++)updateSourceWind(fine,i/60);
    updateSourceWind(sparse,0);updateSourceWind(sparse,5);
    expect(fine.direction).toBe(sparse.direction);expect(fine.averageRandom).toEqual(sparse.averageRandom);
    expect(fine.variationRandom).toEqual(sparse.variationRandom);
    expect(fine.renderParameter3).not.toEqual(sparse.renderParameter3);
  });
  it('rejects backward/non-finite/oversized catch-up before mutating restored state',()=>{
    const state=createSourceWind(DUST2_WIND_PARAMETERS,init);updateSourceWind(state,1);
    const before=JSON.stringify(state);
    for(const time of [0,NaN,Infinity,302,1e9]){
      expect(()=>updateSourceWind(state,time)).toThrow();expect(JSON.stringify(state)).toBe(before);
    }
    expect(()=>restoreSourceWind({...state,variationRandom:{...state.variationRandom,iv:[1]}})).toThrow();
    expect(()=>restoreSourceWind({...state,switchTime:0})).toThrow();
  });
  it('validates explicit initialization and finite, advancing gust intervals',()=>{
    expect(()=>createSourceWind(DUST2_WIND_PARAMETERS,{...init,seed:.5})).toThrow();
    expect(()=>createSourceWind({...DUST2_WIND_PARAMETERS,gustDuration:0},init)).toThrow();
    expect(()=>createSourceWind({...DUST2_WIND_PARAMETERS,minGustDelay:0},init)).toThrow();
    expect(()=>createSourceWind({...DUST2_WIND_PARAMETERS,minWind:5},init)).toThrow();
  });
  it('rounds the external curtime to float32 before comparing paused timestamps',()=>{
    const state=createSourceWind(DUST2_WIND_PARAMETERS,init);
    updateSourceWind(state,.1);
    expect(()=>updateSourceWind(state,.1)).not.toThrow();
    expect(state.simTime).toBe(Math.fround(.1));
  });
});
