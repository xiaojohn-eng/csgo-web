import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import native from '../research/source-customweapon-all-programs.json';
import paths from '../research/source-paint-paths.json';
import inputs from '../game/source-kit-input-resources.json';
import {SOURCE_CUSTOMWEAPON_LOW_ALBEDO_DATA} from '../game/source-customweapon-low-albedo-data';
import {SOURCE_CUSTOMWEAPON_PROGRAMS} from '../game/source-customweapon-programs';
import {sourceCustomWeaponStyleProgram,sourcePaletteRegisters} from '../game/source-redline-compositor';
import {sourceCustomWeaponFragmentShader} from '../game/source-redline-program';

it('retains all 36 original selected DX9 byte streams, including exponent aliases previously missed',()=>{
  expect(native.programs).toHaveLength(36);
  for(const row of native.programs){
    const raw=readFileSync(`.reference-assets/source-exports/fidelity-paint-20260913/programs/customweapon-static${row.static}-dynamic0.dx9`);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(row.sha256);
    const words=Array.from({length:raw.length/4},(_,i)=>new DataView(raw.buffer,raw.byteOffset,raw.byteLength).getUint32(i*4,true)),tokens:number[][]=[];
    expect(words[0]).toBe(0xffff0300);
    for(let i=1;i<words.length;){
      const op=words[i]&65535;if(op===65535)break;
      const n=1+(op===65534?words[i]>>>16:(words[i]>>>24)&15);
      if(op!==65534)tokens.push(words.slice(i,i+n));i+=n;
    }
    const data=row.style===7&&!row.lowAlbedo?SOURCE_CUSTOMWEAPON_PROGRAMS['7'][row.pass as'color'|'exponent']
      :sourceCustomWeaponStyleProgram(row.style,row.lowAlbedo?.5:1)[row.pass as'color'|'exponent'];
    expect(data.tokens).toEqual(tokens);
    expect(tokens).toHaveLength(row.tokenCount);
    const constants=row.constants.flatMap(c=>Array.from({length:c.count},(_,i)=>c.register+i));
    expect(()=>sourceCustomWeaponFragmentShader({tokens,samplers:row.samplers,constants})).not.toThrow();
    expect(row.nativeCombined).toBe(row.static*5);
  }
  expect(SOURCE_CUSTOMWEAPON_PROGRAMS['3'].exponent.tokens).toEqual(SOURCE_CUSTOMWEAPON_PROGRAMS['1'].exponent.tokens);
  expect(SOURCE_CUSTOMWEAPON_PROGRAMS['6'].exponent.tokens).toEqual(SOURCE_CUSTOMWEAPON_PROGRAMS['4'].exponent.tokens);
  expect(SOURCE_CUSTOMWEAPON_LOW_ALBEDO_DATA['9'].exponent.aliasResolvedStatic).toBe(19);
});

it('keeps the projected pattern matrix separate from palette rows and matches original PS c10/c11 upload',()=>{
  for(const style of[3,6])for(const factor of[.5,1]){
    expect(sourcePaletteRegisters(style,factor)).toEqual([0,1,2]);
    const data=sourceCustomWeaponStyleProgram(style,factor).color;
    expect(data.constants.find(row=>row.register===10)).toEqual({register:10,name:'g_patternTexCoordTransform',count:2});
  }
  for(const row of native.patternMatrixCases){
    expect(row.commandWords).toEqual([3,10,2]);
    expect(row.nativeC10C11).toEqual(row.matrixFirstTwoRows.map(Math.fround));
  }
  expect(native.additionalSamplerBindings.map(row=>[row.sampler,row.srgbRead])).toEqual([[4,false],[6,false],[7,false]]);
});

it('resolves all 287 paint references through the original directory table and stages all selected original files',()=>{
  expect(paths.cases).toHaveLength(287);
  expect(paths.cases.filter(row=>row.priorCandidates.length>1)).toHaveLength(31);
  const catalogue=JSON.parse(readFileSync('public/source/csgo-12426148/skins/paint-kits.json','utf8'));
  for(const row of paths.cases){
    expect(row.priorCandidates).toContain(row.selectedVpkPath);
    const kit=catalogue.weapons.find((w:{weapon:string})=>w.weapon===row.weapon).finishes.find((k:{id:string})=>Number(k.id)===row.paintKitId);
    expect(kit.textureReferences.find((r:{field:string})=>r.field===row.field)).toMatchObject({resolution:'unique',candidates:[row.selectedVpkPath]});
    const staged=inputs.find(input=>input.weapon===row.weapon&&input.role===row.field&&input.paintKitIds.includes(String(row.paintKitId)));
    expect(staged?.sourceMaterial).toBe(row.selectedVpkPath);
  }
});
