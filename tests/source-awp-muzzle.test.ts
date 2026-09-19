import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {prepareSourcePistolParticleGraph,decodeSourcePistolParticleSheet} from '../game/source-pistol-particles-graph';
import {sourcePistolParticleSheetFrame} from '../game/source-pistol-particles';
import {createSourceAwpMuzzleFlameProgram,createSourceAwpMuzzleGlowProgram,sampleSourceAwpMuzzleParticles,
  SOURCE_AWP_MUZZLE_ROOT,SOURCE_AWP_MUZZLE_FLAME_SYSTEM,SOURCE_AWP_MUZZLE_GLOW_SYSTEM} from '../game/source-rifle-muzzle-particles';
import {loadSourceAwpMuzzleRenderer} from '../game/source-awp-muzzle-renderer';
import resources from '../game/source-muzzle-particle-resources.json';

const staged=resolve('public/source/csgo-12426148/muzzle-particles');
const stagedGraph=()=>JSON.parse(readFileSync(resolve(staged,'graph.json'),'utf8'));
const stagedNative=()=>JSON.parse(readFileSync(resolve(staged,'native-defaults.json'),'utf8'));
const prepare=()=>prepareSourcePistolParticleGraph(stagedGraph());
const fileFor=(name:string)=>Uint8Array.from(readFileSync(resolve(staged,name)));

it('reads the AWP\'s own chain: a continuous flame and the flare it parents',()=>{
 const graph=prepare(),native=stagedNative();
 const flame=createSourceAwpMuzzleFlameProgram(graph,native),glow=createSourceAwpMuzzleGlowProgram(graph,native);
 // The original dispatch of `weapon_muzzle_flash_awp`: the hunting rifle's continuous
 // flame, which itself parents the two sparks systems and this glow.
 expect(flame.system).toBe(SOURCE_AWP_MUZZLE_FLAME_SYSTEM);
 expect(glow.system).toBe(SOURCE_AWP_MUZZLE_GLOW_SYSTEM);
 expect([flame.system,glow.system]).not.toContain(SOURCE_AWP_MUZZLE_ROOT);
 // 1200 per second over 7.5 ms is nine particles; 500 over the same window is three.
 expect(flame.configuration).toMatchObject({count:9,rate:1200,duration:Math.fround(.0075),sequenceMin:5,
  sequenceMax:20,alphaMin:70,alphaMax:100,offsetMin:1,offsetMax:1,sphereMin:0,sphereMax:Math.fround(.5),
  positionMinimum:[0,0,0],positionMaximum:[29,0,0],radiusMinimum:15,radiusMaximum:1,
  alphaMinimum:Math.fround(.5),alphaMaximum:0,lifetimeMinimum:Math.fround(.025),
  lifetimeMaximum:Math.fround(.0175),animationRate:8,colour1:[255,217,186,255],colour2:[255,255,255,255]});
 expect(glow.configuration).toMatchObject({count:3,rate:500,sequenceMin:2,sequenceMax:2,alphaMin:50,alphaMax:70,
  positionMaximum:[25,0,0],radiusMinimum:22,radiusMaximum:6,alphaMinimum:1,alphaMaximum:0,
  lifetimeMinimum:Math.fround(.024),lifetimeMaximum:Math.fround(.024),fadeStart:Math.fround(.7),fadeEnd:1,
  colour1:[255,174,0,255],colour2:[255,114,0,255]});
 // The flame's own lifetime comes from its birth-time remap, not from a lifetime
 // initializer, and only the glow carries an original `Color Fade`.
 expect(glow.configuration.fadeStart).toBeLessThan(1);
 expect(flame.configuration.fadeStart).toBe(1);
 expect(flame.material).toBe('materials/particle/fire_particle_4/fire_particle_4.vmt');
 expect(flame.texture).toBe('materials/particle/fire_particle_4/fire_particle_4.vtf');
 expect(glow.material).toBe('materials/particle/particle_glow_04_additive.vmt');
 expect(glow.texture).toBe('materials/particle/particle_glow_04.vtf');
});

it('sweeps the flame forward with its own birth time and thins it out on the way',()=>{
 const flame=createSourceAwpMuzzleFlameProgram(prepare(),stagedNative()),particles=flame.emit({awp:740});
 const {positionMaximum,radiusMinimum,radiusMaximum,alphaMinimum,alphaMaximum,lifetimeMinimum,lifetimeMaximum,
  duration,offsetMin,offsetMax}=flame.configuration;
 expect(particles.map(p=>p.id)).toEqual([0,1,2,3,4,5,6,7,8]);
 for(const [index,particle] of particles.entries()){
  // Emission is continuous: the births step through the original duration and the last
  // one lands exactly on its end, in the same float32 order the original steps them.
  const birth=Math.fround(Math.min(duration,Math.fround(duration/particles.length)*(index+1)));
  expect(particle.born).toBe(birth);
  // The remaps read the birth time in the original's own float32 order.
  const t=Math.fround(Math.fround(birth)/Math.fround(duration));
  expect(particle.distance).toBe(Math.fround((positionMaximum as number[])[0]*t));
  // Radius, alpha and lifetime all read the same birth time through their own windows.
  expect(particle.radius).toBeGreaterThanOrEqual(radiusMaximum);
  expect(particle.radius).toBeLessThanOrEqual(radiusMinimum);
  expect(particle.alpha).toBeGreaterThanOrEqual(alphaMaximum);
  expect(particle.alpha).toBeLessThanOrEqual(alphaMinimum);
  expect(particle.life).toBeGreaterThanOrEqual(lifetimeMaximum);
  expect(particle.life).toBeLessThanOrEqual(lifetimeMinimum);
  // The spawn offset is the sphere's own offset plus the fixed one, on the local axes.
  expect(particle.offset[0]).toBeGreaterThanOrEqual(offsetMin-0.5);
  expect(particle.offset[0]).toBeLessThanOrEqual(offsetMax+0.5);
  expect(Math.hypot(particle.offset[1],particle.offset[2])).toBeLessThanOrEqual(flame.configuration.sphereMax);
  expect(particle.sequence).toBeGreaterThanOrEqual(5);
  expect(particle.sequence).toBeLessThanOrEqual(20);
 }
 // The original's alpha remap scales each particle's own `Alpha Random` draw instead of
 // writing its mapped value in, so the alpha never reaches the remap's own 0.5 ceiling.
 const alphaCeiling=Math.fround(Math.fround(flame.configuration.alphaMax/255)*flame.configuration.alphaMinimum);
 for(const particle of particles)expect(particle.alpha).toBeLessThanOrEqual(alphaCeiling);
 // A continuously emitted burst is a gradient, not nine copies of one sprite.
 expect(particles[0].distance).toBeLessThan(particles[8].distance);
 expect(particles[0].radius).toBeGreaterThan(particles[8].radius);
 expect(particles[0].alpha).toBeGreaterThan(particles[8].alpha);
 expect(particles[0].life).toBeGreaterThan(particles[8].life);
 expect(new Set(particles.map(p=>p.rotation)).size).toBe(9);
 expect(new Set(particles.map(p=>p.color.join(','))).size).toBeGreaterThan(1);
 // Same shot, same burst; a different shot is a different draw.
 expect(flame.emit({awp:740})).toEqual(particles);
 expect(flame.emit({awp:740})).not.toEqual(flame.emit({awp:741}));
 expect(()=>flame.emit({awp:4096})).toThrow(/outside the original table/);
});

it('holds both of the AWP\'s systems at their original alpha and fades only the glow\'s colour',()=>{
 const graph=prepare(),native=stagedNative();
 const flame=createSourceAwpMuzzleFlameProgram(graph,native),glow=createSourceAwpMuzzleGlowProgram(graph,native);
 const [flameParticle]=flame.emit({awp:3}),[glowParticle]=glow.emit({awp:3});
 // Neither system has an alpha fade, so a particle keeps the alpha its remap gave it.
 for(const [program,particle] of [[flame,flameParticle],[glow,glowParticle]] as const){
  expect(sampleSourceAwpMuzzleParticles([particle],particle.born)[0].currentAlpha).toBe(particle.alpha);
  expect(sampleSourceAwpMuzzleParticles([particle],particle.life*.99)[0].currentAlpha).toBe(particle.alpha);
  // It disappears at its lifetime instead.
  expect(sampleSourceAwpMuzzleParticles([particle],particle.born+particle.life)).toEqual([]);
  expect(program.configuration.count).toBeGreaterThan(0);
 }
 // The glow's `Color Fade` runs its colour to the original target over the last 30% of
 // its life; the flame has no colour fade and keeps its own random colour.
 const late=sampleSourceAwpMuzzleParticles([glowParticle],glowParticle.life*.999)[0];
 expect(late.currentColor[0]).toBeLessThan(glowParticle.color[0]+1e-6);
 expect(sampleSourceAwpMuzzleParticles([flameParticle],flameParticle.life*.999)[0].currentColor)
  .toEqual(flameParticle.color);
});

it('refuses any other configuration of the AWP chain instead of approximating it',()=>{
 const native=stagedNative();
 const tamper=(mutate:(element:{attributes:Record<string,unknown>})=>void)=>{
  const graph=JSON.parse(JSON.stringify(stagedGraph()));
  const element=graph.elements.find((e:{name:string;type:string})=>e.name===SOURCE_AWP_MUZZLE_FLAME_SYSTEM
   &&e.type==='DmeParticleSystemDefinition');
  const lock=element.attributes.operators.find((row:{name:string})=>row.name==='Movement Lock to Control Point');
  const target=graph.elements.find((e:{id:string})=>e.id===lock.ref);
  mutate(target);
  return ()=>createSourceAwpMuzzleFlameProgram(prepareSourcePistolParticleGraph(graph),native);
 };
 // A partial lock is a different behaviour, so it is refused rather than treated as the
 // full lock this port asserts.
 expect(tamper(row=>{row.attributes['start_fadeout_min']=.5;})).toThrow(/movement lock/);
 expect(tamper(row=>{row.attributes['distance fade range']=10;})).toThrow(/movement lock/);
 expect(tamper(row=>{row.attributes['lock rotation']=true;})).toThrow(/movement lock/);
 // So is a changed emission or a changed phase list.
 const changed=JSON.parse(JSON.stringify(stagedGraph()));
 const element=changed.elements.find((e:{name:string;type:string})=>e.name===SOURCE_AWP_MUZZLE_FLAME_SYSTEM
  &&e.type==='DmeParticleSystemDefinition');
 element.attributes.operators.push(element.attributes.operators[0]);
 expect(()=>createSourceAwpMuzzleFlameProgram(prepareSourcePistolParticleGraph(changed),native))
  .toThrow(/AWP muzzle flame operators/);
});

type Owner=Awaited<ReturnType<typeof loadSourceAwpMuzzleRenderer>>;
const owners:Owner[]=[];
afterEach(()=>{for(const owner of owners.splice(0))owner.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();});
const files=new Map(resources.map(row=>[row.path,fileFor(row.path)]));
const pngFiles=new Map([...files].filter(([name])=>name.endsWith('.png')));
function mockResources(){
 const state={textures:[]as T.Texture<HTMLImageElement>[],disposed:[]as T.Texture<HTMLImageElement>[],blobs:new Map<string,Blob>()};
 vi.stubGlobal('crypto',undefined);
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  const name=url.slice('/awp-fixture/'.length),original=files.get(name);
  if(!original)return new Response(null,{status:404});
  return new Response(new Blob([Uint8Array.from(original)]));
 }));
 vi.spyOn(URL,'createObjectURL').mockImplementation(blob=>{if(!(blob instanceof Blob))throw Error('Expected verified image Blob');const url='blob:awp-'+state.blobs.size;state.blobs.set(url,blob);return url;});
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
const load=async()=>{const owner=await loadSourceAwpMuzzleRenderer('/awp-fixture');owners.push(owner);return owner;};

it('draws the AWP\'s flame and glow along the weapon\'s own muzzle axes',async()=>{
 const h=mockResources(),owner=await load();
 // Every file the renderer takes is verified against the staged manifest: the closure,
 // its operator defaults, the flame's atlas, its sheet and the glow's texture.
 expect(Object.keys(owner.hashVerified).sort()).toEqual(['graph.json','native-defaults.json',
  'sheets/fire_particle_4.bin','sheets/smoke1.bin','sheets/vistasmokev1_emods.bin','textures/fire_particle_4-frame-0.png','textures/particle_glow_04-frame-0.png','textures/smoke1-frame-0.png','textures/spark-frame-0.png','textures/vistasmokev1_emods-frame-0.png']);
 expect(owner.group.children).toHaveLength(3);
 expect(owner.group.children[0].name).toBe('original-awp-muzzle-flame');
 expect(owner.group.children[1].name).toBe('original-awp-muzzle-glow');
 const flameMesh=owner.group.children[0] as T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>;
 const glowMesh=owner.group.children[1] as T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>;
 // `fire_particle_4.vmt` is addself with overbright 6; `particle_glow_04_additive.vmt` is
 // the original additive unlitgeneric.
 expect(flameMesh.material.uniforms.addSelf.value).toBe(1);
 expect(flameMesh.material.uniforms.overbright.value).toBe(6);
 expect(glowMesh.material.uniforms.addSelf.value).toBe(0);
 expect(glowMesh.material.blendSrc).toBe(T.SrcAlphaFactor);
 // A muzzle pointing along world +Z with the attachment's own up on world +Y.
 const anchor={position:new T.Vector3(1,2,3),forward:new T.Vector3(0,0,1),up:new T.Vector3(0,1,0)};
 owner.fire(anchor,10,{awp:5});
 // The original emits continuously, so at the instant of the shot only the first particles
 // exist; the whole burst is there once its own 7.5 ms emission window has passed.
 expect(owner.update(10).flameCount).toBe(0);
 expect(owner.update(10+.004).flameCount).toBe(4);
 const frame=owner.update(10+.01);
 expect(frame.flameCount).toBe(9);expect(frame.glowCount).toBe(3);expect(frame.dropped).toBe(0);
 const ahead=(row:{position:number[]})=>new T.Vector3().fromArray(row.position).sub(anchor.position)
  .dot(anchor.forward);
 // The flame is swept forward along the barrel, in metres, and the glow sits further
 // along it; both are in front of the muzzle.
 for(const row of frame.flame)expect(ahead(row)).toBeGreaterThan(0);
 for(const row of frame.glow)expect(ahead(row)).toBeGreaterThan(0);
 expect(ahead(frame.flame[8])).toBeGreaterThan(ahead(frame.flame[0]));
 expect(flameMesh.geometry.instanceCount).toBe(9);
 expect(glowMesh.geometry.instanceCount).toBe(3);
 expect(flameMesh.material.uniforms.originalTexture.value).toBe(h.textures[3]);
 expect(glowMesh.material.uniforms.originalTexture.value).toBe(h.textures[4]);
 // The frame comes from the original sheet through the verified CSheet fixup, so the
 // flame's 5..20 request lands on the sheet's first sequence.
 const sheet=decodeSourcePistolParticleSheet(files.get('sheets/fire_particle_4.bin')!);
 for(const row of frame.flame){
  expect(row.requestedSequence).toBeGreaterThanOrEqual(5);
  expect(row.requestedSequence).toBeLessThanOrEqual(20);
  expect(row.sequence).toBe(0);
  const expected=sourcePistolParticleSheetFrame(sheet,row.requestedSequence,row.age,owner.flame.configuration.animationRate);
  expect(row.frame).toBe(expected.index);
 }
 // The burst expires with the original lifetimes (24 ms glow, ~17-25 ms flame) plus its
 // own 7.5 ms emission window.
 expect(owner.update(10+Math.fround(.04)).flameCount).toBe(0);
 owner.clear();expect(owner.update(10.1).flameCount).toBe(0);
 owner.dispose();owner.dispose();
 expect(h.disposed).toEqual(h.textures);expect(h.blobs.size).toBe(0);
 expect(()=>owner.fire(anchor,10,{awp:1})).toThrow('disposed');
});

it('reports its own capacity overflow and rejects bad units before fetching',async()=>{
 const h=mockResources();
 await expect(loadSourceAwpMuzzleRenderer('/awp-fixture',{sourceUnitMetres:0})).rejects.toThrow('capacity/units');
 expect(h.textures).toHaveLength(0);
 const owner=await loadSourceAwpMuzzleRenderer('/awp-fixture',{capacity:4});owners.push(owner);
 const anchor={position:new T.Vector3(),forward:new T.Vector3(0,0,1)};
 for(let shot=0;shot<3;shot++)owner.fire(anchor,0,{awp:shot});
 const frame=owner.update(.01);
 expect(frame.flameCount).toBe(4);expect(frame.glowCount).toBe(4);
 expect(frame.dropped).toBe((3*9-4)+(3*3-4));
});

it('hashes the staged bytes it draws from',()=>{
 for(const row of resources){
  const bytes=fileFor(row.path);
  expect(bytes.byteLength).toBe(row.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256);
 }
});

it('renders all AWP smoke and spark children with original atlases and nonzero trail geometry',async()=>{
 mockResources();const owner=await load(),anchor={position:new T.Vector3(2,3,4),forward:new T.Vector3(0,0,1)};owner.fire(anchor,10,{awp:7});
 const state=owner.update(10.01);
 expect(state.children.counts).toEqual({weapon_muzzle_flash_smoke_small:3,weapon_muzzle_flash_smoke_small3:4,weapon_shell_eject_smoke_awp3:1,weapon_muzzle_flash_sparks2:5,weapon_muzzle_flash_sparks4:10});
 const sparks=state.children.particles.filter(p=>String(p.system).includes('sparks'));expect(sparks).toHaveLength(15);
 for(const p of sparks){expect((p.position as number[]).some((v,i)=>Math.abs(v-(p.tail as number[])[i])>1e-6)).toBe(true);expect(p.radius).toBeGreaterThan(0);}
 const batches=owner.children.batches;expect(batches[3].material.uniforms.trails.value).toBe(true);expect(batches[4].material.uniforms.trails.value).toBe(true);
 expect(batches[3].geometry.getAttribute('particleTail').array.some(v=>v!==0)).toBe(true);
 // The two smoke sequences have independent UV rectangles and original mixed RGB/alpha.
 expect(batches[2].material.uniforms.dualSequence.value).toBe(true);expect(batches[2].geometry.getAttribute('particleUV20').array).not.toEqual(batches[2].geometry.getAttribute('particleUV0').array);
 expect(owner.group.children[0].userData).toBeDefined();expect((owner.group.children[0] as T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>).material.userData.sourceDepthBlend).toBe(true);
 owner.clear();expect(owner.update(11).children.bursts).toBe(0);
});
