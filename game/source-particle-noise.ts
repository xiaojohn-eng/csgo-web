/** Valve NoiseSIMD scalar transcription (source-sdk-2013 b8cfb12). Its three
 * permutation arrays and impulse table match build 12426148 client_client.so
 * byte-for-byte at 0x11009c0/0x1100dc0/0x11011c0/0x11019c0. */
import data from './source-particle-noise-data.json';
const f=Math.fround,bits=new DataView(new ArrayBuffer(4));
const lerp=(a:number,b:number,t:number)=>f(a+f(t*f(b-a)));
export function sourceParticleNoise(x:number,y:number,z:number){
 const coords=[x,y,z].map(v=>{bits.setFloat32(0,f(v+32768),true);const i=bits.getUint32(0,true)&65535;return[i>>>8,(i&255)/256];});
 const lattice=(a:number,b:number,c:number)=>f(data.impulse_xcoords[data.perm_c[(c+data.perm_b[(b+data.perm_a[a&255])&255])&255]]);
 const [[ix,tx],[iy,ty],[iz,tz]]=coords;
 const plane=(k:number)=>lerp(lerp(lattice(ix,iy,k),lattice(ix+1,iy,k),tx),lerp(lattice(ix,iy+1,k),lattice(ix+1,iy+1,k),tx),ty);
 return f(2*f(lerp(plane(iz),plane(iz+1),tz)-.5));
}
