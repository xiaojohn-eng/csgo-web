import {SOURCE_PAINT_MIP_GAMMA_LOOKUP as gamma} from './source-paint-mip-data';
const f=Math.fround,inv255=f(1/255),inverseGamma=f(1/f(2.2));
export type SourcePaintMip={data:Uint8Array;width:number;height:number};
/** Original CVTFTexture RGBA8888 pool flags 0x400, with no optional postprocess.
 * Native uses gamma 2.2 for RGB in both output roles and linear independent alpha.
 * Levels 1..4 sample level 0; later levels sample level-4. All sums are float32.
 * This reproduces uncompressed mip generation, not the subsequent DXT conversion. */
export function sourcePaintMipChain(rgba:Uint8Array,size:number):SourcePaintMip[]{
  if(!Number.isInteger(size)||size<1||size>2048||(size&(size-1))!==0||rgba.length!==size*size*4)
    throw Error('Original paint mip chain requires complete square power-of-two RGBA8');
  const chain:SourcePaintMip[]=[{data:rgba,width:size,height:size}];
  for(let level=1,dim=size>>1;dim;level++,dim>>=1){
    const source=chain[Math.max(0,level-4)],stride=source.width,ratio=stride/dim,weight=f(1/(ratio*ratio));
    const output=new Uint8Array(dim*dim*4);
    for(let y=0;y<dim;y++)for(let x=0;x<dim;x++){
      let r=0,g=0,b=0,a=0;
      for(let dy=0;dy<ratio;dy++)for(let dx=0;dx<ratio;dx++){
        const at=((y*ratio+dy)*stride+x*ratio+dx)*4;
        r=f(r+f(gamma[source.data[at]]*weight));g=f(g+f(gamma[source.data[at+1]]*weight));
        b=f(b+f(gamma[source.data[at+2]]*weight));a=f(a+f(source.data[at+3]*weight));
      }
      const at=(y*dim+x)*4;
      output[at]=encode(r);output[at+1]=encode(g);output[at+2]=encode(b);
      output[at+3]=Math.min(255,Math.max(0,Math.trunc(f(a+.5))));
    }
    chain.push({data:output,width:dim,height:dim});
  }
  return chain;
}
function encode(value:number){return Math.min(255,Math.max(0,Math.trunc(f(f(Math.pow(f(Math.max(0,value)*inv255),inverseGamma)*255)+.5))));}
