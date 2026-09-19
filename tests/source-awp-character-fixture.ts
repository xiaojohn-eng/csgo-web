import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {prepareSourceCharacterPose} from '../game/source-character-pose';
import {prepareSourceAWPWorldPose} from '../game/source-awp-world-pose';
import {prepareSourceAWPCharacterPose} from '../game/source-awp-character-pose';
import {SOURCE_AWP_CHARACTERS} from '../game/source-awp-character-contracts';
export const readAWPCharacterJson=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
export function awpCharacterFixture(team:'t'|'ct'){
 const folder=resolve(`.reference-assets/source-exports/awp-character-candidates/character-${team}-awp`),body=readAWPCharacterJson(folder+'/body-pose-data.json'),world=readAWPCharacterJson(folder+'/world-pose-data.json');
 const index=prepareSourceAWPCharacterPose(prepareSourceCharacterPose(body,readFileSync(folder+'/body-frames.f64.bin')),prepareSourceAWPWorldPose(world,readFileSync(folder+'/world-frames.f64.bin')));
 return{folder,body,world,index,version:SOURCE_AWP_CHARACTERS[`${team}-awp`].poseVersion,reference:readAWPCharacterJson(folder+'/python-reference.json')};
}
