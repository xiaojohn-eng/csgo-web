import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadSourceAWPWorld} from '../game/source-awp-world';
import {sampleSourceAWPWorldPose} from '../game/source-awp-world-pose';
async function fixture(corrupt?:string){
 const folder='public/source/csgo-12426148/awp-world/',manifest=JSON.parse(readFileSync(folder+'manifest.json','utf8')),buffers=new Map<string,Uint8Array>([['manifest.json',readFileSync(folder+'manifest.json')]]);
 for(const f of manifest.files)buffers.set(f.path,readFileSync(folder+f.path));
 const bytes=buffers.get('model.glb')!,size=new DataView(bytes.buffer,bytes.byteOffset).getUint32(12,true),doc=JSON.parse(Buffer.from(bytes.subarray(20,20+size)).toString()),binary=bytes.subarray(28+size);
 doc.materials=doc.materials.map((m:{name:string})=>({name:m.name}));delete doc.images;delete doc.textures;delete doc.extensionsUsed;delete doc.extensionsRequired;doc.buffers=[{byteLength:binary.byteLength,uri:'data:application/octet-stream;base64,'+Buffer.from(binary).toString('base64')}];
 if(!globalThis.ProgressEvent)globalThis.ProgressEvent=class{constructor(type:string,data:object){Object.assign(this,{type},data);}}as unknown as typeof ProgressEvent;
 const gltf=await new GLTFLoader().parseAsync(JSON.stringify(doc),''),textures:T.Texture[]=[],released:T.Texture[]=[];
 vi.stubGlobal('fetch',async(url:string,options:RequestInit)=>{expect(options.cache).toBe('no-cache');const key=url.replace('/fixture/',''),raw=Uint8Array.from(buffers.get(key)!);if(key===corrupt)raw[raw.length-1]^=1;return new Response(raw);});
 const parse=vi.spyOn(GLTFLoader.prototype,'parseAsync').mockResolvedValue(gltf),texture=vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(async()=>{const t=new T.Texture<HTMLImageElement>();textures.push(t);t.addEventListener('dispose',()=>released.push(t));return t;});
 return{textures,released,restore(){parse.mockRestore();texture.mockRestore();vi.unstubAllGlobals();}};
}
it('loads the original 94-bone world rig, all clips, exact materials and independent clone skeletons',async()=>{
 const f=await fixture();try{
  const o=await loadSourceAWPWorld({baseUrl:'/fixture'}),a=o.createWorldModel(),b=o.createWorldModel(),seen=new Set<T.Bone>();
  expect(Object.keys(o.hashVerified)).toHaveLength(9);expect(o.inspectWorldModel(a).attachments).toHaveLength(14);expect(o.inspectWorldModel(a).clips.reduce((n,c)=>n+c.frames,0)).toBe(445);
  const c=new T.Matrix4().set(1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1);let maximum=0;
  for(const clip of o.inspectWorldModel(a).clips){
   o.sampleWorldModel(a,{sequence:clip.sourceSequence,timeSeconds:clip.duration*.37});const pose=sampleSourceAWPWorldPose(o.poseIndex,{sequence:clip.sourceSequence,cycle:.37}),inverse=a.matrixWorld.clone().invert();
   a.traverse(obj=>{if(obj instanceof T.Bone){seen.add(obj);const bone=obj.userData.sourceAWPWorldBone as number,expected=c.clone().multiply(new T.Matrix4().fromArray(pose.sourceWorldMatrices,bone*16)),actual=inverse.clone().multiply(obj.matrixWorld);for(let i=0;i<16;i++)maximum=Math.max(maximum,Math.abs(expected.elements[i]-actual.elements[i]));}});
  }
  expect(maximum).toBeLessThan(1e-10);expect(o.inspectWorldModel(b).sequence).toBe('default');b.traverse(obj=>{if(obj instanceof T.Bone)expect(seen.has(obj)).toBe(false);});
  const materials=new Set<T.Material>();a.traverse(obj=>{if(obj instanceof T.Mesh)for(const m of Array.isArray(obj.material)?obj.material:[obj.material])materials.add(m);});expect([...materials].map(m=>m.name).sort()).toEqual(['Source_AWP_Scope_VertexLitGeneric','Source_AWP_World_VertexLitGeneric']);
  expect(o.attachment(a,'muzzle_flash').elements.every(Number.isFinite)).toBe(true);o.disposeWorldModel(a);expect(()=>o.inspectWorldModel(a)).toThrow(/disposed/);o.dispose();expect(f.textures.every(t=>f.released.includes(t))).toBe(true);expect(()=>o.createWorldModel()).toThrow(/disposed/);
 }finally{f.restore();}
});
it('applies original magazine hide/unhide cycles and resets them on sequence change',async()=>{
 const f=await fixture();try{const o=await loadSourceAWPWorld({baseUrl:'/fixture'}),model=o.createWorldModel();
  for(const c of o.inspectWorldModel(model).clips.filter(c=>c.sourceSequence!=='default')){
   const hide=c.events.find(e=>e.name==='AE_CL_EJECT_MAG')!,show=c.events.find(e=>e.name==='AE_CL_EJECT_MAG_UNHIDE')!;
   expect(o.sampleWorldModel(model,{sequence:c.sourceSequence,timeSeconds:hide.cycle*c.duration-1e-5}).magazineVisible).toBe(true);
   expect(o.sampleWorldModel(model,{sequence:c.sourceSequence,timeSeconds:hide.cycle*c.duration+1e-5}).magazineVisible).toBe(false);
   expect(o.sampleWorldModel(model,{sequence:c.sourceSequence,timeSeconds:show.cycle*c.duration+1e-5}).magazineVisible).toBe(true);
   o.sampleWorldModel(model,{sequence:c.sourceSequence,timeSeconds:(hide.cycle+show.cycle)*.5*c.duration});expect(o.sampleWorldModel(model,{sequence:'default',timeSeconds:0}).magazineVisible).toBe(true);
  }o.dispose();
 }finally{f.restore();}
});
it('rejects corrupted raw world frames and releases already loaded textures',async()=>{
 const f=await fixture('frames.f64.bin');try{await expect(loadSourceAWPWorld({baseUrl:'/fixture'})).rejects.toThrow(/SHA mismatch/);expect(f.textures.every(t=>f.released.includes(t))).toBe(true);}finally{f.restore();}
});
