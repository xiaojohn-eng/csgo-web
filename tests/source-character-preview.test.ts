import {afterEach,describe,expect,it,vi} from 'vitest';
import * as T from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {applySourceCharacterPreview} from '../scripts/preview-source-character';

const names=['tm_leet_upperbody_variantA','tm_leet_lowerbody_variantA','tm_elite_head_variantA','ak47'];
function fixture(materialNames=names){
  const scene=new T.Group();
  for(const name of materialNames){const material=new T.MeshBasicMaterial();material.name=name;scene.add(new T.Mesh(new T.BufferGeometry(),material));}
  return {scene,animations:[],cameras:[],scenes:[scene],asset:{version:'2.0'},parser:{},userData:{}} as unknown as GLTF;
}
afterEach(()=>vi.restoreAllMocks());
describe('private source character preview installation',()=>{
  it('rejects partial or approximate material matches before reading any texture',async()=>{
    const loader=vi.spyOn(T.TextureLoader.prototype,'loadAsync');
    await expect(applySourceCharacterPreview(fixture(names.slice(0,3)),'/assets/character-ak/')).rejects.toThrow(/ak47/);
    await expect(applySourceCharacterPreview(fixture([...names,'tm_leet_upperbody_variantA.001']),'/assets/character-ak/')).rejects.toThrow(/exact/);
    expect(loader).not.toHaveBeenCalled();
  });
  it('replaces every exact original slot after all 11 original textures load and restores them on idempotent cleanup',async()=>{
    // Node has no image decoder/DOM. Only that external boundary is replaced;
    // matching, real Three materials, shader factories and cleanup remain real.
    const loaded:T.Texture[]=[];const urls:string[]=[];
    vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(async url=>{
      urls.push(url);const texture=new T.Texture<HTMLImageElement>();loaded.push(texture);return texture;
    });
    const gltf=fixture([...names,'ak47']),meshes=gltf.scene.children as T.Mesh[],originals=meshes.map(m=>m.material);
    const audit=await applySourceCharacterPreview(gltf,'/assets/source-exports/character-ak/');
    expect(audit.textureCount).toBe(11);expect(audit.materialCount).toBe(4);expect(audit.meshCount).toBe(5);
    expect(urls).toHaveLength(11);expect(new Set(urls).size).toBe(11);
    expect(urls).toContain('/assets/source-exports/character-ak/textures/tm_elite_head_varianta_normal.png');
    expect(urls).toContain('/assets/source-exports/character-ak/textures/ak47_exponent.png');
    expect(meshes.every(m=>m.material instanceof T.MeshPhongMaterial)).toBe(true);
    expect(meshes[3].material).toBe(meshes[4].material);
    await expect(applySourceCharacterPreview(gltf,'/assets/source-exports/character-ak/')).rejects.toThrow(/already/);
    let disposed=0;for(const t of loaded)t.addEventListener('dispose',()=>disposed++);
    audit.dispose();audit.dispose();expect(disposed).toBe(11);
    expect(meshes.map(m=>m.material)).toEqual(originals);
  });
  it('leaves the original scene intact and releases successful loads when one raw image fails',async()=>{
    const loaded:T.Texture[]=[];let disposed=0;
    vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(async url=>{
      if(url.endsWith('/ak47_exponent.png'))throw new Error('fixture missing original image');
      const texture=new T.Texture<HTMLImageElement>();texture.addEventListener('dispose',()=>disposed++);loaded.push(texture);return texture;
    });
    const gltf=fixture(),meshes=gltf.scene.children as T.Mesh[],originals=meshes.map(m=>m.material);
    await expect(applySourceCharacterPreview(gltf,'/assets/character-ak/')).rejects.toThrow(/original texture/);
    expect(loaded).toHaveLength(10);expect(disposed).toBe(10);expect(meshes.map(m=>m.material)).toEqual(originals);
  });
});
