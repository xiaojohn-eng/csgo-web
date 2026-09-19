import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {loadSourcePropTintDecal} from '../game/source-prop-tint-decal-loader';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),bsp='b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc';
const mat=(n:number)=>'models/props/de_dust/hr_dust/dust_crates/dust_shipping_crate_0'+n+'_painted_decals';
function fixture(){
 const pixels=new Uint8Array([1,2,3]),rgba=new Uint8Array(12632).fill(255),uvBytes=new Uint8Array(new Float32Array([.2,.7,.8,.3,.4,.1]).buffer);
 const file=(url:string,b:Uint8Array)=>({url,bytes:b.length,sha256:sha(b)});
 const manifest={format:'source-prop-tint-decal-v1',sourceBspSha256:bsp,materials:[1,2].map(i=>({material:mat(i),tintSource:`materials/tint${i}.vtf`,decalSource:'materials/decal.vtf',mode:1})),
   textures:['tint1','tint2','decal'].map(s=>({...file(s+'.png',pixels),source:`materials/${s}.vtf`,width:1,height:1,clampS:false,clampT:false})),instanceRGBA:{...file('instance-rgba.u8',rgba),count:3158}};
 const uv={format:'source-prop-decal-uv-v1',sourceBspSha256:bsp,originalGLBSha256:'55937fce28a53461520fa2c531384f65f0f8b69df1a8205245466b6064ab5232',file:file('original-decal-uv.f32',uvBytes),records:[{mesh:0,primitive:0,model:'models/test.mdl',material:mat(1),offset:0,vertexCount:3,verified:true,sha256:sha(uvBytes)}]};
 const response=(url:URL)=>new Response(url.pathname.endsWith('manifest.json')?JSON.stringify(manifest):url.pathname.endsWith('uv-remap.json')?JSON.stringify(uv):url.pathname.endsWith('.u8')?rgba:url.pathname.endsWith('.f32')?uvBytes:pixels);
 const texture=()=>{const t=new T.Texture({width:1,height:1});t.colorSpace=T.SRGBColorSpace;t.flipY=false;t.wrapS=t.wrapT=T.RepeatWrapping;return t;};
 const tint=texture(),decal=texture();
 return {manifest,uv,response,tint,decal,borrowedTint:{materials:new Map([['old',{texture:tint,source:'materials/tint2.vtf'}]]),rgba},borrowedDecal:{materials:new Map([['old',{texture:decal,source:'materials/decal.vtf',mode:1 as const}]]),uv:{} as never}};
}
afterEach(()=>vi.unstubAllGlobals());
it('borrows already verified R3/R4 textures and disposes only its new texture, UV2 and bitmap',async()=>{
 const f=fixture(),close=vi.fn(),decode=vi.fn(async()=>({width:1,height:1,close})),fetch=vi.fn(async(url:URL,init?:RequestInit)=>f.response(url));vi.stubGlobal('fetch',fetch);vi.stubGlobal('createImageBitmap',decode);vi.stubGlobal('crypto',undefined);
 const owner=await loadSourcePropTintDecal({baseURL:'http://192.168.1.2/vhv/tint-decal/',borrowedTint:f.borrowedTint,borrowedDecal:f.borrowedDecal});
 expect(owner.audit.ownedTextures).toBe(1);expect(owner.audit.borrowedTextures).toBe(2);expect(decode).toHaveBeenCalledTimes(1);
 expect(owner.tints.materials.get(mat(2))!.texture).toBe(f.tint);expect(owner.decals.materials.get(mat(1))!.texture).toBe(f.decal);
 const borrowedDispose=vi.fn(),ownedDispose=vi.fn();f.tint.addEventListener('dispose',borrowedDispose);f.decal.addEventListener('dispose',borrowedDispose);
 owner.tints.materials.get(mat(1))!.texture.addEventListener('dispose',ownedDispose);owner.decals.uv.texture.addEventListener('dispose',ownedDispose);
 for(const args of fetch.mock.calls)expect(args[1]).toMatchObject({cache:'no-cache'});
 owner.dispose();owner.dispose();expect(borrowedDispose).not.toHaveBeenCalled();expect(ownedDispose).toHaveBeenCalledTimes(2);expect(close).toHaveBeenCalledTimes(1);
});
it('closes all new resources on late corrupt original UV2 and preserves borrowed owners',async()=>{
 const f=fixture(),close=vi.fn(),dispose=vi.fn();f.tint.addEventListener('dispose',dispose);f.decal.addEventListener('dispose',dispose);f.uv.file.sha256='0'.repeat(64);
 vi.stubGlobal('fetch',vi.fn(async(url:URL)=>f.response(url)));vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:1,height:1,close})));
 await expect(loadSourcePropTintDecal({baseURL:'http://127.0.0.1/vhv/tint-decal/',borrowedTint:f.borrowedTint,borrowedDecal:f.borrowedDecal})).rejects.toThrow(/receipt/);
 expect(close).toHaveBeenCalledTimes(1);expect(dispose).not.toHaveBeenCalled();
});
it('rejects any third material or tampered original RGB before image allocation',async()=>{
 const f=fixture(),decode=vi.fn();vi.stubGlobal('fetch',vi.fn(async(url:URL)=>f.response(url)));vi.stubGlobal('createImageBitmap',decode);
 f.manifest.materials[1].material='models/other';await expect(loadSourcePropTintDecal({baseURL:'http://127.0.0.1/'})).rejects.toThrow(/subset/);
 f.manifest.materials[1].material=mat(2);f.manifest.instanceRGBA.sha256='0'.repeat(64);await expect(loadSourcePropTintDecal({baseURL:'http://127.0.0.1/'})).rejects.toThrow(/receipt/);expect(decode).not.toHaveBeenCalled();
});
