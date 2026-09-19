import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import * as T from 'three';
import {loadSourceDroppedWeaponRenderer} from '../game/source-dropped-weapon-renderer';
import {SOURCE_DROPPED_WEAPONS,type SourceDroppedWeaponState} from '../game/source-dropped-weapons';
import resources from '../game/source-dropped-weapon-resources.json';

const directory=resolve(existsSync('output/fidelity-character/dropped-weapons/models.json')?'output/fidelity-character/dropped-weapons':'public/source/csgo-12426148/dropped-weapons-20260913');
const state=(weapon:typeof SOURCE_DROPPED_WEAPONS[number],id:string=weapon):SourceDroppedWeaponState=>({id,weapon,ownerId:'victim',createdAt:1,position:[3,2,-4],quaternion:[0,0,0,1],velocity:[0,0,0],angularVelocity:[0,0,0],sleeping:false,magazineVisible:true,silencerVisible:true});
function localAssets(tamper?:string){
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const path=url.replace('http://dropped/',''),bytes=readFileSync(resolve(directory,path));if(path===tamper)bytes[0]^=1;return new Response(bytes);}));
 // Source PNG bytes still pass SHA validation. Only image decoding is replaced
 // for CPU checks; no claim is made about shader/GPU appearance here.
 vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(async()=>new T.Texture());
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('the six original model_dropped meshes and finish ownership',()=>{
 it('loads outward geometry with original textures and keeps per-drop finish/bodygroups independent',async()=>{
  localAssets();const created:T.Group[]=[],removed:T.Group[]=[],onCreate=vi.fn((root:T.Group,s:SourceDroppedWeaponState)=>{expect(root.position.toArray()).toEqual(s.position);created.push(root);}),owner=await loadSourceDroppedWeaponRenderer('http://dropped/',{onCreate,onRemove:root=>removed.push(root)});
  owner.sync(SOURCE_DROPPED_WEAPONS.map(w=>state(w)));expect(created).toHaveLength(6);expect(Object.keys(owner.verified).length).toBeGreaterThan(20);
  const expected:Record<string,string>={vandal:'Source_AK47_VertexLitGeneric',m4a4:'Source_World_M4A4_VertexLitGeneric',awp:'Source_AWP_World_VertexLitGeneric',glock:'Source_World_glock_VertexLitGeneric',usp:'Source_World_usp_VertexLitGeneric',deagle:'Source_World_Deagle_VertexLitGeneric'};
  for(const weapon of SOURCE_DROPPED_WEAPONS){const root=owner.root(weapon)!;let count=0,positive=0,negative=0;const materialNames=new Set<string>();
   root.traverse(o=>{if(!(o instanceof T.Mesh))return;const geometry=o.geometry,p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv'),idx=geometry.index!;expect(p.count).toBe(n.count);expect(p.count).toBe(uv.count);count+=p.count;expect(o.name).not.toContain('holsterstrap');
    const material=o.material as T.MeshPhongMaterial;materialNames.add(material.name);expect(material.userData.sourceVMT).toContain('materials/models/weapons/');expect(material.map!.colorSpace).toBe(T.SRGBColorSpace);expect(material.map!.flipY).toBe(false);
    for(let i=0;i<idx.count;i+=3){const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2);expect(Math.max(a,b,c)).toBeLessThan(p.count);const face=new T.Vector3().subVectors(new T.Vector3().fromBufferAttribute(p,b),new T.Vector3().fromBufferAttribute(p,a)).cross(new T.Vector3().subVectors(new T.Vector3().fromBufferAttribute(p,c),new T.Vector3().fromBufferAttribute(p,a))),normal=new T.Vector3().fromBufferAttribute(n,a).add(new T.Vector3().fromBufferAttribute(n,b)).add(new T.Vector3().fromBufferAttribute(n,c));if(face.dot(normal)>1e-8)positive++;else if(face.dot(normal)<-1e-8)negative++;}
   });expect(count).toBeGreaterThan(2000);expect(materialNames.has(expected[weapon])).toBe(true);expect(positive/(positive+negative)).toBeGreaterThan(.98);
   const size=new T.Box3().setFromObject(root).getSize(new T.Vector3());expect(size.length()).toBeGreaterThan(.2);expect(size.length()).toBeLessThan(1.6);
  }
  const first=owner.root('usp')!;owner.sync([{...state('usp'),magazineVisible:false,silencerVisible:false},{...state('usp','second'),position:[0,4,0]}]);expect(removed).toHaveLength(5);expect(owner.root('usp')).toBe(first);expect(created).toHaveLength(7);
  const bodygroups=(root:T.Group,kind:string)=>{const out:T.Object3D[]=[];root.traverse(o=>{if(o.userData.sourceDroppedBodygroup===kind)out.push(o);});return out;};
  expect(bodygroups(first,'mag')).toHaveLength(1);expect(bodygroups(first,'mag')[0].visible).toBe(false);expect(bodygroups(first,'silencer')[0].visible).toBe(false);expect(bodygroups(owner.root('second')!,'mag')[0].visible).toBe(true);
  owner.clear();expect(removed).toHaveLength(7);expect(owner.group.children).toHaveLength(0);owner.dispose();owner.dispose();expect(removed).toHaveLength(7);
 });
 it('rejects changed source mesh bytes before publishing any renderer',async()=>{localAssets('vandal/mesh.bin');await expect(loadSourceDroppedWeaponRenderer('http://dropped/')).rejects.toThrow('SHA mismatch');expect(resources.some(f=>f.path==='vandal/mesh.bin')).toBe(true);});
});
