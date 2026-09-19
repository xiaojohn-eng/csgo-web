import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {loadSourcePropDecals} from '../game/source-prop-decal-loader';
import * as T from 'three';
const bsp='b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc';
const data=new Uint8Array([1,2,3]),sha=createHash('sha256').update(data).digest('hex');
const manifest=()=>({format:'source-prop-decal-v1',sourceBspSha256:bsp,
  materials:[{material:'models/first',decalSource:'materials/shared.vtf',mode:1},{material:'models/second',decalSource:'materials/shared.vtf',mode:2}],
  textures:[{source:'materials/shared.vtf',url:'shared.png',bytes:3,sha256:sha,width:1,height:1,clampS:false,clampT:true}]});
const uvBytes=new Uint8Array(new Float32Array([.25,.75]).buffer),uvSha=createHash('sha256').update(uvBytes).digest('hex');
const uvManifest={format:'source-prop-decal-uv-v1',sourceBspSha256:bsp,originalGLBSha256:'55937fce28a53461520fa2c531384f65f0f8b69df1a8205245466b6064ab5232',
 file:{url:'uv.f32',bytes:8,sha256:uvSha},records:[{mesh:0,primitive:0,model:'models/a.mdl',material:'models/first',offset:0,vertexCount:1,verified:true,sha256:uvSha}]};
function respond(url:URL,value=manifest()){return new Response(url.pathname.endsWith('/manifest.json')?JSON.stringify(value):url.pathname.endsWith('uv-remap.json')?JSON.stringify(uvManifest):url.pathname.endsWith('uv.f32')?uvBytes:data);}
afterEach(()=>vi.unstubAllGlobals());
it('shares a verified original texture and closes only owned decoded images once',async()=>{
  const close=vi.fn(),decode=vi.fn(async()=>({width:1,height:1,close}));vi.stubGlobal('createImageBitmap',decode);
  vi.stubGlobal('fetch',vi.fn(async(url:URL)=>respond(url)));
  const owner=await loadSourcePropDecals({baseURL:'http://192.168.1.2/vhv/decal/'});
  const first=owner.materials.get('models/first')!,second=owner.materials.get('models/second')!;
  expect(first.texture).toBe(second.texture);expect(first.texture.colorSpace).toBe(T.SRGBColorSpace);expect(first.texture.flipY).toBe(false);
  expect(first.texture.wrapS).toBe(T.RepeatWrapping);expect(first.texture.wrapT).toBe(T.ClampToEdgeWrapping);
  expect(second.mode).toBe(2);expect(decode).toHaveBeenCalledTimes(1);
  expect(owner.uv.texture.image.data![0]).toBe(.25);const uvDisposed=vi.fn();owner.uv.texture.addEventListener('dispose',uvDisposed);
  const disposed=vi.fn();first.texture.addEventListener('dispose',disposed);owner.dispose();owner.dispose();expect(disposed).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);expect(uvDisposed).toHaveBeenCalledTimes(1);
});
it('rejects SHA corruption before decode, dimensions before fetch, and releases a decoded image after cancellation',async()=>{
  const close=vi.fn(),decode=vi.fn(async()=>({width:1,height:1,close}));vi.stubGlobal('createImageBitmap',decode);
  let value=manifest();value.textures[0].sha256='0'.repeat(64);
  const fetch=vi.fn(async(url:URL)=>respond(url,value));vi.stubGlobal('fetch',fetch);
  await expect(loadSourcePropDecals({baseURL:'http://192.168.1.2/vhv/decal/'})).rejects.toThrow(/receipt/);expect(decode).not.toHaveBeenCalled();
  value=manifest();value.textures[0].width=99999;fetch.mockClear();
  await expect(loadSourcePropDecals({baseURL:'http://192.168.1.2/vhv/decal/',maxTextureSize:4096})).rejects.toThrow(/budget/);expect(fetch).toHaveBeenCalledTimes(1);
  value=manifest();const abort=new AbortController();decode.mockImplementation(async()=>{abort.abort();return {width:1,height:1,close};});
  await expect(loadSourcePropDecals({baseURL:'http://192.168.1.2/vhv/decal/',signal:abort.signal})).rejects.toThrow();expect(close).toHaveBeenCalledTimes(1);
});
