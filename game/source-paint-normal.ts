import * as T from 'three';
import {sourceSha256} from './source-sha256';
import type {SourceRedlinePatternInput} from './source-redline-compositor';

/** Lossless RGBA8 PNG decode for original data maps. Canvas alpha premultiplication
 * cannot preserve independent Source mask channels, so reconstruct the PNG scanlines
 * directly. The served export is verified before this bounded format is decoded. */
export async function decodeSourcePaintNormal(bytes:Uint8Array,width:number,height:number):Promise<Uint8Array> {
  const fail=()=>{throw Error('Original finish normal PNG format differs');};
  if(bytes.length<33||[137,80,78,71,13,10,26,10].some((v,i)=>bytes[i]!==v))fail();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),chunks:Uint8Array[]=[];
  let offset=8,header=false,ended=false;
  while(offset+12<=bytes.length){
    const count=view.getUint32(offset),type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
    if(offset+count+12>bytes.length)fail();
    if(type==='IHDR'){
      if(header||offset!==8||count!==13||view.getUint32(offset+8)!==width||view.getUint32(offset+12)!==height
        ||bytes[offset+16]!==8||bytes[offset+17]!==6||bytes[offset+18]!==0||bytes[offset+19]!==0||bytes[offset+20]!==0)fail();
      header=true;
    }else if(type==='IDAT'){if(!header)fail();chunks.push(bytes.slice(offset+8,offset+8+count));}
    else if(type==='IEND'){if(count!==0)fail();ended=true;offset+=12;break;}
    else if(type[0]===type[0].toUpperCase())fail();
    offset+=count+12;
  }
  if(!header||!ended||offset!==bytes.length||!chunks.length||!Number.isInteger(width)||!Number.isInteger(height)
    ||width<1||height<1||Math.max(width,height)>2048)fail();
  const stream=new Blob(chunks as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate'));
  const filtered=new Uint8Array(await new Response(stream).arrayBuffer()),stride=width*4;
  if(filtered.length!==(stride+1)*height)fail();
  const rgba=new Uint8Array(stride*height);
  for(let y=0;y<height;y++){
    const filter=filtered[y*(stride+1)];if(filter>4)fail();
    for(let x=0;x<stride;x++){
      const i=y*stride+x,a=x>=4?rgba[i-4]:0,b=y?rgba[i-stride]:0,c=y&&x>=4?rgba[i-stride-4]:0;
      let predictor=0;
      if(filter===1)predictor=a;
      else if(filter===2)predictor=b;
      else if(filter===3)predictor=Math.floor((a+b)/2);
      else if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);predictor=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
      rgba[i]=filtered[y*(stride+1)+1+x]+predictor;
    }
  }
  return rgba;
}

/** The original client clone assigns this finish's own $bumpmap for styles 7/8/9
 * (research/source-paint-normal.json). It is sampled by VertexLitGeneric, separately
 * from CustomWeapon's generated base/exponent pair. */
export async function loadSourcePaintNormal(input:SourceRedlinePatternInput,baseURL:string,signal?:AbortSignal):Promise<T.DataTexture>{
  signal?.throwIfAborted();
  if(!input.path.startsWith('png/')||input.path.includes('..'))throw Error('Original finish normal path differs');
  const response=await fetch(baseURL.replace(/\/$/,'')+'/'+input.path,{signal});
  if(!response.ok)throw Error('Original finish normal HTTP '+response.status);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length!==input.bytes||await sourceSha256(bytes,signal)!==input.sha256)throw Error('Original finish normal PNG checksum differs');
  const rgba=await decodeSourcePaintNormal(bytes,input.width,input.height);
  if(await sourceSha256(rgba,signal)!==input.rgba8Sha256)throw Error('Original finish normal decoded checksum differs');
  signal?.throwIfAborted();
  const normal=new T.DataTexture(rgba,input.width,input.height,T.RGBAFormat,T.UnsignedByteType);
  normal.colorSpace=T.NoColorSpace;normal.flipY=false;normal.premultiplyAlpha=false;
  normal.wrapS=input.vtfFlags&4?T.ClampToEdgeWrapping:T.RepeatWrapping;
  normal.wrapT=input.vtfFlags&8?T.ClampToEdgeWrapping:T.RepeatWrapping;
  normal.anisotropy=8;normal.magFilter=T.LinearFilter;normal.minFilter=T.LinearMipmapLinearFilter;
  normal.generateMipmaps=true;normal.needsUpdate=true;
  normal.userData.sourceFinishNormal={...input,decodedVerified:true,originalClientOutputCompared:false};
  return normal;
}
