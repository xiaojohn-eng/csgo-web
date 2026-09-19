import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {groupSourceKitInputs,loadSourceKitWeapon,SOURCE_KIT_SAMPLED_ROLES,SOURCE_KIT_STAGED_ROLES}
  from '../game/source-kit-inputs';
import {createSourceKitFinishResolver} from '../game/source-kit-finishes';
import {sourceRedlineSkinParameters} from '../game/source-redline-seed';
import {sourceRedlinePhongMaterialValue} from '../game/source-redline-parameters';
import manifest from '../game/source-kit-input-resources.json';
import {SOURCE_FINISHES,SOURCE_FINISH_WEAPONS} from '../game/source-finish-table';

const kitRoot=resolve('public/source/csgo-12426148/kit-inputs-fidelity-20260913');
/** Every weapon whose inputs are staged per weapon: each one's own receipt is served by name. */
const STAGED_WEAPONS=['weapon_ak47','weapon_m4a1','weapon_awp','weapon_glock','weapon_usp_silencer','weapon_deagle'];
const receipt=(weapon='weapon_m4a1')=>readFileSync(resolve(kitRoot,`${weapon}/inputs.json`));
function serve(){
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    const text=String(url);
    for(const weapon of STAGED_WEAPONS)
      if(text.includes(`kit-inputs-fidelity-20260913/${weapon}/inputs.json`))
        return new Response(new Blob([receipt(weapon) as unknown as Uint8Array<ArrayBuffer>]));
    if(text.includes('skins/paint-kits.json'))
      return new Response(new Blob([readFileSync('public/source/csgo-12426148/skins/paint-kits.json') as unknown as Uint8Array<ArrayBuffer>]));
    return new Response(null,{status:404});
  }));
}
beforeEach(()=>serve());
afterEach(()=>{vi.unstubAllGlobals();});
const load=()=>loadSourceKitWeapon('weapon_m4a1','/kit-inputs-fidelity-20260913/weapon_m4a1/');
const resolver=()=>createSourceKitFinishResolver({weapon:'weapon_m4a1',
  catalogueBaseURL:'/source/csgo-12426148/skins/',kitBaseURL:'/source/csgo-12426148/kit-inputs-fidelity-20260913/'});

it('loads a weapon\'s own inputs, Phong values and staged finishes',async()=>{
  const {weapon,hashVerified}=await load();
  expect(hashVerified).toEqual({'inputs.json':true});
  // The weapon's own Phong values, which differ from the AK's 35 — this is the reason the
  // composition has to be told which weapon it is composing.
  expect(weapon.kit.phong).toMatchObject({phongBoost:2,phongAlbedoBoost:25,phongFresnelRanges:[.83,.83,1]});
  expect(weapon.kit.weapon).toBe('weapon_m4a1');
  // Every staged role, at the sampler the original program reads it at: the five the style-7
  // composition binds, then the mask and the object-space position the other styles read.
  expect(weapon.kit.inputs.map(input=>input.sampler)).toEqual([0,1,2,3,5,4,7,6]);
  expect(weapon.kit.inputs.map(input=>input.source.split('/').pop())).toEqual([
    'rif_m4a1_ao.vtf','paint_wear.vtf','rif_m4a1_exponent.vtf','rif_m4a1.vtf','gun_grunge.vtf',
    'rif_m4a1_masks.vtf','rif_m4a1_pos.vtf','rif_m4a1_surface.vtf']);
  for(const input of weapon.kit.inputs){
    expect(input.path.startsWith('png/models/weapons/')).toBe(true);
    expect(input.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(input.rgba8Sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Math.max(input.width,input.height)).toBeLessThanOrEqual(2048);
  }
  // Twenty-two finishes have their own pattern staged - every finish whose style samples one and
  // whose reference the original resolves to a single texture - and the original's four ambiguous
  // ones are carried as refusals rather than silently dropped.
  expect(weapon.kit.patternIds).toHaveLength(38);
  expect([...weapon.kit.refusedFinishes].sort()).toEqual([]);
  for(const refused of weapon.kit.refusedFinishes)
    expect(()=>weapon.patternFor(Number(refused))).toThrow('staged pattern textures cover finish');
});

it('gives a finish its own pattern texture, and refuses one the original does not resolve',async()=>{
  const {weapon}=await load();
  const howl=weapon.patternFor(309);
  expect(howl.paintKitId).toBe(309);
  expect(howl.sourceMaterial).toBe('materials/models/weapons/customization/paints/custom/workshop/howling_m4a1.vtf');
  expect(howl.path).toBe('png/models/weapons/customization/paints/custom/workshop/howling_m4a1.png');
  expect(howl.width).toBe(2048);
  const second=weapon.patternFor(255);
  expect(second.sourceMaterial).toBe('materials/models/weapons/customization/paints/custom/workshop/zone9_m4.vtf');
  expect(second.sha256).not.toBe(howl.sha256);
  expect(()=>weapon.patternFor(9999)).toThrow('cover finish 9999');
  expect(()=>weapon.patternFor(0)).toThrow('must be a positive integer');
});

it('resolves a finish to its own numbers, its weapon\'s inputs and its own artwork',async()=>{
  const finishes=resolver();
  const howl=await finishes.resolve(309);
  expect(howl.weapon).toBe('weapon_m4a1');
  expect(howl.kit.paintKitId).toBe(309);
  expect(howl.kit.phongExponent).toBe(50);
  expect(howl.kit.phongIntensity).toBe(60);
  expect(howl.kit.wearMinimum).toBe(0);
  expect(howl.kit.wearMaximum).toBeCloseTo(.4,6);
  expect(howl.phong).toMatchObject({phongBoost:2,phongAlbedoBoost:25,phongFresnelRanges:[.83,.83,1]});
  expect(howl.inputs).toHaveLength(8);
  // The composition parameters take the weapon's own Phong values, so the same finish
  // composed on a weapon with a different albedo boost would differ — which is why they
  // travel rather than being constants.
  const parameters=sourceRedlineSkinParameters({paintKitId:309,seed:422,wear:.2},howl.kit,howl.phong);
  expect(parameters.phongAlbedoFactor).toBe(25);
  // The finish's own intensity 60, divided by the weapon's boost 2 and turned into a
  // material value the way the original caller does.
  expect(parameters.phongIntensity).toBe(sourceRedlinePhongMaterialValue(30));
  // Against the AK's own Phong values, the same finish composes differently: the albedo
  // factor is the weapon's, and the two weapons carry different ones. (Their Phong
  // *boosts* are both 2, so the intensity comes out the same — which is why the albedo
  // factor is the value that shows the difference, and why a weapon with another boost
  // is asked for separately below.)
  const akParameters=sourceRedlineSkinParameters({paintKitId:309,seed:422,wear:.2},howl.kit);
  expect(akParameters.phongAlbedoFactor).toBe(35);
  expect(akParameters.phongExponent).toBe(parameters.phongExponent);
  expect(akParameters.phongIntensity).toBe(parameters.phongIntensity);
  // The boost is the divisor, so a weapon carrying another one composes another intensity.
  const boosted=sourceRedlineSkinParameters({paintKitId:309,seed:422,wear:.2},howl.kit,
    {phongBoost:3,phongAlbedoBoost:25,phongFresnelRanges:[.83,.83,1]});
  expect(boosted.phongIntensity).toBe(sourceRedlinePhongMaterialValue(20));
  expect(boosted.phongIntensity).not.toBe(parameters.phongIntensity);
  // A weapon with no usable Phong values is refused rather than composed with a guess.
  expect(()=>sourceRedlineSkinParameters({paintKitId:309,seed:422,wear:.2},howl.kit,
    {phongBoost:0,phongAlbedoBoost:25,phongFresnelRanges:[.83,.83,1]})).toThrow('Phong boost must be a positive integer');
  expect(()=>sourceRedlineSkinParameters({paintKitId:309,seed:422,wear:.2},howl.kit,
    {phongBoost:2,phongAlbedoBoost:-1,phongFresnelRanges:[.83,.83,1]})).toThrow('albedo boost must be a positive integer');
  // Only the finishes this weapon can actually compose are offered: the style-7 ones, the style-2
  // ones whose pattern transform the kit fully determines, the style-5 ones whose own albedo boost
  // divides the weapon's, and the solid-colour one.
  const available=await finishes.available();
  expect([...available]).toEqual(SOURCE_FINISHES.m4a4.map(row=>row.paintKitId));
  expect(available).toHaveLength(39);
  // The solid-colour style composes from the finish's own four colours and binds no pattern: its
  // program declares no pattern sampler, so there is nothing to wait for.
  const tornado=await finishes.resolve(101);
  expect(tornado.kit.style).toBe(1);
  expect(tornado.pattern).toBeNull();
  expect(tornado.kit.colours[0]).toEqual([51,61,77]);
  // A style that combines the finish's own pattern with the finish's own colours resolves its own
  // artwork, and its pattern transform is drawn from the kit's own ranges: two seeds shift it.
  const desert=await finishes.resolve(8);
  expect(desert.kit.style).toBe(2);
  expect(desert.pattern!.sourceMaterial).toContain('desert_spots');
  expect(desert.pattern!.sha256).not.toBe(howl.pattern!.sha256);
  const shift=(seed:number)=>sourceRedlineSkinParameters({paintKitId:8,seed,wear:.2},
    desert.kit,desert.phong).sourceUVFields.pattern;
  expect(shift(1)).not.toEqual(shift(2));
  for(const seed of [1,2]){
    const fields=shift(seed);
    expect(fields[1]).toBeGreaterThanOrEqual(0); expect(fields[1]).toBeLessThanOrEqual(1);
    expect(fields[3]).toBeGreaterThanOrEqual(0); expect(fields[3]).toBeLessThanOrEqual(360);
  }
  // A style this port builds no program for, a finish whose pattern is scaled by the weapon's own
  // size, a finish whose original artwork is ambiguous, one that carries a normal map the program
  // cannot sample, and one no M4A1 finish carries.
  expect((await finishes.resolve(167)).kit.style).toBe(3);
  const jungle=await finishes.resolve(16);
  expect(jungle.kit.textureScale).toBe(Math.fround(.425));
  expect((await finishes.resolve(155)).pattern!.sourceMaterial).toBe('materials/models/weapons/customization/paints/custom/bullet_rain_m4.vtf');
  expect((await finishes.resolve(695)).normal?.sourceMaterial).toContain('_normal.vtf');
  await expect(finishes.resolve(282)).rejects.toThrow('is not an original weapon_m4a1 finish');
  // A finish that carries its own albedo boost divides the weapon's, and the AWP's own is 40, so a
  // kit of 40 composes at exactly 1 — the original's own branch, executed and recorded by
  // `scripts/probe-source-redline-phong.py` (material 35 with kit 8 gives 4.375).
  const awpFinishes=createSourceKitFinishResolver({weapon:'weapon_awp',
    catalogueBaseURL:'/source/csgo-12426148/skins/',kitBaseURL:'/source/csgo-12426148/kit-inputs-fidelity-20260913/'});
  const lightning=await awpFinishes.resolve(51);
  expect(lightning.kit.style).toBe(5);
  expect(lightning.kit.phongAlbedoBoost).toBe(40);
  // Its own wear window is 0..0.08, so the sample is taken inside it.
  expect(sourceRedlineSkinParameters({paintKitId:51,seed:422,wear:.05},lightning.kit,lightning.phong)
    .phongAlbedoFactor).toBe(1);
  const sunrise=await finishes.resolve(471);
  expect(sourceRedlineSkinParameters({paintKitId:471,seed:422,wear:.05},sunrise.kit,sunrise.phong)
    .phongAlbedoFactor).toBe(Infinity);
});

it('reads a third weapon\'s own Phong values, which differ again',async()=>{
  const {weapon}=await loadSourceKitWeapon('weapon_awp','/kit-inputs-fidelity-20260913/weapon_awp/');
  // The AWP's material carries albedo boost 40 where the AK-47's carries 35 and the M4A1's
  // 25, and different Fresnel stops from both. All three are the weapon's own original
  // values, which is why nothing about them may be inherited from another weapon.
  expect(weapon.kit.phong).toMatchObject({phongBoost:2,phongAlbedoBoost:40,phongFresnelRanges:[.8,.8,1]});
  expect(weapon.kit.inputs.map(input=>input.source.split('/').pop())).toEqual([
    'snip_awp_ao.vtf','paint_wear.vtf','awp_exponent.vtf','awp.vtf','gun_grunge.vtf',
    'snip_awp_masks.vtf','snip_awp_pos.vtf','snip_awp_surface.vtf']);
  // The two the styles other than 7 sample are linear, which is what the original's own sampling
  // flags say for slots 4 and 7; every input here reports the space the original samples it in.
  expect(weapon.kit.inputs.map(input=>[input.sampler,input.srgb])).toEqual([
    [0,true],[1,false],[2,false],[3,true],[5,true],[4,false],[7,false],[6,false]]);
  expect(weapon.kit.patternIds).toHaveLength(39);
  expect([...weapon.kit.refusedFinishes].sort()).toEqual([]);
  // Twenty-one finishes have their own pattern staged; three of them also carry a normal map, which
  // is why the composition cannot draw those, and five the original leaves ambiguous.
  const medusa=weapon.patternFor(279);
  expect(medusa.sourceMaterial)
    .toBe('materials/models/weapons/customization/paints/custom/workshop/zone9_awp.vtf');
  expect(medusa.path).toBe('png/models/weapons/customization/paints/custom/workshop/zone9_awp.png');
  expect(medusa.width).toBe(2048);
});

it('offers every weapon exactly the finishes the generated table lists',async()=>{
  // The menu, the transport rule and the composition path all have to agree per weapon: a resolver
  // that offered more would promise a finish the composition refuses, and one that offered less
  // would hide a finish it can draw.
  for(const weapon of STAGED_WEAPONS){
    const entry=SOURCE_FINISH_WEAPONS.find(candidate=>candidate.originalWeapon===weapon)!;
    const finishes=createSourceKitFinishResolver({weapon,
      catalogueBaseURL:'/source/csgo-12426148/skins/',kitBaseURL:'/source/csgo-12426148/kit-inputs-fidelity-20260913/'});
    const available=[...await finishes.available()].sort((one,two)=>one-two);
    expect(available).toEqual(SOURCE_FINISHES[entry.id].map(finish=>finish.paintKitId));
    // And each one resolves, which is what makes the offer true rather than only listed.
    for(const paintKitId of available) await expect(finishes.resolve(paintKitId)).resolves.toBeDefined();
  }
});

it('refuses a staged manifest that does not describe a composable weapon',()=>{
  const rows=()=>structuredClone(manifest) as unknown as Record<string,unknown>[];
  expect(()=>groupSourceKitInputs(null)).toThrow('holds no entries');
  expect(()=>groupSourceKitInputs([])).toThrow('holds no entries');
  expect(()=>groupSourceKitInputs([{weapon:''}])).toThrow('names no weapon');
  // A missing sampled role, so the weapon could not be composed at all.
  expect(()=>groupSourceKitInputs(manifest.filter(entry=>entry.role!=='gunGrunge')))
    .toThrow('stages 0 textures for role gunGrunge, not one');
  // A role staged twice, which would make the binding ambiguous.
  const twice=rows(),duplicated=manifest.find(entry=>entry.role==='ao'&&entry.weapon==='weapon_m4a1')!;
  twice.push({...duplicated});
  expect(()=>groupSourceKitInputs(twice)).toThrow(`stages ${duplicated.path} twice`);
  // A path outside the served tree, and a texture outside the composed budget.
  expect(()=>groupSourceKitInputs(rows().map((entry,index)=>index===0?{...entry,path:'../escape.png'}:entry)))
    .toThrow('is not inside the served tree');
  expect(()=>groupSourceKitInputs(rows().map((entry)=>entry.role==='ao'?{...entry,width:4096}:entry)))
    .toThrow('is outside the composed texture budget');
  // Digests that are not digests.
  expect(()=>groupSourceKitInputs(rows().map((entry)=>entry.role==='ao'?{...entry,sha256:'nope'}:entry)))
    .toThrow('is not a digest');
  expect(()=>groupSourceKitInputs(rows().map((entry)=>entry.role==='ao'?{...entry,rgba8Sha256:''}:entry)))
    .toThrow('is not a digest');
  // No receipt means the weapon's own Phong values would be unknown.
  expect(()=>groupSourceKitInputs(manifest.filter(entry=>entry.role!=='receipt')))
    .toThrow('stages no receipt');
  // A sampled role without a sampler could not be bound.
  expect(()=>groupSourceKitInputs(rows().map((entry)=>entry.role==='ao'?{...entry,sampler:-1}:entry)))
    .toThrow('ao carries no sampler');
  // The shipped manifest passes every one of those rules.
  expect(groupSourceKitInputs(manifest).get('weapon_m4a1')).toHaveLength(
    manifest.filter(entry=>entry.weapon==='weapon_m4a1').length);
  expect(SOURCE_KIT_SAMPLED_ROLES).toHaveLength(5);
  // The catalogue carries two roles beyond the five style 7 samples: the mask and the object-space
  // position, which the colour and exponent passes of the other styles declare (MasksSampler is
  // slot 4 and OSPosSampler slot 7 in the permutations' own constant tables). They are staged for
  // every weapon, and a weapon missing one is refused even though style 7 does not read it.
  expect(SOURCE_KIT_STAGED_ROLES).toEqual([...SOURCE_KIT_SAMPLED_ROLES,'mask','osPos','surface']);
  for (const [role,sampler] of [['mask',4],['osPos',7],['surface',6]] as const) {
    const entries = manifest.filter((entry)=>entry.role===role);
    expect(entries.length).toBeGreaterThanOrEqual(5);
    expect(new Set(entries.map((entry)=>entry.sampler))).toEqual(new Set([sampler]));
  }
  expect(()=>groupSourceKitInputs(manifest.filter((entry)=>entry.role!=='mask')))
    .toThrow(/stages 0 textures for role mask, not one/);
});
