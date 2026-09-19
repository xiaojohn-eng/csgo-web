import {describe,it,expect,vi} from 'vitest';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as T from 'three';
import {loadCharacterCpuFixture} from '../scripts/validate-source-character-actor';
import {createSourceCharacterActors} from '../game/source-character';
import {applySourceCharacterSurfaces} from '../game/source-character-surfaces';
import type {SourceCharacterPoseInput} from '../game/source-character-pose';
const C=new T.Matrix4().set(1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1);
for(const team of ['t','ct']as const){
 const dir=resolve('public/source/csgo-12426148/character-'+team+'-m4'),privateDir='.reference-assets/source-exports/character-'+team+'-m4/';
 describe.runIf(existsSync(dir+'/manifest.json'))('original '+team+' M4 continuous actor',()=>{
  it('matches independent Python body/world matrices, actual rendered joints/vertices and original IBM at arbitrary clocks',async()=>{
   const f=await loadCharacterCpuFixture(dir),manager=createSourceCharacterActors(f.gltf,f.poseIndex,f.weapon,f.weaponBytes,f.manifest),a=manager.createActor(),b=manager.createActor();
   const reference=JSON.parse(readFileSync(privateDir+'actor-reference.json','utf8'));
   expect(f.manifest.weaponId).toBe('m4a4');expect(reference.poseDataSHA256).toBe(f.manifest.files[f.manifest.poseData].sha256);
   expect(f.weapon.animations.find(s=>s.name==='rifle_fire_crouch')).toBeUndefined();
   const meshes:T.SkinnedMesh[]=[];a.model.traverse(o=>{if(o instanceof T.SkinnedMesh)meshes.push(o);});
   const ibms=meshes.map(m=>m.skeleton.boneInverses.map(b=>b.elements.slice()));let worldError=0,renderError=0,vertexError=0,vertices=0;
   for(const s of reference.samples as {input:SourceCharacterPoseInput;character:number[][];weapon:number[][]}[]){
    const sampled=manager.updateActor(a,{x:7,y:1.3,z:-12,yaw:.831,sourceContract:'csgo-player-12426148',sourcePoseVersion:f.manifest.poseVersion,sourcePose:s.input})!;
    const outer=a.root.matrixWorld.clone().multiply(new T.Matrix4().makeScale(.0254,.0254,.0254)).multiply(C),expected=new Map<T.Bone,T.Matrix4>();
    for(const [role,bones,raw]of [['character',a.characterBones,sampled.sourceWorldMatrices],['weapon',a.weaponBones,a.sourceWeaponWorldMatrices]]as const){
     for(let i=0;i<bones.length;i++){
      const source=new T.Matrix4().set(...s[role].slice(i*4,i*4+4).flat()as Parameters<T.Matrix4['set']>),world=outer.clone().multiply(source);expected.set(bones[i],world);
      for(let j=0;j<16;j++){worldError=Math.max(worldError,Math.abs(raw[i*16+j]-source.elements[j]));renderError=Math.max(renderError,Math.abs(bones[i].matrixWorld.elements[j]-world.elements[j]));}
     }
    }
    const point=new T.Vector3(),sum=new T.Vector3(),part=new T.Vector3();
    for(const m of meshes){const pos=m.geometry.attributes.position,j=m.geometry.attributes.skinIndex,w=m.geometry.attributes.skinWeight;
     for(let i=0;i<pos.count;i+=97){point.fromBufferAttribute(pos,i);m.applyBoneTransform(i,point);m.localToWorld(point);sum.set(0,0,0);
      for(let k=0;k<4;k++){const weight=w.getComponent(i,k);if(weight){const bone=j.getComponent(i,k);part.fromBufferAttribute(pos,i).applyMatrix4(expected.get(m.skeleton.bones[bone])!.clone().multiply(m.skeleton.boneInverses[bone]));sum.addScaledVector(part,weight);}}
      vertexError=Math.max(vertexError,point.distanceTo(sum));vertices++;
     }
    }
    for(const pair of f.weapon.boneMerge)expect(a.sourceWeaponWorldMatrices.slice(pair.weaponBone*16,pair.weaponBone*16+16)).toEqual(sampled.sourceWorldMatrices.slice(pair.characterBone*16,pair.characterBone*16+16));
   }
   expect(worldError).toBeLessThan(.0001);expect(renderError).toBeLessThan(.00001);expect(vertexError).toBeLessThan(.00001);
   expect(meshes.map(m=>m.skeleton.boneInverses.map(b=>b.elements.slice()))).toEqual(ibms);
   expect(a.characterBones[0]).not.toBe(b.characterBones[0]);expect(a.weaponBones[0]).not.toBe(b.weaponBones[0]);expect(b.root.visible).toBe(false);
   expect(()=>createSourceCharacterActors(f.gltf,f.poseIndex,f.weapon,f.weaponBytes,{...f.manifest,weaponId:'ak47'})).toThrow();
   expect(manager.updateActor(a,{x:0,y:0,z:0,yaw:0,sourceContract:'csgo-player-12426148',sourcePoseVersion:'csgo-'+team+'-ak-12426148:old',sourcePose:reference.samples[0].input})).toBeNull();
   manager.disposeActor(a);expect(b.status).toBe('awaiting-authority');manager.dispose();
   writeFileSync(privateDir+'actor-verification.json',JSON.stringify({status:'passed-original-m4-continuous-actor',samples:reference.samples.length,worldMatrixMaxErrorSourceUnits:worldError,actualJointMaxErrorMetres:renderError,actualVertexMaxErrorMetres:vertexError,vertices,exactOriginalInverseBinds:f.poseIndex.mainBoneCount+94,poseVersion:f.manifest.poseVersion,modelSHA256:f.manifest.files[f.manifest.model].sha256},null,2)+'\n');
  });
  it('binds the exact team body + M4 world VMT and rejects the old AK material profile',async()=>{
   const f=await loadCharacterCpuFixture(dir),urls:string[]=[];
   await expect(applySourceCharacterSurfaces(f.gltf,'/m4/',f.manifest.characterProfile)).rejects.toThrow(/unexpected/);
   const spy=vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(async u=>{urls.push(u);return new T.Texture<HTMLImageElement>();});
   try{const surfaces=await applySourceCharacterSurfaces(f.gltf,'/m4/',f.manifest.characterProfile,'m4a4');expect(surfaces.materialCount).toBe(4);expect(surfaces.textureCount).toBe(11);
    expect(urls).toContain('/m4/textures/rif_m4a1.png');expect(urls.some(u=>u.includes('ak47'))).toBe(false);expect(surfaces.materials.find(m=>m.originalName==='rif_m4a1')!.sourceVMT).toContain('/w_rif_m4a1/');surfaces.dispose();
   }finally{spy.mockRestore();}
  });
 });
}
