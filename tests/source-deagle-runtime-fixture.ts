import {readFileSync} from 'node:fs';
import {prepareSourceCharacterPose} from '../game/source-character-pose';
import {prepareSourceDeagleCharacterPose,prepareSourceDeagleWorldPose} from '../game/source-deagle-character-pose';
import {SOURCE_DEAGLE_CHARACTERS} from '../game/source-deagle-character-contracts';
import {createSourceDeaglePoseDriver,type SourceDeaglePosePlayer} from '../game/source-deagle-runtime-pose';
export const readDeagleJson=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const cache=new Map<'t'|'ct',ReturnType<typeof load>>();
function load(team:'t'|'ct'){
 const folder=`public/source/csgo-12426148/character-${team}-deagle`,data=readDeagleJson(folder+'/body-pose-data.json');
 const index=prepareSourceDeagleCharacterPose(prepareSourceCharacterPose(data,readFileSync(folder+'/body-frames.f64.bin')),
  prepareSourceDeagleWorldPose(readDeagleJson(folder+'/world-pose-data.json'),readFileSync(folder+'/world-frames.f64.bin')));
 const version=SOURCE_DEAGLE_CHARACTERS[`${team}-deagle`].poseVersion;
 return{index,version,data,folder};
}
export function deagleRuntimeFixture(team:'t'|'ct'){
 const source=cache.get(team)??load(team);cache.set(team,source);
 const driver=createSourceDeaglePoseDriver(source.index,source.version),player={id:'deagle-owner',x:0,y:0,z:0,yaw:0,pitch:0,crouch:false,grounded:true,
  team:team==='t'?'amber':'blue',weapon:'deagle',sourcePoseVersion:source.version,shotIdle:100,sourceDeagle:{command:{}}}as SourceDeaglePosePlayer;
 const at=(time:number,activity=194,state:'Idle'|'Walk'|'Run'|'Crouch_Idle'|'Crouch_Walk'='Idle',generation=1,startedAt=10)=>{
  const p=structuredClone(player);p.sourceDeagle!.action={activity,generation,time:startedAt};p.shotIdle=activity===192||activity===195?Math.max(0,time-startedAt):100;
  p.sourcePose=driver.advance(p,p,1/60);p.sourcePose.state=state;p.sourcePistolPose=driver.pistolPose(p,time);return p;
 };
 return{...source,driver,player,at};
}
