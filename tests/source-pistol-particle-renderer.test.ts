import {afterEach,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as T from 'three';
import {loadSourcePistolParticleRenderer} from '../game/source-pistol-particles-renderer';
import resources from '../game/source-pistol-particle-resources.json';
const root=resolve('public/source/csgo-12426148/pistol-particles');
const files=new Map(resources.map(row=>[row.path,Uint8Array.from(readFileSync(resolve(root,row.path)))]));
const muzzle={position:new T.Vector3(2,-3,4),forward:new T.Vector3(0,0,7)};
type Owner=Awaited<ReturnType<typeof loadSourcePistolParticleRenderer>>;
const owners:Owner[]=[];
afterEach(()=>{for(const owner of owners.splice(0))owner.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();});
function mockResources(options:{corrupt?:string;missing?:string;signal?:AbortSignal}={}){
 const state={textures:[]as T.Texture<HTMLImageElement>[],disposed:[]as T.Texture<HTMLImageElement>[],created:[]as string[],revoked:[]as string[],blobs:new Map<string,Blob>(),decode:async(texture:T.Texture<HTMLImageElement>,_index:number)=>texture};
 vi.stubGlobal('crypto',undefined); // Same SHA fallback required on HTTP LAN origins.
 const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
  expect(init?.signal).toBe(options.signal);init?.signal?.throwIfAborted();
  expect(url.startsWith('/particle-fixture/')).toBe(true);
  const name=url.slice('/particle-fixture/'.length),original=files.get(name);
  if(name===options.missing||!original)return new Response(null,{status:404});
  const bytes=Uint8Array.from(original);if(name===options.corrupt)bytes[bytes.length-1]^=1;
  return new Response(new Blob([bytes]));
 });vi.stubGlobal('fetch',fetch);
 vi.spyOn(URL,'createObjectURL').mockImplementation(blob=>{if(!(blob instanceof Blob))throw Error('Expected verified image Blob');const url='blob:particle-owner-'+state.created.length;state.created.push(url);state.blobs.set(url,blob);return url;});
 vi.spyOn(URL,'revokeObjectURL').mockImplementation(url=>{state.revoked.push(url);state.blobs.delete(url);});
 const load=vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(async url=>{
  const blob=state.blobs.get(url);expect(blob).toBeDefined();expect(blob!.type).toBe('image/png');
  const bytes=new Uint8Array(await blob!.arrayBuffer()),source=[...files.entries()].find(([name,raw])=>name.endsWith('.png')&&raw.byteLength===bytes.byteLength);
  expect(source).toBeDefined();expect(bytes).toEqual(source![1]); // Decode exactly verified bytes, never a second HTTP fetch.
  const texture=new T.Texture<HTMLImageElement>(),index=state.textures.length;state.textures.push(texture);texture.addEventListener('dispose',()=>state.disposed.push(texture));
  return state.decode(texture,index);
 });
 return Object.assign(state,{fetch,load});
}
async function load(options:Parameters<typeof loadSourcePistolParticleRenderer>[1]={}){const owner=await loadSourcePistolParticleRenderer('/particle-fixture',options);owners.push(owner);return owner;}
function deferred(){let resolve!:()=>void,reject!:(error:Error)=>void;const promise=new Promise<void>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}

it('verifies all five real staged resources and disposes only owned textures, batches and parent membership',async()=>{
 const h=mockResources(),owner=await load(),parent=new T.Group(),unrelated=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());parent.add(unrelated,owner.group);
 expect(owner.hashVerified).toEqual(Object.fromEntries(resources.map(row=>[row.path,true])));expect(h.fetch).toHaveBeenCalledTimes(5);expect(h.load).toHaveBeenCalledTimes(2);
 expect(h.created).toHaveLength(2);expect(h.revoked.sort()).toEqual(h.created.sort());expect(h.blobs.size).toBe(0);expect(h.disposed).toEqual([]);
 const released:string[]=[],outside=vi.fn();unrelated.geometry.addEventListener('dispose',outside);unrelated.material.addEventListener('dispose',outside);
 for(const mesh of owner.group.children as T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>[]){mesh.geometry.addEventListener('dispose',()=>released.push(mesh.name+' geometry'));mesh.material.addEventListener('dispose',()=>released.push(mesh.name+' material'));}
 owner.fire(muzzle,10,{main:0,core:0});expect(owner.update(10).counts).toEqual({main:4,core:0});owner.dispose();owner.dispose();
 expect(released).toHaveLength(4);expect(new Set(released).size).toBe(4);expect(h.disposed).toHaveLength(2);expect(new Set(h.disposed)).toEqual(new Set(h.textures));
 expect(parent.children).toEqual([unrelated]);expect(outside).not.toHaveBeenCalled();expect(()=>owner.fire(muzzle,10)).toThrow('disposed');expect(()=>owner.update(10)).toThrow('disposed');
 unrelated.geometry.dispose();unrelated.material.dispose();
});
it('keeps independently loaded owners separate while clear removes only that owner emission',async()=>{
 const h=mockResources(),a=await load(),b=await load();a.fire(muzzle,0,{main:17,core:17});b.fire(muzzle,0,{main:17,core:17});
 expect(a.update(.05).counts).toEqual(b.update(.05).counts);a.clear();expect(a.update(.05).counts).toEqual({main:0,core:0});expect(b.update(.05).counts).toEqual({main:4,core:8});
 a.dispose();expect(h.disposed).toHaveLength(2);expect(b.update(.05).counts).toEqual({main:4,core:8});b.dispose();expect(h.disposed).toHaveLength(4);
});
it.each(resources.map(row=>row.path))('rejects same-length bad SHA for %s and releases any successful parallel decode',async corrupt=>{
 const h=mockResources({corrupt});await expect(load()).rejects.toThrow('SHA mismatch '+corrupt);
 expect(new Set(h.disposed)).toEqual(new Set(h.textures));expect(h.disposed.length).toBe(h.textures.length);expect(h.blobs.size).toBe(0);expect(h.revoked.sort()).toEqual(h.created.sort());
 if(!corrupt.endsWith('.png'))expect(h.load).not.toHaveBeenCalled();
});
it('rejects a missing texture and cleans up the successful sibling decode',async()=>{
 const h=mockResources({missing:'textures/muzzleflash4-frame-0.png'});await expect(load()).rejects.toThrow('HTTP 404');
 expect(h.textures).toHaveLength(1);expect(h.disposed).toEqual(h.textures);expect(h.created).toEqual(h.revoked);expect(h.blobs.size).toBe(0);
});
it('rejects pre-aborted load before any texture decode',async()=>{
 const controller=new AbortController();controller.abort();const h=mockResources({signal:controller.signal});
 await expect(load({signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});expect(h.load).not.toHaveBeenCalled();expect(h.created).toHaveLength(0);
});
it('aborts while both decoded texture promises are pending and reclaims both after they settle',async()=>{
 const controller=new AbortController(),h=mockResources({signal:controller.signal}),gates=[deferred(),deferred()];
 h.decode=async(texture,index)=>{await gates[index].promise;return texture;};
 const pending=load({signal:controller.signal}).then(()=>({resolved:true,error:null}),error=>({resolved:false,error}));
 await vi.waitFor(()=>expect(h.textures).toHaveLength(2));controller.abort();gates[1].resolve();gates[0].resolve();const result=await pending;
 expect(result.resolved).toBe(false);expect(result.error).toMatchObject({name:'AbortError'});expect(h.disposed).toHaveLength(2);expect(new Set(h.disposed)).toEqual(new Set(h.textures));
 expect(h.revoked.sort()).toEqual(h.created.sort());expect(h.blobs.size).toBe(0);
});
it('reclaims the successful sibling after a decoder fails, revoking both object URLs',async()=>{
 const h=mockResources();h.decode=async(texture,index)=>{if(index===0)throw Error('native decode rejected');return texture;};
 await expect(load()).rejects.toThrow('native decode rejected');
 // A decoder rejecting never transfers its internal Texture to this owner.
 expect(h.disposed).toEqual([h.textures[1]]);expect(h.revoked.sort()).toEqual(h.created.sort());expect(h.blobs.size).toBe(0);
});
it('preserves original clock gates through repeated timestamps and slow frames, then expires normally',async()=>{
 mockResources();const owner=await load();owner.fire(muzzle,10,{main:0,core:0});const first=owner.update(10);
 expect(first.counts).toEqual({main:4,core:0});expect(owner.update(10)).toEqual(first);expect(owner.update(10)).toEqual(first);
 const slow=owner.update(10.05);expect(slow.counts).toEqual({main:4,core:8});expect(slow.clocks[0].main.time).toBe(Math.fround(.0075));expect(slow.clocks[0].core.time).toBe(Math.fround(.015));
 expect(owner.update(10.05)).toEqual(slow);expect(owner.update(10.1).counts.main).toBe(4);expect(owner.update(10.15).counts).toEqual({main:0,core:0});
});
it('uses metre CP coordinates and converts only native displacement/radius, with real buffer values matching diagnostics',async()=>{
 mockResources();const owner=await load();owner.fire(muzzle,0,{main:0,core:0});const first=owner.update(0);
 expect(first.particles.every(p=>new T.Vector3().fromArray(p.position).distanceTo(muzzle.position)<1e-12)).toBe(true);expect(first.particles[0].radius).toBe(5*.0254);
 const frame=owner.update(.05),native=owner.program.emitWithSeeds({main:0,core:0});
 for(const particle of frame.particles){const expected=native.find(p=>p.id===particle.id)!,distance=expected.forwardOffset+particle.age*expected.forwardSpeed;
  expect(particle.position[0]).toBe(2);expect(particle.position[1]).toBe(-3);expect(particle.position[2]).toBeCloseTo(4+distance*.0254,12);
 }
 for(const mesh of owner.group.children as T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>[]){const system=mesh.name.endsWith('core')?'core':'main',particles=frame.particles.filter(p=>p.system===system),position=mesh.geometry.getAttribute('particleCenter');
  expect(mesh.geometry.instanceCount).toBe(particles.length);for(let i=0;i<particles.length;i++)expect([position.getX(i),position.getY(i),position.getZ(i)]).toEqual(particles[i].position.map(Math.fround));
 }
});
it('reports finite batch capacity overflow and rejects invalid units before fetching resources',async()=>{
 const h=mockResources();await expect(load({sourceUnitMetres:0})).rejects.toThrow('capacity/units');await expect(load({capacity:1})).rejects.toThrow('capacity/units');expect(h.fetch).not.toHaveBeenCalled();
 const owner=await load({capacity:12});owner.fire(muzzle,0);owner.fire(muzzle,0);const frame=owner.update(.05);expect(frame.counts).toEqual({main:8,core:12});expect(frame.dropped).toBe(4);
});

it('requests original soft depth for fire_particle_4 only, at the renderer source-unit scale',async()=>{
 mockResources();const owner=await loadSourcePistolParticleRenderer('/particle-fixture',{sourceUnitMetres:.01});owners.push(owner);
 const main=owner.group.children[0]as T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>,core=owner.group.children[1]as T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>;
 expect(main.material.userData.sourceDepthBlend).toBe(false);expect(core.material.userData.sourceDepthBlend).toBe(true);expect(core.material.uniforms.depthScaleMetres.value).toBe(.5);
});
