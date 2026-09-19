import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {prepareSourcePistolParticleGraph,decodeSourcePistolParticleSheet,sourceParticleSchemaFor,sourcePistolParticleParameters,type SourceParticleNativeDefaults,type SourceParticleSheet} from '../game/source-pistol-particles-graph';
import {createSourceRifleMuzzleProgram,createSourceRifleMuzzleGlowProgram,createSourceRifleMuzzleFlameProgram,createSourceRifleMuzzleContinuousFlameProgram,sourceParticleColorFade,
  SOURCE_RIFLE_MUZZLE_FLASH_SYSTEM,SOURCE_RIFLE_MUZZLE_GLOW_SYSTEM,SOURCE_RIFLE_MUZZLE_FLAME_SYSTEM,SOURCE_RIFLE_MUZZLE_ROOT,
  SOURCE_RIFLE_MUZZLE_CONTINUOUS_SYSTEM,SOURCE_RIFLE_MUZZLE_MATERIAL,SOURCE_RIFLE_MUZZLE_TEXTURE,sampleSourceRifleMuzzleParticles,sampleSourceRifleMuzzleGlowParticles,
  sampleSourceRifleMuzzleFlameParticles,sampleSourceAwpMuzzleParticles,sourceParticleRemapScalar} from '../game/source-rifle-muzzle-particles';
import {loadSourceRifleMuzzleRenderer} from '../game/source-rifle-muzzle-renderer';
import resources from '../game/source-muzzle-particle-resources.json';

const staged=resolve('public/source/csgo-12426148/muzzle-particles');
const exported=resolve('.reference-assets/source-exports/muzzle-flash-particles');
const stagedGraph=()=>JSON.parse(readFileSync(resolve(staged,'graph.json'),'utf8'));
const stagedNative=()=>JSON.parse(readFileSync(resolve(staged,'native-defaults.json'),'utf8'))as SourceParticleNativeDefaults;
const program=()=>createSourceRifleMuzzleProgram(prepareSourcePistolParticleGraph(stagedGraph()),stagedNative());
/** One element of the staged original export, as the tamper tests need to reach it. */
type StagedElement={id:string;name?:string;type?:string;attributes:Record<string,unknown>};

it('stages the original rifle closure with its source receipts and the vent that owns the flash',()=>{
 const raw=stagedGraph(),receipt=JSON.parse(readFileSync(resolve(exported,'receipt.json'),'utf8'));
 expect(raw.format).toBe('source-pistol-particles-v1');expect(raw.build).toBe(12426148);
 expect(raw.roots.map((r:{name:string})=>r.name)).toEqual(['weapon_muzzle_flash_assaultrifle','weapon_muzzle_flash_awp']);
 // The staged bytes are the exported bytes, checked by the export's own receipt.
 const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 const exportedGraph=readFileSync(resolve(exported,'graph.json'));
 expect(Buffer.from(readFileSync(resolve(staged,'graph.json'))).equals(exportedGraph)).toBe(true);
 expect(sha(exportedGraph)).toBe(receipt.graph.sha256);
 const graph=prepareSourcePistolParticleGraph(raw);
 expect(graph.systems.size).toBe(21);expect(graph.data.textures).toHaveLength(7);
 // The original third-person system is a dispatcher; the sprite flash is its vent.
 expect(graph.phase('weapon_muzzle_flash_assaultrifle','children').map(e=>e.name)).toEqual([
  'weapon_muzzle_flash_assaultrifle_vent','weapon_muzzle_flash_assualtrifle_flame','weapon_muzzle_flash_smoke_small2',
  'weapon_shell_eject_smoke_assrifle2','weapon_shell_eject_smoke_assrifle3']);
 const vent=graph.systems.get(SOURCE_RIFLE_MUZZLE_FLASH_SYSTEM)!;
 expect(vent.attributes.material).toBe('particle\\particle_muzzleflashx.vmt');
 expect(graph.phase('weapon_muzzle_flash_assaultrifle_vent','children').map(e=>e.name))
  .toEqual(['weapon_muzzle_flash_assaultrifle_main']);
 const muzzleflashx=graph.data.textures.find(t=>t.source===SOURCE_RIFLE_MUZZLE_TEXTURE)!;
 // This original texture predates the VTF resource dictionary: one 128×128 DXT1
 // frame with no sprite sheet, so the flash never needs a sequence lookup.
 expect(muzzleflashx.resourceTable).toBe('absent-before-7.2');expect(muzzleflashx.resources).toEqual([]);
 expect(muzzleflashx.frames).toBe(1);expect([muzzleflashx.width,muzzleflashx.height]).toEqual([128,128]);
 expect(muzzleflashx.frameDecodeStatus).toBe('complete');
 const material=graph.data.materials.find(m=>m.source===SOURCE_RIFLE_MUZZLE_MATERIAL)!;
 expect(material.textures.map(t=>t.source)).toEqual([SOURCE_RIFLE_MUZZLE_TEXTURE]);
 expect(material.definition).toEqual({spritecard:{'$basetexture':'effects/muzzleflashX.vtf','$additive':'1','$depthblend':'0'}});
});

it('carries the closure\'s own original operator table, not another closure\'s',()=>{
 const native=stagedNative();
 expect(native.status).toBe('original-unpack-getters-executed');
 const names=new Set(native.operators.map(o=>o.functionName));
 // The vent needs the first group; the glow, flame, muzzle smoke and tracers that
 // live in the same closure need the rest, which only a probe of this closure finds.
 for(const name of ['emit_instantaneously','Position Within Sphere Random','Rotation Random','Lifetime Random',
  'Remap Noise to Scalar','Alpha Random','Movement Basic','Lifespan Decay','Alpha Fade Out Random','render_animated_sprites',
  'Color Fade','Position Within Box Random','Movement Lock to Control Point','Position Along Path Sequential',
  'Set Control Point Positions','Remap Initial Distance to Control Point to Scalar'])expect(names.has(name)).toBe(true);
 // `Color Fade` is the original color interpolation: its window defaults to the whole
 // lifetime and it eases, so a system only has to name its own start time.
 const fade=native.operators.find(o=>o.functionName==='Color Fade')!;
 const field=(name:string)=>fade.fields.find(f=>f.name===name)!.default;
 expect([field('fade_start_time'),field('fade_end_time'),field('ease_in_and_out'),field('output field')]).toEqual(['0','1','1','6']);
 // The closure names two operators by the lowercase class-style spelling its authoring
 // tool wrote, which this build registers only under its display name. They are
 // resolved rather than declared missing, and the target ships with the table.
 expect(native.absentOperators).toEqual([]);
 expect(native.unresolvedOperators).toEqual([]);
 expect(native.aliasedOperators).toEqual([{requested:'remap initial scalar',resolved:'Remap Initial Scalar'},
  {requested:'remap scalar to vector',resolved:'Remap Scalar to Vector'}]);
 for(const alias of native.aliasedOperators??[])expect(names.has(alias.resolved)).toBe(true);
 // The probe records the same legacy names it could not tell apart before the alias
 // rule existed, so the provenance of the rule stays visible.
 expect(native.probeUnresolvedOperators).toEqual([]);
});

it('matches the original code\'s own scalar remap values',()=>{
 // Recorded by executing the original initializer code
 // (scripts/probe-source-muzzle-particle-initializers.py, seed 0). The continuous flame's
 // radius remap has the scaling flag off and wrote the mapped value straight in, while its
 // alpha remap has the flag on and multiplied the particle's own `Alpha Random` draw.
 const birth=Math.fround(Math.fround(.0075)/9);
 expect(sourceParticleRemapScalar(birth,0,{minimum:0,maximum:Math.fround(.0075),
  outputMinimum:15,outputMaximum:1,scalesInitialValue:false})).toBeCloseTo(13.4444,3);
 expect(sourceParticleRemapScalar(birth,0,{minimum:0,maximum:Math.fround(.0075),
  outputMinimum:8,outputMaximum:1,scalesInitialValue:false})).toBeCloseTo(7.2222,3);
 expect(sourceParticleRemapScalar(birth,0,{minimum:0,maximum:Math.fround(.0075),
  outputMinimum:Math.fround(.025),outputMaximum:Math.fround(.0175),scalesInitialValue:false})).toBeCloseTo(.0242,3);
 // The same run's `Alpha Random` drew 0.4643 and the remap cut it to 0.2128 at the first
 // particle's own birth time.
 expect(sourceParticleRemapScalar(birth,.4643,{minimum:0,maximum:Math.fround(.01),
  outputMinimum:Math.fround(.5),outputMaximum:0,scalesInitialValue:true})).toBeCloseTo(.2128,3);
 // The two branches differ by exactly the initial value, which is what tells them apart.
 const window={minimum:0,maximum:Math.fround(.0075),outputMinimum:15,outputMaximum:1}as const;
 expect(sourceParticleRemapScalar(birth,3,{...window,scalesInitialValue:true}))
  .toBe(Math.fround(3*sourceParticleRemapScalar(birth,0,{...window,scalesInitialValue:false})));
 expect(()=>sourceParticleRemapScalar(birth,0,{...window,maximum:0,scalesInitialValue:false}))
  .toThrow(/scalar remap input/);
});

it('resolves a legacy operator name only when the normalised match is unique',()=>{
 const native=stagedNative();
 const exact=sourceParticleSchemaFor('Remap Initial Scalar',native);
 expect(exact?.aliasedFrom).toBeNull();
 expect(exact?.schema.functionName).toBe('Remap Initial Scalar');
 // The file's class-style spelling resolves to the registered display name.
 const legacy=sourceParticleSchemaFor('remap scalar to vector',native);
 expect(legacy?.schema.functionName).toBe('Remap Scalar to Vector');
 expect(legacy?.aliasedFrom).toBe('remap scalar to vector');
 // The alias points at the same registration the display name does, not a copy.
 expect(legacy?.schema.tableVA).toBe(sourceParticleSchemaFor('Remap Scalar to Vector',native)?.schema.tableVA);
 expect(sourceParticleSchemaFor('No Such Operator',native)).toBeNull();
 // Ambiguity fails closed: two registrations that normalise the same are refused.
 const ambiguous={...native,operators:[...native.operators,
  {...native.operators[0],functionName:'remap  initial_scalar'}]};
 expect(sourceParticleSchemaFor('remap initial scalar',ambiguous)).toBeNull();
});

it('now reads the AWP flame, its glow and the rifle\'s continuous flame in full',()=>{
 const graph=prepareSourcePistolParticleGraph(stagedGraph()),native=stagedNative();
 // These three systems used to fail closed on the file's class-style spellings alone.
 for(const system of ['weapon_muzzle_flash_huntingrifle_main','weapon_muzzle_flash_huntingrifle_glow',
  'weapon_muzzle_flash_assualtrifle_flame']){
  const aliases:string[]=[];
  for(const phase of ['emitters','initializers','operators','renderers']as const)
   for(const element of graph.phase(system,phase)){
    const resolved=sourcePistolParticleParameters(element,native);
    expect(resolved.unknownOverrides).toEqual([]);
    if(resolved.aliasedFrom)aliases.push(`${resolved.aliasedFrom} -> ${resolved.schemaFunctionName}`);
   }
  expect(aliases).toContain('remap initial scalar -> Remap Initial Scalar');
  expect(aliases).toContain('remap scalar to vector -> Remap Scalar to Vector');
 }
 // `Remap Scalar to Vector` writes the original's position field from the particle's own
 // birth time, and the three scalar remaps write its radius, its alpha and its lifetime:
 // the lifetime field index is the one this build's own executed initializer shows
 // `Lifetime Random` writing, and the position/radius/alpha indices are the ones the
 // already-ported vent, glow and pistol core use.
 const remaps=graph.phase('weapon_muzzle_flash_huntingrifle_main','initializers')
  .filter(element=>/^remap/.test(String(element.attributes.functionName)))
  .map(element=>{const resolved=sourcePistolParticleParameters(element,native);
   return [resolved.schemaFunctionName,resolved.values['output field'],resolved.values['output minimum'],resolved.values['output maximum']];});
 expect(remaps).toEqual([
  ['Remap Scalar to Vector',0,[0,0,0],[29,0,0]],
  ['Remap Initial Scalar',3,15,1],
  ['Remap Initial Scalar',7,Math.fround(.5),0],
  ['Remap Initial Scalar',1,Math.fround(.025),Math.fround(.0175)],
 ]);
 // Its continuous emitter is the same shape the already-ported pistol core uses.
 const emitter=sourcePistolParticleParameters(
  graph.phase('weapon_muzzle_flash_huntingrifle_main','emitters')[0],native).values;
 expect([emitter['emission_rate'],emitter['emission_duration'],emitter['emission_start_time']])
  .toEqual([1200,Math.fround(.0075),0]);
});

it('reads the vent\'s original parameters instead of inventing any of them',()=>{
 const p=program();
 expect(p.version).toBe('csgo-assaultrifle-muzzle-12426148-r1');
 // One instant screen-aligned sprite: the original spawns a single particle, gives
 // it 25 ms of life, a 5..7 unit radius, alpha 190..230 and ±15° of rotation.
 expect(p.configuration).toEqual({count:1,start:0,distanceMin:0,distanceMax:Math.fround(.1),
  rotationMin:-15,rotationMax:15,lifetimeMin:Math.fround(.025),lifetimeMax:Math.fround(.025),
  radiusMin:5,radiusMax:7,alphaMin:190,alphaMax:230,
  // The PCF stores this fade window as an f32 pair, unlike the lifetime above.
  fadeMin:0.02500000223517418,fadeMax:0.02500000223517418,randomlyFlipDirection:true,animationRate:4,
  // The one original child of the vent this port reports instead of drawing.
  unsimulatedChildren:['weapon_muzzle_flash_assaultrifle_main']});
});

it('emits the original single vent particle inside every original range, from the shot seed',()=>{
 const p=program();
 for(const seed of [0,1,37,1024,4095]){
  const particles=p.emit({vent:seed});
  expect(particles).toHaveLength(1);
  const [particle]=particles;
  expect(particle.id).toBe(0);expect(particle.born).toBe(0);
  expect(particle.life).toBe(Math.fround(.025));
  expect(particle.radius).toBeGreaterThanOrEqual(5);expect(particle.radius).toBeLessThanOrEqual(7);
  expect(particle.alpha).toBeGreaterThanOrEqual(Math.fround(190/255));expect(particle.alpha).toBeLessThanOrEqual(Math.fround(230/255));
  expect(Math.abs(particle.rotation)).toBeLessThanOrEqual(Math.fround(15*Math.PI/180));
  expect(particle.fadeDuration).toBeGreaterThanOrEqual(Math.fround(.025));
  // The original spawn offset is inside a 0.1 unit sphere: it never leaves the muzzle.
  expect(Math.hypot(...particle.offset)).toBeLessThanOrEqual(Math.fround(.1));
 }
 // Same shot, same values on both clients; a different shot is a different draw.
 expect(p.emit({vent:41})).toEqual(p.emit({vent:41}));
 expect(p.emit({vent:41})).not.toEqual(p.emit({vent:42}));
 expect(()=>p.emit({vent:-1})).toThrow('outside the original table');
 expect(()=>p.emit({vent:4096})).toThrow('outside the original table');
 expect(()=>p.emit({vent:1.5})).toThrow('outside the original table');
});

it('fades the original alpha out over its whole life and then removes the particle',()=>{
 const [particle]=program().emit({vent:7});
 expect(sampleSourceRifleMuzzleParticles([particle],-1e-6)).toEqual([]);
 const start=sampleSourceRifleMuzzleParticles([particle],0)[0];
 expect(start.currentAlpha).toBeGreaterThan(0);expect(start.currentAlpha).toBeLessThanOrEqual(particle.alpha);
 // Not proportional: the original eases this fade, so a quarter of the way through
 // it has already given up more than a quarter of the original alpha.
 const middle=sampleSourceRifleMuzzleParticles([particle],particle.life*.25)[0];
 expect(middle.currentAlpha).toBeGreaterThan(particle.alpha*.75);expect(middle.currentAlpha).toBeLessThan(particle.alpha);
 const end=sampleSourceRifleMuzzleParticles([particle],Math.fround(particle.life*.999))[0];
 expect(end.currentAlpha).toBeLessThan(particle.alpha*.01);
 expect(sampleSourceRifleMuzzleParticles([particle],particle.life)).toEqual([]);
 expect(()=>sampleSourceRifleMuzzleParticles([particle],NaN)).toThrow('Invalid rifle muzzle particle clock');
});

it('refuses any other original chain instead of approximating it',()=>{
 const raw=stagedGraph(),native=stagedNative();
 // The AWP's original third-person system has no sprite vent at all: it dispatches
 // the hunting rifle's continuous flame and two smoke children, so there is nothing
 // for the vent port to read and the router reports it as not staged.
 expect(prepareSourcePistolParticleGraph(raw).phase('weapon_muzzle_flash_awp','children').map(e=>e.name)).toEqual([
  'weapon_muzzle_flash_smoke_small','weapon_muzzle_flash_smoke_small3','weapon_muzzle_flash_huntingrifle_main','weapon_shell_eject_smoke_awp3']);
 // A changed original operator chain is refused rather than partially applied.
 const extra=JSON.parse(JSON.stringify(raw));
 const vent=extra.elements.find((e:{name:string;type:string})=>e.name===SOURCE_RIFLE_MUZZLE_FLASH_SYSTEM&&e.type==='DmeParticleSystemDefinition');
 vent.attributes.initializers.push(vent.attributes.initializers[0]);
 expect(()=>createSourceRifleMuzzleProgram(prepareSourcePistolParticleGraph(extra),native))
  .toThrow('Unsupported original rifle muzzle initializers');
 // ... and so is a different original material, even one this graph resolves.
 const material=JSON.parse(JSON.stringify(raw));
 material.elements.find((e:{name:string;type:string})=>e.name===SOURCE_RIFLE_MUZZLE_FLASH_SYSTEM&&e.type==='DmeParticleSystemDefinition').attributes.material='particle\\particle_spark.vmt';
 expect(()=>createSourceRifleMuzzleProgram(prepareSourcePistolParticleGraph(material),native))
  .toThrow('Unsupported original rifle muzzle material');
 // The unmodified graph still reads.
 expect(createSourceRifleMuzzleProgram(prepareSourcePistolParticleGraph(raw),native).configuration.count).toBe(1);
});

it('reads a mutated original parameter through the native defaults rather than a baked value',()=>{
 const raw=stagedGraph();
 const root=raw.elements.find((e:{id:string})=>e.id===raw.root);
 // The root's children are the original `DmeParticleChild` wrappers, each naming the
 // system it adds; the vent is reached through its wrapper's own `child` reference.
 const wrapper=raw.elements.find((e:{id:string})=>e.id===root.attributes.children
  .find((c:{name:string})=>c.name===SOURCE_RIFLE_MUZZLE_FLASH_SYSTEM).ref);
 const vent=raw.elements.find((e:{id:string})=>e.id===wrapper.attributes.child.ref);
 const emitter=vent.attributes.emitters[0];
 raw.elements.find((e:{id:string})=>e.id===emitter.ref).attributes.num_to_emit=3;
 const changed=createSourceRifleMuzzleProgram(prepareSourcePistolParticleGraph(raw),stagedNative());
 expect(changed.configuration.count).toBe(3);
 expect(changed.emit({vent:3})).toHaveLength(3);
});

it('fades the original colour from its start time to the target, eased by default',()=>{
 const initial=[1,1,1]as[number,number,number],target=[0,0,0]as[number,number,number];
 // The window is a fraction of the lifetime: nothing happens before it opens, and the
 // blend has arrived by the time it closes (the build's own end default is the life).
 expect(sourceParticleColorFade(initial,target,0,1,.7,1,true)).toEqual([1,1,1]);
 expect(sourceParticleColorFade(initial,target,.699999,1,.7,1,true)).toEqual([1,1,1]);
 expect(sourceParticleColorFade(initial,target,1,1,.7,1,true)).toEqual([0,0,0]);
 const middle=sourceParticleColorFade(initial,target,.85,1,.7,1,true)[0];
 expect(middle).toBeCloseTo(.5,3);
 // Eased, as the original's default is: the ease starts flat, so a quarter into the
 // window an eased fade has faded less than a straight one.
 expect(sourceParticleColorFade(initial,target,.775,1,.7,1,true)[0])
  .toBeGreaterThan(sourceParticleColorFade(initial,target,.775,1,.7,1,false)[0]);
 expect(()=>sourceParticleColorFade(initial,target,0,1,1,.5,true)).toThrow(/colour fade window/);
 expect(()=>sourceParticleColorFade(initial,target,0,0,.7,1,true)).toThrow(/colour fade window/);
});

it('reads the glow\'s original flare, colour window and colour fade',()=>{
 const p=createSourceRifleMuzzleGlowProgram(prepareSourcePistolParticleGraph(stagedGraph()),stagedNative());
 expect(p.system).toBe(SOURCE_RIFLE_MUZZLE_GLOW_SYSTEM);
 // One instant flare of the system's own radius, held still, with the original
 // alpha window, colour pair, 70%-of-life colour fade and single sequence.
 expect(p.configuration).toMatchObject({count:1,radius:25,lifetimeMin:Math.fround(.015),lifetimeMax:Math.fround(.015),
  rotationMin:0,rotationMax:360,alphaMin:160,alphaMax:190,sequenceMin:2,sequenceMax:2,
  fadeStart:Math.fround(.7),fadeEnd:1,colorFadeEased:true,randomlyFlipDirection:true,animationRate:30});
 const [particle]=p.emit({vent:3});
 expect(particle.radius).toBe(25);
 expect(particle.alpha).toBeGreaterThanOrEqual(Math.fround(160/255));
 expect(particle.alpha).toBeLessThanOrEqual(Math.fround(190/255));
 expect(particle.colorFadeTarget).toEqual([0,0,0]);
 expect(particle.colorFadeStart).toBe(Math.fround(.7));
 expect(particle.colorFadeEnd).toBe(1);
 // `Color Random` picks between the original's two colours, channel by channel.
 for(const [index,channel] of particle.color.entries()){
  const [a,b]=[p.configuration.color1[index],p.configuration.color2[index]];
  expect(channel).toBeGreaterThanOrEqual(Math.fround(Math.min(a,b)*Math.fround(1/255))-1e-6);
  expect(channel).toBeLessThanOrEqual(Math.fround(Math.max(a,b)*Math.fround(1/255))+1e-6);
 }
 // Same shot, same flare on both ends; a different shot is a different draw.
 expect(p.emit({vent:3})).toEqual(p.emit({vent:3}));
 expect(p.emit({vent:3})).not.toEqual(p.emit({vent:4}));
 expect(()=>p.emit({vent:4096})).toThrow(/outside the original table/);
 // A changed original operator chain is refused rather than partially applied.
 const extra=JSON.parse(JSON.stringify(stagedGraph()));
 const element=extra.elements.find((e:{name:string;type:string})=>e.name===SOURCE_RIFLE_MUZZLE_GLOW_SYSTEM
  &&e.type==='DmeParticleSystemDefinition');
 element.attributes.operators.push(element.attributes.operators[0]);
 expect(()=>createSourceRifleMuzzleGlowProgram(prepareSourcePistolParticleGraph(extra),stagedNative()))
  .toThrow(/glow operators/);
});

const files=new Map(resources.map(row=>[row.path,Uint8Array.from(readFileSync(resolve(staged,row.path)))]));
const pngFiles=new Map([...files].filter(([name])=>name.endsWith('.png')));
const sheetFiles=[...files].filter(([name])=>name.endsWith('.bin'));

const flame=()=>createSourceRifleMuzzleFlameProgram(prepareSourcePistolParticleGraph(stagedGraph()),stagedNative());

it('reads the flame\'s original path, remaps and blend from the graph',()=>{
 const p=flame();
 expect(p.system).toBe(SOURCE_RIFLE_MUZZLE_FLAME_SYSTEM);
 // The dispatcher's own end control point, the eight spawn offsets, the distance and
 // radius windows, the radius-to-alpha remap, the radius scale and the colour pair.
 expect(p.configuration).toMatchObject({count:8,mapped:8,pathLength:17.5,endPoint:[17.5,0,0],
  offsetMin:Math.fround(1),offsetMax:Math.fround(1.5),distanceMin:0,distanceMax:19,radiusMin:12,radiusMax:4,
  scalarMin:4,scalarMax:12,alphaLo:Math.fround(.125),alphaHi:1,lifetimeMin:Math.fround(.015),
  lifetimeMax:Math.fround(.015),sequenceMin:5,sequenceMax:18,animationRate:1,
  scaleStart:Math.fround(.3),scaleEnd:1,scaleLo:1,scaleHi:Math.fround(1.125)});
 // The end point of the path is the whole point: the original's distance maximum of 19
 // is exactly that point plus the offset's own maximum, so both readings agree.
 expect(p.configuration.pathLength+p.configuration.offsetMax).toBe(p.configuration.distanceMax);
 expect(p.configuration.radiusMax).toBe(p.configuration.scalarMin);
 expect(p.configuration.alphaHi).toBe(1);
 expect(p.emit({vent:5})).toHaveLength(8);
 expect(p.emit({vent:5})).toEqual(p.emit({vent:5}));
 expect(p.emit({vent:5})).not.toEqual(p.emit({vent:6}));
 expect(()=>p.emit({vent:4096})).toThrow(/outside the original table/);
});

it('spreads the flame\'s original sprites over the path and scales each alpha by its own radius',()=>{
 const p=flame(),particles=p.emit({vent:11});
 const {pathLength,offsetMin,offsetMax,distanceMax,radiusMin,radiusMax,scalarMin,scalarMax,alphaMin,alphaMax,
  alphaLo,alphaHi}=p.configuration;
 const radiusAt=(distance:number)=>Math.fround(radiusMin+(radiusMax-radiusMin)*Math.min(1,Math.max(0,distance/distanceMax)));
 // The original's own executed code scales the particle's `Alpha Random` draw by the
 // remapped radius instead of writing the mapped value in, so the alpha stays inside that
 // draw's own window.
 const alphaBounds=[Math.fround(Math.fround(alphaMin/255)*alphaLo),Math.fround(Math.fround(alphaMax/255)*alphaHi)];
 expect(particles.map(particle=>particle.id)).toEqual([0,1,2,3,4,5,6,7]);
 for(const particle of particles){
  const along=pathLength*particle.id/(particles.length-1);
  // The original's own offsets are a forward jitter on the path's axis alone.
  expect(particle.offsetX).toBeGreaterThanOrEqual(offsetMin);
  expect(particle.offsetX).toBeLessThanOrEqual(offsetMax);
  expect(particle.distance).toBe(Math.fround(along+particle.offsetX));
  expect(particle.distance).toBeLessThanOrEqual(distanceMax);
  expect(particle.radius).toBe(radiusAt(particle.distance));
  expect(particle.alpha).toBeGreaterThanOrEqual(alphaBounds[0]);
  expect(particle.alpha).toBeLessThanOrEqual(alphaBounds[1]);
  expect(particle.life).toBe(Math.fround(.015));
 }
 // The last ordinal sits exactly on the end control point, so the path spans the whole
 // original 17.5 units rather than falling short of it.
 expect(particles[7].distance).toBe(Math.fround(17.5+particles[7].offsetX));
 // The radius shrinks along the barrel and the alphas are separately drawn rather than
 // all collapsing onto the mapped value. The radius term dominates the random draw's own
 // span, so a sprite near the muzzle stays brighter than one at the tip.
 expect(particles[0].radius).toBeGreaterThan(particles[7].radius);
 expect(particles[0].alpha).toBeGreaterThan(particles[7].alpha);
 expect(particles[0].alpha).not.toBe(Math.fround(alphaLo+(alphaHi-alphaLo)*Math.min(1,Math.max(0,
  (particles[0].radius-scalarMin)/(scalarMax-scalarMin)))));
 expect(new Set(particles.map(particle=>particle.rotation)).size).toBe(8);
 expect(new Set(particles.map(particle=>particle.sequence)).size).toBeGreaterThan(1);
 for(const particle of particles){
  expect(particle.sequence).toBeGreaterThanOrEqual(5);expect(particle.sequence).toBeLessThanOrEqual(18);
  expect(particle.color).toHaveLength(3);
  expect(particle.color[0]).toBeGreaterThanOrEqual(Math.fround(120/255));
  expect(particle.color[0]).toBeLessThanOrEqual(Math.fround(126/255));
 }
});

it('holds the flame\'s radius until the original start time and then scales it',()=>{
 const p=flame(),[particle]=p.emit({vent:2});
 const scale={startTime:p.configuration.scaleStart,endTime:p.configuration.scaleEnd,
  startScale:p.configuration.scaleLo,endScale:p.configuration.scaleHi};
 // `Radius Scale` starts at 30% of the lifetime, so a fresh sprite is at scale 1.
 expect(sampleSourceRifleMuzzleFlameParticles([particle],0,scale)[0].currentRadius).toBe(particle.radius);
 const early=sampleSourceRifleMuzzleFlameParticles([particle],particle.life*.25,scale)[0];
 expect(early.currentRadius).toBe(particle.radius);
 // By the end of the life it has grown to the original's 1.125 and faded out.
 const late=sampleSourceRifleMuzzleFlameParticles([particle],particle.life*.999,scale)[0];
 expect(late.currentRadius).toBeGreaterThan(particle.radius);
 expect(late.currentRadius).toBeLessThanOrEqual(Math.fround(particle.radius*p.configuration.scaleHi));
 expect(late.currentAlpha).toBeLessThan(particle.alpha);
 expect(sampleSourceRifleMuzzleFlameParticles([particle],particle.life,scale)).toEqual([]);
 expect(()=>sampleSourceRifleMuzzleFlameParticles([particle],0,{...scale,endTime:scale.startTime}))
  .toThrow(/radius scale window/);
});

it('refuses a changed original flame chain instead of approximating it',()=>{
 const extra=JSON.parse(JSON.stringify(stagedGraph()));
 const element=extra.elements.find((e:{name:string;type:string})=>e.name===SOURCE_RIFLE_MUZZLE_FLAME_SYSTEM
  &&e.type==='DmeParticleSystemDefinition');
 element.attributes.operators.push(element.attributes.operators[0]);
 expect(()=>createSourceRifleMuzzleFlameProgram(prepareSourcePistolParticleGraph(extra),stagedNative()))
  .toThrow(/flame operators/);
 // The path's own end must be the control point the dispatcher sets; a dispatcher that
 // no longer names it fails closed rather than placing the flame at the origin.
 const moved=JSON.parse(JSON.stringify(stagedGraph()));
 const dispatcher=moved.elements.find((e:{name:string;type:string})=>e.name===SOURCE_RIFLE_MUZZLE_ROOT
  &&e.type==='DmeParticleSystemDefinition');
 const set=dispatcher.attributes.operators[0];
 const target=moved.elements.find((e:{id:string})=>e.id===set.ref);
 target.attributes['First Control Point Location']=[0,17.5,0];
 expect(()=>createSourceRifleMuzzleFlameProgram(prepareSourcePistolParticleGraph(moved),stagedNative()))
  .toThrow(/path direction/);
});

it('derives every original sheet frame from the staged bytes and matches the export',()=>{
 expect(sheetFiles.map(([name])=>name)).toEqual(['sheets/fire_particle_4.bin','sheets/smoke1.bin','sheets/vistasmokev1_emods.bin']);
 const raw=stagedGraph();
 for(const [name,bytes] of sheetFiles){
  const row=resources.find(r=>r.path===name)!;
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256);
  // The runtime decoder is the authority; the staged graph must be exactly what it
  // derives from the staged bytes, so a re-export can never drift from the graph.
  const decoded=decodeSourcePistolParticleSheet(bytes);
  const resource=raw.textures.flatMap((t:{resources:{sheetFile?:{path:string}}[]})=>t.resources)
   .find((r:{sheetFile?:{path:string}})=>r.sheetFile?.path===name)!;
  const sheet=resource.sheet as SourceParticleSheet;
  expect(sheet.version).toBe(decoded.version);
  expect(sheet.sequenceCount).toBe(decoded.sequences.length);
  expect(sheet.frameCount).toBe(decoded.sequences.reduce((n,s)=>n+s.frames.length,0));
  expect(sheet.sequences.map(s=>[s.id,s.flags,s.frames.length])).toEqual(decoded.sequences.map(s=>[s.id,s.flags,s.frames.length]));
  for(const [index,sequence] of sheet.sequences.entries()){
   const original=decoded.sequences[index];
   // A sequence's own total is the sum of its frames; nothing is rounded to fit.
   expect(sequence.frames.reduce((n,f)=>n+f.duration,0)).toBeCloseTo(sequence.duration,4);
   expect(sequence.duration).toBeCloseTo(original.duration,6);
   expect(sequence.frames.map(f=>f.rects)).toEqual(original.frames.map(f=>f.images));
  }
 }
 // The flame sheet is the one the original `_main` flame addresses: five sequences of
 // sixteen frames over the 2048x128 strip, so `Sequence Random 5..18` addresses a
 // frame of it; the muzzle smoke sheet is sixteen single-frame sequences, matching
 // `Sequence Random 0..0`; the vista sheet is the dual-sequence smoke.
 const fire=decodeSourcePistolParticleSheet(files.get('sheets/fire_particle_4.bin')!);
 expect(fire.sequences).toHaveLength(5);
 expect(fire.sequences.every(s=>s.frames.length===16)).toBe(true);
 expect(new Set(fire.sequences.flatMap(s=>s.frames.map(f=>f.images[0].join(',')))).size).toBe(16);
 // Half-texel inset rects on a 2048x128 strip of sixteen 128x128 frames.
 expect(fire.sequences[0].frames[0].images[0]).toEqual([0.5/2048,0.5/128,127.5/2048,127.5/128]);
 expect(decodeSourcePistolParticleSheet(files.get('sheets/smoke1.bin')!).sequences.every(s=>s.frames.length===1)).toBe(true);
 expect(decodeSourcePistolParticleSheet(files.get('sheets/vistasmokev1_emods.bin')!).sequences).toHaveLength(34);
 // A changed resource is refused, never partially applied.
 const tampered=Uint8Array.from(files.get('sheets/fire_particle_4.bin')!);tampered[0]=2;
 expect(()=>decodeSourcePistolParticleSheet(tampered)).toThrow(/Unsupported original particle sheet/);
 const truncated=Uint8Array.from(files.get('sheets/fire_particle_4.bin')!).subarray(0,5524);
 expect(()=>decodeSourcePistolParticleSheet(truncated)).toThrow(/Truncated particle sheet/);
});
type Owner=Awaited<ReturnType<typeof loadSourceRifleMuzzleRenderer>>;
const owners:Owner[]=[];
afterEach(()=>{for(const owner of owners.splice(0))owner.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();});
function mockResources(){
 const state={textures:[]as T.Texture<HTMLImageElement>[],disposed:[]as T.Texture<HTMLImageElement>[],blobs:new Map<string,Blob>()};
 vi.stubGlobal('crypto',undefined);
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  const name=url.slice('/muzzle-fixture/'.length),original=files.get(name);
  if(!original)return new Response(null,{status:404});
  return new Response(new Blob([Uint8Array.from(original)]));
 }));
 vi.spyOn(URL,'createObjectURL').mockImplementation(blob=>{if(!(blob instanceof Blob))throw Error('Expected verified image Blob');const url='blob:muzzle-'+state.blobs.size;state.blobs.set(url,blob);return url;});
 vi.spyOn(URL,'revokeObjectURL').mockImplementation(url=>{state.blobs.delete(url);});
 vi.spyOn(T.TextureLoader.prototype,'loadAsync').mockImplementation(async url=>{
  const blob=state.blobs.get(url);expect(blob).toBeDefined();expect(blob!.type).toBe('image/png');
  const bytes=new Uint8Array(await blob!.arrayBuffer()),source=[...pngFiles.values()].find(raw=>raw.byteLength===bytes.byteLength);
  expect(source).toBeDefined();expect(bytes).toEqual(source!);
  const texture=new T.Texture<HTMLImageElement>();state.textures.push(texture);
  texture.addEventListener('dispose',()=>state.disposed.push(texture));
  return texture;
 });
 return state;
}
async function load(){const owner=await loadSourceRifleMuzzleRenderer('/muzzle-fixture');owners.push(owner);return owner;}

it('draws the original flash from the staged bytes, verifies every SHA and releases what it owns',async()=>{
 const h=mockResources(),owner=await load();
 // Exactly the files this renderer takes are verified: the closure, its own operator
 // defaults, the textures its own subsystems draw and the one sheet the flame
 // addresses. The sheets and textures the ported subsystems do not draw yet — the
 // smoke the dispatcher also emits, and the glow the AWP's own chain draws — stay
 // staged for their own renderer.
 const unfetched=['sheets/smoke1.bin','textures/particle_glow_04-frame-0.png',
  'textures/smoke1-frame-0.png','textures/spark-frame-0.png'];
 expect(owner.hashVerified).toEqual(Object.fromEntries(resources.filter(row=>!unfetched.includes(row.path)).map(row=>[row.path,true])));
 expect(resources.map(row=>row.path)).toContain('sheets/fire_particle_4.bin');
 expect(owner.program.system).toBe(SOURCE_RIFLE_MUZZLE_FLASH_SYSTEM);
 expect(owner.group.children).toHaveLength(5);
 expect(owner.group.children[0].name).toBe('original-assaultrifle-muzzle');
 // Every original subsystem this port runs draws: the vent, the flare, the rolling
 // flame and the dispatcher's other flame.
 expect(owner.group.children[1].name).toBe('original-assaultrifle-muzzle-glow');
 expect(owner.group.children[2].name).toBe('original-assaultrifle-muzzle-flame');
 expect(owner.group.children[3].name).toBe('original-assaultrifle-muzzle-continuous-flame');
 const anchor={position:new T.Vector3(1,2,3),forward:new T.Vector3(0,0,1)};
 owner.fire(anchor,10,{vent:5});
 const frame=owner.update(10);
 expect(frame.count).toBe(1);expect(frame.dropped).toBe(0);expect(frame.bursts).toBe(1);
 // The one original sprite sits on the muzzle in metres, so the offset is < 2.6 mm.
 const [drawn]=frame.particles;
 expect(new T.Vector3().fromArray(drawn.position).distanceTo(anchor.position)).toBeLessThanOrEqual(Math.fround(.1)*.0254);
 expect(drawn.radius).toBeGreaterThanOrEqual(5*.0254);expect(drawn.radius).toBeLessThanOrEqual(7*.0254);
 expect(drawn.alpha).toBeGreaterThan(.5);
 const mesh=owner.group.children[0] as T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>;
 expect(mesh.geometry.instanceCount).toBe(1);
 expect(mesh.material.uniforms.originalTexture.value).toBe(h.textures[1]);
 // The glow draws one flare of its own on the same frame, with its own texture, its
 // own radius and the colour `Color Fade` gives it at that age.
 expect(frame.glowCount).toBe(1);
 expect(frame.glow[0].radius).toBe(Math.fround(25)*.0254);
 const glowMesh=owner.group.children[1] as T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>;
 expect(glowMesh.geometry.instanceCount).toBe(1);
 expect(glowMesh.material.uniforms.originalTexture.value).toBe(h.textures[2]);
 const glowParticle=owner.glow.emit({vent:5})[0];
 // The original's fade-out window here is longer than the lifetime and it is not
 // proportional, so the flare is already partly faded when it is born - the drawn
 // alpha is the sampled one, not the initial one.
 const sampled=sampleSourceRifleMuzzleGlowParticles([glowParticle],0)[0];
 expect(sampled.currentAlpha).toBeLessThan(glowParticle.alpha);
 expect(frame.glow[0].color).toEqual(sampled.currentColor);
 expect(frame.glow[0].alpha).toBeCloseTo(sampled.currentAlpha,6);
 // The flame draws its original eight sprites along the barrel axis: the muzzle's own
 // forward, in metres, with the sheet frame the verified CSheet fixup resolves.
 expect(frame.flameCount).toBe(8);
 expect(frame.flame).toHaveLength(8);
 const flameMesh=owner.group.children[2] as T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>;
 expect(flameMesh.geometry.instanceCount).toBe(8);
 expect(flameMesh.material.uniforms.originalTexture.value).toBe(h.textures[3]);
 // `fire_particle_4.vmt` is addself with overbright 6 and no `$additive`.
 expect(flameMesh.material.uniforms.addSelf.value).toBe(1);
 expect(flameMesh.material.uniforms.overbright.value).toBe(6);
 expect(flameMesh.material.blendSrc).toBe(T.OneFactor);expect(flameMesh.material.blendDst).toBe(T.OneMinusSrcAlphaFactor);
 for(const drawn of frame.flame){
  const along=new T.Vector3().fromArray(drawn.position).sub(anchor.position).dot(anchor.forward);
  expect(along).toBeCloseTo(drawn.distance*.0254,6);
  expect(along).toBeGreaterThan(0);
  // Every flame particle asks for one of the original's sequence range, and the
  // original sheet does not hold it, so the verified fixup lands them all on id 0.
  expect(drawn.requestedSequence).toBeGreaterThanOrEqual(5);
  expect(drawn.requestedSequence).toBeLessThanOrEqual(18);
  expect(drawn.sequence).toBe(0);
 }
 expect(frame.flame[7].distance*.0254).toBeGreaterThan(frame.flame[0].distance*.0254);
 // Original additive blend from `particle_muzzleflashx.vmt`: $additive, no $addself.
 expect(mesh.material.uniforms.addSelf.value).toBe(0);
 expect(mesh.material.uniforms.overbright.value).toBe(1);
 expect(mesh.material.blendSrc).toBe(T.SrcAlphaFactor);expect(mesh.material.blendDst).toBe(T.OneFactor);
 // The burst expires with the original 25 ms life.
 expect(owner.update(10+Math.fround(.025)).count).toBe(0);
 owner.clear();expect(owner.update(10.1).count).toBe(0);
 owner.dispose();owner.dispose();
 expect(h.disposed).toEqual(h.textures);expect(h.blobs.size).toBe(0);
 expect(()=>owner.fire(anchor,10,{vent:1})).toThrow('disposed');
});

it('reports capacity overflow instead of merging shots and rejects bad units before fetching',async()=>{
 const h=mockResources();
 await expect(loadSourceRifleMuzzleRenderer('/muzzle-fixture',{sourceUnitMetres:0})).rejects.toThrow('capacity/units');
 expect(h.textures).toHaveLength(0);
 const owner=await loadSourceRifleMuzzleRenderer('/muzzle-fixture',{capacity:4});owners.push(owner);
 const anchor={position:new T.Vector3(),forward:new T.Vector3(0,0,1)};
 for(let shot=0;shot<5;shot++)owner.fire(anchor,0,{vent:shot});
 const frame=owner.update(0);
 // Each subsystem draws into its own batch and reports its own overflow: the vent and
 // the flare one sprite per shot, the rolling flame the original eight. Capacity is per
 // subsystem, and excess shots are reported rather than merged into one sprite.
 expect(frame.count).toBe(4);expect(frame.glowCount).toBe(4);expect(frame.flameCount).toBe(4);
 // The dispatcher's other flame emits continuously, and every one of its particles is
 // born after the shot, so at the shot's own instant it has nothing alive to draw.
 expect(frame.continuousCount).toBe(0);
 expect(frame.dropped).toBe(1+1+(5*8-4));
 // Two milliseconds in, it does have sprites, and it reports its own overflow too.
 const later=owner.update(Math.fround(.002));
 expect(later.continuousCount).toBe(4);
 expect(later.dropped).toBeGreaterThanOrEqual(5*7-4);
});

it('reads the dispatcher\'s other flame from its own original numbers',()=>{
 const graph=prepareSourcePistolParticleGraph(stagedGraph()),native=stagedNative(),
  continuous=createSourceRifleMuzzleContinuousFlameProgram(graph,native);
 expect(continuous.system).toBe(SOURCE_RIFLE_MUZZLE_CONTINUOUS_SYSTEM);
 // The original spelling of this system is `assualtrifle`, and it is that name, not the
 // dispatcher's `assaultrifle`, that was looked up.
 expect(SOURCE_RIFLE_MUZZLE_CONTINUOUS_SYSTEM).toBe('weapon_muzzle_flash_assualtrifle_flame');
 // Its own original numbers: the AWP flame's twin chain with a different alpha window,
 // its own colour, and the radius remap down to 8 instead of 15.
 expect(continuous.configuration).toMatchObject({count:9,rate:1200,duration:Math.fround(.0075),
  sequenceMin:5,sequenceMax:20,alphaMin:100,alphaMax:120,offsetMin:1,offsetMax:1,
  sphereMin:0,sphereMax:Math.fround(.5),positionMinimum:[0,0,0],positionMaximum:[29,0,0],
  radiusMinimum:8,radiusMaximum:1,alphaMinimum:Math.fround(.5),alphaMaximum:0,
  lifetimeMinimum:Math.fround(.025),lifetimeMaximum:Math.fround(.0175),animationRate:8,
  colour1:[254,233,216,255]});
 expect(continuous.material).toBe('materials/particle/fire_particle_4/fire_particle_4.vmt');
 expect(continuous.texture).toBe('materials/particle/fire_particle_4/fire_particle_4.vtf');
 // It is a different original system from the rolling flame, and the two do not share
 // a configuration.
 const rolling=createSourceRifleMuzzleFlameProgram(graph,native);
 expect(continuous.system).not.toBe(rolling.system);
 expect(continuous.configuration.alphaMin).not.toBe(rolling.configuration.alphaMin);
 expect(continuous.configuration.radiusMinimum).not.toBe(rolling.configuration.radiusMin);
});

it('sweeps the dispatcher\'s other flame forward from each particle\'s own birth time',()=>{
 const continuous=createSourceRifleMuzzleContinuousFlameProgram(prepareSourcePistolParticleGraph(stagedGraph()),stagedNative()),
  particles=continuous.emit({vent:740});
 const {duration,radiusMinimum,radiusMaximum,alphaMinimum,positionMaximum,offsetMin}=continuous.configuration,
  // The alpha remap runs its window from `alphaMinimum` down to `alphaMaximum` as the
  // birth time advances, and the scaling flag multiplies the particle's own
  // `Alpha Random` draw into it, so the largest alpha any particle can carry is the
  // biggest draw times the window's start.
  alphaCeiling=Math.fround(Math.fround(continuous.configuration.alphaMax)*Math.fround(1/255)*Math.fround(alphaMinimum));
 expect(particles.map(p=>p.id)).toEqual([0,1,2,3,4,5,6,7,8]);
 for(const [index,particle] of particles.entries()){
  // Continuous emission steps the births through the original duration, the last one
  // landing exactly on its end, in the same float32 order the original steps them.
  const birth=Math.fround(Math.min(duration,Math.fround(duration/particles.length)*(index+1)));
  expect(particle.born).toBe(birth);
  // All four remaps read the particle's own birth time: the sweep, the thinning radius,
  // the shrinking lifetime and the scaled alpha all follow from it.
  expect(particle.distance).toBeCloseTo(Math.fround(Math.fround(positionMaximum[0])*Math.fround(birth/duration)),4);
  expect(particle.radius).toBeCloseTo(sourceParticleRemapScalar(birth,0,{minimum:0,maximum:duration,
   outputMinimum:radiusMinimum,outputMaximum:radiusMaximum,scalesInitialValue:false}),4);
  expect(particle.life).toBeCloseTo(sourceParticleRemapScalar(birth,0,{minimum:0,maximum:duration,
   outputMinimum:continuous.configuration.lifetimeMinimum,outputMaximum:continuous.configuration.lifetimeMaximum,
   scalesInitialValue:false}),5);
  // Every alpha is a real scaled draw inside both of its windows: the scaling flag means
  // the remap can never clear the particle's own `Alpha Random` value away, only shrink it.
  expect(particle.alpha).toBeGreaterThan(0);
  expect(particle.alpha).toBeLessThanOrEqual(alphaCeiling);
  // The spawn offset is the original `+X 1..1` plus this port's sphere adapter, so the
  // offset as a whole stays inside the original 0..0.5 unit sphere distance around it.
  const span=continuous.configuration.sphereMax;
  expect(offsetMin).toBe(1);expect(span).toBe(Math.fround(.5));
  expect(Math.hypot(particle.offset[0]-offsetMin,particle.offset[1],particle.offset[2])).toBeLessThanOrEqual(span);
 }
 // The last particle is born exactly at the duration and counts as age zero, so the whole
 // original batch of nine is alive at the end of the emission; a hair later the first-born
 // ones are still there, and past the longest remapped lifetime they are all gone.
 expect(sampleSourceAwpMuzzleParticles(particles,duration)).toHaveLength(9);
 expect(sampleSourceAwpMuzzleParticles(particles,Math.fround(duration+Math.fround(.001))).length).toBeGreaterThan(0);
 expect(sampleSourceAwpMuzzleParticles(particles,Math.fround(duration+Math.fround(.026)))).toHaveLength(0);
});

it('refuses the dispatcher\'s other flame when its own cursor or its own graph changes',()=>{
 const graph=prepareSourcePistolParticleGraph(stagedGraph()),native=stagedNative(),
  continuous=createSourceRifleMuzzleContinuousFlameProgram(graph,native);
 // Its own cursor field is `vent`, the dispatcher's; an AWP cursor is not accepted.
 expect(()=>continuous.emit({awp:1}as unknown as {vent:number})).toThrow('seed outside the original table');
 expect(()=>continuous.emit({vent:4096})).toThrow('seed outside the original table');
 expect(()=>continuous.emit({vent:-1})).toThrow('seed outside the original table');
 // The chain is enumerated, so a changed original operator list fails closed rather
 // than being partly applied.
 const renamed=stagedGraph() as {elements:StagedElement[]};
 const lock=renamed.elements.find(e=>e.attributes.functionName==='Movement Lock to Control Point'
  &&e.name==='Movement Lock to Control Point');
 expect(lock).toBeDefined();
 lock!.attributes.functionName='Movement Lock to Control Point ';
 expect(()=>createSourceRifleMuzzleContinuousFlameProgram(prepareSourcePistolParticleGraph(renamed),native))
  .toThrow(`Unsupported original rifle muzzle continuous flame operators`);
 // A changed radius window is read from the graph, so it changes the program rather than
 // being ignored: the window is never carried in by a caller.
 const widened=stagedGraph() as {elements:StagedElement[]},
  byId=new Map(widened.elements.map(e=>[e.id,e] as const)),
  system=widened.elements.find(e=>e.name==='weapon_muzzle_flash_assualtrifle_flame'
   &&e.type==='DmeParticleSystemDefinition');
 expect(system).toBeDefined();
 // Resolve the radius remap through this system's own initializer list, never by the
 // order elements happen to sit in the file.
 const radiusRemap=(system!.attributes.initializers as {ref:string}[])
  .map(ref=>byId.get(ref.ref))
  .find(e=>e?.attributes.functionName==='remap initial scalar'&&e.attributes['output minimum']===8);
 expect(radiusRemap).toBeDefined();
 const before=continuous.configuration.radiusMinimum;
 radiusRemap!.attributes['output minimum']=11;
 const after=createSourceRifleMuzzleContinuousFlameProgram(prepareSourcePistolParticleGraph(widened),native)
  .configuration.radiusMinimum;
 expect(before).toBe(8);
 expect(after).toBe(11);
});

it('draws the dispatcher\'s other flame in the world on its own batch',async()=>{
 const h=mockResources(),owner=await load();
 const anchor={position:new T.Vector3(0,0,0),forward:new T.Vector3(0,0,1),up:new T.Vector3(0,1,0)};
 owner.fire(anchor,10,{vent:3});
 const frame=owner.update(10+Math.fround(.002));
 expect(frame.continuousCount).toBeGreaterThan(0);
 expect(frame.continuousCount).toBeLessThanOrEqual(9);
 const mesh=owner.group.children[3] as T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>;
 expect(mesh.geometry.instanceCount).toBe(frame.continuousCount);
 // The same original addself-overbright recipe as the rolling flame, from the same
 // original texture and sheet.
 expect(mesh.material.uniforms.addSelf.value).toBe(1);
 expect(mesh.material.uniforms.overbright.value).toBe(6);
 expect(mesh.material.uniforms.originalTexture.value).toBe(h.textures[3]);
 expect(mesh.material.blendSrc).toBe(T.OneFactor);
 expect(mesh.material.blendDst).toBe(T.OneMinusSrcAlphaFactor);
 // The sweep runs along the burst's own forward, so a newer particle sits further out.
 const furthest=Math.max(...frame.continuous.map(p=>p.distance));
 expect(furthest).toBeGreaterThan(0);expect(furthest).toBeLessThanOrEqual(29);
 // A yaw/Pi rotation is applied; a screen-aligned sprite has no flip in this system.
 expect(frame.continuous.every(p=>Number.isFinite(p.rotation))).toBe(true);
 // The burst expires with its own lifetime remap, which is at most the original 25 ms.
 expect(owner.update(10+Math.fround(.025)+1).continuousCount).toBe(0);
});

it('renders original muzzle and ejection smoke after all four flame batches expire',async()=>{
 mockResources();const owner=await loadSourceRifleMuzzleRenderer('/muzzle-fixture');owners.push(owner);
 const anchor={position:new T.Vector3(2,3,4),forward:new T.Vector3(0,0,1)};owner.fire(anchor,10,{vent:8});
 const early=owner.update(10.06),late=owner.update(10.3);
 expect(early.children.counts).toEqual({weapon_muzzle_flash_smoke_small2:1,weapon_shell_eject_smoke_assrifle2:1,weapon_shell_eject_smoke_assrifle3:1});
 expect(early.children.particles.find(p=>p.system==='weapon_shell_eject_smoke_assrifle2')!.position).toEqual(expect.arrayContaining([expect.any(Number)]));
 expect(late.count+late.flameCount+late.glowCount+late.continuousCount).toBe(0);
 expect(late.children.counts.weapon_muzzle_flash_smoke_small2).toBe(0);expect(late.children.counts.weapon_shell_eject_smoke_assrifle2).toBe(1);
 const [smoke,eject]=owner.children.batches;
 expect(smoke.material.userData.sourceDepthBlend).toBe(true);expect(smoke.material.uniforms.sequenceZoom.value).toBe(24);
 expect(eject.material.uniforms.dualSequence.value).toBe(true);expect(eject.material.uniforms.visibilityAlpha.value).toEqual([0,40,1,0]);
 expect(smoke.material.blendSrc).toBe(T.SrcAlphaFactor);expect(smoke.material.blendDst).toBe(T.OneMinusSrcAlphaFactor);
 owner.clear();expect(owner.children.batches.every(b=>b.geometry.instanceCount===0)).toBe(true);
});
