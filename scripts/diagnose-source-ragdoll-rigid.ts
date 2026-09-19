import RAPIER from '@dimforge/rapier3d-compat';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as T from 'three';
import {loadCharacterCpuFixture} from './validate-source-character-actor.js';
import {createSourceCharacterActors} from '../game/source-character.js';
import {createSourcePoseDriver} from '../game/source-player-contract.js';
import {createSourceRagdollPoseDriver,parseSourceRagdollData,bindSourceRagdoll,type SourceRagdollState} from '../game/source-ragdoll.js';

/** CPU skinning of actual shipped meshes, including inverse binds and weights. */
export function sourceCorpseMeshVertices(root:T.Object3D){
  root.updateMatrixWorld(true);
  const result:{name:string;vertices:T.Vector3[];indices:number[]}[]=[];
  root.traverse(o=>{
    if(!(o instanceof T.SkinnedMesh)||!o.skeleton.bones.some(b=>b.name.includes('Bip01_Pelvis')))return;
    const vertices=Array.from({length:o.geometry.attributes.position.count},(_,i)=>o.getVertexPosition(i,new T.Vector3()).applyMatrix4(o.matrixWorld));
    const indices=o.geometry.index?Array.from({length:o.geometry.index.count},(_,i)=>o.geometry.index!.getX(i)):vertices.map((_,i)=>i);
    result.push({name:o.name,vertices,indices});
  });
  return result;
}
export function sourceCorpseEdgeStrain(reference:ReturnType<typeof sourceCorpseMeshVertices>,current:ReturnType<typeof sourceCorpseMeshVertices>){
  const ratios:number[]=[];let vertices=0;
  for(let m=0;m<reference.length;m++){
    const a=reference[m],b=current[m];vertices+=a.vertices.length;
    for(let i=0;i<a.indices.length;i+=3)for(let j=0;j<3;j++){
      const u=a.indices[i+j],v=a.indices[i+(j+1)%3],length=a.vertices[u].distanceTo(a.vertices[v]);
      if(length>.001)ratios.push(b.vertices[u].distanceTo(b.vertices[v])/length);
    }
  }
  ratios.sort((a,b)=>a-b);
  return{vertices,edges:ratios.length,p99:ratios[Math.floor(ratios.length*.99)],max:ratios.at(-1)};
}
async function main(){
  await RAPIER.init();
  const fixture=await loadCharacterCpuFixture(),data=parseSourceRagdollData(JSON.parse(readFileSync('public/source/csgo-12426148/ragdoll/ragdoll-data.json','utf8')));
  const index=bindSourceRagdoll(data,fixture.poseIndex),driver=createSourceRagdollPoseDriver(createSourcePoseDriver(fixture.poseIndex,fixture.manifest.poseVersion),fixture.poseIndex,data);
  const owner=createSourceCharacterActors(fixture.gltf,fixture.poseIndex,fixture.weapon,fixture.weaponBytes,fixture.manifest,index),actor=owner.createActor();
  const output=resolve(process.argv[2]??'output/fidelity-character/rigid-corpse.json');mkdirSync(resolve(output,'..'),{recursive:true});
  const results=[];
  for(const stance of ['Idle','Run','Crouch_Idle']as const){
    const sourcePose={state:stance,cycle:.45,parameters:{move_x:stance==='Run'?1:0,move_y:0,body_yaw:20,body_pitch:-15},blendMode:'sdk-3way'as const};
    const player={id:'diagnostic-'+stance,x:0,y:0,z:0,yaw:-Math.PI/2,sourceContract:'csgo-player-12426148'as const,sourcePoseVersion:fixture.manifest.poseVersion,sourcePose};
    owner.updateActor(actor,player);const before=sourceCorpseMeshVertices(actor.root),rest=driver.ragdoll!.capturePose(player);
    let state=driver.ragdoll!.beginRagdoll(player,{x:0,y:0,z:0},{x:170,y:0,z:42.5},undefined,rest);
    let peak=1,ticks=0;const samples:{tick:number;state:SourceRagdollState;strain:ReturnType<typeof sourceCorpseEdgeStrain>}[]=[];
    while(!state.settled&&ticks<900){
      state=driver.ragdoll!.stepRagdoll(player,1/60)!;ticks++;
      if(ticks%10===0||state.settled){owner.updateActor(actor,{...player,sourceRagdoll:state});const strain=sourceCorpseEdgeStrain(before,sourceCorpseMeshVertices(actor.root));peak=Math.max(peak,strain.p99);if(ticks%30===0||state.settled)samples.push({tick:ticks,state:structuredClone(state),strain});}
    }
    results.push({stance,ticks,settled:state.settled,peakP99EdgeStrain:peak,player:{...player,alive:false,sourceRagdoll:state},samples});
    driver.ragdoll!.endRagdoll(player);
    console.log(JSON.stringify({stance,ticks,settled:state.settled,peakP99EdgeStrain:peak,last:samples.at(-1)?.strain}));
  }
  owner.dispose();writeFileSync(output,JSON.stringify({scope:'Current rigid-body solver CPU diagnostic; actual shipped body GLB skinning. No browser or network proof.',results},null,2)+'\n');
  console.log(output);
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]??'')).href)await main();
