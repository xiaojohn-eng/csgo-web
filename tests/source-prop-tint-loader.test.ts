import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {loadSourcePropTint} from '../game/source-prop-tint-loader';
const bsp='b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc';
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex'),pixels=new Uint8Array([1,2,3]),rgba=new Uint8Array(3158*4).fill(255);
function manifest(){return {format:'source-prop-tint-v1',sourceBspSha256:bsp,
  materials:[{material:'models/test',tintSource:'materials/original.vtf'}],
  textures:[{source:'materials/original.vtf',url:'original.png',bytes:3,sha256:sha(pixels),width:1,height:1,clampS:true,clampT:false}],
  instanceRGBA:{url:'instance-rgba.u8',bytes:rgba.length,sha256:sha(rgba),count:3158}};}
const response=(url:URL,m=manifest())=>new Response(url.pathname.endsWith('manifest.json')?JSON.stringify(m):url.pathname.endsWith('.u8')?rgba:pixels);
afterEach(()=>vi.unstubAllGlobals());
it('retains original verified instance bytes on insecure LAN and disposes owned images/textures once',async()=>{
  const close=vi.fn(),decode=vi.fn(async(_blob:Blob,_options:ImageBitmapOptions)=>({width:1,height:1,close})),fetch=vi.fn(async(url:URL,_init?:RequestInit)=>response(url));
  vi.stubGlobal('fetch',fetch);vi.stubGlobal('createImageBitmap',decode);vi.stubGlobal('crypto',undefined);
  const owner=await loadSourcePropTint({baseURL:'http://192.168.1.2/vhv/tint/'}),texture=owner.materials.get('models/test')!.texture;
  expect(owner.rgba).toEqual(rgba);expect(owner.audit.hashVerified).toBe(true);expect(texture.colorSpace).toBe(T.SRGBColorSpace);expect(texture.flipY).toBe(false);
  expect(texture.wrapS).toBe(T.ClampToEdgeWrapping);expect(texture.wrapT).toBe(T.RepeatWrapping);
  expect(decode.mock.calls[0][1]).toEqual({colorSpaceConversion:'none',premultiplyAlpha:'none',imageOrientation:'none'});
  for(const args of fetch.mock.calls)expect(args[1]).toMatchObject({cache:'no-cache'});
  const disposed=vi.fn();texture.addEventListener('dispose',disposed);owner.dispose();owner.dispose();expect(disposed).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);
});
it('fails corrupt original RGBA before image allocation and closes an image if aborted during decode',async()=>{
  let value=manifest();value.instanceRGBA.sha256='0'.repeat(64);
  const close=vi.fn(),decode=vi.fn(async()=>({width:1,height:1,close}));vi.stubGlobal('createImageBitmap',decode);
  vi.stubGlobal('fetch',vi.fn(async(url:URL)=>response(url,value)));
  await expect(loadSourcePropTint({baseURL:'http://127.0.0.1/vhv/tint/'})).rejects.toThrow(/instance RGB.*receipt/);expect(decode).not.toHaveBeenCalled();
  value=manifest();const abort=new AbortController();decode.mockImplementation(async()=>{abort.abort();return {width:1,height:1,close};});
  await expect(loadSourcePropTint({baseURL:'http://127.0.0.1/vhv/tint/',signal:abort.signal})).rejects.toThrow();expect(close).toHaveBeenCalledTimes(1);
});
it('rejects duplicate/path/budget errors before allocating image resources',async()=>{
  const value=manifest(),decode=vi.fn();value.textures[0].url='../outside.png';vi.stubGlobal('createImageBitmap',decode);vi.stubGlobal('fetch',vi.fn(async(url:URL)=>response(url,value)));
  await expect(loadSourcePropTint({baseURL:'http://127.0.0.1/vhv/tint/'})).rejects.toThrow(/receipt/);
  value.textures[0].url='original.png';value.textures[0].width=8192;
  await expect(loadSourcePropTint({baseURL:'http://127.0.0.1/vhv/tint/',maxTextureSize:4096})).rejects.toThrow(/budget/);expect(decode).not.toHaveBeenCalled();
});
