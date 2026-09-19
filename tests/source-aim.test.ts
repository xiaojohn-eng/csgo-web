import fs from 'node:fs';
import {expect,it} from 'vitest';
import {sourceBrowserShotBasis,sourceBrowserCameraBasis} from '../game/source-aim.js';
import {Matrix4,Vector3} from 'three';
const original=fs.existsSync('output/tests/source-aim-native.json')?it:it.skip;
original('matches original AngleMatrix after Source QAngle to browser direction conversion',()=>{
  const oracle=JSON.parse(fs.readFileSync('output/tests/source-aim-native.json','utf8'));let maxError=0;
  expect(oracle.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');expect(oracle.rows).toHaveLength(105);
  for(const r of oracle.rows){const result=sourceBrowserShotBasis(r.yaw,r.pitch,r.punch);
    for(const key of ['forward','right','up']as const)for(let i=0;i<3;i++)maxError=Math.max(maxError,Math.abs(result[key][i]!-r.original[key][i]));
  }
  fs.writeFileSync('output/tests/source-aim-verification.json',JSON.stringify({cases:105,maxError},null,2)+'\n');expect(maxError).toBeLessThan(2e-7);
});
const originalCamera=fs.existsSync('output/tests/source-camera-native.json')?it:it.skip;
originalCamera('matches original client camera composition including .45 tracking and view roll',()=>{
  const oracle=JSON.parse(fs.readFileSync('output/tests/source-camera-native.json','utf8'));let maxError=0;
  expect(oracle.sourceClientSha256).toBe('21d2d652a3b2e07c44fa0a3b638886744af9d24ba0c91e64f97a0d8afc43d4cb');expect(oracle.rows).toHaveLength(105);
  for(const r of oracle.rows){const result=sourceBrowserCameraBasis(r.yaw,r.pitch,r.punch);
    for(const key of ['forward','right','up']as const)for(let i=0;i<3;i++)maxError=Math.max(maxError,Math.abs(result[key][i]!-r.original[key][i]));
    const matrix=new Matrix4().makeBasis(new Vector3(...result.right),new Vector3(...result.up),new Vector3(...result.forward).negate());
    expect(matrix.determinant()).toBeCloseTo(1,5);
    expect(new Vector3(0,0,-1).applyMatrix4(matrix).distanceTo(new Vector3(...result.forward))).toBe(0);
  }
  fs.writeFileSync('output/tests/source-camera-verification.json',JSON.stringify({cases:105,maxError},null,2)+'\n');expect(maxError).toBe(0);
});
it('matches current camera axes and gives recoil lift without treating degrees as radians',()=>{
  for(const yaw of [-2,0,1.5])for(const pitch of [-.4,0,.7]){
    const v=sourceBrowserShotBasis(yaw,pitch,[0,0,0]).forward;
    expect(v[0]).toBeCloseTo(-Math.sin(yaw)*Math.cos(pitch),6);expect(v[1]).toBeCloseTo(Math.sin(pitch),6);expect(v[2]).toBeCloseTo(-Math.cos(yaw)*Math.cos(pitch),6);
  }
  expect(sourceBrowserShotBasis(0,0,[-5,0,0]).forward[1]).toBeCloseTo(Math.sin(5*Math.PI/180),6);
  expect(sourceBrowserShotBasis(0,0,[0,5,0]).forward[0]).toBeCloseTo(-Math.sin(5*Math.PI/180),6);
});
