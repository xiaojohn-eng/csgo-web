import {describe,it,expect} from 'vitest';
import * as T from 'three';
import {applySourcePropMips,type SourcePropMipRecord} from '../game/source-map-prop-mips';
import {sourceMapCapabilities} from '../game/source-map-capabilities';

function fixture(slot:'map'|'normalMap'='map'){
  const original={width:4,height:4} as ImageBitmap;
  const texture=new T.Texture(original);texture.flipY=false;texture.colorSpace=slot==='map'?T.SRGBColorSpace:T.NoColorSpace;
  const levels=[{width:2,height:2},{width:1,height:1}] as ImageBitmap[];
  const record:SourcePropMipRecord={materialIndex:1,material:'original',slot,textureIndex:2,source:'original.vtf',
    sourceSha256:'a'.repeat(64),width:4,height:4,mipCount:3,normalGreenInverted:slot==='normalMap',
    levels:levels.map((l,i)=>({...l,level:i+1,file:i+'.png',bytes:16,sha256:'a'.repeat(64),rgbaSha256:'a'.repeat(64)}))};
  return {record,texture,levels};
}
describe('original prop mip resource owner',()=>{
  it('toggles all existing material borrowers without altering UV/color/alpha or base mip',()=>{
    const base=fixture(),normal=fixture('normalMap');
    const a=new T.MeshStandardMaterial({map:base.texture,normalMap:normal.texture,alphaTest:.5});
    const b=a.clone(),original=base.texture.image,old=base.texture.mipmaps;
    const owner=applySourcePropMips([base,normal]);
    expect(owner.audit.enabled).toBe(true);expect(a.map).toBe(b.map);expect(a.normalMap).toBe(b.normalMap);
    expect(base.texture.mipmaps).toEqual([original,...base.levels]);expect(base.texture.generateMipmaps).toBe(false);
    expect(base.texture.image).toBe(original);expect(base.texture.matrix.elements).toEqual(new T.Matrix3().elements);
    const before=base.texture.version;owner.setEnabled(false);
    expect(base.texture.version).toBeGreaterThan(before);expect(base.texture.mipmaps).toBe(old);expect(base.texture.generateMipmaps).toBe(true);
    owner.setEnabled(true);expect(b.map!.mipmaps).toHaveLength(3);expect(b.alphaTest).toBe(.5);
    owner.dispose();owner.dispose();expect(base.texture.mipmaps).toBe(old);expect(()=>owner.setEnabled(true)).toThrow('disposed');
  });
  it('validates every chain before mutating any borrowed texture',()=>{
    const first=fixture(),bad=fixture('normalMap');bad.levels[1]={width:2,height:1} as ImageBitmap;
    expect(()=>applySourcePropMips([first,bad])).toThrow('dimensions');expect(first.texture.mipmaps).toEqual([]);expect(first.texture.generateMipmaps).toBe(true);
    expect(()=>applySourcePropMips([first,first])).toThrow('identity');
  });
  it('rejects a normal channel/colorspace mismatch and retains disabled initial state',()=>{
    const normal=fixture('normalMap');normal.texture.colorSpace=T.SRGBColorSpace;
    expect(()=>applySourcePropMips([normal])).toThrow('identity');
    const base=fixture(),owner=applySourcePropMips([base],false);expect(base.texture.mipmaps).toEqual([]);
    owner.setEnabled(true);expect(base.texture.mipmaps).toHaveLength(3);owner.dispose();
  });
});
describe('runtime capability scope',()=>{
  const history=['Original world directional bump lightmaps and secondary displacement textures pending',
    'Source sky clouds: the port still does not auto-expose, draw sun or LUT','Original collision boundaries remain'];
  it('preserves historical receipts but reports actually installed world layers and scene ownership',()=>{
    const r=sourceMapCapabilities(history,{decorated:85,limitations:['Native vertex-alpha quantization remains under audit']});
    expect(r.sourceManifestLimitations).toEqual(history);expect(history).toHaveLength(3);
    expect(r.limitations).toEqual(['Original collision boundaries remain','Native vertex-alpha quantization remains under audit']);
    expect(r.runtimeCapabilities.worldLayers.applied).toBe(true);expect(r.runtimeCapabilities.environment.owner).toBe('scene / WorldComposite');
  });
  it('does not claim enabled world layers when its owner is disabled',()=>{
    const r=sourceMapCapabilities(history,null);expect(r.runtimeCapabilities.worldLayers.applied).toBe(false);
    expect(r.limitations.at(-1)).toContain('disabled');
  });
});
