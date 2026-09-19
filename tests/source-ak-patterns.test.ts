import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadSourceAkPatterns,validateSourceAkPatternReceipt,sourceAkPatternFor,sourceAkPatternExists,
  SOURCE_AK_PATTERN_RESOURCE} from '../game/source-ak-patterns';
import manifest from '../game/source-ak-pattern-resources.json';

const staged=resolve('public/source/csgo-12426148/ak-patterns');
const receiptBytes=()=>Uint8Array.from(readFileSync(resolve(staged,SOURCE_AK_PATTERN_RESOURCE)));
const receipt=()=>JSON.parse(new TextDecoder().decode(receiptBytes()));
/** Serves the real staged receipt, or the bytes handed in. */
function serve(value:Uint8Array){
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Blob([value as Uint8Array<ArrayBuffer>]))));
}
beforeEach(()=>serve(receiptBytes()));
afterEach(()=>{vi.unstubAllGlobals();});
const load=()=>loadSourceAkPatterns('/patterns/');

it('stages the original pattern texture of every AK finish whose style samples one',async()=>{
  const {patterns,hashVerified}=await load();
  expect(hashVerified).toEqual({[SOURCE_AK_PATTERN_RESOURCE]:true});
  expect(patterns.provenance).toMatchObject({status:'pattern_inputs_extracted',textures:31,
    styles:[2,5,7],refusedFinishes:3});
  expect(patterns.provenance.catalogueSha256).toMatch(/^[0-9a-f]{64}$/);
  // The export covers the finishes of the styles whose programs read the pattern - 2, 5 and 7 -
  // and the textures are shared: the 25 pattern textures cover 28 finishes, because the four
  // laminates are one pattern in four palettes.
  expect(patterns.entries.filter(entry=>entry.field==='pattern')).toHaveLength(25);
  expect(patterns.entries.filter(entry=>entry.field==='normal')).toHaveLength(6);
  const covered=new Set(patterns.entries.filter(entry=>entry.field==='pattern')
    .flatMap(entry=>entry.paintKitIds));
  expect(covered.size).toBe(28);
  // The laminates are one texture the catalogue resolves for four finishes, which is what a style
  // that combines a pattern with the finish's own palette looks like.
  const laminate=patterns.entries.find(entry=>entry.sourceMaterial.endsWith('laminate_ak47.vtf'))!;
  expect([...laminate.paintKitIds].sort()).toEqual(['1070','14','172','226']);
  // Every entry describes a real original material inside the served tree.
  for(const entry of patterns.entries){
    expect(entry.path.startsWith('png/models/weapons/customization/paints/')).toBe(true);
    expect(entry.sourceMaterial.startsWith('materials/models/weapons/customization/paints/')).toBe(true);
    expect(entry.sourceMaterial.endsWith('.vtf')).toBe(true);
    expect(entry.width).toBeGreaterThan(0);
    expect(entry.width).toBe(entry.height);
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.rgba8Sha256).toMatch(/^[0-9a-f]{64}$/);
  }
});

it('extracts one original texture to the same bytes twice, and hands it to the compositor',async()=>{
  const {patterns}=await load();
  const pattern=sourceAkPatternFor(patterns,282);
  expect(pattern.paintKitId).toBe(282);
  expect(pattern.sourceMaterial)
    .toBe('materials/models/weapons/customization/paints/custom/workshop/elegantredv1.1.vtf');
  expect(pattern.path).toBe('png/models/weapons/customization/paints/custom/workshop/elegantredv1.1.png');
  expect(pattern.width).toBe(2048);
  expect(pattern.height).toBe(2048);
  // The finish the port already composes was extracted by the first pass as one of the
  // shared Redline inputs and by this pass as a pattern; both must be the same texture,
  // so the two independent decodes are compared here rather than assumed equal.
  const shared=JSON.parse(readFileSync('.reference-assets/source-exports/ak47-redline-inputs/inputs.json','utf8'))
    .textures.find((texture:{path:string})=>texture.path.endsWith('elegantredv1.1.vtf'));
  expect(shared).toBeDefined();
  expect(pattern.sha256).toBe(shared.pngSha256);
  expect(pattern.rgba8Sha256).toBe(shared.rgba8Sha256);
  expect(pattern.width).toBe(shared.width);
  expect(pattern.height).toBe(shared.height);
  expect(pattern.vtfFlags).toBe(shared.vtfFlags);
  // A second finish gets its own artwork, not the verified one's.
  const vulcan=sourceAkPatternFor(patterns,302);
  expect(vulcan.sourceMaterial).toBe('materials/models/weapons/customization/paints/custom/workshop/rubber_ak47.vtf');
  expect(vulcan.sha256).not.toBe(pattern.sha256);
  expect(sourceAkPatternExists(patterns,282)).toBe(true);
  expect(sourceAkPatternExists(patterns,302)).toBe(true);
  // Finishes whose style this export never covered, and ids that do not exist.
  expect(sourceAkPatternExists(patterns,3000)).toBe(false);
  expect(()=>sourceAkPatternFor(patterns,3000)).toThrow('staged pattern textures cover finish 3000');
  expect(()=>sourceAkPatternFor(patterns,0)).toThrow('must be a positive integer');
});

it('refuses staged bytes that no longer match the manifest, and a changed receipt',async()=>{
  const pristine=receiptBytes(),tampered=Uint8Array.from(pristine);
  tampered[pristine.byteLength-2]=pristine[pristine.byteLength-2]^0xff;
  serve(tampered);
  await expect(load()).rejects.toThrow('differ from the manifest');
  // The structure is checked on its own too: the staged digest gate means a hand-edited
  // receipt never reaches these rules through the loader, and both gates matter.
  const relabelled=receipt();
  relabelled.weapon='weapon_m4a1';
  expect(()=>validateSourceAkPatternReceipt(relabelled)).toThrow('is for weapon_m4a1');
  const wrongStyle=receipt();
  wrongStyle.styles=[2,5];
  expect(()=>validateSourceAkPatternReceipt(wrongStyle))
    .toThrow('does not cover the style this port compiled');
  const noStyles=receipt();
  noStyles.styles=[];
  expect(()=>validateSourceAkPatternReceipt(noStyles)).toThrow('names no styles');
  // A finish the original leaves ambiguous is recorded rather than staged, and the record keeps the
  // count: the table is what promises a listed finish has artwork, and it does not list these.
  const refused=receipt();
  refused.refusedFinishes=[{paintKitId:'707',reason:'original pattern reference is ambiguous'}];
  expect(validateSourceAkPatternReceipt(refused))
    .toMatchObject({styles:[2,5,7],refusedFinishes:1});
  const noTextures=receipt();
  noTextures.textures=[];
  expect(()=>validateSourceAkPatternReceipt(noTextures)).toThrow('names no textures');
  const noFinishes=receipt();
  noFinishes.finishCount=0;
  expect(()=>validateSourceAkPatternReceipt(noFinishes)).toThrow('covers no finishes');
  const wrongStatus=receipt();
  wrongStatus.status='running';
  expect(()=>validateSourceAkPatternReceipt(wrongStatus)).toThrow('the staged receipt is running');
  expect(()=>validateSourceAkPatternReceipt(null)).toThrow('is not an object');
  // The shipped receipt passes the same validation it refuses tampered copies of.
  expect(validateSourceAkPatternReceipt(receipt()).textures).toBe(31);
  expect(manifest.length).toBe(32);
  expect(manifest.some(entry=>entry.field==='receipt')).toBe(true);
});
