import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash,webcrypto} from 'node:crypto';
import {sourceSha256} from '../game/source-sha256';
afterEach(()=>vi.unstubAllGlobals());
describe('browser SHA-256 with mandatory HTTP LAN integrity',()=>{
  it.each(['native','insecure'] as const)('matches SHA-256 known answer vectors through %s',async mode=>{
    vi.stubGlobal('crypto',mode==='native'?webcrypto:undefined);
    expect(await sourceSha256(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sourceSha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sourceSha256(new Uint8Array(1_000_000).fill(97))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
  it('matches independent Node crypto across padding/chunk boundaries and nonzero byteOffset',async()=>{
    vi.stubGlobal('crypto',{});
    for(const length of [55,56,63,64,65,4*1024*1024+131]){
      const storage=new Uint8Array(length+37);for(let i=0;i<storage.length;i++)storage[i]=(i*13+7)&255;
      const bytes=storage.subarray(17,17+length),before=bytes.slice();
      expect(await sourceSha256(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));expect(bytes).toEqual(before);
    }
  });
  it('yields between large fallback chunks and respects cancellation without returning a partial digest',async()=>{
    vi.stubGlobal('crypto',undefined);const controller=new AbortController();
    setTimeout(()=>controller.abort(),0);
    await expect(sourceSha256(new Uint8Array(8*1024*1024),controller.signal)).rejects.toThrow();
    await expect(sourceSha256(new Uint8Array(),controller.signal)).rejects.toThrow();
  });
});
