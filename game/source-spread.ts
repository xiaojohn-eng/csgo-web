/** Ordinary App740 one-projectile rifle spread. See docs/source-handling.md.
 * Caller supplies authoritative accuracy and seed byte; this is not a recoil
 * or accuracy state machine and must not be driven from render time. */
const f=Math.fround,IM=2147483647,IA=16807,IQ=127773,IR=2836;
export class SourceUniformRandomStream{
  private idum:number;
  private iy=0;
  private readonly iv=new Int32Array(32);
  constructor(seed:number){
    if(!Number.isInteger(seed)||seed< -2147483648||seed>2147483647)throw Error('Source RNG requires an int32 seed');
    this.idum=seed>0?-seed:seed;
  }
  private generate(){
    if(this.idum<=0||this.iy===0){
      this.idum=(-this.idum)|0;
      if(this.idum<1)this.idum=1;
      for(let j=39;j>=0;j--){
        const k=Math.trunc(this.idum/IQ);
        this.idum=IA*(this.idum-k*IQ)-IR*k;
        if(this.idum<0)this.idum+=IM;
        if(j<32)this.iv[j]=this.idum;
      }
      this.iy=this.iv[0]!;
    }
    const k=Math.trunc(this.idum/IQ);
    this.idum=IA*(this.idum-k*IQ)-IR*k;
    if(this.idum<0)this.idum+=IM;
    const j=Math.trunc(this.iy/67108864);
    this.iy=this.iv[j]!;
    this.iv[j]=this.idum;
    return this.iy;
  }
  /** `CUniformRandomStream::RandomFloat(low, high)`: one draw from the 31-bit integer, scaled to
   * `[0, 1)`, clamped just below one, then `low + value * (high - low)` in float32 - the client's
   * own order, which is what the composition's stream alignment depends on.
   *
   * The client's function (read out of `libvstdlib_client.so` by
   * `scripts/probe-source-paintkit-transform.py`) swaps nothing and clamps nothing, so a reversed
   * interval is a range like any other: it draws inside `[high, low]`, which is how a paint kit
   * whose `pattern_rotate_start` sits above its `_end` - nine of them do - is still drawn. */
  randomFloat(low=0,high=1){
    if(!Number.isFinite(low)||!Number.isFinite(high))throw Error('Invalid Source random interval');
    let value=f(this.generate()*(1/IM));
    if(value>.99999988)value=f(.99999988);
    return f(f(value*f(f(high)-f(low)))+f(low));
  }
}
export type SourceSpread={x:number;y:number;draws:readonly[number,number,number,number]};
export function sourceRifleSpread(seedByte:number,inaccuracy:number,spread:number):SourceSpread{
  if(!Number.isInteger(seedByte)||seedByte<0||seedByte>255||
    !Number.isFinite(inaccuracy)||inaccuracy<0||inaccuracy>1||!Number.isFinite(spread)||spread<0||spread>1)
    throw Error('Invalid normal Source rifle spread input');
  const rng=new SourceUniformRandomStream(seedByte+1);
  const r1=rng.randomFloat(),a1=rng.randomFloat(0,f(2*Math.PI)),r2=rng.randomFloat(),a2=rng.randomFloat(0,f(2*Math.PI));
  const radius1=f(r1*f(inaccuracy)),radius2=f(r2*f(spread));
  return {x:f(f(f(Math.cos(a2))*radius2)+f(f(Math.cos(a1))*radius1)),
    y:f(f(f(Math.sin(a2))*radius2)+f(f(Math.sin(a1))*radius1)),draws:[r1,a1,r2,a2]};
}
export type SourceSpreadBasis={forward:readonly number[];right:readonly number[];up:readonly number[]};
/** Basis is already in the caller's world coordinates, including aim punch.
 * Offsets are dimensionless basis coefficients, never yaw/pitch radians.
 * Original normalization adds FLT_EPSILON; retain the precise SSE ordering. */
export function sourceSpreadDirection(basis:SourceSpreadBasis,spread:Pick<SourceSpread,'x'|'y'>):[number,number,number]{
  if(!Number.isFinite(spread.x)||!Number.isFinite(spread.y)||
    [basis.forward,basis.right,basis.up].some(v=>v.length!==3||v.some(n=>!Number.isFinite(n))))
    throw Error('Invalid Source spread basis');
  const out=[0,1,2].map(i=>f(f(f(basis.right[i]!)*f(spread.x))+f(basis.forward[i]!)));
  for(let i=0;i<3;i++)out[i]=f(out[i]!+f(f(basis.up[i]!)*f(spread.y)));
  const length=f(Math.sqrt(f(f(f(out[0]!*out[0]!)+f(out[1]!*out[1]!))+f(out[2]!*out[2]!))));
  const scale=f(1/f(length+1.1920928955078125e-7));
  return out.map(v=>f(v*scale))as[number,number,number];
}
