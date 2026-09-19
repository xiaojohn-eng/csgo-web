import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Euler,NoColorSpace,Quaternion,ShaderMaterial,Texture,TextureLoader,Vector3} from 'three';
import {createSourceMuzzleChildProgram,SOURCE_MUZZLE_CHILD_SYSTEMS,sourceParticleRingPosition,sourceParticleColorRandom} from '../game/source-muzzle-children';
import {prepareSourcePistolParticleGraph,sourcePistolParticleParameters} from '../game/source-pistol-particles-graph';
import {loadSourceGrenadeSmokeRenderer,SOURCE_GRENADE_REFRACT_BLUR,sourceGrenadeRefractOffset} from '../game/source-grenade-smoke-renderer';
import resources from '../game/source-grenade-smoke-resources.json';
import {sourcePistolParticleRandomValue} from '../game/source-pistol-particles-random';
import {loadSourceMuzzleChildrenRenderer} from '../game/source-muzzle-children-renderer';
import nativeColor from './fixtures/source-grenade-smoke/color-native.json';
import ring from './fixtures/source-grenade-smoke/ring-native.json';
const staged='public/source/csgo-12426148/grenade-smoke-20260913';
const base=resolve(existsSync(staged)?staged:'output/fidelity-character/grenade-smoke');
const json=(file:string)=>JSON.parse(readFileSync(resolve(base,file),'utf8'));
const graph=prepareSourcePistolParticleGraph(json('graph.json')),native=json('native-defaults.json');
const program=(name:string)=>createSourceMuzzleChildProgram(graph,native,'explosion_child_'+name);
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('verifies every runtime byte and the original five-child dispatcher without double-emitting its fallback',()=>{
 for(const r of resources){const b=readFileSync(resolve(base,r.path));expect(b.length).toBe(r.bytes);expect(createHash('sha256').update(b).digest('hex')).toBe(r.sha256);}
 expect(graph.phase('explosion_smokegrenade','emitters')).toEqual([]);
 expect(graph.phase('explosion_smokegrenade','children').map(e=>e.name).sort()).toEqual([...SOURCE_MUZZLE_CHILD_SYSTEMS.grenade].sort());
 expect(graph.data.source.sha256).toBe('9ed53f823d5340cd35883674d5ef5e22c52cf434d59890f7d5e0f13e07d59c5d');
 expect(native.unresolved).toEqual([]);
 for(const name of SOURCE_MUZZLE_CHILD_SYSTEMS.grenade)for(const phase of ['initializers','emitters','operators','renderers','forces']as const)for(const e of graph.phase(name,phase))expect(sourcePistolParticleParameters(e,native).unknownOverrides).toEqual([]);
});
it('matches native ring positions, including the first angular increment, and keeps thickness three-dimensional',()=>{
 for(const row of ring.positions){const result=sourceParticleRingPosition(ring.radius,0,[0,0,0],row.index,ring.count);for(let axis=0;axis<3;axis++)expect(result[axis]).toBeCloseTo(row.position[axis],4);}
 const base=sourceParticleRingPosition(74,0,[0,0,0],2,16),thick=sourceParticleRingPosition(74,34,[.3,-.4,.5],2,16);
 for(let axis=0;axis<3;axis++)expect(thick[axis]-base[axis]).toBeCloseTo([10.2,-13.6,17][axis],4);
});
it('forms two original static rings with their actual capacities, elevation and radius, rather than a radial ball cloud',()=>{
 const bottom=program('smoke_bottom'),ring=program('smoke03d_ring'),b=bottom.emit(73),r=ring.emit(73);
 expect(b).toHaveLength(70);expect(r.length).toBeGreaterThanOrEqual(100);expect(r.length).toBeLessThanOrEqual(104);
 for(const p of b){expect(p.life).toBe(17);expect(Math.hypot(p.position[0],p.position[1])).toBeGreaterThanOrEqual(46);expect(Math.hypot(p.position[0],p.position[1])).toBeLessThanOrEqual(62);expect(Math.abs(p.position[2]-2)).toBeLessThanOrEqual(8);expect(p.trajectory).toHaveLength(1);}
 for(const p of r){expect(p.life).toBe(18);expect(Math.abs(p.position[2]-62)).toBeLessThanOrEqual(34);expect(p.radius).toBeGreaterThanOrEqual(36);expect(p.radius).toBeLessThanOrEqual(39);}
 expect(bottom.sample(b,5)[0].currentPosition).toEqual(b[0].position);
 expect(bottom.sample(b,5)[0].rotation-b[0].rotation).toBeCloseTo(10*Math.PI/180);
 expect(bottom.sample(b,0)[0].currentAlpha).toBe(0);expect(bottom.sample(b,5)[0].currentAlpha).toBeGreaterThan(.5);
 expect(bottom.sample(b,17)).toHaveLength(0);expect(ring.sample(r,18)).toHaveLength(0);
});
it('retains delayed 10s/14s emissions and the last original 6–8s particle instead of killing the effect at 18s',()=>{
 const late=program('smoke07b'),instant=program('smoke03e'),p=late.emit(12),q=instant.emit(12);
 expect(p).toHaveLength(90);expect(p[0].born).toBeCloseTo(10.1);expect(p.at(-1)!.born).toBe(19);
 expect(q).toHaveLength(15);expect(q.every(p=>p.born===14)).toBe(true);
 expect(late.sample(p,10)).toHaveLength(0);expect(late.sample(p,10.11)).toHaveLength(1);expect(instant.sample(q,13.9)).toHaveLength(0);expect(instant.sample(q,14.1)).toHaveLength(15);
 expect(late.sample(p,20).length).toBeGreaterThan(0);expect(late.sample(p,27)).toHaveLength(0);
 expect(late.configuration.phases.forces[0].values['ending force']).toEqual([10,-6,4]);
 expect(late.sample(p,12)[0].currentPosition[0]).toBeGreaterThan(p[0].position[0]);
});
it('uses the original normal-map alpha and screen-space refraction scale, with a normalized native blur kernel',()=>{
 expect(sourceGrenadeRefractOffset([.5,.5,1,1],1)).toEqual([-0,0]);
 expect(sourceGrenadeRefractOffset([1,0,1,.5],.25)).toEqual([-.0625,-.0625]);
 expect(sourceGrenadeRefractOffset([1,0,1,0],1)).toEqual([-0,-0]);
 expect(SOURCE_GRENADE_REFRACT_BLUR.reduce((n,r)=>n+r[2],0)).toBe(1);
 const p=program('distort01c').emit(2)[0];expect(p.life).toBeGreaterThanOrEqual(.4);expect(p.life).toBeLessThanOrEqual(.5);expect(p.position).toEqual([0,0,40]);
});
function mockAssets(tamper?:string){
 const textures:Texture[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const name=url.replace('http://original/','');const data=readFileSync(resolve(base,name));return{ok:true,arrayBuffer:async()=>{const bytes=Uint8Array.from(data);if(name===tamper)bytes[0]^=1;return bytes.buffer;}};}));
 vi.spyOn(TextureLoader.prototype,'loadAsync').mockImplementation(async()=>{const t=new Texture<HTMLImageElement>();textures.push(t);return t;});return textures;
}
it('draws original atlas/normal-map batches, deduplicates snapshots and disposes after the late plume',async()=>{
 const textures=mockAssets(),renderer=await loadSourceGrenadeSmokeRenderer('http://original/');
 expect(renderer.group.children).toHaveLength(2);expect(renderer.smoke.programs).toHaveLength(4);
 for(const [i,p]of renderer.smoke.programs.entries())expect(renderer.smoke.batches[i].material.uniforms.orientationType.value).toBe(['explosion_child_smoke_bottom','explosion_child_smoke03d_ring'].includes(p.system)?1:0);
 expect(renderer.spawn('grenade-1',{x:10,y:2,z:-4},100,30)).toBe(true);expect(renderer.spawn('grenade-1',{x:10,y:2,z:-4},100.1,30)).toBe(false);
 const early=renderer.update(100.1);expect(early.bursts).toBe(1);expect(early.distortion.count).toBe(1);expect(early.distortion.bound).toBe(false);
 expect(early.distortion.particles[0].position).toEqual([10,2+40*.0254,-4]);
 const proof=early.particles[0];expect(proof.worldUp).toEqual([0,1,0]);const smokeBatch=renderer.smoke.batches[renderer.smoke.programs.findIndex(p=>p.system===proof.system)];
 for(let i=0;i<3;i++)expect(smokeBatch.geometry.getAttribute('particleTint').array[i]).toBeCloseTo((proof.color as number[])[i],6);
 const normal=textures.at(-1)!;expect(normal.colorSpace).toBe(NoColorSpace);
 const refract=(renderer.group.children[0] as import('three').Mesh).material as ShaderMaterial;
 expect(refract.depthTest).toBe(false);expect(refract.fragmentShader).toContain('vec2(1.0,-1.0)');
 renderer.setSceneColor({texture:new Texture(),width:800,height:600});expect(renderer.update(100.2).distortion.bound).toBe(true);
 const mid=renderer.update(112);expect(mid.counts.explosion_child_smoke07b).toBe(20);expect(mid.distortion.count).toBe(0);
 const late=renderer.update(120);expect(late.events).toBe(1);expect(late.particles.length).toBeGreaterThan(0);
 expect(renderer.update(128).events).toBe(0);expect(renderer.update(128).bursts).toBe(0);
 renderer.spawn('new',{x:0,y:0,z:0},200,10);renderer.clear();expect(renderer.update(200).events).toBe(0);
 const disposal=textures.map(t=>vi.spyOn(t,'dispose'));renderer.dispose();renderer.dispose();expect(disposal.every(s=>s.mock.calls.length===1)).toBe(true);
});
it('refuses altered original grenade bytes before creating an effect',async()=>{
 mockAssets('graph.json');await expect(loadSourceGrenadeSmokeRenderer('http://original/')).rejects.toThrow(/SHA mismatch/);
});

it('matches original cached-light tint and unlit vertex colours without an extra sRGB conversion',()=>{
 const values=program('smoke03e').configuration.phases.initializers.find(e=>e.name==='Color Random')!.values;
 for(const c of nativeColor.cases){const actual=sourceParticleColorRandom(c.lightingColor?values:{...values,tint_perc:0},sourcePistolParticleRandomValue((c.seed+c.randomIndex)&4095),c.lightingColor as [number,number,number]|undefined);for(let i=0;i<3;i++)expect(actual[i]).toBeCloseTo(c.color[i],6);}
});
it('keeps physical smoke/noise identical when first-person draw space is rotated relative to the world',async()=>{
 vi.spyOn(TextureLoader.prototype,'loadAsync').mockImplementation(async()=>new Texture<HTMLImageElement>());
 const base='public/source/csgo-12426148/muzzle-particles/';
 const graph=prepareSourcePistolParticleGraph(JSON.parse(readFileSync(base+'graph.json','utf8'))),native=JSON.parse(readFileSync(base+'native-defaults.json','utf8'));
 const make=()=>loadSourceMuzzleChildrenRenderer(graph,native,async p=>new Uint8Array(readFileSync(base+p)),{family:'awp',unit:.0254,capacity:64});
 const local=await make(),world=await make(),rotation=new Quaternion().setFromEuler(new Euler(.65,.8,.3)),camera=new Vector3(6,2,4),localOrigin=new Vector3(.3,-.4,-.8),worldOrigin=localOrigin.clone().applyQuaternion(rotation).add(camera);
 const forward=new Vector3(1,0,0),up=new Vector3(0,1,0),worldForward=forward.clone().applyQuaternion(rotation),worldUp=up.clone().applyQuaternion(rotation),sourcePosition:[number,number,number]=[worldOrigin.x/.0254,-worldOrigin.z/.0254,worldOrigin.y/.0254];
 local.fire({position:localOrigin,forward,up,worldForward,worldUp,sourcePosition},100,54);world.fire({position:worldOrigin,forward:worldForward,up:worldUp,sourcePosition},100,54);
 for(const time of [100.03,100.1,100.3]){const a=local.update(time),b=world.update(time);expect(a.particles).toHaveLength(b.particles.length);for(let i=0;i<a.particles.length;i++){const localParticle=a.particles[i],worldParticle=b.particles[i],position=new Vector3(...localParticle.position as [number,number,number]).applyQuaternion(rotation).add(camera);for(let k=0;k<3;k++)expect(position.toArray()[k]).toBeCloseTo((worldParticle.position as number[])[k],6);expect(localParticle.radius).toBe(worldParticle.radius);}}
 local.dispose();world.dispose();
});
