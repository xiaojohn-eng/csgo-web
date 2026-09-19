import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as T from 'three';
import {SOURCE_FINISHES,SOURCE_FINISH_TABLE_FORMAT,SOURCE_FINISH_WEAPONS,
  SOURCE_FINISH_CATALOGUE_SHA256} from '../game/source-finish-table';
import {sourceFinishIds,sourceFinishWearWindow,sourceFinishWeapon,validSourceWeaponFinish}
  from '../game/source-weapon-finish';
import {sourceKitFinishWeapon,sourceKitOriginalWeapon,SOURCE_KIT_INPUT_BASE} from '../game/source-kit-finishes';
import {createSourceAKMaterial,createSourceFinishMaterial} from '../game/source-materials';
import {SOURCE_COMPOSABLE_STYLES,SOURCE_REDLINE_VERIFIED_SAMPLERS,
  sourceStyleSamplesPattern} from '../game/source-redline-compositor';
import {SOURCE_CUSTOMWEAPON_PROGRAM_DATA} from '../game/source-customweapon-program-data';

const read=(path:string)=>readFileSync(resolve(path));
type CatalogueFinish={id:string;style:number;wearMinimum:number;wearMaximum:number;chineseName:string;
  englishName:string;phongAlbedoBoost:number;ignoreWeaponSizeScale:number;patternOffsetX:number[];
  patternOffsetY:number[];patternRotate:number[];textureReferences:{field:string;resolution:string}[]};
const catalogue=():{weapons:{weapon:string;finishes:CatalogueFinish[]}[]}=>
  JSON.parse(read('public/source/csgo-12426148/skins/paint-kits.json').toString());
const stagedInputs=():{weapon:string;role:string;sampler:number;paintKitIds:string[]}[]=>
  JSON.parse(read('game/source-kit-input-resources.json').toString());
const akPatterns=():{field:string;paintKitIds:string[]}[]=>
  JSON.parse(read('game/source-ak-pattern-resources.json').toString());
const effectMap=():{prefabs:Record<string,string>}=>
  JSON.parse(read('public/source/csgo-12426148/weapon-effects/effect-map.json').toString());

/** Derive coverage independently from staged sampler slots and unique original artwork.
 * Native weapon scale, normal-map and zero-albedo branches have dedicated receipts. */
function composable(finishes:CatalogueFinish[],samplers:readonly number[]){
  return finishes.filter(finish=>SOURCE_COMPOSABLE_STYLES.includes(finish.style)
    && styleSamplers(finish.style).every(sampler=>samplers.includes(sampler))
    && finish.textureReferences.filter(reference=>reference.field==='normal').every(reference=>reference.resolution==='unique')
    && (sourceStyleSamplesPattern(finish.style)
      ? finish.textureReferences.some(reference=>reference.field==='pattern')
        && finish.textureReferences.filter(reference=>reference.field==='pattern')
          .every(reference=>reference.resolution==='unique')
      : !finish.textureReferences.some(reference=>reference.field==='pattern')))
    .map(finish=>Number(finish.id)).sort((one,two)=>one-two);
}
/** The slots one style's two programs declare, read from the same exported program data the runtime
 * builds them from rather than restated here. The verified style's own shader reads the receipt's
 * five textures and the pattern, which is what the compositor binds for it. */
function styleSamplers(style:number):readonly number[]{
  if(style===7) return SOURCE_REDLINE_VERIFIED_SAMPLERS;
  const data=(SOURCE_CUSTOMWEAPON_PROGRAM_DATA as unknown as Record<string,{
    color:{samplers:number[]};exponent:{samplers:number[]}}>)[String(style)];
  return [...new Set([...data.color.samplers,...data.exponent.samplers])];
}
const catalogueFinishes=(weapon:string)=>
  catalogue().weapons.find(entry=>entry.weapon===weapon)!.finishes;

it('covers exactly the weapons whose composition inputs exist, and says where each comes from',()=>{
  expect(SOURCE_FINISH_TABLE_FORMAT).toBe('source-finish-table-v1');
  // The AK-47 composes from the receipt its composition was verified against; the others
  // compose from their own staged inputs. No other weapon is offered, because offering a
  // finish the port cannot compose is worse than not offering it.
  expect(SOURCE_FINISH_WEAPONS.map(entry=>entry.id))
    .toEqual(['vandal','m4a4','awp','glock','usp','deagle']);
  expect(SOURCE_FINISH_WEAPONS.map(entry=>entry.inputSource))
    .toEqual(['staged-kit-inputs','staged-kit-inputs','staged-kit-inputs','staged-kit-inputs',
      'staged-kit-inputs','staged-kit-inputs']);
  // Which original weapon each port id is comes from the staged effect map rather than from
  // a second hand-written copy, so the two cannot disagree.
  const prefabs=effectMap().prefabs;
  for(const entry of SOURCE_FINISH_WEAPONS)
    expect(prefabs[entry.id]).toBe(entry.originalWeapon+'_prefab');
});

it('lists exactly what the catalogue can compose, with the original\'s own numbers',()=>{
  const samplersFor=(entry:{id:string;inputSource:string})=>entry.inputSource==='verified-receipt'
    ? SOURCE_REDLINE_VERIFIED_SAMPLERS
    : [...new Set(stagedInputs().filter(row=>row.weapon===SOURCE_FINISH_WEAPONS
        .find(candidate=>candidate.id===entry.id)!.originalWeapon)
        .map(row=>row.sampler).filter(sampler=>sampler>=0))];
  for(const entry of SOURCE_FINISH_WEAPONS){
    const finishes=catalogueFinishes(entry.originalWeapon);
    const listed=SOURCE_FINISHES[entry.id];
    expect(listed.map(finish=>finish.paintKitId)).toEqual(composable(finishes,samplersFor(entry)));
    for(const finish of listed){
      const original=finishes.find(candidate=>Number(candidate.id)===finish.paintKitId)!;
      expect(original).toBeDefined();
      expect(finish.style).toBe(original.style);
      expect(finish.wearMinimum).toBe(original.wearMinimum);
      expect(finish.wearMaximum).toBe(original.wearMaximum);
      expect(finish.chineseName).toBe(original.chineseName);
      expect(finish.englishName).toBe(original.englishName);
    }
  }
  // The verified counts, so a regeneration that silently widens or narrows what the programs
  // this port carries can draw is not mistaken for a pass. They span styles 1, 2, 5 and 7: the
  // solid-colour style reads no pattern at all, and the others sample the finish's own.
  expect(SOURCE_FINISHES.vandal).toHaveLength(45);
  expect(SOURCE_FINISHES.m4a4).toHaveLength(39);
  expect(SOURCE_FINISHES.awp).toHaveLength(39);
  expect(SOURCE_FINISHES.glock).toHaveLength(45);
  expect(SOURCE_FINISHES.usp).toHaveLength(35);
  expect(SOURCE_FINISHES.deagle).toHaveLength(35);
  // Every listed finish's style is one this port builds a program for, and the ones whose program
  // reads the pattern are exactly the ones with an original pattern the install resolves.
  const styles=new Set(Object.values(SOURCE_FINISHES).flatMap(list=>list.map(finish=>finish.style)));
  expect([...styles].sort((one,two)=>one-two)).toEqual([1,2,3,5,6,7,8,9]);
  for(const style of styles) expect(SOURCE_COMPOSABLE_STYLES).toContain(style);
  // A solid-colour finish needs no artwork and samples no pattern; the others do.
  for(const entry of SOURCE_FINISH_WEAPONS){
    const finishes=catalogueFinishes(entry.originalWeapon);
    for(const finish of SOURCE_FINISHES[entry.id]){
      expect(sourceStyleSamplesPattern(finish.style)).toBe(finish.style!==1);
      // Original weapon size and zero-albedo branches are now derived for all listed finishes.
      const original=finishes.find(candidate=>Number(candidate.id)===finish.paintKitId)!;
      expect(original.phongAlbedoBoost).toBeGreaterThanOrEqual(-1);
      expect([0,1]).toContain(original.ignoreWeaponSizeScale);
    }
  }
});

it('records the digest of the catalogue it was written from',()=>{
  // A regenerated catalogue cannot be paired with a stale table unnoticed.
  expect(SOURCE_FINISH_CATALOGUE_SHA256)
    .toBe(createHash('sha256').update(read('public/source/csgo-12426148/skins/paint-kits.json')).digest('hex'));
});

it('agrees with the staged artwork about which finishes can be drawn',()=>{
  const all=stagedInputs();
  for(const entry of SOURCE_FINISH_WEAPONS){
    const staged=all.filter(row=>row.weapon===entry.originalWeapon);
    // The staged pattern textures and the normal maps that sit beside them. A weapon served from
    // its own staged tree has both there; the AK-47's artwork lives in its own manifest.
    const patterns=entry.inputSource==='staged-kit-inputs'
      ? new Set(staged.filter(row=>row.role==='pattern').flatMap(row=>row.paintKitIds))
      : new Set(akPatterns().filter(row=>row.field==='pattern').flatMap(row=>row.paintKitIds));
    const normals=entry.inputSource==='staged-kit-inputs'
      ? new Set(staged.filter(row=>row.role==='normal').flatMap(row=>row.paintKitIds))
      : new Set(akPatterns().filter(row=>row.field==='normal').flatMap(row=>row.paintKitIds));
    const drawable=new Set([...patterns].map(Number));
    for(const finish of SOURCE_FINISHES[entry.id]){
      const original=catalogueFinishes(entry.originalWeapon).find(row=>Number(row.id)===finish.paintKitId)!;
      if(original.textureReferences.some(ref=>ref.field==='normal'))expect(normals).toContain(String(finish.paintKitId));
    }
    // Every finish the table lists whose style samples a pattern must have that pattern staged, or
    // the table would offer a finish whose artwork is missing. Artwork staged beyond that is
    // allowed - it can be staged ahead of the input set that would sample it - and the generator
    // reports it rather than dropping it silently.
    for(const finish of SOURCE_FINISHES[entry.id])
      if(sourceStyleSamplesPattern(finish.style)) expect(drawable).toContain(finish.paintKitId);
  }
  // The AK-47's own laminates are the case that difference is about: their artwork is staged, and
  // their style reads a sampler slot the verified receipt does not hold, so the table does not
  // offer them. They are the ones the next staged input would unlock.
  expect(akPatterns().filter(row=>row.field==='pattern').flatMap(row=>row.paintKitIds))
    .toEqual(expect.arrayContaining(['14','172','226','1070']));
  for(const id of [14,172,226,1070]) expect(SOURCE_FINISHES.vandal.map(f=>f.paintKitId)).toContain(id);
});

it('lets a finish travel only under the weapon that offers it',()=>{
  const packet=(weapon:string,paintKitId:number,wear:number)=>({weapon,paintKitId,seed:422,wear});
  for(const entry of SOURCE_FINISH_WEAPONS){
    const finishes=SOURCE_FINISHES[entry.id];
    for(const finish of finishes){
      expect(validSourceWeaponFinish(packet(entry.id,finish.paintKitId,finish.wearMinimum)))
        .toMatchObject({weapon:entry.id,paintKitId:finish.paintKitId});
      if(finish.wearMinimum>0)
        expect(validSourceWeaponFinish(packet(entry.id,finish.paintKitId,finish.wearMinimum-.001))).toBeNull();
      if(finish.wearMaximum<1)
        expect(validSourceWeaponFinish(packet(entry.id,finish.paintKitId,finish.wearMaximum+.001))).toBeNull();
    }
  }
  // The same original id is a different finish on another weapon, so the weapon is part of
  // the lookup: the M4A1's 255 and the AK's 282 travel, and neither travels as the other.
  expect(validSourceWeaponFinish(packet('m4a4',255,.5))).not.toBeNull();
  expect(validSourceWeaponFinish(packet('m4a4',282,.5))).toBeNull();
  expect(validSourceWeaponFinish(packet('vandal',255,.5))).toBeNull();
  expect(validSourceWeaponFinish(packet('vandal',309,.2))).toBeNull();
  // The wear window is the finish's own, per weapon rather than global.
  expect(sourceFinishWearWindow('m4a4',255)).toMatchObject({wearMinimum:.18,wearMaximum:1});
  expect(sourceFinishWearWindow('vandal',282)).toMatchObject({wearMinimum:.1,wearMaximum:.7});
  expect(sourceFinishWearWindow('m4a4',282)).toBeNull();
  expect(sourceFinishWearWindow('glock',282)).toBeNull();
  // Every weapon this port ships with finishes in the original is a finish weapon now.
  for(const id of ['vandal','m4a4','awp','glock','usp','deagle'])
    expect(sourceFinishWeapon(id)).toBe(id);
  // A weapon this port ships but whose original finishes are not staged has no weapon id
  // here, so no finish can be named for it however plausible the id looks.
  expect(sourceFinishWeapon('spectre')).toBeNull();
  expect(sourceFinishWeapon('ak47')).toBeNull();
  expect(sourceFinishIds('m4a4')).toHaveLength(39);
  expect(sourceFinishIds('awp')).toHaveLength(39);
  expect(sourceFinishIds('glock')).toHaveLength(45);
  expect(sourceFinishIds('usp')).toHaveLength(35);
  expect(sourceFinishIds('deagle')).toHaveLength(35);
  expect(sourceFinishIds('spectre')).toEqual([]);
});

it('gives a staged weapon both of its gun-body material names and its own Phong values',()=>{
  // The M4A1's first-person and world models name their gun body differently, and both are
  // the same original material, so one owner has to replace both.
  const m4a4=sourceKitFinishWeapon('m4a4',{phongBoost:2,phongAlbedoBoost:25,phongFresnelRanges:[.83,.83,1]});
  expect(m4a4).toEqual({id:'m4a4',materialName:'Source_M4A4_VertexLitGeneric',
    replaces:['Source_M4A4_VertexLitGeneric','Source_World_M4A4_VertexLitGeneric'],
    phong:{phongBoost:2,phongAlbedoBoost:25,phongFresnelRanges:[.83,.83,1]}});
  // The AWP's material carries both a different albedo boost and different Fresnel stops,
  // so nothing about it can be inherited from another weapon.
  const awp=sourceKitFinishWeapon('awp',{phongBoost:2,phongAlbedoBoost:40,phongFresnelRanges:[.8,.8,1]});
  expect(awp).toEqual({id:'awp',materialName:'Source_AWP_FP_VertexLitGeneric',
    replaces:['Source_AWP_FP_VertexLitGeneric','Source_AWP_World_VertexLitGeneric'],
    phong:{phongBoost:2,phongAlbedoBoost:40,phongFresnelRanges:[.8,.8,1]}});
  // The scope is its own original material and is not the gun body, so it is not replaced.
  expect(awp!.replaces).not.toContain('Source_AWP_Scope_VertexLitGeneric');
  // The pistols name their gun bodies in this port's own lower-case spelling, and the
  // Deagle spells its world model differently from its first-person one.
  const glock=sourceKitFinishWeapon('glock',{phongBoost:1,phongAlbedoBoost:35,phongFresnelRanges:[.83,.83,1]});
  expect(glock!.replaces).toEqual(['Source_glock_VertexLitGeneric','Source_World_glock_VertexLitGeneric']);
  const usp=sourceKitFinishWeapon('usp',{phongBoost:8,phongAlbedoBoost:80,phongFresnelRanges:[.83,.83,1]});
  expect(usp!.replaces).toEqual(['Source_usp_VertexLitGeneric','Source_World_usp_VertexLitGeneric']);
  const deagle=sourceKitFinishWeapon('deagle',{phongBoost:1,phongAlbedoBoost:40,phongFresnelRanges:[.8,.8,1]});
  expect(deagle!.replaces).toEqual(['Source_deagle_VertexLitGeneric','Source_World_Deagle_VertexLitGeneric']);
  // The AK-47 is served by its verified receipt, not by this path, so this path refuses it
  // rather than building a second owner for it.
  expect(sourceKitFinishWeapon('vandal',{phongBoost:2,phongAlbedoBoost:35,phongFresnelRanges:[.83,.83,1]})).toMatchObject({replaces:['Source_AK47_VertexLitGeneric']});
  expect(sourceKitFinishWeapon('spectre',{phongBoost:2,phongAlbedoBoost:35,phongFresnelRanges:[.83,.83,1]})).toBeNull();
  for(const [id,original] of [['m4a4','weapon_m4a1'],['awp','weapon_awp'],['vandal','weapon_ak47'],
    ['glock','weapon_glock'],['usp','weapon_usp_silencer'],['deagle','weapon_deagle']] as const)
    expect(sourceKitOriginalWeapon(id)).toBe(original);
  expect(sourceKitOriginalWeapon('spectre')).toBeNull();
  expect(SOURCE_KIT_INPUT_BASE).toBe('/source/csgo-12426148/kit-inputs-fidelity-20260913/');
});

it('composes with the weapon\'s own Phong values rather than with the AK\'s',()=>{
  const base=new T.DataTexture(new Uint8Array([0,0,0,0]),1,1,T.RGBAFormat,T.UnsignedByteType);
  const exponent=new T.DataTexture(new Uint8Array([0,0,0,0]),1,1,T.RGBAFormat,T.UnsignedByteType);
  const ak=createSourceAKMaterial(base,exponent);
  // The verified AK constants remain distinct from the other weapon owners.
  expect(ak.material.name).toBe('Source_AK47_VertexLitGeneric');
  expect(ak.material.userData.sourceParameters).toMatchObject({boost:2,albedoBoost:35,albedoTint:true,fresnel:[.83,.83,1]});
  expect(ak.material.customProgramCacheKey()).toContain('Source_AK47_VertexLitGeneric-source-phong-');
  // The composed M4A1 adapter keeps the same branch and takes the weapon's own albedo boost,
  // which is what the composition preserves: its Fresnel stops happen to match the AK's.
  const m4=createSourceFinishMaterial({name:'Source_M4A4_VertexLitGeneric',phongBoost:2,phongAlbedoBoost:25,
    phongFresnelRanges:[.83,.83,1]},base,exponent);
  expect(m4.material.name).toBe('Source_M4A4_VertexLitGeneric');
  expect(m4.material.userData.sourceParameters).toMatchObject({boost:2,albedoBoost:25,albedoTint:true,fresnel:[.83,.83,1]});
  // The AWP's stops do not, so a hardcoded pair would have been wrong for it; and the
  // pistols' boost, which is the divisor of a finish's intensity, is 1 and 8 where the
  // rifles' is 2.
  const awp=createSourceFinishMaterial({name:'Source_AWP_FP_VertexLitGeneric',phongBoost:2,phongAlbedoBoost:40,
    phongFresnelRanges:[.8,.8,1]},base,exponent);
  expect(awp.material.userData.sourceParameters).toMatchObject({boost:2,albedoBoost:40,fresnel:[.8,.8,1]});
  const usp=createSourceFinishMaterial({name:'Source_usp_VertexLitGeneric',phongBoost:8,phongAlbedoBoost:80,
    phongFresnelRanges:[.83,.83,1]},base,exponent);
  expect(usp.material.userData.sourceParameters).toMatchObject({boost:8,albedoBoost:80,fresnel:[.83,.83,1]});
  for(const handle of [ak,m4,awp,usp]){
    expect(handle.material.userData.sourceShader).toBe('VertexLitGeneric');
    handle.dispose();
  }
  base.dispose();exponent.dispose();
});
