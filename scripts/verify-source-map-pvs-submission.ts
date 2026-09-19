/** Read only original GLB index/face accessors, without textures or positions.
 * Tests the runtime submission owner against an independent per-triangle
 * selection at all original spawn eyes. Material grouping here is diagnostic;
 * renderer material branches, GPU upload and FPS require separate acceptance. */
import assert from 'node:assert/strict';
import {createReadStream} from 'node:fs';
import {open,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import * as T from 'three';
import {createSourcePVSSubmission,sourcePVSTriangleSpans,type SourcePVSSpan} from '../game/source-map-pvs-index';
import {prepareSourceVisibility,querySourceVisibility} from '../game/source-visibility';

type Primitive={indices:number;attributes:Record<string,number>;material:number};
type Accessor={bufferView:number;byteOffset?:number;componentType:number;count:number;type:string};
type GLB={nodes:{name?:string;mesh?:number;children?:number[]}[];meshes:{primitives:Primitive[]}[];
  scenes:{nodes:number[]}[];scene?:number;accessors:Accessor[];bufferViews:{byteOffset?:number;byteLength:number;byteStride?:number}[]};
const root=resolve('.reference-assets/source-exports'),sky=JSON.parse(await readFile(resolve(root,'dust2/sky/sky.json'),'utf8'));
const rawPVS=await readFile(resolve(root,'dust2/visibility/visibility.json'));
const visibility=prepareSourceVisibility(JSON.parse(rawPVS.toString()));assert(visibility.valid,visibility.reason);
const fixtures=JSON.parse(await readFile(resolve(root,'dust2/visibility/spawn-fixtures.json'),'utf8'));
async function shaFile(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
async function readGLB(path:string,expectedSHA:string){
  assert.equal(await shaFile(path),expectedSHA);const file=await open(path,'r');
  async function bytes(offset:number,count:number){const out=Buffer.alloc(count);assert.equal((await file.read(out,0,count,offset)).bytesRead,count);return out;}
  const header=await bytes(0,20);assert.equal(header.readUInt32LE(0),0x46546c67);assert.equal(header.readUInt32LE(16),0x4e4f534a);
  const length=header.readUInt32LE(12),json:GLB=JSON.parse((await bytes(20,length)).toString());
  const binary=await bytes(20+length,8);assert.equal(binary.readUInt32LE(4),0x004e4942);
  const cache=new Map<number,Uint32Array|Float32Array>();
  return {json,close:()=>file.close(),async accessor(id:number){
    if(cache.has(id))return cache.get(id)!;
    const a=json.accessors[id],view=json.bufferViews[a.bufferView],components=a.type==='SCALAR'?1:a.type==='VEC2'?2:0;assert(components);
    const size=a.componentType===5123?2:4,stride=view.byteStride??components*size;
    assert([5123,5125,5126].includes(a.componentType));
    const raw=await bytes(28+length+(view.byteOffset??0)+(a.byteOffset??0),(a.count-1)*stride+components*size);
    const values=a.componentType===5126?new Float32Array(a.count*components):new Uint32Array(a.count*components);
    for(let v=0;v<a.count;v++)for(let c=0;c<components;c++){
      const at=v*stride+c*size;values[v*components+c]=a.componentType===5126?raw.readFloatLE(at):size===2?raw.readUInt16LE(at):raw.readUInt32LE(at);
    }
    cache.set(id,values);return values;
  }};
}
type Entry={id:number;indices:Uint32Array;vertices:number;faces?:Float32Array;offset:number};
type Group={entries:Entry[];vertices:number;indices:number;mesh?:T.Mesh;owner?:ReturnType<typeof createSourcePVSSubmission>};
const resources=[
  {kind:'props',path:'dust2/props.glb',sha:'55937fce28a53461520fa2c531384f65f0f8b69df1a8205245466b6064ab5232',triangles:6269945},
  {kind:'world',path:'dust2-lightmapped/world.glb',sha:'91b52e52b988e1b41b07b9cd365c159d615934fa49f07c3fa1e438d43269ffa8',triangles:302307},
];
const owners:{kind:string;groups:Group[];excluded:Set<number>;sourceTriangles:number;sourceSHA:string}[]=[];
for(const resource of resources){
  const glb=await readGLB(resolve(root,resource.path),resource.sha),groups=new Map<number,Group>();
  async function visit(nodeId:number,inherited=-1){
    const node=glb.json.nodes[nodeId],match=/^static_prop_(\d+)$/.exec(node.name??''),id=match?Number(match[1]):inherited;
    if(node.mesh!==undefined)for(const primitive of glb.json.meshes[node.mesh].primitives){
      const indices=await glb.accessor(primitive.indices);assert(indices instanceof Uint32Array);
      const vertices=glb.json.accessors[primitive.attributes.POSITION].count;
      let faces:Float32Array|undefined;
      if(resource.kind==='world'){
        const uv=await glb.accessor(primitive.attributes.TEXCOORD_2);assert(uv instanceof Float32Array);
        faces=Float32Array.from({length:vertices},(_,i)=>uv[i*2]);
      }else assert(id>=0,'Original prop anchor missing');
      const group=groups.get(primitive.material)??{entries:[],vertices:0,indices:0};
      group.entries.push({id,indices,vertices,faces,offset:group.vertices});group.vertices+=vertices;group.indices+=indices.length;groups.set(primitive.material,group);
    }
    for(const child of node.children??[])await visit(child,id);
  }
  for(const node of glb.json.scenes[glb.json.scene??0].nodes)await visit(node);
  await glb.close();
  for(const group of groups.values()){
    const indices=new Uint32Array(group.indices),spans:SourcePVSSpan[]=[];let at=0;
    for(const entry of group.entries){
      for(let i=0;i<entry.indices.length;i++)indices[at+i]=entry.indices[i]+entry.offset;
      if(entry.faces)for(const span of sourcePVSTriangleSpans(entry.indices,entry.faces))spans.push({...span,start:span.start+at});
      else spans.push({id:entry.id,start:at,count:entry.indices.length});
      at+=entry.indices.length;
    }
    group.mesh=new T.Mesh(new T.BufferGeometry().setIndex(new T.BufferAttribute(indices,1)),new T.MeshBasicMaterial());
    group.owner=createSourcePVSSubmission(group.mesh,spans);
  }
  const sourceTriangles=[...groups.values()].reduce((n,g)=>n+g.indices/3,0);assert.equal(sourceTriangles,resource.triangles);
  owners.push({kind:resource.kind,groups:[...groups.values()],sourceTriangles,sourceSHA:resource.sha,
    excluded:new Set(resource.kind==='world'?sky.worldFaceIds:sky.staticPropIds)});
}
const samples=[];
// Null/invalid location restores every original world span except the distinct sky pass.
for(const fixture of [...fixtures,{hammerid:'all-visible-boundary',browserEye64:[NaN,NaN,NaN]}]){
  const [x,y,z]=fixture.browserEye64,result=querySourceVisibility(visibility,{x,y,z}),counts:Record<string,unknown>={};
  for(const owner of owners){
    const mask=result.allVisible?null:owner.kind==='world'?result.worldFaceMask:result.staticPropMask;
    const first=owner.kind==='world'?result.worldFirstFace:0,start=performance.now();let changedGroups=0,submitted=0;
    for(const group of owner.groups)changedGroups+=+group.owner!.select(mask,first,owner.excluded);
    const selectMs=performance.now()-start;
    for(const group of owner.groups){
      const output=group.mesh!.geometry.index!.array;let at=0;
      // Independent original per-triangle reference, without run extraction.
      for(const entry of group.entries)for(let i=0;i<entry.indices.length;i+=3){
        const a=entry.indices[i],b=entry.indices[i+1],c=entry.indices[i+2];let id=entry.id;
        if(entry.faces){const face=entry.faces[a];id=Number.isSafeInteger(face)&&face>=0&&entry.faces[b]===face&&entry.faces[c]===face?face:-1;}
        const offset=id-first;
        if(owner.excluded.has(id)||(mask&&id>=0&&offset>=0&&offset<mask.length&&!mask[offset]))continue;
        for(const source of [a,b,c])assert.equal(output[at++],source+entry.offset,'Original triangle order/winding differs');
      }
      assert.equal(group.mesh!.geometry.drawRange.count,at);assert.equal(group.owner!.audit.submittedTriangles,at/3);submitted+=at/3;
      const version=group.mesh!.geometry.index!.version;assert.equal(group.owner!.select(mask,first,owner.excluded),false);
      assert.equal(group.mesh!.geometry.index!.version,version,'Repeated PVS uploaded the same index buffer');
    }
    counts[owner.kind]={sourceTriangles:owner.sourceTriangles,submittedTriangles:submitted,changedGroups,selectMs};
  }
  samples.push({hammerid:fixture.hammerid,leaf:result.leaf,cluster:result.cluster,allVisible:result.allVisible,visibleProps:result.staticPropIds.length,
    visibleWorldProps:result.staticPropIds.filter(id=>!owners[0].excluded.has(id)).length,...counts});
}
const report={status:'passed',scope:'CPU only; exact original GLB indices with original PVS at 30 diagnostic Z+64 spawn eyes plus all-visible fallback. Diagnostic material groups include all original primitives; real shader-branch batches, frustum, GPU uploads and FPS are not measured.',
  resources:owners.map(o=>({kind:o.kind,sourceSHA256:o.sourceSHA,originalTriangles:o.sourceTriangles,diagnosticGroups:o.groups.length,
    indexBytesRetained:o.groups.reduce((n,g)=>n+g.owner!.audit.indexBytesRetained,0)})),
  pvsSHA256:createHash('sha256').update(rawPVS).digest('hex'),samples};
for(const owner of owners)for(const group of owner.groups){group.owner!.dispose();group.mesh!.geometry.dispose();(group.mesh!.material as T.Material).dispose();}
await writeFile(resolve('research/source-map-pvs-submission.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,samples:samples.filter(s=>s.cluster===1555||s.allVisible)}));
