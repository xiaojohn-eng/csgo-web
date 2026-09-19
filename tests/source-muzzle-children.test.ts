import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {sourceParticleNoise} from '../game/source-particle-noise';
import {createSourceMuzzleChildProgram,sourceMuzzleVelocityNoise,sourceParticleMovementBasic,SOURCE_MUZZLE_CHILD_SYSTEMS,type SourceParticleVec3} from '../game/source-muzzle-children';
import {prepareSourcePistolParticleGraph,sourcePistolParticleParameters} from '../game/source-pistol-particles-graph';
import noise from './fixtures/source-muzzle-children/noise-native.json';
import velocity from './fixtures/source-muzzle-children/velocity-noise-native.json';
const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const base='public/source/csgo-12426148/muzzle-particles/';
const graph=prepareSourcePistolParticleGraph(json(base+'graph.json')),native=json(base+'native-defaults.json');
it('matches the actual client NoiseSIMD across positive, negative and large shifted coordinates',()=>{
 for(const row of noise.cases)expect(sourceParticleNoise(...row.input as SourceParticleVec3)).toBeCloseTo(row.output,6);
});
it('matches the original Velocity Noise initializer displacement instead of inventing spark velocity',()=>{
 const element=graph.phase('weapon_muzzle_flash_sparks4','initializers').find(e=>e.attributes.functionName==='Velocity Noise')!;
 const values=sourcePistolParticleParameters(element,native).values;
 for(const row of velocity.cases){const result=sourceMuzzleVelocityNoise(row.position as SourceParticleVec3,row.born,values);for(let i=0;i<3;i++)expect(result[i]).toBeCloseTo((row.previous[i]-row.after[i])*30,3);}
});
it('matches all four original SIMD lanes of the measured Movement Basic operator',()=>{
 const data=json('research/source-movement-basic-apply.json');
 for(const row of data.cases)for(let lane=0;lane<4;lane++){
  const p=row.before['0'].map((x:number[])=>x[lane]),q=row.before['2'].map((x:number[])=>x[lane]);
  const actual=sourceParticleMovementBasic(p,q,row.case.gravity,row.case.drag,row.case.dt,1/30);
  for(let axis=0;axis<3;axis++)expect(actual[axis]).toBeCloseTo(row.after['2'][axis][lane],4);
 }
});
it('executes the actual rifle and AWP child closure, including the second sparks random force',()=>{
 const expected=[1,1,1,3,4,1,5,10];
 for(const [i,name]of [...SOURCE_MUZZLE_CHILD_SYSTEMS.rifle,...SOURCE_MUZZLE_CHILD_SYSTEMS.awp].entries()){
  const program=createSourceMuzzleChildProgram(graph,native,name),particles=program.emit(71,{born:1});expect(particles).toHaveLength(expected[i]);
  expect(program.sample(particles,3)).toHaveLength(0);
  expect(program.emit(71,{born:1})).toEqual(particles);expect(program.emit(72,{born:1})).not.toEqual(particles);
  for(const p of particles){expect(p.life).toBeGreaterThan(0);expect(p.trajectory.length).toBe(Math.ceil(p.life*60)+1);expect(p.trajectory.flat().every(Number.isFinite)).toBe(true);}
 }
 const sparks2=createSourceMuzzleChildProgram(graph,native,'weapon_muzzle_flash_sparks2');expect(sparks2.configuration.phases.forces[0].values['min force']).toEqual([-1000,-1000,-1000]);
});
it('grows and thins muzzle smoke after the core flash ends, with a distinct ejection origin',()=>{
 const smoke=createSourceMuzzleChildProgram(graph,native,'weapon_muzzle_flash_smoke_small2'),s=smoke.emit(3);
 const early=smoke.sample(s,.025)[0],late=smoke.sample(s,.15)[0];expect(late.currentRadius).toBeGreaterThan(early.currentRadius);expect(late.currentAlpha).toBeLessThan(early.currentAlpha);expect(late.currentPosition[0]).toBeGreaterThan(early.currentPosition[0]);
 const eject=createSourceMuzzleChildProgram(graph,native,'weapon_shell_eject_smoke_assrifle2'),p=eject.emit(3)[0];expect(p.position).toEqual([-20,2,2]);expect(p.life).toBe(1.5);expect(eject.sample([p],1)).toHaveLength(1);expect(eject.sample([p],0)[0].currentAlpha).toBe(0);
});
it('keeps the two ejection streams distinct and preserves frame-sequence IDs',()=>{
 for(const [name,seq,seq2,offset]of [['weapon_shell_eject_smoke_assrifle2',1,0,-20],['weapon_shell_eject_smoke_assrifle3',2,10,-25],['weapon_shell_eject_smoke_awp3',2,10,-40]]as const){const p=createSourceMuzzleChildProgram(graph,native,name).emit(3)[0];expect(p.sequence).toBe(seq);expect(p.sequence2).toBe(seq2);expect(p.position[0]).toBe(offset);}
});
it('lets the world owner rotate gravity into the muzzle frame while retaining original magnitude',()=>{
 const smoke=createSourceMuzzleChildProgram(graph,native,'weapon_shell_eject_smoke_assrifle2');const a=smoke.emit(3,{gravity:[0,0,0]}),b=smoke.emit(3,{gravity:[-4,0,0]});
 expect(b[0].trajectory.at(-1)![0]).toBeLessThan(a[0].trajectory.at(-1)![0]);expect(b[0].trajectory.at(-1)![2]).toBe(a[0].trajectory.at(-1)![2]);
});
