import {describe,it,expect,vi} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadSourceTViewmodel} from '../game/source-t-viewmodel';
import {loadSourceCTViewmodel} from '../game/source-ct-viewmodel';
import {inspectSourceViewmodel,isSourceViewmodel,sampleSourceViewmodel} from '../game/source-viewmodel';

async function fixture(profile:'t'|'ct'){
 const folder=resolve('public/source/csgo-12426148/'+(profile==='ct'?'ak47-ct-draw':'ak47-draw'));
 const manifestName=profile==='ct'?'manifest.json':'provenance.json';
 const buffers=new Map<string,Uint8Array>([[manifestName,readFileSync(resolve(folder,manifestName))]]);
 const manifest=JSON.parse(Buffer.from(buffers.get(manifestName)!).toString());
 for(const file of manifest.files as {path:string}[])buffers.set(file.path,readFileSync(resolve(folder,file.path)));
 const bytes=buffers.get('viewmodel.glb')!,size=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(12,true),doc=JSON.parse(Buffer.from(bytes.subarray(20,20+size)).toString()),bin=bytes.subarray(28+size);
 doc.materials=doc.materials.map((m:{name:string})=>({name:m.name}));delete doc.images;delete doc.textures;delete doc.extensionsUsed;delete doc.extensionsRequired;
 doc.buffers=[{byteLength:bin.byteLength,uri:'data:application/octet-stream;base64,'+Buffer.from(bin).toString('base64')}];
 if(!globalThis.ProgressEvent)globalThis.ProgressEvent=class{constructor(type:string,data:object){Object.assign(this,{type},data);}}as unknown as typeof ProgressEvent;
 const gltf=await new GLTFLoader().parseAsync(JSON.stringify(doc),'');
 return {buffers,gltf,loader:profile==='ct'?loadSourceCTViewmodel:loadSourceTViewmodel};
}
describe.runIf(existsSync('public/source/csgo-12426148/ak47-ct-draw/manifest.json'))('original first-person owners',()=>{
 it.each(['t','ct']as const)('%s validates original GLB and every PNG on HTTP without WebCrypto, and disposes only the requested clone',async profile=>{
  const f=await fixture(profile),textures:T.Texture[]=[],disposals=new Map<T.Texture,number>(),urls:string[]=[];
  vi.stubGlobal('crypto',undefined);
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const key=url.replace('/fixture/','');urls.push(key);const data=f.buffers.get(key);return new Response(data?new Blob([data as Uint8Array<ArrayBuffer>]):null,{status:data?200:404});}));
  const parser=vi.spyOn(GLTFLoader.prototype,'parseAsync').mockResolvedValue(f.gltf);
  const texture=vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(async()=>{const t=new T.Texture<HTMLImageElement>();textures.push(t);disposals.set(t,0);t.addEventListener('dispose',()=>disposals.set(t,disposals.get(t)!+1));return t;});
  try{
   const owner=await f.loader({baseUrl:'/fixture'});expect(owner.hashVerified).toBe(true);expect(owner.profile).toBe(profile==='ct'?'ct_arms_idf':'t_arms');
   expect(textures).toHaveLength(profile==='ct'?7:9);expect(urls.filter(u=>u.endsWith('.png'))).toHaveLength(textures.length);
   const a=owner.createViewmodel(),b=owner.createViewmodel();owner.disposeViewmodel(a);expect(isSourceViewmodel(a)).toBe(false);expect(isSourceViewmodel(b)).toBe(true);
   expect([...disposals.values()]).toEqual(textures.map(()=>0));sampleSourceViewmodel(b,'draw',.4);expect(inspectSourceViewmodel(b).pose).toBe('draw');sampleSourceViewmodel(b,'reload',.8);expect(inspectSourceViewmodel(b).time).toBe(.8);
   owner.dispose();owner.dispose();expect([...disposals.values()]).toEqual(textures.map(()=>1));expect(isSourceViewmodel(b)).toBe(false);expect(()=>owner.createViewmodel()).toThrow(/disposed/);
  }finally{parser.mockRestore();texture.mockRestore();vi.unstubAllGlobals();}
 });
 it.each(['t','ct']as const)('%s rejects a corrupt PNG and waits for all other loads before reclaiming assets',async profile=>{
  const f=await fixture(profile),textures:T.Texture[]=[],disposed:T.Texture[]=[];let geometryDisposed=0;
  f.gltf.scene.traverse(o=>{if(o instanceof T.Mesh)o.geometry.addEventListener('dispose',()=>geometryDisposed++);});
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const key=url.replace('/fixture/',''),data=f.buffers.get(key)!;
   const copy=Uint8Array.from(data);if(key==='textures/ak47_exponent-rgba.png')copy[copy.length-1]^=1;return new Response(new Blob([copy]));}));
  const parser=vi.spyOn(GLTFLoader.prototype,'parseAsync').mockImplementation(async()=>{await Promise.resolve();return f.gltf;});
  const texture=vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(async()=>{await Promise.resolve();const t=new T.Texture<HTMLImageElement>();textures.push(t);t.addEventListener('dispose',()=>disposed.push(t));return t;});
  try{await expect(f.loader({baseUrl:'/fixture'})).rejects.toThrow(/SHA mismatch/);expect(textures).toHaveLength(profile==='ct'?6:8);expect(new Set(disposed)).toEqual(new Set(textures));expect(geometryDisposed).toBeGreaterThan(0);}
  finally{parser.mockRestore();texture.mockRestore();vi.unstubAllGlobals();}
 });
 it('aborts after texture decode and reclaims every resource already returned by loaders',async()=>{
  const f=await fixture('t'),controller=new AbortController(),textures:T.Texture[]=[],disposed:T.Texture[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(new Blob([f.buffers.get(url.replace('/fixture/',''))! as Uint8Array<ArrayBuffer>]))));
  const parser=vi.spyOn(GLTFLoader.prototype,'parseAsync').mockResolvedValue(f.gltf);
  const texture=vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(async()=>{const t=new T.Texture<HTMLImageElement>();textures.push(t);t.addEventListener('dispose',()=>disposed.push(t));controller.abort();return t;});
  try{await expect(f.loader({baseUrl:'/fixture',signal:controller.signal})).rejects.toThrow();expect(textures.length).toBeGreaterThan(0);expect(new Set(disposed)).toEqual(new Set(textures));}
  finally{parser.mockRestore();texture.mockRestore();vi.unstubAllGlobals();}
 });
});
