import {describe,expect,it} from 'vitest';
import {sourcePaintTextureScale} from '../game/source-paint-geometry';
import {SOURCE_PAINT_GEOMETRY} from '../game/source-paint-geometry-data';
import {sourceRedlineSkinParameters,SOURCE_REDLINE_KIT_282,sourceRedlineUVMatrix} from '../game/source-redline-seed';
import native from '../research/source-paint-geometry.json';

describe('original paint geometry scale',()=>{
 it('matches all 238 original native generator cases, including projected style3/6 and ignore branches',()=>{
  expect(native.cases).toHaveLength(238);
  for(const row of native.cases){
   const scale=sourcePaintTextureScale(row.weapon,row.style,row.ignoreWeaponSizeScale);
   row.inputScales.forEach((input,i)=>expect(Math.fround(Math.fround(input)*scale)).toBe(row.nativeScaled[i]));
  }
  expect(SOURCE_PAINT_GEOMETRY.weapon_awp.uvScale).toBe(1.029);
  expect(sourcePaintTextureScale('unknown',7,1)).toBe(1);
  expect(()=>sourcePaintTextureScale('unknown',7,0)).toThrow('unavailable');
 });
 it('scales pattern, wear and grunge before the original two-decimal transform parser while retaining random draw order',()=>{
  const input={paintKitId:282,seed:422,wear:.4},a=sourceRedlineSkinParameters(input),scale=sourcePaintTextureScale('weapon_glock',7,0);
  const b=sourceRedlineSkinParameters(input,{...SOURCE_REDLINE_KIT_282,textureScale:scale});
  for(const key of ['pattern','wear','grunge']as const){
   expect(b.sourceUVFields[key].slice(1)).toEqual(a.sourceUVFields[key].slice(1));
   expect(b.sourceUVFields[key][0]).toBe(Math.fround(Math.fround(a.sourceUVFields[key][0])*scale));
  }
  expect(b.pattern).toEqual(sourceRedlineUVMatrix(b.sourceUVFields.pattern));
  expect(b.wearTransform).toEqual(sourceRedlineUVMatrix(b.sourceUVFields.wear));
  expect(b.grunge).toEqual(sourceRedlineUVMatrix(b.sourceUVFields.grunge));
 });
});
