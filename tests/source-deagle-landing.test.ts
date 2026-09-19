import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createSourceDeagleHandlingState,sourceDeagleMovementTick,sourceDeagleHandlingOnLand,sourceDeagleHandlingTick} from '../game/source-deagle-handling';
const d=JSON.parse(readFileSync('output/tests/source-deagle-landing-native.json','utf8'));
function state(r:any){const s=createSourceDeagleHandlingState();s.accuracy={penalty:r.before.penalty,recoilIndex:r.before.recoilIndex,lastShotTime:r.before.lastShotTime,lastUpdateTime:r.before.lastUpdateTime};s.punch={angle:r.before.angle,velocity:r.before.velocity,viewPunch:r.before.viewPunch};return s;}
it('matches original Deagle OnLand and movement/landing/accuracy order',()=>{
 expect(d.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');expect(d.rows).toHaveLength(18);expect(d.chains).toHaveLength(3);
 for(const r of d.rows){const s=sourceDeagleHandlingOnLand(state(r),r.fallVelocitySource,r.commandSeed);expect({...s.accuracy,...s.punch}).toEqual(r.original.state);}
 for(const r of d.chains){let s=sourceDeagleMovementTick(state(r),r.dt);s=sourceDeagleHandlingOnLand(s,r.fallVelocitySource,r.commandSeed);s=sourceDeagleHandlingTick(s,{grounded:true},r.time,r.dt);expect({...s.accuracy,...s.punch}).toEqual(r.original);}
});
