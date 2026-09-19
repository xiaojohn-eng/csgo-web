import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadSourcePistolViewmodel,type SourcePistolWeapon,type SourcePistolTeam} from '../game/source-pistol-viewmodel';
import {sourcePistolFxAttachments,sourcePistolMuzzleAttachmentName} from '../game/source-pistol-fx';
async function fixture(weapon:SourcePistolWeapon,team:SourcePistolTeam){
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

it.each([['glock','t'],['glock','ct'],['usp','t'],['usp','ct']]as const)('%s/%s FX matrices track independent original MDL attachments through animation frames',async(weapon,team)=>{
 const f=await fixture(weapon,team),m=mock(f);try{
  const owner=await loadSourcePistolViewmodel({weapon,team,baseUrl:'/fixture'}),root=owner.createViewmodel(),scene=new T.Group(),relative=new T.Group();
  scene.position.set(3,-2,5);scene.rotation.set(.3,-.8,.2);relative.position.set(.7,.4,-.2);relative.rotation.set(-.2,.6,.1);scene.add(root,relative);root.position.set(.15,-.1,.2);scene.updateMatrixWorld(true);
  const raw=JSON.parse(readFileSync(resolve(`.reference-assets/source-exports/pistol-candidates/${weapon}-${team}/original-frames.json`),'utf8'));
  const rig=JSON.parse(Buffer.from(f.buffers.get('rig.json')!).toString());
  const c=new T.Matrix4().set(1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1),ci=c.clone().invert(),unit=new T.Vector3(1,1,1);let sampled=0,maxError=0;
  for(const clip of Object.values(raw)as {sequence:string;frames:number;fps:number;positions:number[][][];quaternionsXYZW:number[][][]}[])for(const frameIndex of [0,Math.floor(clip.frames/2),clip.frames-1]){
   owner.sampleViewmodel(root,{sequence:clip.sequence,timeSeconds:frameIndex/clip.fps,silencerAttached:true});const world:T.Matrix4[]=[];
   for(let i=0;i<rig.weaponBones.length;i++){
    const local=new T.Matrix4().compose(new T.Vector3(...clip.positions[frameIndex][i]),new T.Quaternion(...clip.quaternionsXYZW[frameIndex][i]).normalize(),unit),parent=rig.weaponBones[i].parent;
    world.push(parent<0?local:world[parent].clone().multiply(local));
   }
   for(const attached of [false,true]){const fx=sourcePistolFxAttachments(root,relative,{silencerAttached:attached});
    expect(fx.muzzle.name).toBe(weapon==='usp'&&attached?'muzzle_flash2':'1');expect(fx.shellEject.name).toBe('2');expect(fx.particles.rendererStatus).toBe('not-implemented');
    for(const socket of [fx.muzzle,fx.shellEject]){
     const a=rig.attachments.find((a:{name:string})=>a.name===socket.name),matrix=new T.Matrix4().set(...[...a.matrix,0,0,0,1]as Parameters<T.Matrix4['set']>);
     const expected=relative.matrixWorld.clone().invert().multiply(root.matrixWorld).multiply(c).multiply(world[a.parent_bone]).multiply(matrix).multiply(ci);
     maxError=Math.max(maxError,...socket.matrix.elements.map((v,j)=>Math.abs(v-expected.elements[j])));
     expect(socket.position.distanceTo(new T.Vector3().setFromMatrixPosition(expected))).toBeLessThan(2e-6);
     expect(socket.forward.distanceTo(new T.Vector3(1,0,0).transformDirection(expected))).toBeLessThan(2e-5);
     expect(socket.up.distanceTo(new T.Vector3(0,1,0).transformDirection(expected))).toBeLessThan(2e-5);
     expect(socket.right.distanceTo(new T.Vector3(0,0,1).transformDirection(expected))).toBeLessThan(2e-5);
    }
   }sampled++;
  }
  expect(sampled).toBe((weapon==='glock'?6:11)*3);expect(maxError).toBeLessThan(2e-6);
  if(weapon==='usp'){
   owner.sampleViewmodel(root,{sequence:'idle',timeSeconds:0,silencerAttached:true});const plain=sourcePistolFxAttachments(root,scene,{silencerAttached:false}),silenced=sourcePistolFxAttachments(root,scene,{silencerAttached:true});
   expect(silenced.muzzle.position.distanceTo(plain.muzzle.position)).toBeCloseTo(8.7*.0254,6);
   // Physical mode is explicit even when a transient animation hides/shows the part.
   owner.sampleViewmodel(root,{sequence:'draw',timeSeconds:0,silencerAttached:false});expect(sourcePistolFxAttachments(root,scene,{silencerAttached:false}).muzzle.name).toBe('1');
  }owner.dispose();
 }finally{m.restore();}
});
it('matches original client attachment branch and rejects guessed USP mode',()=>{
 // Native 0x5e0fb0 execution receipt: false/false -> 1; false/true -> 1;
 // true/false -> 1; true/true -> muzzle_flash2. Null VM -> -1, never a guessed socket.
 expect(sourcePistolMuzzleAttachmentName('glock',false)).toBe('1');expect(sourcePistolMuzzleAttachmentName('glock',true)).toBe('1');
 expect(sourcePistolMuzzleAttachmentName('usp',false)).toBe('1');expect(sourcePistolMuzzleAttachmentName('usp',true)).toBe('muzzle_flash2');
 expect(()=>sourcePistolMuzzleAttachmentName('usp')).toThrow('authoritative');expect(()=>sourcePistolFxAttachments(new T.Group(),new T.Group())).toThrow('Not a Source pistol');
});
