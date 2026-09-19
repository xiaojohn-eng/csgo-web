import {readFile} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {DUST2_BSP_SHA256,sourceSimulationVersion} from '../game/source-identity.js';
import type {SourceLevelData} from '../game/source-level.js';
import type {SourceMapCollisionData} from '../game/source-map-collision.js';
import type {SourceNavigationData} from '../game/source-navigation.js';

/** Shared immutable source bytes; each room creates its own Rapier World. The
 * server never needs to parse or allocate the 700 MB visual scene. */
const cache=new Map<string,Promise<{level:SourceLevelData;collision:SourceMapCollisionData;navigation:SourceNavigationData;simulationVersion:string}>>();
export function loadServerSourceMap(manifestPath:string){
  const path=resolve(manifestPath),existing=cache.get(path);if(existing)return existing;
  const pending=(async()=>{
    const manifest=JSON.parse(await readFile(path,'utf8'));
    if(manifest.format!=='source-map-runtime-v1'||manifest.id!=='de_dust2'||manifest.sourceBspSha256!==DUST2_BSP_SHA256)
      throw Error('Server Source map identity differs');
    const base=dirname(path);
    async function json(key:string){
      const f=manifest.files[key];if(!f||typeof f.url!=='string')throw Error('Server Source file receipt missing: '+key);
      const file=resolve(base,f.url);if(!file.startsWith(base+sep))throw Error('Server Source file must be inside its staged directory');
      const bytes=await readFile(file);
      if(bytes.byteLength!==f.bytes||createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('Server Source checksum differs: '+key);
      const data=JSON.parse(new TextDecoder().decode(bytes));
      if(data.sourceBspSha256!==DUST2_BSP_SHA256)throw Error('Server Source layer BSP differs: '+key);
      return data;
    }
    const [level,collision,navigation]=await Promise.all([json('level'),json('collision'),json('navigation')]);
    if(navigation.sourceNavSha256!==level.sourceNavSha256)throw Error('Server Source NAV identity differs');
    return {level,collision,navigation,simulationVersion:sourceSimulationVersion(manifest.files)};
  })();
  cache.set(path,pending);void pending.catch(()=>cache.delete(path));return pending;
}
