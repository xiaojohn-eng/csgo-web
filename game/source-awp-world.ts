import * as T from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {SOURCE_AWP_WORLD_ASSETS} from './source-awp-world-contracts';
import {prepareSourceAWPWorldPose,sampleSourceAWPWorldPose,SOURCE_AWP_WORLD_SEQUENCES,type SourceAWPWorldSequence,type SourceAWPWorldIndex} from './source-awp-world-pose';
import {createSourceAWPMaterial,createSourceAWPScopeMaterial} from './source-awp-materials';
import {sourceSha256} from './source-sha256';
type Event={cycle:number;event:number;type:number;name:string;options:string};
type Clip={sourceSequence:SourceAWPWorldSequence;name:string;fps:number;frames:number;duration:number;events:Event[]};
export type SourceAWPWorldManifest={format:'source-awp-world-v1';sourceApp:740;build:12426148;weaponId:'awp';itemDefinition:9;sourceModel:string;sourceSHA256:string;boneCount:94;attachmentCount:14;model:string;rig:string;pose:string;frames:string;clips:Record<string,Clip>;files:{path:string;bytes:number;sha256:string}[];metersPerSourceUnit:number;actorYawOffsetRadians:number};
type Rig={format:'source-awp-world-rig-v1';weaponId:'awp';skinIndex:number;skinName:string;joints:{bone:number;sourceName:string;gltfNode:number;skinJoint:number}[];magazineNodes:number[];attachments:{name:string;parent_bone:number;matrix:number[]}[]};
export type SourceAWPWorldSample={sequence:SourceAWPWorldSequence;timeSeconds:number};
const KEY='sourceAWPWorldModel';
type Instance={body:T.Object3D;bones:T.Bone[];magazine:T.Object3D[];attachments:Map<string,T.Object3D>;skeletons:Set<T.Skeleton>;sequence:string;time:number};
const C=new T.Matrix4().set(1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1);
const check=(value:unknown,message:string)=>{if(!value)throw Error(message);};
/** Standalone world weapon, with original clips and magazine events. This does
 * not substitute the AWP player graph or perform character bone merge. */
export function createSourceAWPWorldModels(gltf:GLTF,poseIndex:SourceAWPWorldIndex,rig:Rig,manifest:SourceAWPWorldManifest){
 check(manifest.format==='source-awp-world-v1'&&manifest.sourceApp===740&&manifest.build===12426148&&manifest.weaponId==='awp'&&manifest.itemDefinition===9&&manifest.sourceModel===poseIndex.data.sourceModel&&manifest.sourceSHA256===poseIndex.data.sourceSHA256&&manifest.boneCount===94&&manifest.attachmentCount===14&&manifest.metersPerSourceUnit===.0254&&manifest.actorYawOffsetRadians===Math.PI/2,'Original AWP world manifest identity changed');
 const doc=gltf.parser.json,byNode=new Map<number,T.Object3D>();for(const[o,a]of gltf.parser.associations)if(a.nodes!==undefined)byNode.set(a.nodes,o as T.Object3D);
 check(rig.format==='source-awp-world-rig-v1'&&rig.weaponId==='awp'&&rig.joints.length===94&&rig.attachments.length===14&&rig.magazineNodes.length===1&&doc.skins?.length===1&&doc.skins[rig.skinIndex]?.name===rig.skinName,'Original AWP world rig identity changed');
 const ids=new Set<number>(),slots=new Set<number>();
 for(const j of rig.joints){const bone=byNode.get(j.gltfNode);check(bone instanceof T.Bone&&poseIndex.data.bones[j.bone]?.name===j.sourceName&&doc.skins[rig.skinIndex].joints[j.skinJoint]===j.gltfNode&&!ids.has(j.bone)&&!slots.has(j.skinJoint),'Original AWP world joint identity changed');ids.add(j.bone);slots.add(j.skinJoint);bone!.userData.sourceAWPWorldBone=j.bone;}
 const originalSkeletons=new Set<T.Skeleton>();gltf.scene.traverse(o=>{if(o instanceof T.SkinnedMesh)originalSkeletons.add(o.skeleton);});
 check(originalSkeletons.size>0,'Original AWP world skin missing');for(const skeleton of originalSkeletons){check(skeleton.bones.length===94,'Original AWP world skin count changed');for(const j of rig.joints){check(skeleton.bones[j.skinJoint]===byNode.get(j.gltfNode),'Original AWP world skin mapping changed');check(poseIndex.data.bones[j.bone].inverseBindGltf.every((v,i)=>Math.fround(v)===skeleton.boneInverses[j.skinJoint].elements[i]),'Original AWP world raw inverse bind changed');}}
 for(const node of rig.magazineNodes){const o=byNode.get(node);check(o instanceof T.Mesh,'Original AWP magazine missing');o!.userData.sourceAWPWorldMagazine=true;}
 const clips=new Map(Object.values(manifest.clips).map(c=>[c.sourceSequence,c]));
 check(clips.size===5&&gltf.animations.length===5&&SOURCE_AWP_WORLD_SEQUENCES.every(s=>clips.has(s)),'Original AWP world clips changed');
 for(const c of clips.values()){const clip=gltf.animations.find(a=>a.name===c.name);check(clip&&Math.abs(clip.duration-c.duration)<1e-5,'Original AWP world clip timing changed');}
 const instances=new Set<T.Group>();let disposed=false;
 const instance=(root:T.Group)=>{check(instances.has(root),'AWP world model is absent or disposed');return root.userData[KEY]as Instance;};
 function sampleWorldModel(root:T.Group,input:SourceAWPWorldSample){
  const s=instance(root),clip=clips.get(input.sequence);check(clip&&Number.isFinite(input.timeSeconds),'Invalid AWP world sequence/time');
  const time=T.MathUtils.clamp(input.timeSeconds,0,clip!.duration),pose=sampleSourceAWPWorldPose(poseIndex,{sequence:input.sequence,cycle:clip!.duration>0?time/clip!.duration:0});
  // Source's original quaternion interpolation differs slightly from glTF's
  // interpolation between exported frames. Render the verified f64 raw pose.
  root.updateWorldMatrix(true,true);const prefix=root.matrixWorld.clone().multiply(C);
  for(let i=0;i<s.bones.length;i++){const bone=s.bones[i],world=prefix.clone().multiply(new T.Matrix4().fromArray(pose.sourceWorldMatrices,i*16));bone.matrixAutoUpdate=false;bone.matrix.copy(bone.parent!.matrixWorld).invert().multiply(world);bone.matrixWorldNeedsUpdate=true;bone.updateWorldMatrix(false,false);}
  let visible=true;for(const e of clip!.events)if(e.cycle*clip!.duration<=time+1e-9){if(e.name==='AE_CL_EJECT_MAG')visible=false;else if(e.name==='AE_CL_EJECT_MAG_UNHIDE')visible=true;}
  for(const o of s.magazine)o.visible=visible;s.sequence=input.sequence;s.time=time;root.updateMatrixWorld(true);return{sequence:s.sequence,time:s.time,magazineVisible:visible};
 }
 function createWorldModel(){
  check(!disposed,'AWP world owner disposed');const root=new T.Group(),body=clone(gltf.scene);root.name='CSGO_12426148_AWP_WORLD';root.userData.sourceWeapon='awp';root.scale.setScalar(.0254);root.rotation.y=Math.PI/2;root.add(body);
  const skeletons=new Set<T.Skeleton>(),attachments=new Map<string,T.Object3D>(),magazine:T.Object3D[]=[],bones:T.Bone[]=[];
  body.traverse(o=>{if(o instanceof T.SkinnedMesh){skeletons.add(o.skeleton);o.frustumCulled=false;}if(o instanceof T.Bone)bones[o.userData.sourceAWPWorldBone]=o;if(o.userData.sourceAWPWorldMagazine)magazine.push(o);if(o.userData.source_attachment){const name=o.userData.source_attachment.name;check(!attachments.has(name),'Duplicate AWP attachment');attachments.set(name,o);}});
  check(attachments.size===14&&magazine.length===1&&bones.filter(Boolean).length===94,'Original AWP world instance binding changed');
  root.userData[KEY]={body,bones,skeletons,attachments,magazine,sequence:'',time:0}satisfies Instance;instances.add(root);sampleWorldModel(root,{sequence:'default',timeSeconds:0});return root;
 }
 function attachment(root:T.Group,name:string,relativeTo:T.Object3D=root){const s=instance(root),o=s.attachments.get(name);check(o,'Original AWP attachment missing: '+name);root.updateWorldMatrix(true,true);relativeTo.updateWorldMatrix(true,false);return relativeTo.matrixWorld.clone().invert().multiply(o!.matrixWorld);}
 function inspectWorldModel(root:T.Group){const s=instance(root);return{weapon:'awp',sequence:s.sequence,time:s.time,magazineVisible:s.magazine.every(o=>o.visible),clips:[...clips.values()],attachments:[...s.attachments.keys()],boneCount:94};}
 function disposeWorldModel(root:T.Group){if(!instances.delete(root))return;const s=root.userData[KEY]as Instance;s.skeletons.forEach(s=>s.dispose());delete root.userData[KEY];root.removeFromParent();}
 function dispose(){if(disposed)return;for(const root of [...instances])disposeWorldModel(root);disposed=true;}
 return{createWorldModel,sampleWorldModel,attachment,inspectWorldModel,disposeWorldModel,dispose};
}
export type SourceAWPWorldLoadOptions={baseUrl?:string;signal?:AbortSignal;loadingManager?:T.LoadingManager};
export async function loadSourceAWPWorld(options:SourceAWPWorldLoadOptions={}){
 const {signal}=options,base=(options.baseUrl??'/source/csgo-12426148/awp-world').replace(/\/$/,''),frozen=SOURCE_AWP_WORLD_ASSETS;
 const r=await fetch(base+'/manifest.json',{signal,cache:'no-cache'});check(r.ok,'AWP world manifest HTTP '+r.status);const raw=new Uint8Array(await r.arrayBuffer());check(await sourceSha256(raw,signal)===frozen.manifestSha256,'AWP world manifest SHA mismatch');const manifest=JSON.parse(new TextDecoder().decode(raw))as SourceAWPWorldManifest;
 const files=new Map(manifest.files.map(f=>[f.path,f]));check(files.size===manifest.files.length&&manifest.files.every(f=>/^[\w./-]+$/.test(f.path)&&!f.path.startsWith('/')&&f.path.split('/').every(p=>p!=='.'&&p!=='..')&&Number.isSafeInteger(f.bytes)&&f.bytes>0&&/^[a-f0-9]{64}$/.test(f.sha256)),'AWP world file contract changed');
 for(const[name,sha]of [[manifest.model,frozen.modelSha256],[manifest.rig,frozen.rigSha256],[manifest.pose,frozen.poseSha256],[manifest.frames,frozen.framesSha256]])check(files.get(name)?.sha256===sha,'AWP world frozen file differs: '+name);
 const textures=new Map<string,T.Texture>(),hashVerified:Record<string,boolean>={'manifest.json':true},materials:ReturnType<typeof createSourceAWPMaterial>[]=[];let gltf:GLTF|undefined,models:ReturnType<typeof createSourceAWPWorldModels>|undefined,disposed=false;
 async function bytes(name:string){check(!disposed,'AWP world owner disposed');const row=files.get(name);check(row,'AWP world file absent: '+name);const r=await fetch(base+'/'+name,{signal,cache:'no-cache'});check(r.ok,'AWP world HTTP '+r.status);const b=new Uint8Array(await r.arrayBuffer());check(b.byteLength===row!.bytes&&await sourceSha256(b,signal)===row!.sha256,'AWP world SHA mismatch: '+name);hashVerified[name]=true;return b;}
 async function texture(name:string){const b=await bytes(name),url=URL.createObjectURL(new Blob([b as Uint8Array<ArrayBuffer>],{type:'image/png'}));try{const t=await new T.TextureLoader(options.loadingManager).loadAsync(url);textures.set(name,t);signal?.throwIfAborted();t.flipY=false;t.colorSpace=/normal|exponent/.test(name)?T.NoColorSpace:T.SRGBColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=8;t.needsUpdate=true;}finally{URL.revokeObjectURL(url);}}
 const oldMaterials=new Set<T.Material>();function dispose(){if(disposed)return;disposed=true;models?.dispose();materials.forEach(m=>m.dispose());const geometries=new Set<T.BufferGeometry>(),skeletons=new Set<T.Skeleton>(),allTextures=new Set(textures.values()),images=new Set<ImageBitmap>();gltf?.scene.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])oldMaterials.add(m);}if(o instanceof T.SkinnedMesh)skeletons.add(o.skeleton);});for(const m of oldMaterials){for(const v of Object.values(m))if(v instanceof T.Texture)allTextures.add(v);m.dispose();}skeletons.forEach(s=>s.dispose());geometries.forEach(g=>g.dispose());allTextures.forEach(t=>{if(typeof ImageBitmap!=='undefined'&&t.image instanceof ImageBitmap)images.add(t.image);t.dispose();});images.forEach(i=>i.close());}
 try{
  const values=new Map<string,Uint8Array>(),tasks=await Promise.allSettled([bytes(manifest.model).then(async b=>gltf=await new GLTFLoader(options.loadingManager).parseAsync(b.buffer as ArrayBuffer,base+'/')),...[manifest.rig,manifest.pose,manifest.frames].map(async n=>values.set(n,await bytes(n))),...manifest.files.filter(f=>f.path.startsWith('textures/')).map(f=>texture(f.path))]);for(const t of tasks)if(t.status==='rejected')throw t.reason;signal?.throwIfAborted();
  const json=(n:string)=>JSON.parse(new TextDecoder().decode(values.get(n)!)),data=json(manifest.pose);check(data.frames.sha256===frozen.framesSha256,'AWP world raw frame identity changed');const poseIndex=prepareSourceAWPWorldPose(data,values.get(manifest.frames)!);
  const tex=(n:string)=>{const t=textures.get('textures/'+n+'-rgba.png');check(t,'AWP world texture missing: '+n);return t!;};const weapon=createSourceAWPMaterial('awp',tex('awp'),tex('awp_exponent'),true),scope=createSourceAWPScopeMaterial(tex('scope'),tex('scope_normal'));materials.push(weapon,scope);const replaced=new Set<string>();
  gltf!.scene.traverse(o=>{if(o instanceof T.Mesh){const replace=(m:T.Material)=>{oldMaterials.add(m);const h=m.name==='awp'?weapon:m.name==='scope_awp'?scope:undefined;check(h,'Unadapted AWP world material: '+m.name);replaced.add(m.name);return h!.material;};o.material=Array.isArray(o.material)?o.material.map(replace):replace(o.material);}});check(replaced.size===2,'AWP world material set changed');
  models=createSourceAWPWorldModels(gltf!,poseIndex,json(manifest.rig),manifest);return{gltf:gltf!,manifest,poseIndex,hashVerified,...models,fetchFile:bytes,dispose};
 }catch(error){dispose();throw error;}
}
