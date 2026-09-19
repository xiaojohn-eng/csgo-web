import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import * as T from 'three';
import {createSourceOverlays,validateSourceOverlays,type OverlayManifest,type OverlayGeometry} from '../game/source-overlays';
import {SOURCE_OVERLAYS_RECEIPT} from '../game/source-overlays-data';
const base=new URL('../public/source/csgo-12426148/fidelity-world-20260913/overlays/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8'))as OverlayManifest;
const data=JSON.parse(readFileSync(new URL('geometry.json',base),'utf8'))as OverlayGeometry;
const textures=new Map(manifest.textures.map(t=>[t.source,new T.Texture()]));
function owner(sky:number[]=[]){return createSourceOverlays(manifest,data,textures,m=>m,sky);}
it('keeps original BSP/world identity and independently verifies every emitted receipt',()=>{
 validateSourceOverlays(manifest,data);
 for(const r of [SOURCE_OVERLAYS_RECEIPT,manifest.geometry,...manifest.textures]){
  const bytes=readFileSync(new URL(r.file,base));expect(bytes.length).toBe(r.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(r.sha256);
 }
 expect(data.overlays.filter(r=>[29,30,31,40].includes(r.id)).map(r=>[r.id,r.triangles])).toEqual([[29,332],[30,36],[31,48],[40,64]]);
});
it('draws only visible original receiver triangles and never leaks sky faces into the world',()=>{
 const skyFaces=data.overlays[89].faces,skySet=new Set(skyFaces),o=owner(skyFaces);
 expect(o.world.children.length).toBeGreaterThan(0);expect(o.sky.children.length).toBeGreaterThan(0);
 const wanted=data.overlays[29].faceIds[0],mask=new Uint8Array(wanted+1);mask[wanted]=1;o.setVisibleFaces(mask,0);
 for(const mesh of o.world.children as T.Mesh[]){
  const row=data.overlays.find(r=>r.id===mesh.userData.sourceOverlayId)!;
  for(let i=0;i<mesh.geometry.drawRange.count;i++)expect(row.faceIds[mesh.geometry.index!.getX(i)]).toBe(wanted);
 }
 const skyIndices=(o.sky.children[0]as T.Mesh).geometry.index!.array.slice();
 o.setVisibleFaces(null,0);
 for(const mesh of o.world.children as T.Mesh[]){
  const row=data.overlays.find(r=>r.id===mesh.userData.sourceOverlayId)!;
  for(let i=0;i<mesh.geometry.drawRange.count;i++)expect(skySet.has(row.faceIds[mesh.geometry.index!.getX(i)])).toBe(false);
 }
 expect((o.sky.children[0]as T.Mesh).geometry.index!.array).toEqual(skyIndices);o.dispose();
});
it('retains receiver HDR UVs, original alpha and order; each distance fade affects only that overlay',()=>{
 const o=owner(),get=(id:number)=>o.world.children.find(m=>m.userData.sourceOverlayId===id)as T.Mesh<T.BufferGeometry,T.MeshBasicMaterial>;
 const row=data.overlays.find(r=>r.fadeSquared[0]>=0)!;const mesh=get(row.id);
 expect(Array.from(mesh.geometry.getAttribute('uv1').array)).toEqual(Array.from(new Float32Array(row.lightmapUV)));
 expect(get(29).material.opacity).toBe(.75);expect(mesh.renderOrder).toBe(row.renderOrder);
 const [x,y,z]=row.origin;const camera=new T.Vector3(x*.0254,z*.0254,-y*.0254);
 o.update(camera);expect(mesh.material.opacity).toBe(manifest.materials.find(m=>m.source===row.material)!.opacity);
 camera.x+=Math.sqrt((row.fadeSquared[0]+row.fadeSquared[1])/2)*.0254;o.update(camera);
 expect(mesh.material.opacity).toBeCloseTo(manifest.materials.find(m=>m.source===row.material)!.opacity*.5,6);
 expect(get(29).material).not.toBe(mesh.material);o.dispose();
});
it('fails closed for a mixed receiver triangle and cleans private geometry without disposing borrowed textures',()=>{
 const wrong=structuredClone(data);wrong.overlays[29].faceIds[1]=999999;
 expect(()=>validateSourceOverlays(manifest,wrong)).toThrow(/attribution/);
 const disposals=vi.fn();for(const t of textures.values())t.addEventListener('dispose',disposals);
 const o=owner(),geometryDispose=vi.fn();for(const m of o.world.children as T.Mesh[])m.geometry.addEventListener('dispose',geometryDispose);
 const count=o.world.children.length;o.dispose();o.dispose();expect(geometryDispose).toHaveBeenCalledTimes(count);expect(disposals).not.toHaveBeenCalled();
 expect(()=>o.setVisibleFaces(null,0)).toThrow(/disposed/);
});
