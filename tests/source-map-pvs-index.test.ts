import {describe,it,expect} from 'vitest';
import * as T from 'three';
import {createSourcePVSSubmission,sourcePVSTriangleSpans,sourcePVSRetainedIndices} from '../game/source-map-pvs-index';

describe('original PVS index submission',()=>{
  it('matches the exact original triangle subsequence for every visibility combination',()=>{
    const indices=new Uint32Array([4,1,7,9,8,3,0,5,2,2,5,0,8,9,3]);
    const spans=[{id:5,start:0,count:3},{id:6,start:3,count:6},{id:7,start:9,count:3},{id:-1,start:12,count:3}];
    const geometry=new T.BufferGeometry().setIndex(new T.BufferAttribute(indices.slice(),1));
    geometry.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(30),3));
    const mesh=new T.Mesh(geometry),owner=createSourcePVSSubmission(mesh,spans),index=geometry.index!;
    expect(sourcePVSRetainedIndices.has(index)).toBe(true);
    // Position/normal data may already have been released after GPU upload.
    (geometry.attributes.position as T.BufferAttribute).array=null as never;
    for(let bits=0;bits<8;bits++){
      const mask=Uint8Array.from([bits&1,(bits>>1)&1,(bits>>2)&1]);
      const expected=spans.filter(s=>s.id<0||mask[s.id-5]).flatMap(s=>[...indices.subarray(s.start,s.start+s.count)]);
      owner.select(mask,5);expect([...index.array].slice(0,geometry.drawRange.count)).toEqual(expected);
      expect(owner.audit.submittedTriangles).toBe(expected.length/3);expect(index.usage).toBe(T.DynamicDrawUsage);
      const version=index.version;expect(owner.select(mask.slice(),5)).toBe(false);expect(index.version).toBe(version);
    }
    owner.select(null);expect([...index.array]).toEqual([...indices]);expect(mesh.visible).toBe(true);
    owner.dispose();expect(sourcePVSRetainedIndices.has(index)).toBe(false);expect(()=>owner.select(null)).toThrow('disposed');
  });
  it('omits every vertex invocation for culled groups and restores exact winding when visible',()=>{
    const geometry=new T.BufferGeometry().setIndex([2,0,1,5,4,3]),mesh=new T.Mesh(geometry);
    const owner=createSourcePVSSubmission(mesh,[{id:0,start:0,count:3},{id:1,start:3,count:3}]);
    owner.select(new Uint8Array([0,0]));expect(mesh.visible).toBe(false);expect(geometry.drawRange.count).toBe(0);
    owner.select(new Uint8Array([0,1]));expect(mesh.visible).toBe(true);expect([...geometry.index!.array].slice(0,3)).toEqual([5,4,3]);
    owner.select(null,0,new Set([1]));expect([...geometry.index!.array].slice(0,3)).toEqual([2,0,1]);owner.dispose();
  });
  it('builds contiguous original face runs and conservatively retains ambiguous faces',()=>{
    const indices=new Uint16Array([0,1,2,2,1,0,3,4,5,0,4,5]),ids=new Float32Array([7,7,7,8,8,8]);
    expect(sourcePVSTriangleSpans(indices,ids)).toEqual([{id:7,start:0,count:6},{id:8,start:6,count:3},{id:-1,start:9,count:3}]);
    expect(()=>sourcePVSTriangleSpans(new Uint16Array([0,1,8]),ids)).toThrow('missing');
  });
});
