import {describe,it,expect,vi} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';
import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadSourcePistolViewmodel,isSourcePistolViewmodel,inspectSourcePistolViewmodel,sourcePistolAttachment,createSourcePistolMaterial,type SourcePistolWeapon,type SourcePistolTeam} from '../game/source-pistol-viewmodel';
import {updateSourceGlockPlayback,startSourcePistolInspection} from '../game/source-pistol-playback';
import {createSourceGlockRuntimeState} from '../game/source-glock-runtime';
import type {Player} from '../game/types';
import {GameAssets} from '../game/assets';
const profiles=[['glock','t'],['glock','ct'],['usp','t'],['usp','ct']]as const;
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
describe('original independent pistol owners',()=>{
 it('keeps each real action audio cursor through idle corrections, inspection and a same-generation rebuy',async()=>{
  const f=await fixture('glock','t'),m=mock(f);try{const o=await loadSourcePistolViewmodel({weapon:'glock',team:'t',baseUrl:'/fixture'}),g=o.createViewmodel(),assets=new GameAssets(),heard:string[]=[];
   assets.onSourcePistolSound=(_weapon,event)=>heard.push(event);
   const p={id:'p',deaths:0,alive:true,weapon:'glock',sourceGlock:createSourceGlockRuntimeState(),sourcePistolPose:{clock:{time:12.25}}}as Player;
   delete p.sourceGlock!.animation; // Legacy action-clock fixture; native cursor path has separate coverage.
   p.sourceGlock!.action={activity:194,generation:3,time:10};
   for(const time of [12.25,12.28,12.25]){p.sourcePistolPose!.clock!.time=time;assets.animateWeapon(g,p,0,0);}
   expect(heard).toEqual(['weapon_glock.clipout','weapon_glock.clipin','weapon_glock.slideback','weapon_glock.sliderelease']);
   expect(inspectSourcePistolViewmodel(g).sequence).toBe('glock_reload'); // Visual correction remains visible.
   p.sourcePistolPose!.clock!.time=13;assets.animateWeapon(g,p,0,0);startSourcePistolInspection(g);assets.animateWeapon(g,p,0,.1);assets.animateWeapon(g,p,0,10);
   expect(heard.filter(e=>e==='weapon_glock.clipout')).toHaveLength(1);
   heard.length=0;p.sourceGlock!.action={activity:183,generation:1,time:14};p.sourcePistolPose!.clock!.time=14.8;assets.animateWeapon(g,p,0,0);
   p.sourceGlock!.action={activity:183,generation:1,time:14.8};assets.animateWeapon(g,p,0,0);
   expect(heard.filter(e=>e==='weapon_glock.draw')).toHaveLength(2);o.dispose();
  }finally{m.restore();}
 });
 it('Glock uses command draw/fire/reload clocks and cancels local inspect on the next accepted action',async()=>{
  const f=await fixture('glock','t'),m=mock(f);try{const o=await loadSourcePistolViewmodel({weapon:'glock',team:'t',baseUrl:'/fixture'}),g=o.createViewmodel();
   const p={id:'p',deaths:0,alive:true,weapon:'glock',sourceGlock:createSourceGlockRuntimeState(),sourcePistolPose:{clock:{time:2}}}as Player;
   delete p.sourceGlock!.animation;
   p.sourceGlock!.action={activity:183,generation:1,time:2};p.sourceGlock!.command.ownerNextAttack=3.1;
   expect(updateSourceGlockPlayback(g,p,0)).toMatchObject({pose:'glock_draw',time:0});expect(startSourcePistolInspection(g)).toBe(false);
   p.sourcePistolPose!.clock!.time=2.6;expect(updateSourceGlockPlayback(g,p,.1).time).toBeCloseTo(.6,12);
   p.sourcePistolPose!.clock!.time=3.2;expect(updateSourceGlockPlayback(g,p,.1).pose).toBe('glock_idle');expect(startSourcePistolInspection(g)).toBe(true);
   expect(updateSourceGlockPlayback(g,p,.25)).toMatchObject({pose:'lookat01',time:.25});
   p.sourceGlock!.action={activity:192,generation:2,time:3.2};p.sourceGlock!.command.clip=0;
   expect(updateSourceGlockPlayback(g,p,.1)).toMatchObject({pose:'glock_firesingle',time:0});
   p.sourceGlock!.action={activity:194,generation:3,time:4};p.sourceGlock!.command.reloading=true;p.sourcePistolPose!.clock!.time=4.8;
   expect(updateSourceGlockPlayback(g,p,.1).pose).toBe('glock_reload');expect(inspectSourcePistolViewmodel(g).time).toBeCloseTo(.8,12);
   expect(startSourcePistolInspection(g)).toBe(false);
   // The shared simulation accumulates double time, while native attack gates
   // compare float curtime. The first unlocked frame must allow inspection too.
   p.sourceGlock!.command.reloading=false;p.sourceGlock!.command.ownerNextAttack=Math.fround(5.2166666666666535);p.sourcePistolPose!.clock!.time=5.2166666666666535;
   updateSourceGlockPlayback(g,p,1/60);expect(startSourcePistolInspection(g)).toBe(true);o.dispose();
  }finally{m.restore();}
 });
 it.each(profiles)('%s/%s verifies hashes, every original frame and exact independent arm merge; disposes clones independently',async(weapon,team)=>{
  const f=await fixture(weapon,team),m=mock(f);try{const owner=await loadSourcePistolViewmodel({weapon,team,baseUrl:'/fixture'});expect(owner.hashVerified).toBe(true);expect(m.textures).toHaveLength(team==='t'?9:7);
   const a=owner.createViewmodel(),b=owner.createViewmodel();owner.disposeViewmodel(a);expect(isSourcePistolViewmodel(a)).toBe(false);expect(isSourcePistolViewmodel(b)).toBe(true);expect(m.disposed).toHaveLength(0);
   const gun=new Map<string,T.Bone>(),arms=new Map<string,T.Bone>();b.traverse(o=>{if(o instanceof T.Bone)(o.userData.sourceFPSkin==='weapon'?gun:arms).set(o.userData.sourceFPBoneName,o);});
   const raw=JSON.parse(readFileSync(resolve(`.reference-assets/source-exports/pistol-candidates/${weapon}-${team}/original-frames.json`),'utf8')),rig=JSON.parse(Buffer.from(f.buffers.get('rig.json')!).toString());
   const c=new T.Matrix4().set(1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1),unit=new T.Vector3(1,1,1);let max=0,frames=0,merged=0;
   for(const clip of Object.values(raw)as {sequence:string;frames:number;fps:number;positions:number[][][];quaternionsXYZW:number[][][]}[]){for(let frame=0;frame<clip.frames;frame++){
    owner.sampleViewmodel(b,{sequence:clip.sequence,timeSeconds:frame/clip.fps,silencerAttached:true});const unroot=b.matrixWorld.clone().invert(),world:T.Matrix4[]=[];
    for(let i=0;i<rig.weaponBones.length;i++){const bone=rig.weaponBones[i],local=new T.Matrix4().compose(new T.Vector3(...clip.positions[frame][i]),new T.Quaternion(...clip.quaternionsXYZW[frame][i]).normalize(),unit),parent=bone.parent;world.push(parent<0?local:world[parent].clone().multiply(local));const expected=c.clone().multiply(world[i]),actual=unroot.clone().multiply(gun.get(bone.name)!.matrixWorld);max=Math.max(max,...actual.elements.map((v,j)=>Math.abs(v-expected.elements[j])));}
    for(const name of rig.matchingBoneNames){const actual=arms.get(name)!.matrixWorld.elements,expected=gun.get(name)!.matrixWorld.elements;expect(Math.max(...actual.map((v,j)=>Math.abs(v-expected[j])))).toBeLessThan(1e-11);merged++;}frames++;
   }}
   expect(max).toBeLessThan(.00005);expect(frames).toBe(weapon==='glock'?325:716);expect(sourcePistolAttachment(b,'1',new T.Group()).elements.every(Number.isFinite)).toBe(true);
   const snapshot=inspectSourcePistolViewmodel(b);expect(snapshot.boneCounts.sort()).toEqual(weapon==='glock'?[48,57]:[48,48]);expect(()=>owner.sampleViewmodel(b,{sequence:'fake',timeSeconds:0,silencerAttached:true})).toThrow();
   owner.dispose();owner.dispose();expect(new Set(m.disposed)).toEqual(new Set(m.textures));expect(m.disposed).toHaveLength(m.textures.length);expect(()=>owner.createViewmodel()).toThrow(/disposed/);
   writeFileSync(resolve(`.reference-assets/source-exports/pistol-candidates/${weapon}-${team}/runtime-readback.json`),JSON.stringify({status:'passed',sha256:f.manifest.files.find((r:{path:string})=>r.path==='viewmodel.glb').sha256,frames,matchingBoneMatrices:merged,maxWeaponMatrixErrorSourceUnits:max,hashVerifiedWithoutWebCrypto:true,independentClones:true},null,2)+'\n');
  }finally{m.restore();}
 });
 it('USP applies original visibility events on exact seek and distinguishes reversed draw names',async()=>{const f=await fixture('usp','t'),m=mock(f);try{const o=await loadSourcePistolViewmodel({weapon:'usp',team:'t',baseUrl:'/fixture'}),g=o.createViewmodel();
  expect(o.sampleViewmodel(g,{sequence:'draw',timeSeconds:0,silencerAttached:false})).toMatchObject({activity:'ACT_VM_DRAW_SILENCED',silencerVisible:true});expect(o.sampleViewmodel(g,{sequence:'draw_silenced',timeSeconds:0,silencerAttached:true})).toMatchObject({activity:'ACT_VM_DRAW',silencerVisible:false});
  expect(o.sampleViewmodel(g,{sequence:'attach',timeSeconds:0,silencerAttached:false}).silencerVisible).toBe(false);expect(o.sampleViewmodel(g,{sequence:'attach',timeSeconds:1,silencerAttached:false}).silencerVisible).toBe(true);expect(o.sampleViewmodel(g,{sequence:'attach',timeSeconds:0,silencerAttached:false}).silencerVisible).toBe(false);
  expect(o.sampleViewmodel(g,{sequence:'detach',timeSeconds:4,silencerAttached:true}).silencerVisible).toBe(false);expect(()=>o.sampleViewmodel(g,{sequence:'idle',timeSeconds:0})).toThrow(/explicit silencer/);o.dispose();
 }finally{m.restore();}});
 it.each(['manifest.json','textures/pist_223_exponent-rgba.png'])('rejects corrupt %s and reclaims all completed loads',async corrupt=>{const f=await fixture('usp','ct'),m=mock(f,corrupt);try{await expect(loadSourcePistolViewmodel({weapon:'usp',team:'ct',baseUrl:'/fixture'})).rejects.toThrow(/SHA mismatch/);expect(new Set(m.disposed)).toEqual(new Set(m.textures));}finally{m.restore();}});
 it('aborts after native image decode and reclaims all completed resources',async()=>{const f=await fixture('glock','ct'),controller=new AbortController(),m=mock(f,undefined,controller);try{await expect(loadSourcePistolViewmodel({weapon:'glock',team:'ct',baseUrl:'/fixture',signal:controller.signal})).rejects.toThrow();expect(m.textures.length).toBeGreaterThan(0);expect(new Set(m.disposed)).toEqual(new Set(m.textures));}finally{m.restore();}});
 it.each([['glock',1],['usp',8]]as const)('%s material uses actual VMT boost without green RGB exponent specular', (weapon,boost)=>{const base=new T.Texture(),exponent=new T.Texture(),h=createSourcePistolMaterial(weapon,base,exponent),shader={uniforms:{},vertexShader:T.ShaderLib.phong.vertexShader,fragmentShader:T.ShaderLib.phong.fragmentShader};h.material.onBeforeCompile(shader as T.WebGLProgramParametersWithUniforms,{}as T.WebGLRenderer);expect((shader.uniforms as Record<string,{value:unknown}>).sourceBoost.value).toBe(boost);expect(shader.fragmentShader).toContain('sourceParameters.g');expect(h.material.userData.sourceParameters.boost).toBe(boost);h.dispose();});
});
