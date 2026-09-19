import {expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {prepareSourcePropDecalUv,type SourcePropDecalUvManifest} from '../game/source-prop-decal-uv';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const data=new Float32Array([.25,.75,4,-2,.125,.625]),bytes=data.buffer;
 const descriptor:SourcePropDecalUvManifest={format:'source-prop-decal-uv-v1',sourceBspSha256:'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc',
 originalGLBSha256:'55937fce28a53461520fa2c531384f65f0f8b69df1a8205245466b6064ab5232',file:{url:'uv.f32',bytes:bytes.byteLength,sha256:sha(new Uint8Array(bytes))},
 records:[{mesh:7,primitive:1,model:'models/crate.mdl',material:'models/crate',offset:0,vertexCount:3,verified:true,sha256:sha(new Uint8Array(bytes))}]};
 return {data,bytes,descriptor};
}
it('preserves signed/out-of-unit-range original UV2 and disposes the shared lookup once',async()=>{
 const f=fixture(),owner=await prepareSourcePropDecalUv(f.descriptor,f.bytes,4,128);
 expect([...owner.texture.image.data!.slice(0,6)]).toEqual([...f.data]);expect(owner.records.get('7:1')!.verified).toBe(true);
 const disposed=vi.fn();owner.texture.addEventListener('dispose',disposed);owner.dispose();owner.dispose();expect(disposed).toHaveBeenCalledOnce();
});
it('rejects corrupt bytes, mismatched per-primitive receipt, overlapping ranges, nonfinite UV and padded texture budgets',async()=>{
 const f=fixture();f.data[0]=.5;await expect(prepareSourcePropDecalUv(f.descriptor,f.bytes)).rejects.toThrow(/binary receipt/);
 f.descriptor.file.sha256=sha(new Uint8Array(f.bytes));await expect(prepareSourcePropDecalUv(f.descriptor,f.bytes)).rejects.toThrow(/record receipt/);
 f.descriptor.records[0].sha256=f.descriptor.file.sha256;f.descriptor.records[0].offset=1;
 await expect(prepareSourcePropDecalUv(f.descriptor,f.bytes)).rejects.toThrow(/record/);f.descriptor.records[0].offset=0;
 await expect(prepareSourcePropDecalUv(f.descriptor,f.bytes,4,24)).rejects.toThrow(/lookup budget/);
 f.data[1]=NaN;f.descriptor.file.sha256=f.descriptor.records[0].sha256=sha(new Uint8Array(f.bytes));
 await expect(prepareSourcePropDecalUv(f.descriptor,f.bytes)).rejects.toThrow(/non-finite/);
});
