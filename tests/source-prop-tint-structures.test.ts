import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {loadSourcePropTint} from '../game/source-prop-tint-loader';
import {sourcePropTintCandidate} from '../game/source-prop-tint';
import {loadSourcePropStructuralTint,SOURCE_STRUCTURAL_TINT_MATERIALS} from '../game/source-prop-tint-structures';

vi.mock('../game/source-prop-tint-loader',()=>({loadSourcePropTint:vi.fn()}));
const rgba=new Uint8Array(readFileSync('.reference-assets/source-exports/dust2-vhv/tint/instance-rgba.u8'));
function fixture() {
  const dispose=vi.fn(),oldTexture=new T.Texture(),newTexture=new T.Texture();
  const borrowed={rgba:rgba.slice(),materials:new Map([['existing',{source:'existing.vtf',texture:oldTexture}]])};
  const owner={rgba:rgba.slice(),materials:new Map(SOURCE_STRUCTURAL_TINT_MATERIALS.map(source=>[source,{source:'materials/'+source+'_tint.vtf',texture:newTexture}])),
    audit:{textures:4,textureBytesIncludingMipmaps:4543824,checkedBytes:12632,hashVerified:true,originalInstanceCount:3158,instanceAlphaUsed:false,manualColorAdjustment:false,branch:"fixture"},dispose};
  vi.mocked(loadSourcePropTint).mockResolvedValue(owner as Awaited<ReturnType<typeof loadSourcePropTint>>);
  return {borrowed,owner,dispose,oldTexture};
}
afterEach(()=>vi.clearAllMocks());
it('matches only original VMTs in the verified shader branch and unambiguous VHV records',()=>{
  const catalog=JSON.parse(readFileSync('research/source-prop-material-branches.json','utf8'));
  const selected=SOURCE_STRUCTURAL_TINT_MATERIALS.map(source=>catalog.materials.find((m:{source:string})=>m.source===source));
  expect(selected).toHaveLength(4);
  for(const material of selected){expect(sourcePropTintCandidate(material.parameters)).toBe(true);expect(material.ambiguousMeshes).toBe(0);}
  expect(selected.reduce((n,m)=>n+m.meshInstances,0)).toBe(181);
  expect(selected.reduce((n,m)=>n+m.triangles,0)).toBe(204543);
});
it('merges without mutating or disposing borrowed R4 ownership',async()=>{
  const {borrowed,dispose,oldTexture}=fixture(),oldDispose=vi.fn();oldTexture.addEventListener('dispose',oldDispose);
  const owner=await loadSourcePropStructuralTint({baseURL:'http://192.168.1.2/tint-structures/',borrowedTint:borrowed});
  expect(owner.materials.size).toBe(5);expect(borrowed.materials.size).toBe(1);
  expect(owner.materials.get('existing')).toBe(borrowed.materials.get('existing'));expect(owner.rgba).toBe(borrowed.rgba);
  owner.dispose();expect(dispose).toHaveBeenCalledOnce();expect(oldDispose).not.toHaveBeenCalled();
});
it('fails borrowed identity before allocating and releases only the new owner on late scope mismatch',async()=>{
  let f=fixture();f.borrowed.rgba[0]^=1;
  await expect(loadSourcePropStructuralTint({baseURL:'http://localhost/',borrowedTint:f.borrowed})).rejects.toThrow(/Borrowed.*identity/);
  expect(loadSourcePropTint).not.toHaveBeenCalled();
  f=fixture();f.owner.materials.get(SOURCE_STRUCTURAL_TINT_MATERIALS[0])!.source='materials/wrong.vtf';
  await expect(loadSourcePropStructuralTint({baseURL:'http://localhost/',borrowedTint:f.borrowed})).rejects.toThrow(/material identity/);
  expect(f.dispose).toHaveBeenCalledOnce();expect(f.borrowed.materials.size).toBe(1);
});
it('rejects collisions instead of replacing a borrowed material entry',async()=>{
  const {borrowed,dispose}=fixture();borrowed.materials.set(SOURCE_STRUCTURAL_TINT_MATERIALS[0],borrowed.materials.get('existing')!);
  await expect(loadSourcePropStructuralTint({baseURL:'http://localhost/',borrowedTint:borrowed})).rejects.toThrow(/material identity/);
  expect(dispose).toHaveBeenCalledOnce();expect(borrowed.materials.size).toBe(2);
});
