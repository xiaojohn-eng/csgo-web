import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import * as T from 'three';
import {afterEach,expect,it,vi} from 'vitest';
import {decodeSourcePaintNormal,loadSourcePaintNormal} from '../game/source-paint-normal';
import {createSourceFinishMaterial} from '../game/source-materials';
import ak from '../game/source-ak-pattern-resources.json';
import kits from '../game/source-kit-input-resources.json';
import native from '../research/source-paint-normal.json';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
afterEach(()=>vi.unstubAllGlobals());

const normalEntries=[...ak.filter(row=>row.field==='normal').map(row=>({...row,base:'ak-patterns/'})),
  ...kits.filter(row=>row.role==='normal').map(row=>({...row,base:`kit-inputs-fidelity-20260913/${row.weapon}/`}))];
it('includes all 62 staged original normal resource records in the decode checks',()=>{
  expect(normalEntries).toHaveLength(62);
});
// Each real asset gets its own existing timeout and failure identity. A full
// suite must not spend one 15-second budget on 62 sequential megapixel decodes.
it.each(normalEntries)('decodes original normal $base$path to independently recorded RGBA channels',async row=>{
  const bytes=readFileSync('public/source/csgo-12426148/'+row.base+row.path);
  expect(sha(bytes)).toBe(row.sha256);
  expect(sha(await decodeSourcePaintNormal(bytes,row.width,row.height))).toBe(row.rgba8Sha256);
},15000);

it('preserves zero-alpha RGB and all PNG predictors without color or alpha conversion',async()=>{
  const width=2,height=5,stride=8,rgba=Uint8Array.from({length:stride*height},(_,i)=>i%4===3?0:(i*53)%256);
  const filtered=new Uint8Array((stride+1)*height);
  for(let y=0;y<height;y++)for(let x=0;x<stride;x++){
    const i=y*stride+x,a=x>=4?rgba[i-4]:0,b=y?rgba[i-stride]:0,c=y&&x>=4?rgba[i-stride-4]:0;
    const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
    const predictor=[0,a,b,Math.floor((a+b)/2),pa<=pb&&pa<=pc?a:pb<=pc?b:c][y];
    filtered[y*(stride+1)]=y;filtered[y*(stride+1)+x+1]=rgba[i]-predictor;
  }
  // The outer SHA gate owns byte integrity, including CRC words; the decoder owns format/scanlines.
  const chunk=(type:string,body:Uint8Array)=>{const b=Buffer.alloc(body.length+12);b.writeUInt32BE(body.length);b.write(type,4);b.set(body,8);return b;};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(filtered)),chunk('IEND',new Uint8Array())]);
  expect(await decodeSourcePaintNormal(png,width,height)).toEqual(rgba);
  await expect(decodeSourcePaintNormal(png,1,height)).rejects.toThrow('PNG format');
  await expect(decodeSourcePaintNormal(png.subarray(0,png.length-1),width,height)).rejects.toThrow('PNG format');
});

it('uses actual AK707 normal bytes and retains original base-alpha Phong mask with tangent green conversion',async()=>{
  const row=ak.find(row=>row.field==='normal'&&row.paintKitIds.includes('707'))!;
  const bytes=readFileSync('public/source/csgo-12426148/ak-patterns/'+row.path),input={...row,paintKitId:707};
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes)));
  const normal=await loadSourcePaintNormal(input,'/normal/');
  expect(normal.colorSpace).toBe(T.NoColorSpace);expect(normal.flipY).toBe(false);
  expect(normal.userData.sourceFinishNormal.decodedVerified).toBe(true);
  const base=new T.Texture(),exponent=new T.Texture(),owned=createSourceFinishMaterial({name:'test',phongBoost:2,
    phongAlbedoBoost:35,phongFresnelRanges:[.83,.83,1]},base,exponent,normal);
  expect(owned.material.normalMap).toBe(normal);expect(owned.material.normalScale.toArray()).toEqual([1,-1]);
  const shader={fragmentShader:T.ShaderLib.phong.fragmentShader,vertexShader:T.ShaderLib.phong.vertexShader,uniforms:{}};
  owned.material.onBeforeCompile(shader as never,{} as T.WebGLRenderer);
  expect(shader.fragmentShader).toContain('float sourceMask=texture2D(map,vMapUv).a');
  expect(shader.fragmentShader).not.toContain('float sourceMask=texture2D(normalMap');
  owned.dispose();normal.dispose();base.dispose();exponent.dispose();
  await expect(loadSourcePaintNormal({...input,rgba8Sha256:'0'.repeat(64)},'/normal/')).rejects.toThrow('decoded checksum');
  await expect(loadSourcePaintNormal({...input,sha256:'0'.repeat(64)},'/normal/')).rejects.toThrow('PNG checksum');
});

it('records original native normal assignment for all 56 catalogue normals and six original alpha-mask VMTs',()=>{
  expect(native.cases).toHaveLength(112);
  for(const row of native.cases){
    expect([7,8,9]).toContain(row.style);
    expect(row.nativeSetString).toEqual(row.cloneFlag?[{key:'$bumpmap',value:row.normal,materialMatches:true}]:[]);
  }
  expect(Object.keys(native.weaponMaterials)).toHaveLength(6);
  for(const material of Object.values(native.weaponMaterials))expect(material.basemapAlphaPhongMask).toBe(1);
});
