import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {prepareSourcePistolParticleGraph} from '../game/source-pistol-particles-graph';
import {createSourcePistolParticleProgram} from '../game/source-pistol-particles';
import {createSourcePistolParticleRandom,sourcePistolParticleRandomValue,SOURCE_PISTOL_PARTICLE_RANDOM_TABLE_SHA256} from '../game/source-pistol-particles-random';
const base='.reference-assets/source-exports/pistol-particles',json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
it('preserves all 4096 original float32 bits and the scalar wrapping counter',()=>{
 const original=Buffer.from(readFileSync(base+'-r2/original-random-floats.bin')),copy=Buffer.alloc(original.length);
 for(let i=0;i<4096;i++)copy.writeFloatLE(sourcePistolParticleRandomValue(i),i*4);
 expect(copy).toEqual(original);expect(createHash('sha256').update(copy).digest('hex')).toBe(SOURCE_PISTOL_PARTICLE_RANDOM_TABLE_SHA256);
 const stream=createSourcePistolParticleRandom(4090,3);
 for(let i=0;i<20;i++)expect(stream()).toBe(original.readFloatLE(((4093+i)&4095)*4));
 expect(stream.snapshot()).toEqual({seed:4090,counter:23});
 expect(()=>createSourcePistolParticleRandom(.2)).toThrow('seed');
 expect(createSourcePistolParticleRandom(Number.MAX_SAFE_INTEGER,1)()).toBe(sourcePistolParticleRandomValue(0));
});
it('matches every original main/core scalar initializer over three independent and wrapped seeds',()=>{
 const program=createSourcePistolParticleProgram(prepareSourcePistolParticleGraph(json(base+'/graph.json')),json(base+'/native-defaults.json')),oracle=json(base+'-r2/native-initializers.json');
 expect(oracle.status).toBe('original-scalar-initializers-executed');
 for(const row of oracle.cases){
  const particles=program.emitWithSeeds({main:row.seed,core:row.seed}).filter(p=>p.system===row.system),fields=row.operators.at(-1).fields;
  expect(particles).toHaveLength(row.count);
  for(let i=0;i<row.count;i++){
   const p=particles[i];
   expect(p.life).toBe(fields['1'][i]);expect(p.rotation).toBe(fields['4'][i]);expect(p.sequence).toBe(fields['9'][i]);expect(p.born).toBe(fields['8'][i]);
   expect(p.alpha).toBe(fields['7'][i]);expect(p.radius).toBe(fields['3'][i]);expect(p.color).toEqual(fields['6'][i]);expect(p.forwardOffset).toBe(fields['0'][i][0]);
   if(row.system==='core')expect(p.fadeDuration).toBe(row.fadeDurations[i]);
   if(row.system==='main')expect(Math.fround(-p.forwardSpeed*Math.fround(.0075))).toBe(fields['2'][i][0]);
  }
  expect(row.operators.map((v:{randomBefore:number;randomAfter:number})=>v.randomAfter-v.randomBefore)).toEqual(row.system==='main'?[4,8,4,4,24]:[8,16,8,8,8,0,0,0]);
 }
});
it('keeps explicit sample callbacks while making default emissions reproducible without Math.random',()=>{
 const make=()=>createSourcePistolParticleProgram(prepareSourcePistolParticleGraph(json(base+'/graph.json')),json(base+'/native-defaults.json'));
 const a=make(),b=make();expect(a.emit()).toEqual(b.emit());expect(a.emit()).toEqual(b.emit());expect(a.emit()).not.toEqual(a.emit());
 let calls=0;a.emit(()=>{calls++;return .5;});expect(calls).toBe(44+48+8);
});
