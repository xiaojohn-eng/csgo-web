import fs from 'node:fs';
import {expect,it} from 'vitest';
import {sourceRifleRecoil,type SourceRecoilWeapon} from '../game/source-recoil';
const original=fs.existsSync('output/tests/source-recoil-native.json')?it:it.skip;
original('matches all 256 original rifle recoil-table entries, including smoothed suppressed early shots',()=>{
  const oracle=JSON.parse(fs.readFileSync('output/tests/source-recoil-native.json','utf8'));
  expect(oracle.status).toBe('original_recoil_table_executed');
  expect(oracle.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');
  expect(oracle.rows).toHaveLength(2);
  for(const row of oracle.rows)for(const mode of [0,1]as const)for(let i=0;i<64;i++)
    expect(sourceRifleRecoil(row.weapon,i,mode)).toEqual(row.table[mode][i]);
});
it('uses the original 64-entry lookup wrap without sharing mutable results between shots',()=>{
  const first=sourceRifleRecoil('ak47',0);
  expect(sourceRifleRecoil('ak47',64)).toEqual(first);
  first.angle=999;
  expect(sourceRifleRecoil('ak47',0).angle).not.toBe(999);
  expect(sourceRifleRecoil('m4a4',0)).not.toEqual(sourceRifleRecoil('ak47',0));
  for(const index of [-1,.5,NaN,Infinity])expect(()=>sourceRifleRecoil('ak47',index)).toThrow();
  expect(()=>sourceRifleRecoil('constructor'as SourceRecoilWeapon,0)).toThrow();
});
