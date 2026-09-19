import {SourceUniformRandomStream} from './source-spread.js';
export type SourceRecoilWeapon='ak47'|'m4a4';
export type SourceRecoilEntry={angle:number;magnitude:number};
const f=Math.fround;
function table(seed:number,magnitude:number){
  const rng=new SourceUniformRandomStream(seed),values:SourceRecoilEntry[]=[];
  let angle=0,mag=0;
  for(let i=0;i<64;i++){
    const nextAngle=rng.randomFloat(-70,70),nextMag=f(rng.randomFloat(0,0)+magnitude);
    if(i===0){angle=nextAngle;mag=nextMag;}
    else{angle=f(angle+f(f(nextAngle-angle)*f(.55)));mag=f(mag+f(f(nextMag-mag)*f(.55)));}
    if(i<4)mag=f(mag*f(f(i*f(f(1-f(.75))/4))+f(.75)));
    values.push({angle,magnitude:mag});
  }
  return values;
}
const TABLES={ak47:table(223,30),m4a4:table(38965,23)};
/** Original full-auto rifle table at default recoil ConVars. Angle is in
 * degrees, magnitude feeds the original punch-velocity update, not a direct
 * per-frame camera angle. Caller owns recoilIndex and punch state/decay.
 * Both original modes have equal recoil attributes for these two rifles. */
export function sourceRifleRecoil(weapon:SourceRecoilWeapon,shotIndex:number,mode:0|1=0):SourceRecoilEntry{
  if((weapon!=='ak47'&&weapon!=='m4a4')||!Number.isSafeInteger(shotIndex)||shotIndex<0||(mode!==0&&mode!==1))
    throw Error('Invalid original rifle recoil-table input');
  return {...TABLES[weapon][shotIndex%64]!};
}
