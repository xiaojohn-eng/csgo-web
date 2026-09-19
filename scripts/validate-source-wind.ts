/** Independent installed-instruction fixture readback, not a TS mirror. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createSourceWind,updateSourceWind,restoreSourceWind} from '../game/source-wind';

const source=new URL('../output/tests/source-wind-native.json',import.meta.url),bytes=readFileSync(source);
const oracle=JSON.parse(new TextDecoder().decode(bytes));
let maxVectorError=0,scalarChecks=0,vectorChecks=0,rngChecks=0,steps=0,events=0,restores=0;
const range={windSpeed:[Infinity,-Infinity],renderParameter3XY:[Infinity,-Infinity]};
function verify(actual:unknown,expected:unknown,path='state'){
  if(Array.isArray(expected)){
    assert(Array.isArray(actual));assert.equal(actual.length,expected.length);
    expected.forEach((v,i)=>verify(actual[i],v,`${path}.${i}`));
  }else if(expected&&typeof expected==='object'){
    assert(actual&&typeof actual==='object');
    for(const [k,v]of Object.entries(expected))verify((actual as Record<string,unknown>)[k],v,`${path}.${k}`);
  }else if(typeof expected==='number'){
    assert.equal(typeof actual,'number');const error=Math.abs((actual as number)-expected);
    if(/currentWind|currentSway|previousSway|renderParameter3/.test(path)){
      vectorChecks++;maxVectorError=Math.max(maxVectorError,error);assert(error<=1e-6,`${path}: ${error}`);
    }else{scalarChecks++;if(/Random/.test(path))rngChecks++;assert.equal(error,0,path);}
  }else assert.equal(actual,expected,path);
}
for(const sample of oracle.cases){
  let state=createSourceWind(sample.config,{seed:0,startTime:0,initialDirection:0,initialSpeed:0,...sample.init});
  if(sample.initial)verify(state,sample.initial);
  for(let i=0;i<sample.rows.length;i++){
    const row=sample.rows[i],frame=updateSourceWind(state,row.time);
    verify(state,row.state);verify(frame.events,row.events,'events');assert.equal(frame.nextThinkTime,row.nextThink);
    steps++;events+=frame.events.length;
    range.windSpeed=[Math.min(range.windSpeed[0]!,state.windSpeed),Math.max(range.windSpeed[1]!,state.windSpeed)];
    range.renderParameter3XY=[Math.min(range.renderParameter3XY[0]!,...frame.windSourceXY),Math.max(range.renderParameter3XY[1]!,...frame.windSourceXY)];
    // Interrupt at positions unrelated to native gust/variation boundaries.
    if(i%97===47){state=restoreSourceWind(JSON.parse(JSON.stringify(state)));restores++;}
  }
}
const summary={schema:1,status:'passed',oracleSha256:createHash('sha256').update(bytes).digest('hex'),
  cases:oracle.cases.length,steps,events,scalarChecks,vectorChecks,rngChecks,maxVectorError,jsonRestores:restores,
  nativeSpawnArgumentCases:oracle.callers.spawnArguments.length,nativeClockForwardingCases:oracle.callers.clockForwarding.length,
  sampledRanges:range,
  limits:['Discrete native input schedules, not all legal real-valued clocks or GPU/production acceptance.',
    'No full engine host loop, network time interpolation or physical x87 last-bit claim.']};
writeFileSync(new URL('../output/tests/source-wind-validation.json',import.meta.url),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
