import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import reference from '../research/source-paint-mips.json';
import {sourcePaintMipChain} from '../game/source-paint-mips';
import {SOURCE_PAINT_MIP_GAMMA_LOOKUP} from '../game/source-paint-mip-data';
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
const directory='.reference-assets/source-exports/fidelity-paint-20260913/mips/';
it('matches all 31 native mip images including direct-base, mip-4, opaque, transparent and alpha-control cases',()=>{
  expect(sha(readFileSync(reference.materialSystem.file))).toBe(reference.materialSystem.sha256);
  expect(sha(new Uint8Array(SOURCE_PAINT_MIP_GAMMA_LOOKUP.buffer))).toBe(reference.gammaLookup.sha256);
  expect(reference.cases.reduce((sum,c)=>sum+c.mips.length,0)).toBe(31);
  for(const row of reference.cases){
    const raw=new Uint8Array(readFileSync(directory+row.mips[0].file));expect(sha(raw)).toBe(row.mips[0].sha256);
    const output=sourcePaintMipChain(raw,row.size);expect(output).toHaveLength(row.mips.length);
    expect(output[0].data).toBe(raw);
    for(const mip of row.mips){
      expect(sha(readFileSync(directory+mip.file))).toBe(mip.sha256);
      expect(sha(output[mip.level].data),`${row.name}:${mip.level}`).toBe(mip.sha256);
      expect(output[mip.level].width).toBe(mip.size);expect(output[mip.level].height).toBe(mip.size);
    }
    for(const call of row.calls)expect(call.sourceMip).toBe(Math.max(0,call.targetMip-4));
  }
});
it('rejects incomplete and unsupported input without substituting browser-generated mipmaps',()=>{
  for(const size of[0,3,4096,NaN])expect(()=>sourcePaintMipChain(new Uint8Array(4),size)).toThrow();
  expect(()=>sourcePaintMipChain(new Uint8Array(15),2)).toThrow();
});
