import {md5,sha1} from '@noble/hashes/legacy.js';
/** Original client command seed; not the default server rifle spread seed. */
export function sourceCommandSeed(commandNumber:number):number{
  if(!Number.isInteger(commandNumber)||commandNumber<0||commandNumber>0xffffffff)
    throw Error('Source command number must be uint32');
  const input=new Uint8Array(4);new DataView(input.buffer).setUint32(0,commandNumber,true);
  const digest=md5(input);
  return new DataView(digest.buffer,digest.byteOffset,digest.byteLength).getUint32(6,true)&0x7fffffff;
}
/** Actual App740 default server seed. Caller owns monotonic platform seconds
 * and prior global RNG entropy; store the resulting seed for deterministic
 * authority/replay. No clock or random source is called inside this function.
 * Uses original SHA1 bytes, not the public SDK's older float-bitcast branch. */
export function sourceServerSeed(platformSeconds:number,entropy:number):number{
  if(!Number.isFinite(platformSeconds)||platformSeconds<0||!Number.isInteger(entropy)||entropy<0||entropy>0x7fffffff)
    throw Error('Invalid authoritative Source server seed inputs');
  const input=new Uint8Array(16),view=new DataView(input.buffer);
  view.setFloat64(0,platformSeconds+4294967296,true);view.setInt32(8,entropy,true);
  const digest=sha1(input);
  return new DataView(digest.buffer,digest.byteOffset,digest.byteLength).getInt32(0,true);
}
