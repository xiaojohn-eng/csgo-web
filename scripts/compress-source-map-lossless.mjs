/** Lossless storage-only EXT_meshopt_compression for the two frozen Dust2 GLBs.
 * No scene graph serializer, quantization, filters, remaps, or image processing.
 * INDICES intentionally avoids TRIANGLES' cyclic rotation of triangle vertices.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {MeshoptEncoder} from 'meshoptimizer/encoder';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUT=path.join(ROOT,'.reference-assets/source-exports/dust2');
const EXT='EXT_meshopt_compression';
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const bytesPerComponent={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};

function parse(data){
  assert.equal(data.readUInt32LE(0),0x46546c67);assert.equal(data.readUInt32LE(4),2);assert.equal(data.readUInt32LE(8),data.length);
  const jsonLength=data.readUInt32LE(12);assert.equal(data.readUInt32LE(16),0x4e4f534a);
  const json=JSON.parse(data.toString('utf8',20,20+jsonLength));const start=20+jsonLength;
  assert.equal(data.readUInt32LE(start+4),0x004e4942);assert.equal(start+8+data.readUInt32LE(start),data.length);
  const bin=data.subarray(start+8);assert.equal(json.buffers.length,1);assert.equal(json.buffers[0].uri,undefined);
  assert(json.buffers[0].byteLength<=bin.length&&bin.length-json.buffers[0].byteLength<=3);
  assert(!(json.extensionsUsed??[]).includes(EXT));
  return {json,bin};
}

function serialize(json,bin){
  const raw=Buffer.from(JSON.stringify(json));const padded=Buffer.alloc((raw.length+3)&~3,0x20);raw.copy(padded);
  const body=Buffer.alloc((bin.length+3)&~3);bin.copy(body);
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);
  header.writeUInt32LE(28+padded.length+body.length,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const bh=Buffer.alloc(8);bh.writeUInt32LE(body.length,0);bh.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,padded,bh,body]);
}

async function compress(name){
  const sourcePath=path.join(OUT,name+'.glb'),targetPath=path.join(OUT,name+'.meshopt.glb');
  const start=performance.now(),source=fs.readFileSync(sourcePath),{json,bin}=parse(source),output=structuredClone(json);
  const imageViews=new Set((json.images??[]).map(i=>{assert.equal(i.uri,undefined);assert(Number.isInteger(i.bufferView));return i.bufferView;}));
  const indexAccessors=new Set(json.meshes.flatMap(m=>m.primitives.filter(p=>p.indices!==undefined).map(p=>p.indices)));
  const accessorViews=new Map();
  for(const [i,a]of json.accessors.entries()){
    assert(!a.sparse);assert(Number.isInteger(a.bufferView));
    const entries=accessorViews.get(a.bufferView)??[];entries.push({i,a});accessorViews.set(a.bufferView,entries);
  }
  let offset=0,encodedMs=0;const parts=[],records=[];
  const append=data=>{const pad=(4-offset%4)%4;if(pad){parts.push(Buffer.alloc(pad));offset+=pad;}const start=offset;parts.push(Buffer.from(data));offset+=data.length;return start;};
  const sourceSpans=[];
  for(const [i,view]of json.bufferViews.entries()){
    assert.equal(view.buffer,0);assert(!view.extensions);
    const begin=view.byteOffset??0;assert(begin+view.byteLength<=json.buffers[0].byteLength);
    const raw=bin.subarray(begin,begin+view.byteLength);sourceSpans.push([begin,begin+view.byteLength]);
    let mode=null,stride=null,count=null,compressed=null,reason='image bytes unchanged';
    if(!imageViews.has(i)){
      const access=accessorViews.get(i);assert.equal(access?.length,1,'This bounded exporter expects one accessor per geometry view');
      const a=access[0].a;assert.equal(a.byteOffset??0,0);
      stride=view.byteStride??bytesPerComponent[a.componentType]*components[a.type];count=a.count;
      assert.equal(count*stride,view.byteLength,'No hidden padding or partial accessor views allowed');
      // The source preserves obsolete index accessors after its corner-geometry
      // repair; these original views must survive byte-for-byte as well.
      if(indexAccessors.has(access[0].i)||view.target===34963){
        assert(view.target===undefined||view.target===34963);assert.equal(a.type,'SCALAR');assert([5123,5125].includes(a.componentType));mode='INDICES';
      }else{
        assert(view.target===undefined||view.target===34962);assert(stride>0&&stride<=256&&stride%4===0);mode='ATTRIBUTES';
      }
      const beginEncode=performance.now();compressed=MeshoptEncoder.encodeGltfBuffer(raw,count,stride,mode,0);encodedMs+=performance.now()-beginEncode;
      if(compressed.length>=raw.length){compressed=null;reason='encoding would not reduce bytes';}
    }else assert(!accessorViews.has(i),'Image/geometry alias not supported');
    const changed=output.bufferViews[i];
    if(compressed){
      const encodedOffset=append(compressed);changed.buffer=1;
      // Keep original uncompressed byteOffset/byteLength/target/stride exactly.
      changed.extensions={[EXT]:{buffer:0,byteOffset:encodedOffset,byteLength:compressed.length,byteStride:stride,count,mode,filter:'NONE'}};
      records.push({view:i,sourceBytes:raw.length,encodedBytes:compressed.length,mode,stride,count,sourceSha256:sha(raw)});
    }else{
      changed.buffer=0;changed.byteOffset=append(raw);
      records.push({view:i,sourceBytes:raw.length,encodedBytes:raw.length,mode:'RAW',reason,sourceSha256:sha(raw)});
    }
  }
  output.buffers=[{byteLength:offset},{...structuredClone(json.buffers[0]),extensions:{[EXT]:{fallback:true}}}];
  assert.equal(json.buffers[0].extensions,undefined,'Unknown source buffer extension needs review');
  output.extensionsUsed=[...(json.extensionsUsed??[]),EXT];output.extensionsRequired=[...(json.extensionsRequired??[]),EXT];
  const result=serialize(output,Buffer.concat(parts,offset));
  // Write a new path; original source file is never opened for writing.
  const temporary=targetPath+'.tmp';fs.writeFileSync(temporary,result);fs.renameSync(temporary,targetPath);
  sourceSpans.sort((a,b)=>a[0]-b[0]);let union=0,end=0;
  for(const [a,b]of sourceSpans){union+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
  const record={name,source:path.relative(ROOT,sourcePath),output:path.relative(ROOT,targetPath),
    sourceBytes:source.length,outputBytes:result.length,reductionPercent:100*(1-result.length/source.length),
    sourceSha256:sha(source),outputSha256:sha(result),encodeOnlyMs:encodedMs,totalMs:performance.now()-start,
    originalBinaryBytes:json.buffers[0].byteLength,referencedBinaryBytes:union,
    originalUnreferencedBytesOmitted:json.buffers[0].byteLength-union,
    views:records,compressedViews:records.filter(r=>r.mode!=='RAW').length,
    metadataContract:'Only buffers, bufferView storage/EXT, and extension declarations change; all other JSON remains exact.',
    boundary:'Encoding completed. Independent validator must pass before claiming lossless.'};
  fs.writeFileSync(targetPath+'.encode.json',JSON.stringify(record,null,2)+'\n');
  console.log(JSON.stringify({...record,views:undefined}));
}

await MeshoptEncoder.ready;
const names=process.argv.slice(2);assert(names.every(n=>['world','props'].includes(n)));
for(const name of names.length?names:['world','props'])await compress(name);
