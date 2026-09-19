import {readFileSync,writeFileSync} from 'node:fs';
import {sourceBrowserShotBasis,sourceBrowserCameraBasis} from '../game/source-aim.js';
import {sourceRifleSpread,sourceSpreadDirection} from '../game/source-spread.js';
const path=process.argv[2];if(!path)throw Error('Pass the actual browser evidence JSON');
const data=JSON.parse(readFileSync(path,'utf8')),shots=Object.values(data.capture.shots) as any[];
const normalize=(v:number[])=>{const len=Math.hypot(...v);return v.map(x=>x/len);};
let maxRayError=0,maxCameraError=0;
for(const event of shots){
 const s=event.sourceRifleShot,offset=sourceRifleSpread(s.seedByte,s.inaccuracy,s.spread);
 if(JSON.stringify(offset)!==JSON.stringify(s.offset))throw Error('Authoritative native bullet offset/seed differs');
 const expected=normalize(sourceSpreadDirection(sourceBrowserShotBasis(...s.browserAim as [number,number],s.punchAngles),offset));
 const actual=normalize([event.dx,event.dy,event.dz]);
 maxRayError=Math.max(maxRayError,...actual.map((n,i)=>Math.abs(n-expected[i])));
}
let cameraFrames=0,kickedCameraFrames=0;
for(const frame of data.capture.frames){
 if(!frame.view)continue;
 const v=frame.view,expected=sourceBrowserCameraBasis(v.yaw,v.pitch,v.punch).forward;
 maxCameraError=Math.max(maxCameraError,...frame.cameraForward.map((n:number,i:number)=>Math.abs(n-expected[i])));cameraFrames++;
 if(v.punch.angle.some((n:number)=>Math.abs(n)>.2))kickedCameraFrames++;
}
if(maxRayError>1e-12||maxCameraError>2e-6||cameraFrames<30||kickedCameraFrames<3)throw Error(JSON.stringify({maxRayError,maxCameraError,cameraFrames,kickedCameraFrames}));
const report={input:path,shots:shots.length,cameraFrames,kickedCameraFrames,maxRayError,maxCameraError,
 maxInaccuracy:Math.max(...shots.map(e=>e.sourceRifleShot.inaccuracy)),passed:true,
 scope:'Actual browser event rays and camera matrices vs independently native-verified pure formulas; does not establish complete original movement/renderer or two physical machines.'};
writeFileSync('output/tests/source-handling-browser-validation.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
