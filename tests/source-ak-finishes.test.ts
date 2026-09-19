import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createSourceAkFinishResolver} from '../game/source-ak-finishes';
import {validSourceWeaponFinish,sourceFinishWearWindow} from '../game/source-weapon-finish';
import {SOURCE_FINISHES,SOURCE_FINISH_CATALOGUE_SHA256,SOURCE_FINISH_WEAPONS} from '../game/source-finish-table';

const AK_FINISHES=SOURCE_FINISHES.vandal;
const AK=SOURCE_FINISH_WEAPONS.find(entry=>entry.id==='vandal')!;

const skins=resolve('public/source/csgo-12426148/skins');
const patterns=resolve('public/source/csgo-12426148/ak-patterns');
const catalogue=()=>JSON.parse(readFileSync(resolve(skins,'paint-kits.json'),'utf8'));
/** Serves the two staged documents by name, the way the served tree does. */
function serve(){
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    const text=String(url);
    if(text.includes('paint-kits.json'))
      return new Response(new Blob([readFileSync(resolve(skins,'paint-kits.json')) as unknown as Uint8Array<ArrayBuffer>]));
    if(text.includes('ak-patterns/inputs.json'))
      return new Response(new Blob([readFileSync(resolve(patterns,'inputs.json')) as unknown as Uint8Array<ArrayBuffer>]));
    return new Response(null,{status:404});
  }));
}
beforeEach(()=>serve());
afterEach(()=>{vi.unstubAllGlobals();});
const resolver=()=>createSourceAkFinishResolver({catalogueBaseURL:'/source/csgo-12426148/skins/',
  patternBaseURL:'/source/csgo-12426148/ak-patterns/'});

it('resolves an original finish to its own numbers and its own artwork',async()=>{
  const finishes=resolver();
  const redline=await finishes.resolve(282);
  expect(redline.kit.paintKitId).toBe(282);
  expect(redline.kit.style).toBe(7);
  expect(redline.kit.phongExponent).toBe(150);
  expect(redline.kit.phongIntensity).toBe(10);
  expect(redline.kit.wearMinimum).toBeCloseTo(.1,6);
  expect(redline.pattern!.paintKitId).toBe(282);
  expect(redline.pattern!.sourceMaterial)
    .toBe('materials/models/weapons/customization/paints/custom/workshop/elegantredv1.1.vtf');
  // A second finish resolves to different everything, not to the first one's values.
  const vulcan=await finishes.resolve(302);
  expect(vulcan.kit.paintKitId).toBe(302);
  expect(vulcan.kit.wearMaximum).toBeCloseTo(.9,6);
  expect(vulcan.pattern!.sourceMaterial)
    .toBe('materials/models/weapons/customization/paints/custom/workshop/rubber_ak47.vtf');
  expect(vulcan.pattern!.sha256).not.toBe(redline.pattern!.sha256);
  // The resolver answers with the finishes it will accept, and that list is exactly the
  // generated table's, so the menu, the transport rule and the composition path agree.
  const available=await finishes.available();
  expect([...available].sort((a,b)=>a-b)).toEqual(AK_FINISHES.filter(finish=>finish.style===7).map(finish=>finish.paintKitId));
  expect(available).toHaveLength(24);
});

it('refuses a finish it cannot compose rather than substituting another',async()=>{
  const finishes=resolver();
  // An id no original AK finish carries.
  await expect(finishes.resolve(9999)).rejects.toThrow('is not an original weapon_ak47 finish');
  await expect(finishes.resolve(0)).rejects.toThrow('must be a positive integer');
  await expect(finishes.resolve(282.5)).rejects.toThrow('must be a positive integer');
  // An original AK finish whose composition is a different style than the one this port
  // implements. Red laminate is style 2, whose programs read the weapon's own mask texture at a
  // sampler the verified receipt does not hold, so it is refused as a composition this path's
  // inputs cannot bind rather than as a missing asset. Its artwork is staged and the generated
  // table reports it as staged but not drawn.
  await expect(finishes.resolve(14)).rejects.toThrow(/is style 2, which reads a sampler/);
  // This native normal belongs to the cloned draw material, separately from its pattern.
  const neon=await finishes.resolve(707);
  expect(neon.normal?.sourceMaterial).toContain('ak_neon_rider_normal.vtf');
  expect(neon.pattern!.sha256).not.toBe(neon.normal?.sha256);
  // A finish from another weapon is not an AK finish.
  await expect(finishes.resolve(544)).rejects.toThrow('is not an original weapon_ak47 finish');
});

it('keeps the generated table in step with the catalogue it was written from',()=>{
  const document=catalogue();
  // The table records the digest of the catalogue it came from, so a regenerated
  // catalogue cannot be paired with a stale table unnoticed.
  expect(SOURCE_FINISH_CATALOGUE_SHA256).toMatch(/^[0-9a-f]{64}$/);
  const ak=document.weapons.find((entry:{weapon:string})=>entry.weapon===AK.originalWeapon);
  expect(ak).toBeDefined();
  const style7=ak.finishes.filter((finish:{style:number})=>finish.style===7);
  // All 24 style-7 finishes now retain their original normals when present.
  expect(style7.map((finish:{id:string})=>Number(finish.id)).sort((a:number,b:number)=>a-b))
    .toEqual(AK_FINISHES.filter(finish=>finish.style===7).map(finish=>finish.paintKitId));
  for(const entry of AK_FINISHES){
    const finish=ak.finishes.find((candidate:{id:string})=>Number(candidate.id)===entry.paintKitId);
    expect(finish).toBeDefined();
    expect(entry.wearMinimum).toBe(finish.wearMinimum);
    expect(entry.wearMaximum).toBe(finish.wearMaximum);
    expect(entry.chineseName).toBe(finish.chineseName);
    expect(entry.englishName).toBe(finish.englishName);
  }
  // The window helper the menu and the transport rule share reads the same table.
  expect(sourceFinishWearWindow('vandal',282)).toMatchObject({wearMinimum:.1,wearMaximum:.7});
  expect(sourceFinishWearWindow('vandal',9999)).toBeNull();
  expect(sourceFinishWearWindow('vandal',282.5)).toBeNull();
});

it('lets any composable finish travel, with the wear its own finish allows',async()=>{
  const packet=(paintKitId:number,wear:number)=>({weapon:'vandal',paintKitId,seed:422,wear});
  // Every composable finish travels at either end of its own window.
  for(const entry of AK_FINISHES){
    for(const wear of [entry.wearMinimum,entry.wearMaximum]){
      const accepted=validSourceWeaponFinish(packet(entry.paintKitId,wear));
      expect(accepted).not.toBeNull();
      expect(accepted!.paintKitId).toBe(entry.paintKitId);
    }
    // And is refused just outside it, so a wear the original does not present for this
    // finish never reaches another client.
    if(entry.wearMinimum>0)
      expect(validSourceWeaponFinish(packet(entry.paintKitId,entry.wearMinimum-.001))).toBeNull();
    if(entry.wearMaximum<1)
      expect(validSourceWeaponFinish(packet(entry.paintKitId,entry.wearMaximum+.001))).toBeNull();
  }
  // A wear that one finish allows and another does not is decided by the finish, not by a
  // single global window: 0.85 is inside 0..1 and outside 0..0.67.
  expect(validSourceWeaponFinish(packet(316,.85))).not.toBeNull();
  expect(validSourceWeaponFinish(packet(506,.85))).toBeNull();
  // The verified finish's own window is unchanged.
  expect(validSourceWeaponFinish(packet(282,.4))).toEqual({weapon:'vandal',paintKitId:282,seed:422,wear:Math.fround(.4)});
  expect(validSourceWeaponFinish(packet(282,.09))).toBeNull();
  expect(validSourceWeaponFinish(packet(282,.71))).toBeNull();
  // Ids that are not composable, and shapes that are not a finish at all.
  for(const bad of [packet(9999,.4),packet(0,.4),
    {weapon:'vandal',paintKitId:'282',seed:422,wear:.4},
    {weapon:'ak47',paintKitId:282,seed:422,wear:.4},
    {weapon:'vandal',paintKitId:282,seed:1001,wear:.4},
    {weapon:'vandal',paintKitId:282,seed:-1,wear:.4},
    {weapon:'vandal',paintKitId:282,seed:422,wear:Number.NaN},null,undefined,[]])
    expect(validSourceWeaponFinish(bad)).toBeNull();
});
