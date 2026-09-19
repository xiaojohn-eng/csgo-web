import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createSourceAWPHandlingState,sourceAWPMovementTick,sourceAWPHandlingTick,sourceAWPHandlingOnLand,type SourceAWPHandlingState} from '../game/source-awp-handling';
import {sourceLandingSharedRandom} from '../game/source-landing';
const oracle=JSON.parse(readFileSync('output/tests/source-awp-landing-native.json','utf8'));
function state(input:any){const state=createSourceAWPHandlingState();state.accuracy={penalty:input.penalty,recoilIndex:input.recoilIndex,lastShotTime:input.lastShotTime,lastUpdateTime:input.lastUpdateTime};state.punch={angle:input.angle,velocity:input.velocity,viewPunch:input.viewPunch};return state;}
const flat=(state:SourceAWPHandlingState)=>({...state.accuracy,...state.punch});
it('matches original AWP current-mode OnLand and shared RNG, including asin clamp boundaries',()=>{
 expect(oracle.rows).toHaveLength(36);
 for(const row of oracle.rows){expect(flat(sourceAWPHandlingOnLand(state(row.before),row.mode,row.fallVelocitySource,row.commandSeed))).toEqual(row.original.state);expect(sourceLandingSharedRandom(row.commandSeed).value).toBe(row.original.shared.value);}
});
it('matches original movement-punch then landing then active weapon accuracy ordering',()=>{
 expect(oracle.chains).toHaveLength(6);
 for(const row of oracle.chains){let current=sourceAWPMovementTick(state(row.before),row.dt);current=sourceAWPHandlingOnLand(current,row.mode,row.fallVelocitySource,row.commandSeed);current=sourceAWPHandlingTick(current,row.mode,{grounded:true},row.time,row.dt);expect(flat(current)).toEqual(row.original);}
});
