import {existsSync,readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {sourceWalkingGate,sourceRifleGroundAccelerate} from '../game/source-walking.js';
import {sourceInaccuracy} from '../game/source-accuracy.js';
const available=existsSync('output/tests/source-walking-native.json'),original=available?it:it.skip;
original('matches original IN_SPEED, duck and speed transition gate',()=>{
  const report=JSON.parse(readFileSync('output/tests/source-walking-native.json','utf8'));
  expect(report.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');expect(report.rows).toHaveLength(512);
  for(const r of report.rows)expect(sourceWalkingGate(r.input)).toEqual(r.original);
});
original('feeds actual derived walking state into original accuracy rather than the raw button',()=>{
  const report=JSON.parse(readFileSync('output/tests/source-walking-native.json','utf8'));expect(report.accuracies).toHaveLength(64);
  for(const r of report.accuracies){
    const gate=sourceWalkingGate(r.input);expect(gate).toEqual(r.original.gate);
    expect(sourceInaccuracy(r.weapon,{penalty:.037,recoilIndex:0,lastShotTime:0,lastUpdateTime:0},{grounded:r.grounded,walking:gate.walking,velocitySource:r.input.velocitySource})).toBe(r.original.inaccuracy);
  }
});
original('matches original standing rifle acceleration and IN_SPEED taper',()=>{
  const report=JSON.parse(readFileSync('output/tests/source-walking-native.json','utf8'));expect(report.accelerations).toHaveLength(1296);
  for(const r of report.accelerations)expect(sourceRifleGroundAccelerate({velocitySource:r.input.velocitySource,wishDirectionSource:r.direction,wishSpeedSource:r.wishSpeedSource,weaponSpeedSource:r.input.maxSpeedSource,speedButton:r.input.speedButton,dt:r.dt,surfaceFriction:r.input.surfaceFriction})).toEqual(r.original);
});
it('does not turn IN_SPEED into a premature accuracy flag at running or falling speed',()=>{
  const base={maxSpeedSource:215,velocitySource:[200,0,0]as const,walkingBefore:false,speedButton:true,duckPressed:false,ducking:false,ducked:false};
  expect(sourceWalkingGate(base)).toEqual({walking:false,walkRequested:true,wishSpeedLimitSource:215});
  expect(sourceWalkingGate({...base,walkingBefore:true})).toEqual({walking:true,walkRequested:true,wishSpeedLimitSource:215});
  expect(sourceWalkingGate({...base,velocitySource:[0,0,300]}).walking).toBe(false);
  expect(sourceWalkingGate({...base,velocitySource:[0,0,0]}).walking).toBe(true);
  expect(sourceWalkingGate({...base,velocitySource:[0,0,0],ducked:true})).toEqual({walking:false,walkRequested:false,wishSpeedLimitSource:215});
});
