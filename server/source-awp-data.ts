import {readFile} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareSourceCharacterPose} from '../game/source-character-pose.js';
import {prepareSourceAWPWorldPose} from '../game/source-awp-world-pose.js';
import {prepareSourceAWPCharacterPose,type SourceAWPCharacterPoseIndex} from '../game/source-awp-character-pose.js';
import {SOURCE_AWP_CHARACTERS,type SourceAWPCharacterManifest} from '../game/source-awp-character-contracts.js';
const cache=new Map<string,Promise<{poseIndex:SourceAWPCharacterPoseIndex;poseVersion:string}>>();
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Authority loads only SHA-verified original pose data; no renderer or GLB. */
export function loadServerSourceAWP(manifestPath:string,team:'t'|'ct'){
  const path=resolve(manifestPath),key=path+':'+team,existing=cache.get(key);if(existing)return existing;
  const pending=(async()=>{
    const raw=await readFile(path),frozen=SOURCE_AWP_CHARACTERS[`${team}-awp`];
    if(sha(raw)!==frozen.manifestSha256)throw Error('Server AWP manifest SHA differs');
    const manifest=JSON.parse(new TextDecoder().decode(raw))as SourceAWPCharacterManifest,base=dirname(path);
    if(manifest.format!=='source-awp-character-stage-v1'||manifest.sourceApp!==740||manifest.build!==12426148||manifest.team!==team||manifest.weaponId!=='awp'||manifest.poseVersion!==frozen.poseVersion)throw Error('Server AWP identity differs');
    const files=new Map(manifest.files.map(file=>[file.path,file]));
    async function bytes(name:string){
      const file=resolve(base,name),row=files.get(name);if(!row||!file.startsWith(base+sep))throw Error('Server AWP pose path differs');
      const data=await readFile(file);if(data.byteLength!==row.bytes||sha(data)!==row.sha256)throw Error('Server AWP pose SHA differs: '+name);return data;
    }
    const [bodyRaw,bodyFrames,worldRaw,worldFrames]=await Promise.all([bytes(manifest.bodyPose),bytes(manifest.bodyFrames),bytes(manifest.worldPose),bytes(manifest.worldFrames)]);
    const body=JSON.parse(new TextDecoder().decode(bodyRaw)),world=JSON.parse(new TextDecoder().decode(worldRaw));
    if(body.frames.sha256!==files.get(manifest.bodyFrames)?.sha256||world.frames.sha256!==files.get(manifest.worldFrames)?.sha256||body.worldPoseSHA256!==files.get(manifest.worldPose)?.sha256||manifest.poseVersion!==`csgo-${team}-awp-12426148:`+files.get(manifest.bodyPose)!.sha256.slice(0,16))throw Error('Server AWP pose files disagree');
    const poseIndex=prepareSourceAWPCharacterPose(prepareSourceCharacterPose(body,bodyFrames),prepareSourceAWPWorldPose(world,worldFrames));
    if(poseIndex.team!==team||poseIndex.weapon!=='awp')throw Error('Server AWP graph identity differs');return{poseIndex,poseVersion:manifest.poseVersion};
  })();cache.set(key,pending);void pending.catch(()=>cache.delete(key));return pending;
}
