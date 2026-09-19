import {it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareSourceAWPWorldPose,sampleSourceAWPWorldPose,sourceAWPWorldCycleRate,type SourceAWPWorldInput} from '../game/source-awp-world-pose';
const folder='.reference-assets/source-exports/awp-candidates/awp-world/continuous';
function fixture(){const raw=readFileSync(folder+'/pose-data.json'),data=JSON.parse(raw.toString()),bytes=readFileSync(folder+'/frames.f64.bin'),reference=JSON.parse(readFileSync(folder+'/python-reference.json','utf8'));expect(createHash('sha256').update(raw).digest('hex')).toBe(reference.sourceDataSHA256);expect(createHash('sha256').update(bytes).digest('hex')).toBe(data.frames.sha256);return{data,bytes,reference,index:prepareSourceAWPWorldPose(data,bytes)};}
it('matches all five original AWP world sequences against independent Python/mathutils poses',()=>{
 const f=fixture();let localError=0,worldError=0;
 for(const c of f.reference.cases){const got=sampleSourceAWPWorldPose(f.index,c.input as SourceAWPWorldInput);for(let b=0;b<94;b++){for(let k=0;k<3;k++)localError=Math.max(localError,Math.abs(got.positions[b*3+k]-c.positions[b][k]));for(let k=0;k<4;k++)localError=Math.max(localError,Math.abs(got.quaternions[b*4+k]-c.quaternions[b][k]));for(let col=0;col<4;col++)for(let row=0;row<4;row++)worldError=Math.max(worldError,Math.abs(got.sourceWorldMatrices[b*16+col*4+row]-c.sourceWorldMatrices[b][row][col]));}}
 expect(f.reference.caseCount).toBe(30);expect(localError).toBeLessThan(1e-10);expect(worldError).toBeLessThan(.0001);
 expect(sourceAWPWorldCycleRate(f.index,'default')).toBe(0);for(const name of ['sniper_reload','sniper_reload_moving','sniper_reload_crouch','sniper_reload_crouch_moving']as const)expect(sourceAWPWorldCycleRate(f.index,name)).toBe(30/110);
 writeFileSync(folder+'/verification.json',JSON.stringify({status:'passed-original-awp-world',pythonCases:30,bonesPerCase:94,maximumLocalComponentError:localError,maximumPythonMathutilsWorldMatrixErrorSourceUnits:worldError,noPistolAimGraphInvented:true},null,2)+'\n');
});
it('rejects wrong weapon identities and changed graphs before sampling',()=>{
 const f=fixture();for(const mutate of [(d:typeof f.data)=>d.weaponId='deagle',(d:typeof f.data)=>d.bones.pop(),(d:typeof f.data)=>d.sequences[1].autoLayers.push({sequence_id:2})]){const d=structuredClone(f.data);mutate(d);expect(()=>prepareSourceAWPWorldPose(d,f.bytes)).toThrow(/identity/);}
 expect(()=>sampleSourceAWPWorldPose(f.index,{sequence:'pistol_aim_t'}as unknown as SourceAWPWorldInput)).toThrow();
});
