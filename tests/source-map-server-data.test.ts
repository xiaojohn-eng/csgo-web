import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {loadServerSourceMap} from '../server/source-map-data';
import {DUST2_BSP_SHA256,sourceSimulationVersion} from '../game/source-identity';
const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),'source-map-data-'));temporary.push(directory);
  const files:Record<string,{url:string;bytes:number;sha256:string}>={};
  for(const key of ['level','collision','navigation']){
    const json=JSON.stringify({sourceBspSha256:DUST2_BSP_SHA256,sourceNavSha256:'original-nav'});
    files[key]={url:key+'.json',bytes:new TextEncoder().encode(json).length,sha256:createHash('sha256').update(json).digest('hex')};
    await writeFile(join(directory,key+'.json'),json);
  }
  const path=join(directory,'manifest.json');
  const manifest={format:'source-map-runtime-v1',id:'de_dust2',sourceBspSha256:DUST2_BSP_SHA256,files};
  await writeFile(path,JSON.stringify(manifest));return {path,manifest,directory};
}
describe('authoritative Source map data loading',()=>{
  it('validates all three layers before sharing parsed data and needs no visual files',async()=>{
    const f=await fixture();const data=await loadServerSourceMap(f.path);
    expect(data.level.sourceBspSha256).toBe(DUST2_BSP_SHA256);
    expect(data.simulationVersion).toBe(sourceSimulationVersion(f.manifest.files));
    expect(await loadServerSourceMap(f.path)).toBe(data);
  });
  it('rejects corrupt bytes then permits a corrected retry without retaining a rejected cache entry',async()=>{
    const f=await fixture(),original=f.manifest.files.collision.sha256;
    f.manifest.files.collision.sha256='0'.repeat(64);await writeFile(f.path,JSON.stringify(f.manifest));
    await expect(loadServerSourceMap(f.path)).rejects.toThrow('checksum differs: collision');
    f.manifest.files.collision.sha256=original;await writeFile(f.path,JSON.stringify(f.manifest));
    await expect(loadServerSourceMap(f.path)).resolves.toHaveProperty('collision');
  });
  it('does not read a layer outside the staged directory',async()=>{
    const f=await fixture();f.manifest.files.level.url='../level.json';await writeFile(f.path,JSON.stringify(f.manifest));
    await expect(loadServerSourceMap(f.path)).rejects.toThrow('inside its staged directory');
  });
});
