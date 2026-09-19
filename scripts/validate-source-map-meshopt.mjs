/** Independent reopened-GLB decoder and full byte/JSON verification.
 * Does not import encoder code or compressor helpers.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {MeshoptDecoder} from 'meshoptimizer/decoder';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),EXT='EXT_meshopt_compression';
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
function read(file){
  const data=fs.readFileSync(file);assert.equal(data.toString('ascii',0,4),'glTF');assert.equal(data.readUInt32LE(4),2);assert.equal(data.readUInt32LE(8),data.length);
  let json,bin;for(let offset=12;offset<data.length;){
    const size=data.readUInt32LE(offset),type=data.readUInt32LE(offset+4);assert.equal(size%4,0);offset+=8;assert(offset+size<=data.length);
    if(type===0x4e4f534a){assert(!json);json=JSON.parse(data.toString('utf8',offset,offset+size));}
    else if(type===0x004e4942){assert(!bin);bin=data.subarray(offset,offset+size);}
    else throw new Error('Unexpected GLB chunk');offset+=size;
  }assert(json&&bin);return {data,json,bin};
}
function rawView(glb,index){const b=glb.json.bufferViews[index];assert.equal(b.buffer,0);assert((b.byteOffset??0)+b.byteLength<=glb.bin.length);return glb.bin.subarray(b.byteOffset??0,(b.byteOffset??0)+b.byteLength);}
function nonStorageMetadata(json){const copy=structuredClone(json);delete copy.buffers;delete copy.bufferViews;delete copy.extensionsUsed;delete copy.extensionsRequired;return copy;}

async function validate(name){
  const start=performance.now(),dir=path.join(ROOT,'.reference-assets/source-exports/dust2');
  const source=read(path.join(dir,name+'.glb')),target=read(path.join(dir,name+'.meshopt.glb'));
  assert.deepEqual(nonStorageMetadata(target.json),nonStorageMetadata(source.json),'Non-storage JSON changed');
  assert.deepEqual(target.json.extensionsUsed,[...(source.json.extensionsUsed??[]),EXT]);
  assert.deepEqual(target.json.extensionsRequired,[...(source.json.extensionsRequired??[]),EXT]);
  assert.equal(target.json.buffers.length,2);
  const virtual=structuredClone(target.json.buffers[1]);assert.deepEqual(virtual.extensions,{[EXT]:{fallback:true}});delete virtual.extensions;
  assert.deepEqual(virtual,source.json.buffers[0]);
  assert.deepEqual(Object.keys(target.json.buffers[0]),['byteLength']);assert(target.bin.length-target.json.buffers[0].byteLength<=3);
  assert.equal(target.json.bufferViews.length,source.json.bufferViews.length);
  let decodeOnlyMs=0,compressedBytes=0,decodedBytes=0;const checks=[],decoded=new Map(),geometryViews=new Set(source.json.accessors.map(a=>a.bufferView));
  for(let index=0;index<source.json.bufferViews.length;index++){
    const original=source.json.bufferViews[index],view=target.json.bufferViews[index],ext=view.extensions?.[EXT];
    const expected=rawView(source,index);let bytes;
    if(ext){
      assert.equal(view.buffer,1);assert.equal(ext.buffer,0);assert.equal(ext.filter,'NONE');assert(['ATTRIBUTES','INDICES'].includes(ext.mode));
      assert.equal(ext.count*ext.byteStride,view.byteLength);assert.equal(view.byteLength,original.byteLength);
      assert((ext.byteOffset??0)+ext.byteLength<=target.json.buffers[0].byteLength);
      const compressed=target.bin.subarray(ext.byteOffset??0,(ext.byteOffset??0)+ext.byteLength);
      bytes=Buffer.alloc(view.byteLength);const timer=performance.now();
      MeshoptDecoder.decodeGltfBuffer(bytes,ext.count,ext.byteStride,compressed,ext.mode,ext.filter);
      decodeOnlyMs+=performance.now()-timer;compressedBytes+=compressed.length;decodedBytes+=bytes.length;
      const normalized=structuredClone(view);delete normalized.extensions;normalized.buffer=original.buffer;
      assert.deepEqual(normalized,original,'Compressed view layout changed');
    }else{
      bytes=rawView(target,index);const normalized=structuredClone(view);normalized.buffer=original.buffer;
      if(Object.hasOwn(original,'byteOffset'))normalized.byteOffset=original.byteOffset;else delete normalized.byteOffset;
      assert.deepEqual(normalized,original,'Raw view metadata changed');
    }
    assert(bytes.equals(expected),'Original bytes differ at bufferView '+index);
    checks.push({view:index,bytes:bytes.length,sha256:sha(bytes),mode:ext?.mode??'RAW'});
    if(geometryViews.has(index))decoded.set(index,bytes);
  }
  // Accessors are independently sliced as well; no float tolerance is used.
  const component={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4},size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
  const accessorChecks=[];
  for(const [index,a]of source.json.accessors.entries()){
    assert(!a.sparse);const view=source.json.bufferViews[a.bufferView],width=component[a.componentType]*size[a.type],stride=view.byteStride??width;
    assert.equal(stride,width,'Current source contract is tightly packed');const from=a.byteOffset??0,to=from+a.count*width;
    const original=rawView(source,a.bufferView).subarray(from,to),actual=decoded.get(a.bufferView).subarray(from,to);
    assert.equal(actual.length,a.count*width);assert(actual.equals(original));
    accessorChecks.push({accessor:index,bytes:actual.length,sha256:sha(actual),count:a.count,type:a.type,componentType:a.componentType});
  }
  const imageChecks=(source.json.images??[]).map((image,index)=>{
    const actual=rawView(target,image.bufferView),original=rawView(source,image.bufferView);assert(actual.equals(original));
    assert(!target.json.bufferViews[image.bufferView].extensions,'Images must remain raw');
    return {image:index,bytes:actual.length,sha256:sha(actual),mimeType:image.mimeType};
  });
  const meshTriangles=source.json.meshes.map(mesh=>mesh.primitives.reduce((sum,p)=>{
    assert.equal(p.mode??4,4);const count=source.json.accessors[p.indices??p.attributes.POSITION].count;assert.equal(count%3,0);return sum+count/3;
  },0));
  const result={status:'passed',name,sourceBytes:source.data.length,outputBytes:target.data.length,
    sourceSha256:sha(source.data),outputSha256:sha(target.data),viewCount:checks.length,accessorCount:accessorChecks.length,imageCount:imageChecks.length,
    compressedBytes,decodedBytes,decodeOnlyMs,verifiedReadbackMs:performance.now()-start,
    trianglesInUniqueMeshes:meshTriangles.reduce((a,b)=>a+b,0),trianglesAcrossMeshNodes:source.json.nodes.reduce((sum,n)=>sum+(n.mesh===undefined?0:meshTriangles[n.mesh]),0),
    nodeCount:source.json.nodes.length,meshCount:source.json.meshes.length,materialCount:source.json.materials.length,
    codecVersion:JSON.parse(fs.readFileSync(path.join(ROOT,'node_modules/meshoptimizer/package.json'))).version,
    scripts:{compressor:sha(fs.readFileSync(path.join(ROOT,'scripts/compress-source-map-lossless.mjs'))),validator:sha(fs.readFileSync(fileURLToPath(import.meta.url)))},
    encoderModuleSha256:sha(fs.readFileSync(path.join(ROOT,'node_modules/meshoptimizer/meshopt_encoder.js'))),decoderModuleSha256:sha(fs.readFileSync(path.join(ROOT,'node_modules/meshoptimizer/meshopt_decoder.mjs'))),
    views:checks,accessors:accessorChecks,images:imageChecks,
    invariants:['Every original bufferView and tightly packed accessor is byte-identical after decoding.',
      'All non-storage JSON is deep-equal, including node, skin, animation, mesh, material, image metadata and every extras object.',
      'Indices retain exact order and values; repeated/reverse-winding triangles are retained; no filters or quantization.',
      'Original image bytes are unchanged; original GLB file is never overwritten.'],
    boundary:'CPU WASM decode measured after module ready, excluding output allocation and byte comparison; not browser/GPU load or FPS.'};
  fs.writeFileSync(path.join(dir,name+'.meshopt.verify.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({...result,views:undefined,accessors:undefined,images:undefined}));
}
await MeshoptDecoder.ready;
const names=process.argv.slice(2);assert(names.every(n=>['world','props'].includes(n)));
for(const name of names.length?names:['world','props'])await validate(name);
