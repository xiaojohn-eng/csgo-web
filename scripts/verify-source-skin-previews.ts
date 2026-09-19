/** Independent, read-only acceptance of actual exported original inventory PNGs.
 * Run with tsx. --asset-root contains index.json and weapon/*.png; --index can
 * override it. --repository-root selects the current finish table/catalogue;
 * --vpk-dir selects original pak01_dir.vpk. Only --out writes a receipt.
 * This does not import the exporter or establish browser image-load acceptance.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync,openSync,readFileSync,readdirSync,readSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inflateSync} from 'node:zlib';

type Icon={weapon:string;sourceWeapon:string;paintKitId:number|null;paintKitName:string;variant:string;file:string;url:string;width:number;height:number;bytes:number;sha256:string;pairEvidence:string[];
  source:{path:string;bytes:number;crc32:string;preloadBytes:number;archiveIndex:number;archiveOffset:number;archiveBytes:number}};
type Index={format:string;sourceApp:number;build:number;publicPrefix:string;catalogueSha256:string;sourceCatalogueSha256:string;sourceItems:{path:string;sha256:string;bytes:number};vpkDirectory:{sha256:string;bytes:number};summary:{weapons:number;finishes:number;defaults:number;files:number;bytes:number};images:Icon[]};
type Catalogue={sourceFilesRead:{path:string;sha256:string;bytes:number}[];paintKits:{id:string;name:string}[];weapons:{id:string;name:string;resolvedDefinition:{image_inventory?:string}}[];
  weaponFinishRelations:{weapon:string;paintKitId:string;paintKitName:string;evidence:string[]}[]};
type Entry={path:string;crc32:number;preload:Uint8Array;archive:number;offset:number;length:number};
const view=(bytes:Uint8Array)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
const same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const decode=(bytes:Uint8Array)=>new TextDecoder().decode(bytes);
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const crcTable=Uint32Array.from({length:256},(_,i)=>{for(let k=0;k<8;k++)i=(i&1)?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
const crc=(bytes:Uint8Array)=>{let n=0xffffffff;for(const byte of bytes)n=crcTable[(n^byte)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
const safe=(root:string,file:string)=>{assert(file&&!isAbsolute(file)&&!file.includes('\\'),'Invalid relative asset path: '+file);const path=resolve(root,file),rel=relative(root,path);assert(rel&&!rel.startsWith('..'+sep)&&rel!=='..','Asset escapes root');return path;};
const json=<T>(path:string):T=>JSON.parse(readFileSync(path,'utf8'));

function originalArchive(path:string){
  const bytes=readFileSync(path),v=view(bytes);assert.equal(v.getUint32(0,true),0x55aa1234,'VPK signature');
  const version=v.getUint32(4,true);assert([1,2].includes(version),'VPK version');
  const header=version===2?28:12,end=header+v.getUint32(8,true);assert(end<=bytes.length,'VPK tree range');
  let at=header;const entries=new Map<string,Entry>();
  const string=()=>{const to=bytes.indexOf(0,at);assert(to>=at&&to<end,'VPK unterminated string');const s=decode(bytes.subarray(at,to));at=to+1;return s;};
  for(let ext=string();ext;ext=string())for(let folder=string();folder;folder=string())for(let name=string();name;name=string()){
    assert(at+18<=end,'VPK entry range');const checksum=v.getUint32(at,true),preloadBytes=v.getUint16(at+4,true),archive=v.getUint16(at+6,true),offset=v.getUint32(at+8,true),length=v.getUint32(at+12,true);
    assert.equal(v.getUint16(at+16,true),0xffff,'VPK entry terminator');at+=18;assert(at+preloadBytes<=end,'VPK preload range');
    const file=(folder===' '?'':folder+'/')+name+(ext===' '?'':'.'+ext),preload=bytes.subarray(at,at+preloadBytes);at+=preloadBytes;
    assert(!entries.has(file),'Duplicate VPK entry: '+file);entries.set(file,{path:file,crc32:checksum,preload,archive,offset,length});
  }
  assert.equal(at,end,'VPK tree trailing bytes');const handles=new Map<number,number>();
  return{sha256:sha(bytes),bytes:bytes.length,entries,
    read(entry:Entry){let data:Buffer;if(entry.archive===0x7fff){const start=end+entry.offset;assert(start+entry.length<=bytes.length,'Inline VPK range');data=bytes.subarray(start,start+entry.length);}
      else{let handle=handles.get(entry.archive);if(handle===undefined){handle=openSync(path.replace(/_dir\.vpk$/,`_${String(entry.archive).padStart(3,'0')}.vpk`),'r');handles.set(entry.archive,handle);}data=Buffer.alloc(entry.length);assert.equal(readSync(handle,data,0,data.length,entry.offset),data.length,'VPK short read');}
      const original=Buffer.concat([entry.preload,data]);assert.equal(crc(original),entry.crc32,'Original VPK CRC: '+entry.path);return original;},
    close(){for(const handle of handles.values())closeSync(handle);}};
}

function png(bytes:Uint8Array){
  const v=view(bytes);
  assert(same(bytes.subarray(0,8),Uint8Array.from([137,80,78,71,13,10,26,10])),'PNG signature');
  let at=8,width=0,height=0,ended=false,started=false;const idat:Uint8Array[]=[];
  while(at<bytes.length){assert(at+12<=bytes.length,'PNG chunk header');const size=v.getUint32(at,false),type=decode(bytes.subarray(at+4,at+8)),end=at+12+size;assert(end<=bytes.length,'PNG chunk body');
    assert.equal(crc(bytes.subarray(at+4,end-4)),v.getUint32(end-4,false),'PNG CRC '+type);const data=bytes.subarray(at+8,end-4);
    if(!started){assert.equal(type,'IHDR');assert.equal(size,13);started=true;width=view(data).getUint32(0,false);height=view(data).getUint32(4,false);assert(width>0&&height>0&&width*height<=4e6,'PNG dimensions');assert.deepEqual([...data.subarray(8)],[8,6,0,0,0],'Expected actual noninterlaced RGBA8');}
    else if(type==='IHDR')throw Error('Repeated PNG IHDR');
    if(type==='IDAT')idat.push(data);
    if(type==='IEND'){assert.equal(size,0);assert.equal(end,bytes.length,'PNG trailing bytes');ended=true;break;}
    at=end;
  }
  assert(ended&&idat.length,'PNG lacks IDAT/IEND');const stride=width*4,raw=inflateSync(Buffer.concat(idat),{maxOutputLength:(stride+1)*height});assert.equal(raw.length,(stride+1)*height,'PNG decompressed size');
  const decoded=Buffer.alloc(stride*height);let nontransparent=0,opaque=0,transparent=0,minX=width,minY=height,maxX=-1,maxY=-1;
  const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];assert(filter<=4,'Unknown PNG filter');
    for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=4?decoded[i-4]:0,b=y?decoded[i-stride]:0,c=y&&x>=4?decoded[i-stride-4]:0,predict=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];decoded[i]=(raw[y*(stride+1)+x+1]+predict)&255;}
    for(let x=0;x<width;x++){const alpha=decoded[y*stride+x*4+3];if(alpha){nontransparent++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}else transparent++;if(alpha===255)opaque++;}
  }
  assert(nontransparent>100&&opaque>100&&transparent>100,'Missing weapon artwork or alpha background');
  return{width,height,rgbaSHA256:sha(decoded),nontransparentPixels:nontransparent,opaquePixels:opaque,transparentPixels:transparent,bounds:[minX,minY,maxX,maxY]};
}
function files(root:string,prefix=''):string[]{return readdirSync(root,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(resolve(root,entry.name),prefix+entry.name+'/'):[prefix+entry.name]);}

async function main(){
  const args=new Map<string,string>();for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i],value=process.argv[i+1];assert(['--asset-root','--index','--repository-root','--vpk-dir','--out'].includes(key)&&value,'Usage: tsx scripts/verify-source-skin-previews.ts --asset-root <image-root> [--index <json>] [--repository-root <repo>] [--vpk-dir <pak01_dir.vpk>] [--out <receipt>]');assert(!args.has(key),'Repeated argument '+key);args.set(key,value);}
  const repository=resolve(args.get('--repository-root')??process.cwd()),indexPath=resolve(args.get('--index')??resolve(args.get('--asset-root')??resolve(repository,'public/source/csgo-12426148/skin-previews-20260913'),'index.json')),
    assetRoot=resolve(args.get('--asset-root')??dirname(indexPath)),vpkPath=resolve(args.get('--vpk-dir')??resolve(repository,'.reference-assets/csgo-legacy/csgo/pak01_dir.vpk'));
  const tablePath=resolve(repository,'game/source-finish-table.ts'),cataloguePath=resolve(repository,'research/source-items-catalog.json'),index=json<Index>(indexPath),catalogue=json<Catalogue>(cataloguePath);
  const table=await import(pathToFileURL(tablePath).href) as typeof import('../game/source-finish-table');
  assert.equal(index.format,'source-skin-previews-v1');assert.equal(index.sourceApp,740);assert.equal(index.build,12426148);assert.equal(index.catalogueSha256,table.SOURCE_FINISH_CATALOGUE_SHA256);assert.equal(index.sourceCatalogueSha256,sha(readFileSync(cataloguePath)));
  const itemFile=catalogue.sourceFilesRead.find(f=>f.path==='scripts/items/items_game.txt');assert(itemFile);assert.equal(index.sourceItems.sha256,itemFile.sha256);assert.equal(index.sourceItems.bytes,itemFile.bytes);
  const originalItems=readFileSync(safe(resolve(repository,'.reference-assets/csgo-legacy/csgo'),itemFile.path));assert.equal(sha(originalItems),itemFile.sha256);assert.equal(originalItems.length,itemFile.bytes);
  const original=originalArchive(vpkPath);assert.equal(original.sha256,index.vpkDirectory.sha256);assert.equal(original.bytes,index.vpkDirectory.bytes);
  const expected=new Map<string,{sourceWeapon:string;kit:number|null}>();for(const weapon of table.SOURCE_FINISH_WEAPONS){expected.set(weapon.id+'/default',{sourceWeapon:weapon.originalWeapon,kit:null});for(const finish of table.SOURCE_FINISHES[weapon.id])expected.set(weapon.id+'/'+finish.paintKitId,{sourceWeapon:weapon.originalWeapon,kit:finish.paintKitId});}
  const errors:string[]=[],seen=new Set<string>(),shaSeen=new Map<string,string>(),rgbaSeen=new Map<string,string>(),sourceSeen=new Set<string>(),checked:unknown[]=[],counts:Record<string,number>={};let totalBytes=0;
  try{for(const row of index.images){try{
    const key=row.weapon+'/'+(row.paintKitId??'default'),pair=expected.get(key);assert(pair,'Unexpected weapon/paint-kit pair '+key);assert(!seen.has(key),'Duplicate pair '+key);seen.add(key);assert.equal(row.sourceWeapon,pair.sourceWeapon);
    const weapon=catalogue.weapons.find(w=>w.name===pair.sourceWeapon);assert(weapon,'Original weapon definition absent');let expectedPaths:string[];
    if(pair.kit===null){assert.equal(row.paintKitName,'default');assert.equal(row.variant,'default');assert(weapon.resolvedDefinition.image_inventory);expectedPaths=['resource/flash/'+weapon.resolvedDefinition.image_inventory+'.png'];assert.deepEqual(row.pairEvidence,[`/items/${weapon.id}/resolvedDefinition/image_inventory=${weapon.resolvedDefinition.image_inventory}`]);}
    else{const kit=catalogue.paintKits.find(k=>Number(k.id)===pair.kit),relation=catalogue.weaponFinishRelations.find(r=>r.weapon===pair.sourceWeapon&&Number(r.paintKitId)===pair.kit);assert(kit&&relation,'Original weapon/kit relation absent');assert.equal(row.paintKitName,kit.name);assert.equal(relation.paintKitName,kit.name);assert.equal(row.variant,'light');
      const evidence=relation.evidence.filter(e=>/^\/alternate_icons2\/weapon_icons\/\d+\/icon_path=/.test(e)&&e.endsWith('_light'));assert(evidence.length>0,'Original light icon relation absent');assert.deepEqual(row.pairEvidence,evidence);expectedPaths=evidence.map(e=>'resource/flash/'+e.split('=')[1]+'_large.png');}
    assert(expectedPaths.includes(row.source.path),'Wrong original image path '+key);assert(!sourceSeen.has(row.source.path),'Repeated source icon '+row.source.path);sourceSeen.add(row.source.path);
    assert.equal(row.file,key+'.png');assert.equal(row.url,index.publicPrefix+'/'+row.file);const path=safe(assetRoot,row.file),bytes=readFileSync(path);assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.sha256,'Export SHA '+key);assert(!shaSeen.has(row.sha256),'Duplicate image bytes: '+key+' / '+shaSeen.get(row.sha256));shaSeen.set(row.sha256,key);
    const entry=original.entries.get(row.source.path);assert(entry,'Original VPK icon absent');assert.deepEqual([row.source.archiveIndex,row.source.archiveOffset,row.source.archiveBytes,row.source.preloadBytes],[entry.archive,entry.offset,entry.length,entry.preload.length]);assert.equal(row.source.crc32,entry.crc32.toString(16).padStart(8,'0'));assert.equal(row.source.bytes,bytes.length);assert(same(bytes,original.read(entry)),'Export differs from independently located original VPK image '+key);
    const decoded=png(bytes);assert.equal(row.width,decoded.width);assert.equal(row.height,decoded.height);assert.equal(decoded.width,512);assert.equal(decoded.height,384);assert(!rgbaSeen.has(decoded.rgbaSHA256),'Duplicate decoded image: '+key+' / '+rgbaSeen.get(decoded.rgbaSHA256));rgbaSeen.set(decoded.rgbaSHA256,key);
    checked.push({key,sourceWeapon:pair.sourceWeapon,paintKitName:row.paintKitName,file:row.file,sourcePath:entry.path,sha256:row.sha256,bytes:bytes.length,...decoded});counts[row.weapon]=(counts[row.weapon]??0)+1;totalBytes+=bytes.length;
  }catch(error){errors.push(`${row.weapon}/${row.paintKitId??'default'}: ${String(error)}`);}}}finally{original.close();}
  const actualFiles=files(assetRoot).filter(f=>f.toLowerCase().endsWith('.png')).sort(),expectedFiles=[...expected.keys()].map(k=>k+'.png').sort();
  for(const key of expected.keys())if(!seen.has(key))errors.push('Missing index pair '+key);
  for(const file of expectedFiles)if(!actualFiles.includes(file))errors.push('Missing PNG '+file);
  for(const file of actualFiles)if(!expectedFiles.includes(file))errors.push('Unexpected PNG '+file);
  const wantedSummary={weapons:table.SOURCE_FINISH_WEAPONS.length,finishes:expected.size-table.SOURCE_FINISH_WEAPONS.length,defaults:table.SOURCE_FINISH_WEAPONS.length,files:expected.size,bytes:totalBytes};
  try{assert.deepEqual(index.summary,wantedSummary);assert.equal(index.images.length,expected.size);assert.equal(checked.length,expected.size);}catch(error){errors.push('Coverage: '+String(error));}
  const report={format:'source-skin-preview-independent-qa-v1',status:errors.length?'failed':'passed',scope:'Independent original-catalogue mapping, full original VPK byte comparison and RGBA decode of every candidate PNG. Browser requests, visual layout, seed/wear preview and 3D finish rendering are outside this receipt.',paths:{repository,assetRoot,index:indexPath,vpk:vpkPath},identity:{tableSHA256:sha(readFileSync(tablePath)),sourceCatalogueSHA256:sha(readFileSync(cataloguePath)),indexSHA256:sha(readFileSync(indexPath)),vpkDirectorySHA256:original.sha256,sourceItemsSHA256:itemFile.sha256},summary:wantedSummary,perWeapon:counts,actualPNGFiles:actualFiles.length,errors,checked};
  if(args.has('--out')){const out=resolve(args.get('--out')!);mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({status:report.status,...wantedSummary,perWeapon:counts,errors},null,2));if(errors.length)process.exitCode=1;
}
await main().catch(error=>{console.error(String(error));process.exitCode=1;});
