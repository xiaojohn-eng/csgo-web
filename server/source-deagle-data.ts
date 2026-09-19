import {readFile} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareSourceCharacterPose} from '../game/source-character-pose.js';
import {prepareSourceDeagleWorldPose,prepareSourceDeagleCharacterPose,type SourceDeagleCharacterPoseIndex} from '../game/source-deagle-character-pose.js';
import {SOURCE_DEAGLE_CHARACTERS,type SourceDeagleCharacterManifest} from '../game/source-deagle-character-contracts.js';
const cache=new Map<string,Promise<{poseIndex:SourceDeagleCharacterPoseIndex;poseVersion:string}>>();
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
export function loadServerSourceDeagle(manifestPath:string,team:'t'|'ct',weapon:'deagle'='deagle'){
 const path=resolve(manifestPath),key=path+':'+team+':'+weapon,existing=cache.get(key);if(existing)return existing;
 const pending=(async()=>{
  const raw=await readFile(path),frozen=SOURCE_DEAGLE_CHARACTERS[`${team}-${weapon}`];
  if(sha(raw)!==frozen.manifestSha256)throw Error('Server pistol manifest SHA differs');
  const manifest=JSON.parse(new TextDecoder().decode(raw))as SourceDeagleCharacterManifest,base=dirname(path);
  if(manifest.format!=='source-pistol-character-stage-v1'||manifest.build!==12426148||manifest.team!==team||manifest.weaponId!==weapon||manifest.poseVersion!==frozen.poseVersion)throw Error('Server pistol identity differs');
  const files=new Map(manifest.files.map(f=>[f.path,f]));
  async function bytes(name:string){const file=resolve(base,name),row=files.get(name);
   if(!row||!file.startsWith(base+sep))throw Error('Server pistol pose path differs');const data=await readFile(file);
   if(data.byteLength!==row.bytes||sha(data)!==row.sha256)throw Error('Server pistol pose SHA differs: '+name);return data;
  }
  const [bodyRaw,bodyFrames,worldRaw,worldFrames]=await Promise.all([bytes(manifest.bodyPose),bytes(manifest.bodyFrames),bytes(manifest.worldPose),bytes(manifest.worldFrames)]);
  const body=JSON.parse(new TextDecoder().decode(bodyRaw)),world=JSON.parse(new TextDecoder().decode(worldRaw));
  if(body.frames.sha256!==files.get(manifest.bodyFrames)?.sha256||world.frames.sha256!==files.get(manifest.worldFrames)?.sha256||body.worldPoseSHA256!==files.get(manifest.worldPose)?.sha256||manifest.poseVersion!==`csgo-${team}-${weapon}-12426148:`+files.get(manifest.bodyPose)!.sha256.slice(0,16))throw Error('Server pistol pose files disagree');
  const poseIndex=prepareSourceDeagleCharacterPose(prepareSourceCharacterPose(body,bodyFrames),prepareSourceDeagleWorldPose(world,worldFrames));
  if(poseIndex.team!==team||poseIndex.weapon!==weapon)throw Error('Server pistol graph identity differs');
  return {poseIndex,poseVersion:manifest.poseVersion};
 })();cache.set(key,pending);void pending.catch(()=>cache.delete(key));return pending;
}
