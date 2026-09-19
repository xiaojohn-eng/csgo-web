import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import native from '../research/source-paint-zero-albedo.json';
import {validateSourcePaintKitCatalogue,sourcePaintKitFor,sourceRedlineKitFor} from '../game/source-paint-kits';
import {sourceComposableFinish} from '../game/source-ak-finishes';
import {sourceRedlineSkinParameters,type SourceWeaponPhong} from '../game/source-redline-seed';
import {sourceRedlineAlbedoMaterialValue,sourceRedlineAlbedoShaderConstant} from '../game/source-redline-parameters';
import {sourceCustomWeaponStyleProgram} from '../game/source-redline-compositor';
import {SOURCE_FINISHES} from '../game/source-finish-table';

it('closes the four actual zero-boost kits through native client, material parser and finite shader upload',()=>{
  for(const binary of[native.client,native.shader,native.materialParser.materialSystem])
    expect(createHash('sha256').update(readFileSync(binary.file)).digest('hex')).toBe(binary.sha256);
  expect(native.materialParser).toMatchObject({importName:'strtod',originalText:'inf',hostLibcConsumedBytes:3,
    nativeFloat32Bits:'0x7f800000',nativeFloat32:'Infinity'});
  expect(native.cases.map(row=>`${row.weapon}:${row.paintKitId}`)).toEqual([
    'weapon_m4a1:471','weapon_deagle:468','weapon_deagle:469','weapon_deagle:470']);
  const catalogue=validateSourcePaintKitCatalogue(JSON.parse(readFileSync('public/source/csgo-12426148/skins/paint-kits.json','utf8')));
  for(const row of native.cases){
    const entry=sourceComposableFinish(catalogue,row.weapon,row.paintKitId,[0,1,2,3,4,5,6,7,8]);
    expect(entry).toEqual(sourcePaintKitFor(catalogue,row.weapon,String(row.paintKitId)));
    expect(row.kit).toMatchObject(entry);
    const kit=sourceRedlineKitFor(entry),p=sourceRedlineSkinParameters({paintKitId:row.paintKitId,seed:422,wear:kit.wearMinimum},
      kit,row.phong as unknown as SourceWeaponPhong);
    expect(p.phongAlbedoFactor).toBe(Infinity);
    expect(sourceRedlineAlbedoMaterialValue(p.phongAlbedoFactor)).toBe(Infinity);
    const command=native.shaderUpload.cases.find(c=>c.weapon===row.weapon&&c.paintKitId===row.paintKitId)!;
    expect([sourceRedlineAlbedoShaderConstant(p.phongAlbedoFactor),p.phongExponent,p.phongIntensity,p.wear]).toEqual(command.nativeC3);
    expect(command.nativeC3.every(Number.isFinite)).toBe(true);
    expect(command.factorBits).toBe('0x00000000');
    expect(p.materialPhong.phongAlbedoBoost).toBe(Number(row.materialAfterBranch.$phongalbedoboost));
    expect(p.materialPhong.phongBoost).toBe(Number(row.materialAfterBranch.$phongboost));
    const selected=sourceCustomWeaponStyleProgram(kit.style,p.phongAlbedoFactor);
    expect([row.selectors.color.static,row.selectors.exponent.static]).toEqual([5,15]);
    expect(selected).toEqual(sourceCustomWeaponStyleProgram(5,1));
  }
  expect(Object.values(SOURCE_FINISHES).flat()).toHaveLength(238);
});

it('accepts only the native positive-infinity special value without admitting overflow or NaN',()=>{
  expect(sourceRedlineAlbedoShaderConstant(Infinity)).toBe(0);
  for(const value of[NaN,-Infinity,1e100]){
    expect(()=>sourceRedlineAlbedoShaderConstant(value)).toThrow();
    expect(()=>sourceRedlineAlbedoMaterialValue(value)).toThrow();
    expect(()=>sourceCustomWeaponStyleProgram(5,value)).toThrow();
  }
});
