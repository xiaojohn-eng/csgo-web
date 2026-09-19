import {readFile} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareSourceCharacterPose,type SourceCharacterPoseIndex} from '../game/source-character-pose.js';
const cache=new Map<string,Promise<{poseIndex:SourceCharacterPoseIndex;poseVersion:string}>>();
export function loadServerSourceCharacter(manifestPath:string){
  const path=resolve(manifestPath),existing=cache.get(path);if(existing)return existing;
  const pending=(async()=>{
    const manifest=JSON.parse(await readFile(path,'utf8'));
    if(manifest.format!=='source-character-stage-v1'||manifest.build!==12426148)throw Error('Server Source character build differs');
    const base=dirname(path);
    async function bytes(name:string){
      const record=manifest.files[name],file=resolve(base,name);
      if(!record||!file.startsWith(base+sep))throw Error('Server Source pose file outside staged directory');
      const data=await readFile(file);
      if(data.byteLength!==record.bytes||createHash('sha256').update(data).digest('hex')!==record.sha256)throw Error('Server Source pose checksum differs: '+name);
      return data;
    }
    const [json,frames]=await Promise.all([bytes(manifest.poseData),bytes(manifest.poseFrames)]);
    const data=JSON.parse(new TextDecoder().decode(json));
    const weapon=manifest.weaponId??'ak47';
    if(weapon!=='ak47'&&weapon!=='m4a4')throw Error('Server Source weapon profile differs');
    const suffix=weapon==='m4a4'?'m4':'ak';
    const profile=manifest.characterProfile==='tm_leet_varianta'?{prefix:`csgo-t-${suffix}-12426148:`,body:71,animation:71}:
      manifest.characterProfile==='ctm_idf'?{prefix:`csgo-ct-${suffix}-12426148:`,body:74,animation:70}:null;
    if(!profile||manifest.bodyBoneCount!==profile.body||manifest.animationBoneCount!==profile.animation||
      data.mainBones.length!==profile.body||data.animationBones.length!==profile.animation||
      manifest.poseVersion!==profile.prefix+manifest.files[manifest.poseData].sha256.slice(0,16)||
      data.frames.sha256!==manifest.files[manifest.poseFrames].sha256)throw Error('Server Source pose identity differs');
    return {poseIndex:prepareSourceCharacterPose(data,frames),poseVersion:manifest.poseVersion as string};
  })();
  cache.set(path,pending);void pending.catch(()=>cache.delete(path));return pending;
}
