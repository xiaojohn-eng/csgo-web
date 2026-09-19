import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as T from 'three';
import {DUST2_BSP_SHA256} from '../game/source-identity';
const mocks=vi.hoisted(()=>({parse:vi.fn(),props:vi.fn(),mips:vi.fn(),foliage:vi.fn(),olive:vi.fn(),visibility:vi.fn(),released:[]as string[]}));
vi.mock('three/addons/loaders/GLTFLoader.js',()=>({GLTFLoader:class{parseAsync=mocks.parse;}}));
vi.mock('../game/source-sha256',()=>({sourceSha256:async()=> 'a'.repeat(64)}));
vi.mock('../game/source-world-lightmaps',()=>({applySourceWorldLightmaps:()=>({dispose:()=>mocks.released.push('hdr')})}));
vi.mock('../game/source-prop-lighting-loader',()=>({loadSourcePropLighting:mocks.props}));
vi.mock('../game/source-map-prop-mips',()=>({loadSourcePropMips:mocks.mips}));
vi.mock('../game/source-foliage-loader',()=>({loadSourceFoliage:mocks.foliage}));
vi.mock('../game/source-olive-loader',()=>({loadSourceOlive:mocks.olive}));
vi.mock('../game/source-visibility-render',()=>({createSourceVisibilityPreview:mocks.visibility}));
import {loadSourceDust2 as loadMap} from '../game/source-dust2';
import {createSourcePVSSubmission} from '../game/source-map-pvs-index';
// These fixtures isolate foliage; details have their own receiver/loader tests.
const loadSourceDust2=(options:Parameters<typeof loadMap>[0]={})=>loadMap({...options,enableDetails:false,enableWorldLayers:false});
const shader=vi.fn();
beforeEach(()=>{
 vi.clearAllMocks();mocks.released.length=0;
 const encode=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));
 const common={sourceBspSha256:DUST2_BSP_SHA256,sourceNavSha256:'nav'};
 const data:Record<string,Uint8Array>={world:new Uint8Array([1]),props:new Uint8Array([2]),atlas:new Uint8Array([3])};
 for(const key of ['lightmaps','visibility','level','collision','navigation','sky'])data[key]=encode(common);
 const files=Object.fromEntries(Object.entries(data).map(([k,b])=>[k,{url:k,bytes:b.length,sha256:'a'.repeat(64)}]));
 vi.stubGlobal('fetch',vi.fn(async(url:string|URL)=>{
  const name=new URL(String(url)).pathname.split('/').at(-1)!;
  if(name==='manifest.json')return new Response(JSON.stringify({format:'source-map-runtime-v1',id:'de_dust2',sourceBspSha256:DUST2_BSP_SHA256,worldTriangles:302307,propTriangles:6269945,files,limitations:[]}));
  return new Response(data[name].slice().buffer as ArrayBuffer);
 }));
 mocks.parse.mockImplementation(async(bytes:ArrayBuffer)=>{
  const name=new Uint8Array(bytes)[0]===1?'world':'props',g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([0,0,0],3));
  g.index={count:(name==='world'?302307:6269945)*3}as T.BufferAttribute;
  g.addEventListener('dispose',()=>mocks.released.push(name));
  const scene=new T.Group();scene.add(new T.Mesh(g,new T.MeshBasicMaterial()));return {scene};
 });
 mocks.props.mockResolvedValue({audit:{appliedMeshes:2325,verification:{skipped:[]}},dispose:()=>mocks.released.push('r5')});
 mocks.mips.mockResolvedValue({audit:{enabled:true,textures:6},setEnabled:vi.fn(),dispose:()=>mocks.released.push('mips')});
 mocks.foliage.mockResolvedValue({audit:{enabled:true,meshes:70,triangles:170118,verification:{hashVerified:true}},setState:shader,dispose:()=>mocks.released.push('foliage')});
 mocks.olive.mockResolvedValue({audit:{enabled:true,meshes:64,csm:false},setState:vi.fn(),dispose:()=>mocks.released.push('olive')});
 mocks.visibility.mockReturnValue({index:{valid:true,allStaticPropIds:Array(3158).fill(0)},update:vi.fn(),dispose:()=>mocks.released.push('pvs')});
});
afterEach(()=>vi.unstubAllGlobals());
it('releases uploaded vertices while retaining the dynamic original-PVS index buffers',async()=>{
 const owned:{mesh:T.Mesh;owner:ReturnType<typeof createSourcePVSSubmission>}[]=[];
 mocks.parse.mockImplementation(async(bytes:ArrayBuffer)=>{
  const isWorld=new Uint8Array(bytes)[0]===1,g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));g.setIndex([0,1,2]);
  // The loader fixture supplies declared original totals; only one triangle
  // is needed to test its attribute upload lifecycle without real GPU memory.
  Object.defineProperty(g.index,'count',{value:(isWorld?302307:6269945)*3});
  const mesh=new T.Mesh(g,new T.MeshBasicMaterial()),scene=new T.Group();scene.add(mesh);
  owned.push({mesh,owner:createSourcePVSSubmission(mesh,[{id:0,start:0,count:3}])});return {scene};
 });
 const map=await loadSourceDust2();
 for(const {mesh,owner} of owned){
  const position=mesh.geometry.attributes.position as T.BufferAttribute,index=mesh.geometry.index!;
  position.onUploadCallback.call(position);index.onUploadCallback.call(index);
  expect(position.array).toBeNull();expect(index.array).toBeInstanceOf(Uint16Array);
  owner.select(new Uint8Array([0]));expect(mesh.geometry.drawRange.count).toBe(0);
  owner.select(new Uint8Array([1]));expect([...index.array]).toEqual([0,1,2]);owner.dispose();
 }
 map.dispose();
});
it('loads foliage after unchanged R5, adds separate coverage, retains visibility and releases in reverse ownership order',async()=>{
 const map=await loadSourceDust2({manifestURL:'http://lan/source/map/manifest.json',propLighting:{maxTextureSize:8192,enablePlainUnbumped:true,enableDecalMultiply:true,enableTintMask:true,enableTintDecal:true}});
 expect(mocks.props.mock.invocationCallOrder[0]).toBeLessThan(mocks.foliage.mock.invocationCallOrder[0]);
 expect(mocks.foliage.mock.calls[0][1]).toMatchObject({enabled:true,baseURL:'http://lan/source/map/vhv/foliage/',maxTextureSize:8192,state:{timeSeconds:0,windSourceXY:[0,0]}});
 expect(map.stats.propLighting).toMatchObject({appliedMeshes:2325,totalAppliedMeshes:2395});
 expect(map.stats.foliage).toMatchObject({enabled:true,meshes:70});
 const position=new T.Vector3(1,2,3);map.updateVisibility(position);expect(mocks.visibility.mock.results[0].value.update).toHaveBeenCalledWith(position,true);
 map.updateWind(0,'room-a');map.updateWind(.1,'room-a');expect(shader.mock.lastCall?.[0].timeSeconds).toBe(Math.fround(.1));
 map.dispose();map.dispose();expect(mocks.released).toEqual(['pvs','foliage','r5','hdr','mips','props','world']);
 expect(()=>map.updateWind(.2,'room-a')).toThrow(/disposed/);
});
it('can explicitly retain the R5 baseline without fetching foliage',async()=>{
 const map=await loadSourceDust2({propLighting:{maxTextureSize:8192,enableFoliage:false}});
 expect(mocks.foliage).not.toHaveBeenCalled();expect(map.stats.propLighting?.totalAppliedMeshes).toBe(2325);expect(map.stats.foliage).toBeNull();map.dispose();
});
it('rolls back the original GLTF/HDR/R5 owner when foliage receipts fail',async()=>{
 mocks.foliage.mockRejectedValueOnce(Error('Original foliage file SHA differs'));
 await expect(loadSourceDust2({propLighting:{maxTextureSize:8192}})).rejects.toThrow(/SHA/);
 expect(mocks.visibility).not.toHaveBeenCalled();expect(mocks.released).toEqual(['r5','hdr','mips','props','world']);
});
it('disposes the bound leaf owner before R5 when later PVS identity validation fails',async()=>{
 mocks.visibility.mockReturnValueOnce({index:{valid:false,allStaticPropIds:[]},dispose:()=>mocks.released.push('pvs')});
 await expect(loadSourceDust2({propLighting:{maxTextureSize:8192}})).rejects.toThrow(/visibility/);
 expect(mocks.released).toEqual(['pvs','foliage','r5','hdr','mips','props','world']);
});

it('opt-in olive shares one original wind state and releases before the existing foliage owner',async()=>{
 const map=await loadSourceDust2({manifestURL:'http://lan/source/map/manifest.json',propLighting:{maxTextureSize:8192,enableOlive:true}});
 expect(mocks.olive).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({enabled:true,csm:false,baseURL:'http://lan/source/map/vhv/olive-foliage/'}));
 expect(map.stats.propLighting).toMatchObject({appliedMeshes:2325,totalAppliedMeshes:2459});
 expect(map.stats.olive).toMatchObject({enabled:true,meshes:64,csm:false});
 const olive=await mocks.olive.mock.results[0].value;
 for(let frame=0;frame<120;frame++)map.updateWind(frame/60,'same-level');
 expect(olive.setState.mock.calls).toEqual(shader.mock.calls);expect(shader).toHaveBeenCalledTimes(120);
 map.dispose();expect(mocks.released).toEqual(['pvs','olive','foliage','r5','hdr','mips','props','world']);
});
it('olive receipt failure cleans up already-bound R6 resources before PVS creation',async()=>{
 mocks.olive.mockRejectedValueOnce(Error('Original olive SHA differs'));
 await expect(loadSourceDust2({propLighting:{maxTextureSize:8192,enableOlive:true}})).rejects.toThrow(/SHA/);
 expect(mocks.visibility).not.toHaveBeenCalled();expect(mocks.released).toEqual(['foliage','r5','hdr','mips','props','world']);
});
