import {describe,it,expect,vi} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';
import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadSourceDeagleViewmodel,isSourceDeagleViewmodel,inspectSourceDeagleViewmodel,sourceDeagleAttachment,createSourceDeagleMaterial,type SourceDeagleWeapon,type SourceDeagleTeam} from '../game/source-deagle-viewmodel';
async function fixture(team:SourceDeagleTeam){const weapon='deagle';
 const directory=resolve(`public/source/csgo-12426148/${weapon}-${team}`),buffers=new Map<string,Uint8Array>([['manifest.json',readFileSync(resolve(directory,'manifest.json'))]]),manifest=JSON.parse(Buffer.from(buffers.get('manifest.json')!).toString());
 for(const row of manifest.files)buffers.set(row.path,readFileSync(resolve(directory,row.path)));
 const bytes=buffers.get('viewmodel.glb')!,size=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(12,true),doc=JSON.parse(Buffer.from(bytes.subarray(20,20+size)).toString()),binary=bytes.subarray(28+size);doc.materials=doc.materials.map((m:{name:string})=>({name:m.name}));delete doc.images;delete doc.textures;delete doc.extensionsUsed;delete doc.extensionsRequired;doc.buffers=[{byteLength:binary.byteLength,uri:'data:application/octet-stream;base64,'+Buffer.from(binary).toString('base64')}];
 if(!globalThis.ProgressEvent)globalThis.ProgressEvent=class{constructor(type:string,data:object){Object.assign(this,{type},data);}}as unknown as typeof ProgressEvent;
 const gltf=await new GLTFLoader().parseAsync(JSON.stringify(doc),'');return{directory,buffers,gltf,manifest};
}
function mock(f:Awaited<ReturnType<typeof fixture>>,corrupt?:string,controller?:AbortController){const textures:T.Texture[]=[],disposed:T.Texture[]=[];
 vi.stubGlobal('crypto',undefined);vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{expect(options?.cache).toBe('no-cache');const key=url.replace('/fixture/',''),b=Uint8Array.from(f.buffers.get(key)!);if(key===corrupt)b[b.length-1]^=1;return new Response(new Blob([b]));}));
 const parse=vi.spyOn(GLTFLoader.prototype,'parseAsync').mockResolvedValue(f.gltf),texture=vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(async()=>{const t=new T.Texture<HTMLImageElement>();textures.push(t);t.addEventListener('dispose',()=>disposed.push(t));controller?.abort();return t;});
 return{textures,disposed,restore(){parse.mockRestore();texture.mockRestore();vi.unstubAllGlobals();}};
}

describe('original Deagle owners',()=>{
 it.each(['t','ct']as const)('loads %s, samples all original clips and keeps independent clone bones',async team=>{
  const f=await fixture(team),m=mock(f);try{
   const o=await loadSourceDeagleViewmodel({team,baseUrl:'/fixture'}),a=o.createViewmodel(),b=o.createViewmodel();
   expect(o.hashVerified).toBe(true);expect(isSourceDeagleViewmodel(a)).toBe(true);
   const inspect=inspectSourceDeagleViewmodel(a);expect(inspect.clips).toHaveLength(9);expect(inspect.attachments).toEqual(['1','2']);
   expect(inspect.clips.reduce((n,c)=>n+c.frames,0)).toBe(639);
   for(const clip of inspect.clips){o.sampleViewmodel(a,{sequence:clip.sourceSequence,timeSeconds:clip.duration/2});expect(inspectSourceDeagleViewmodel(a).sequence).toBe(clip.sourceSequence);}
   expect(inspectSourceDeagleViewmodel(b).sequence).toBe('idle1');
   expect(sourceDeagleAttachment(a,'1',a).elements.every(Number.isFinite)).toBe(true);
   const bonesA=new Set<T.Bone>();a.traverse(o=>{if(o instanceof T.Bone)bonesA.add(o);});b.traverse(o=>{if(o instanceof T.Bone)expect(bonesA.has(o)).toBe(false);});
   o.disposeViewmodel(a);expect(isSourceDeagleViewmodel(a)).toBe(false);o.dispose();expect(m.disposed.length).toBe(m.textures.length);
   expect(()=>o.createViewmodel()).toThrow(/disposed/);
  }finally{m.restore();}
 });
 it('rejects a corrupt Deagle GLB and releases already decoded textures',async()=>{
  const f=await fixture('t'),m=mock(f,'viewmodel.glb');try{
   await expect(loadSourceDeagleViewmodel({team:'t',baseUrl:'/fixture'})).rejects.toThrow(/SHA mismatch/);
   expect(m.disposed.length).toBe(m.textures.length);
  }finally{m.restore();}
 });
 it('uses original Deagle VMT boost and Fresnel parameters',()=>{
  const base=new T.Texture(),exponent=new T.Texture(),h=createSourceDeagleMaterial('deagle',base,exponent);
  expect(h.material.userData.sourceParameters).toMatchObject({boost:1,fresnel:[.8,.8,1],phongAlbedoBoost:40});
  const shader={uniforms:{},fragmentShader:'#include <lights_phong_pars_fragment>\n#include <lights_phong_fragment>'} as T.WebGLProgramParametersWithUniforms;
  h.material.onBeforeCompile(shader,{} as T.WebGLRenderer);expect(shader.uniforms.sourceBoost.value).toBe(1);expect(shader.uniforms.sourceFresnelRanges.value.toArray()).toEqual([.8,.8,1]);
  h.dispose();base.dispose();exponent.dispose();
 });
});
