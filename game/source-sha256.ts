import {sha256} from '@noble/hashes/sha2.js';

/** SHA-256 integrity is required on both secure localhost and HTTP LAN origins.
 * Native WebCrypto is preferred; absence uses the pinned, MIT noble SHA-256.
 * No trust downgrade and no Node crypto dependency in the browser bundle.
 */
export async function sourceSha256(bytes:Uint8Array,signal?:AbortSignal):Promise<string>{
  signal?.throwIfAborted();
  let output:Uint8Array;
  if(typeof globalThis.crypto?.subtle?.digest==='function'){
    output=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>));
  }else{
    const hash=sha256.create(),chunk=4*1024*1024;
    try{
      for(let offset=0;offset<bytes.byteLength;offset+=chunk){
        signal?.throwIfAborted();hash.update(bytes.subarray(offset,Math.min(offset+chunk,bytes.byteLength)));
        // Large original VHV files should not monopolize the UI event loop.
        if(offset+chunk<bytes.byteLength)await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
      output=hash.digest();
    }finally{hash.destroy();}
  }
  signal?.throwIfAborted();
  return Array.from(output,value=>value.toString(16).padStart(2,'0')).join('');
}
