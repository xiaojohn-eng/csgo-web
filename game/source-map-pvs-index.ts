import * as T from 'three';

type IndexArray=Uint16Array|Uint32Array;
export type SourcePVSSpan={id:number;start:number;count:number};
export type SourcePVSSubmissionAudit={sourceTriangles:number;submittedTriangles:number;changedGroups:number;indexBytesRetained:number;lastUpdateMs:number};
/** Dynamic index buffers must survive the one-time GLTF CPU vertex release. */
export const sourcePVSRetainedIndices=new WeakSet<T.BufferAttribute>();
const noExcludedIds:ReadonlySet<number>=new Set();

export function sourcePVSTriangleSpans(indices:IndexArray,ids:Float32Array):SourcePVSSpan[]{
  const spans:SourcePVSSpan[]=[];
  if(indices.length%3)throw Error('Original PVS index count differs');
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i],b=indices[i+1],c=indices[i+2];
    if(Math.max(a,b,c)>=ids.length)throw Error('Original PVS face vertex is missing');
    const first=ids[a],id=Number.isSafeInteger(first)&&first>=0&&ids[b]===first&&ids[c]===first?first:-1;
    const last=spans.at(-1);if(last?.id===id)last.count+=3;else spans.push({id,start:i,count:3});
  }
  return spans;
}

/** Select original contiguous source-prop/face spans before vertex processing.
 * No vertex edits or triangle reordering; full vertex attributes remain GPU
 * resident. Only a cluster change copies visible original index spans. */
export function createSourcePVSSubmission(mesh:T.Mesh,spans:readonly SourcePVSSpan[]){
  const geometry=mesh.geometry,index=geometry.index;
  if(!index||!(index.array instanceof Uint16Array||index.array instanceof Uint32Array))throw Error('Original PVS index storage differs');
  const output=index.array;let end=0;
  for(const span of spans){
    if(!Number.isSafeInteger(span.id)||span.id< -1||span.start!==end||!Number.isSafeInteger(span.count)||span.count<3||span.count%3)
      throw Error('Original PVS spans do not partition the index buffer');
    end+=span.count;
  }
  if(end!==output.length)throw Error('Original PVS index spans are incomplete');
  let source:IndexArray|null=output.slice();
  const visible=new Uint8Array(spans.length).fill(1),originalVisible=mesh.visible;
  index.setUsage(T.DynamicDrawUsage);sourcePVSRetainedIndices.add(index);geometry.setDrawRange(0,output.length);
  const audit={sourceTriangles:output.length/3,submittedTriangles:output.length/3,updates:0,indexBytesRetained:output.byteLength*2};
  let disposed=false;
  return {audit,
    select(mask:Uint8Array|null,firstId=0,excluded:ReadonlySet<number>=noExcludedIds){
      if(disposed)throw Error('Original PVS submission disposed');
      let changed=false;
      for(let i=0;i<spans.length;i++){
        const id=spans[i].id,offset=id-firstId;
        const value=+(!excluded.has(id)&&(id<0||mask===null||offset<0||offset>=mask.length||mask[offset]!==0));
        if(value!==visible[i]){visible[i]=value;changed=true;}
      }
      if(!changed)return false;
      let count=0;
      for(let i=0;i<spans.length;i++)if(visible[i]){
        const span=spans[i];output.set(source!.subarray(span.start,span.start+span.count),count);count+=span.count;
      }
      geometry.setDrawRange(0,count);mesh.visible=originalVisible&&count>0;
      index.clearUpdateRanges();
      if(count){index.addUpdateRange(0,count);index.needsUpdate=true;}
      audit.submittedTriangles=count/3;audit.updates++;return true;
    },
    dispose(){if(disposed)return;disposed=true;source=null;sourcePVSRetainedIndices.delete(index);},
  };
}

export function sourcePVSSubmissionAudit(owners:readonly ReturnType<typeof createSourcePVSSubmission>[]):SourcePVSSubmissionAudit{
  return {sourceTriangles:owners.reduce((n,o)=>n+o.audit.sourceTriangles,0),submittedTriangles:owners.reduce((n,o)=>n+o.audit.submittedTriangles,0),
    indexBytesRetained:owners.reduce((n,o)=>n+o.audit.indexBytesRetained,0),changedGroups:0,lastUpdateMs:0};
}
