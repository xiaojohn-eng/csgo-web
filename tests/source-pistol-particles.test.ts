import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {prepareSourcePistolParticleGraph,sourcePistolParticleParameters,decodeSourcePistolParticleSheet,type SourceParticleNativeDefaults} from '../game/source-pistol-particles-graph';
import {createSourcePistolParticleProgram,sampleSourcePistolParticles,sourcePistolParticleSheetFrame} from '../game/source-pistol-particles';
const base=resolve('.reference-assets/source-exports/pistol-particles');
const json=(file:string)=>JSON.parse(readFileSync(resolve(base,file),'utf8'));
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
it('retains all original child and fallback systems with resolvable raw materials and textures',()=>{
 const graph=prepareSourcePistolParticleGraph(json('graph.json'));
 expect(graph.systems.size).toBe(10);expect(graph.elements.size).toBe(124);expect(graph.functionNames).toHaveLength(27);
 expect(graph.phase('weapon_muzzle_flash_pistol','children').map(e=>e.name)).toEqual(['weapon_muzzle_flash_pistol_main','weapon_muzzle_flash_sparks4','weapon_muzzle_flash_smoke_small','weapon_shell_eject_smoke_pistol1','weapon_shell_eject_smoke_pistol2','weapon_shell_eject_smoke_pistol3']);
 expect(graph.phase('weapon_muzzle_flash_pistol','emitters')).toEqual([]);expect(graph.root.attributes.max_particles).toBe(0);
 expect(graph.systems.has('weapon_muzzle_flash_pistol_fallback')).toBe(true);expect(graph.data.materials).toHaveLength(5);expect(graph.data.textures).toHaveLength(4);
 const receipt=json('receipt.json');expect(sha(readFileSync(resolve(base,'graph.json')))).toBe(receipt.graph.sha256);
 for(const texture of graph.data.textures){expect(texture.frames).toBe(1);expect(texture.frameDecodeStatus).toBe('complete');
  for(const file of [texture.file,...texture.images.map(v=>v.file),...texture.resources.flatMap(v=>v.sheetFile?[v.sheetFile]:[])]){
   const data=readFileSync(resolve(base,file.path));expect(data.length).toBe(file.bytes);expect(sha(data)).toBe(file.sha256);
  }
 }
});
it('resolves omitted fields from executed native unpack getters while preserving PCF overrides',()=>{
 const graph=prepareSourcePistolParticleGraph(json('graph.json')),native=json('native-defaults.json')as SourceParticleNativeDefaults;
 expect(native.operators).toHaveLength(27);expect(native.operators.every(v=>v.nativeGetterExecuted)).toBe(true);
 const elements=graph.phase('weapon_muzzle_flash_pistol_main','initializers');
 const position=sourcePistolParticleParameters(elements.find(e=>e.name==='Position Within Sphere Random')!,native);
 expect(position.values).toMatchObject({distance_min:0,distance_max:0,control_point_number:0,'bias in local system':true,speed_in_local_coordinate_system_min:[80,0,0],speed_in_local_coordinate_system_max:[500,0,0]});
 expect(position.origins.control_point_number).toBe('native-default');expect(position.origins['bias in local system']).toBe('pcf');
 const radius=sourcePistolParticleParameters(graph.phase('weapon_muzzle_flash_pistol_main','operators').find(e=>e.name==='Radius Scale')!,native);
 expect(radius.values).toMatchObject({start_time:0,end_time:1,radius_start_scale:1,radius_end_scale:.25,scale_bias:.5,ease_in_and_out:false});
 for(const element of graph.data.elements.filter(e=>e.type==='DmeParticleOperator'))expect(sourcePistolParticleParameters(element,native).unknownOverrides).toEqual([]);
});
it('decodes every raw VTF sheet record and rejects truncated/trailing resources',()=>{
 const fire=readFileSync(resolve(base,'sheets/fire_particle_4.bin')),smoke=readFileSync(resolve(base,'sheets/vistasmokev1_emods.bin'));
 const a=decodeSourcePistolParticleSheet(fire),b=decodeSourcePistolParticleSheet(smoke);
 expect(a.bytesConsumed).toBe(5528);expect(a.sequences.map(s=>[s.id,s.frames.length,s.flags])).toEqual([0,1,2,3,4].map(id=>[id,16,1]));
 expect(b.bytesConsumed).toBe(17960);expect(b.sequences).toHaveLength(34);expect(b.sequences.reduce((n,s)=>n+s.frames.length,0)).toBe(256);
 expect(a.sequences[0].frames[0].images[0]).toEqual([.000244140625,.00390625,.062255859375,.99609375]);
 expect(()=>decodeSourcePistolParticleSheet(fire.subarray(0,fire.length-1))).toThrow('Truncated');
 expect(()=>decodeSourcePistolParticleSheet(Buffer.concat([fire,Buffer.from([0])]))).toThrow('Trailing');
});
it('rejects missing assets, missing references and a cyclic child graph instead of replacing them',()=>{
 const input=json('graph.json'),missing=structuredClone(input);missing.elements.pop();expect(()=>prepareSourcePistolParticleGraph(missing)).toThrow('Unresolved');
 const textures=structuredClone(input);textures.textures=[];expect(()=>prepareSourcePistolParticleGraph(textures)).toThrow('texture unresolved');
 const cycle=structuredClone(input),root=cycle.elements.find((e:{id:string})=>e.id===cycle.root);root.attributes.children.push({ref:root.id,name:root.name});
 expect(()=>prepareSourcePistolParticleGraph(cycle)).toThrow('Cyclic');
});
it('matches the original emitter machine code for four main and eight core birth timestamps',()=>{
 const graph=prepareSourcePistolParticleGraph(json('graph.json')),program=createSourcePistolParticleProgram(graph,json('native-defaults.json')),particles=program.emit(()=>.5),oracle=json('native-operators.json');
 expect(oracle.status).toBe('original-operators-executed');expect(oracle.clientSHA256).toBe('21d2d652a3b2e07c44fa0a3b638886744af9d24ba0c91e64f97a0d8afc43d4cb');
 for(const emitter of oracle.emitters){const actual=particles.filter(p=>p.system===emitter.system);expect(actual).toHaveLength(emitter.count);expect(actual.map(p=>p.born)).toEqual(emitter.births);}
 expect(particles.filter(p=>p.system==='main').every(p=>p.forwardSpeed===290&&p.radius===oracle.particleDefinitionRadius.value)).toBe(true);
 for(const p of particles.filter(p=>p.system==='core')){expect(p.alpha).toBeCloseTo(.2*(1-p.born/Math.fround(.007)),6);expect(p.radius).toBeCloseTo(5-3*p.born/Math.fround(.007),6);}
 expect(()=>program.emit(()=>1)).toThrow('random sample');
});
it('matches 36 independent original SIMD radius and alpha trajectories before expiry',()=>{
 const program=createSourcePistolParticleProgram(prepareSourcePistolParticleGraph(json('graph.json')),json('native-defaults.json')),template=program.emit(()=>.5)[0];
 for(const row of json('native-operators.json').rows)for(let lane=0;lane<4;lane++){
  const [actual]=sampleSourcePistolParticles([{...template,life:row.lifetime,fadeDuration:row.fadeDuration,radius:row.initialRadius[lane],alpha:row.initialAlpha[lane]}],row.age);
  expect(actual.currentRadius).toBeCloseTo(row.radius[lane],5);expect(actual.currentAlpha).toBeCloseTo(row.alpha[lane],6);
 }
 expect(sampleSourcePistolParticles([template],template.life)).toEqual([]);
 expect(sampleSourcePistolParticles([template],-.001)).toEqual([]);
 const [moved]=sampleSourcePistolParticles([template],.02);expect(moved.distance).toBeCloseTo(5.8,7);
});
it('matches native missing-sequence fixup and 512-sample sheet interpolation including clamping',()=>{
 const sheet=decodeSourcePistolParticleSheet(readFileSync(resolve(base,'sheets/fire_particle_4.bin'))),oracle=json('native-operators.json');
 for(const alias of oracle.sheetAliases)expect(sourcePistolParticleSheetFrame(sheet,alias.index,.01,20).resolvedSequence).toBe(alias.resolvedSequence);
 for(const expected of oracle.sheetSamples){const actual=sourcePistolParticleSheetFrame(sheet,expected.sequence,expected.age,20);
  expect(actual.lookupSample).toBe(expected.lookupSample);expect(actual.index).toBe(expected.frame0);expect(actual.nextIndex).toBe(expected.frame1);expect(actual.blend).toBeCloseTo(expected.blend,6);
  expect(actual.uv0).toEqual(sheet.sequences[0].frames[expected.frame0].images[0]);
 }
});
