import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadSourcePaintKits,validateSourcePaintKitCatalogue,sourcePaintKitFor,sourcePaintKitExists,sourcePaintKitsForWeapon,
  SOURCE_PAINT_KIT_FORMAT,SOURCE_PAINT_KIT_RESOURCE} from '../game/source-paint-kits';

const staged=resolve('public/source/csgo-12426148/skins');
const stagedBytes=()=>Uint8Array.from(readFileSync(resolve(staged,SOURCE_PAINT_KIT_RESOURCE)));
const document=()=>JSON.parse(new TextDecoder().decode(stagedBytes()));
/** Serves the real staged bytes, or the raw bytes handed in. */
function serve(value:Uint8Array){
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Blob([value as Uint8Array<ArrayBuffer>]))));
}
beforeEach(()=>serve(stagedBytes()));
afterEach(()=>{vi.unstubAllGlobals();});
const load=()=>loadSourcePaintKits('/staged/');
/** A copy of the shipped document, for exercising the structural rules on their own. */
const tampered=()=>structuredClone(document()) as {
 format:string;status:string;cataloguedFrom:{format:string;manifestSha256:string;catalogueSha256:string;sourceioCommit:string};
 rarities:Record<string,unknown>;defaultKitId:string;factory:{id:string;name:string};
 weapons:{weapon:string;finishes:{id:string;rarity:string;wearMinimum:number;colours:number[][];
   textureReferences:{field:string;sourceValue:string;resolution:string;candidates:string[]}[]}[]}[]};

it('stages the original finishes for every weapon this port ships',async()=>{
 const {catalogue,hashVerified}=await load();
 expect(hashVerified).toEqual({[SOURCE_PAINT_KIT_RESOURCE]:true});
 expect(catalogue.format).toBe(SOURCE_PAINT_KIT_FORMAT);
 expect(catalogue.status).toBe('original_paint_kits_staged');
 // The install's own manifest digest travels with the catalogue, so every finish can be
 // traced back to the exact install it was read from.
 expect(catalogue.cataloguedFrom.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
 expect(catalogue.cataloguedFrom.catalogueSha256).toMatch(/^[0-9a-f]{64}$/);
 expect(catalogue.weapons.map(entry=>entry.weapon)).toEqual(['weapon_ak47','weapon_m4a1','weapon_glock',
  'weapon_usp_silencer','weapon_deagle','weapon_awp']);
 expect(catalogue.weapons.map(entry=>entry.finishes.length)).toEqual([45,39,45,35,35,39]);
 expect(catalogue.weapons.reduce((total,entry)=>total+entry.finishes.length,0)).toBe(238);
 // The factory finish is the original's own kit 0, and the original never lists it among
 // a weapon's finishes because it is the state of having no finish.
 expect(catalogue.defaultKitId).toBe('0');
 expect(catalogue.factory.name).toBe('default');
 expect(catalogue.factory.rarity).toBe('default');
 for(const entry of catalogue.weapons)
  expect(entry.finishes.some(finish=>finish.id===catalogue.defaultKitId)).toBe(false);
});

it('carries the original names, rarities and palettes rather than a placeholder list',async()=>{
 const {catalogue}=await load();
 // The rarity names are the original's own, read from its own localisation file: the
 // weapon tier names, not this port's translations.
 expect(catalogue.rarities.common).toMatchObject({value:1,chineseLabel:'消费级',englishLabel:'Consumer Grade'});
 expect(catalogue.rarities.rare).toMatchObject({value:3,chineseLabel:'军规级',englishLabel:'Mil-Spec Grade'});
 expect(catalogue.rarities.mythical).toMatchObject({value:4,chineseLabel:'受限',englishLabel:'Restricted'});
 expect(catalogue.rarities.legendary).toMatchObject({value:5,chineseLabel:'保密',englishLabel:'Classified'});
 expect(catalogue.rarities.ancient).toMatchObject({value:6,chineseLabel:'隐秘',englishLabel:'Covert'});
 const ak=sourcePaintKitsForWeapon(catalogue,'weapon_ak47');
 const redline=ak.find(finish=>finish.id==='282')!;
 expect(redline.name).toBe('cu_ak47_cobra');
 expect(redline.englishName).toBe('Redline');
 expect(redline.chineseName).toBe('红线');
 expect(redline.rarity).toBe('mythical');
 expect(redline.style).toBe(7);
 // The original wear window, exactly as the original paint-kit block has it.
 expect(redline.wearMinimum).toBeCloseTo(.1,6);
 expect(redline.wearMaximum).toBeCloseTo(.7,6);
 // A style-7 finish leaves the palette at the original default block's grey: its
 // artwork is the pattern texture, not the four colours.
 expect(redline.colours).toEqual([[128,128,128],[128,128,128],[128,128,128],[128,128,128]]);
 // The pattern the original resolves for it is the one this port already composes.
 expect(redline.textureReferences).toContainEqual({field:'pattern',sourceValue:'workshop/elegantredv1.1',
  resolution:'unique',candidates:['materials/models/weapons/customization/paints/custom/workshop/elegantredv1.1.vtf']});
 // A finish that does use the palette carries the original's own four colours.
 const laminate=ak.find(finish=>finish.id==='14')!;
 expect(laminate.englishName).toBe('Red Laminate');
 expect(laminate.style).toBe(2);
 expect(laminate.colours).toEqual([[17,16,15],[150,5,9],[119,108,94],[233,58,7]]);
 expect(laminate.phongExponent).toBe(60);
 expect(laminate.phongIntensity).toBe(51);
 expect(laminate.wearMinimum).toBeCloseTo(.06,6);
 expect(laminate.wearMaximum).toBeCloseTo(.8,6);
 // A second style-7 finish, so the list is not one kit repeated.
 const vulcan=ak.find(finish=>finish.id==='302')!;
 expect(vulcan.englishName).toBe('Vulcan');
 expect(vulcan.chineseName).toBe('火神');
 expect(vulcan.pattern).toBe('workshop/rubber_ak47');
 expect(vulcan.wearMaximum).toBeCloseTo(.9,6);
});

it('answers a finish lookup from the original\'s own ids and never substitutes one',async()=>{
 const {catalogue}=await load();
 expect(sourcePaintKitFor(catalogue,'weapon_ak47','282').englishName).toBe('Redline');
 // An id the weapon does not offer, a non-string, and a weapon the catalogue does not
 // carry all resolve to the factory finish rather than to some other weapon's skin.
 expect(sourcePaintKitFor(catalogue,'weapon_ak47','9999')).toBe(catalogue.factory);
 expect(sourcePaintKitFor(catalogue,'weapon_ak47',null)).toBe(catalogue.factory);
 expect(sourcePaintKitFor(catalogue,'weapon_ak47',282)).toBe(catalogue.factory);
 expect(catalogue.factory.id).toBe('0');
 expect(()=>sourcePaintKitFor(catalogue,'weapon_scar20','282')).toThrow('no staged finishes');
 expect(sourcePaintKitExists(catalogue,'weapon_ak47','282')).toBe(true);
 // The Redline is an AK finish; the AWP does not offer it.
 expect(sourcePaintKitExists(catalogue,'weapon_awp','282')).toBe(false);
 expect(sourcePaintKitExists(catalogue,'weapon_ak47','9999')).toBe(false);
 expect(sourcePaintKitExists(catalogue,'weapon_ak47',282)).toBe(false);
 // The original offers four of these finishes for two weapons each, and each weapon
 // carries its own copy rather than sharing one record across weapons.
 const shared=catalogue.weapons.filter(entry=>entry.finishes.some(finish=>finish.id==='17'));
 expect(shared.map(entry=>entry.weapon)).toEqual(['weapon_m4a1','weapon_deagle']);
});

it('refuses staged bytes that no longer match the manifest, and a missing document',async()=>{
 const pristine=stagedBytes(),tamperedBytes=Uint8Array.from(pristine);
 tamperedBytes[pristine.byteLength-2]=pristine[pristine.byteLength-2]^0xff;
 serve(tamperedBytes);
 await expect(load()).rejects.toThrow('differ from the manifest');
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:404})));
 await expect(load()).rejects.toThrow('HTTP 404');
});

it('refuses a changed original document instead of applying part of it',()=>{
 // A finish that calls two candidates unique contradicts its own original verdict.
 const duplicated=tampered();
 duplicated.weapons[0].finishes.find(finish=>finish.id==='282')!.textureReferences[0]
  .candidates.push('materials/elsewhere.vtf');
 expect(()=>validateSourcePaintKitCatalogue(duplicated)).toThrow('candidates unique');
 // A finish naming a rarity the catalogue does not carry.
 const unknown=tampered();
 unknown.weapons[0].finishes.find(finish=>finish.id==='282')!.rarity='mythicalx';
 expect(()=>validateSourcePaintKitCatalogue(unknown)).toThrow('which the catalogue does not carry');
 // A weapon's list that mixes in the factory finish.
 const mixed=tampered();
 mixed.weapons[0].finishes.push(structuredClone(mixed.factory) as never);
 expect(()=>validateSourcePaintKitCatalogue(mixed)).toThrow('lists the factory finish among its finishes');
 // A weapon listing the same finish twice.
 const twice=tampered();
 twice.weapons[1].finishes.push(twice.weapons[1].finishes[0]);
 expect(()=>validateSourcePaintKitCatalogue(twice)).toThrow('lists the same finish twice');
 // A finish whose own wear window is inverted, and one whose colour is out of range.
 const inverted=tampered();
 inverted.weapons[2].finishes[0].wearMinimum=1.5;
 expect(()=>validateSourcePaintKitCatalogue(inverted)).toThrow('wears from');
 const outOfRange=tampered();
 outOfRange.weapons[2].finishes[0].colours[0]=[0,0,300];
 expect(()=>validateSourcePaintKitCatalogue(outOfRange)).toThrow('outside 0..255');
 // A document that cannot say which install it came from, or which build produced it.
 const relabelled=tampered();
 relabelled.cataloguedFrom.manifestSha256='not a digest';
 expect(()=>validateSourcePaintKitCatalogue(relabelled)).toThrow('is not a digest');
 const wrongFormat=tampered();
 wrongFormat.format='something-else';
 expect(()=>validateSourcePaintKitCatalogue(wrongFormat)).toThrow('unexpected format');
 // A factory finish that is not the default kit.
 const wrongFactory=tampered();
 wrongFactory.factory={...wrongFactory.factory,id:'1'};
 expect(()=>validateSourcePaintKitCatalogue(wrongFactory)).toThrow('not the default');
 // The shipped document passes the same validation it refuses tampered copies of.
 expect(validateSourcePaintKitCatalogue(document()).weapons).toHaveLength(6);
});
