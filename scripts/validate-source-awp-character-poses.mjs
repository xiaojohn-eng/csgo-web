/** Reuse all original frame/IBM/ray-pose conformance assertions for AWP data. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let source=fs.readFileSync(path.join(root,'scripts/validate-source-pistol-character-pose.ts'),'utf8');
for(const[a,b]of [[".reference-assets/source-exports/pistol-candidates/character-",".reference-assets/source-exports/awp-character-candidates/character-"],["+'-pistol')","+'-awp-family')"]]){
 if(!source.includes(a))throw Error('Shared conformance script changed: '+a);source=source.replaceAll(a,b);
}
const generated=path.join(root,'output/awp-character-conformance.ts');fs.writeFileSync(generated,source);
for(const team of ['t','ct']){
 const result=spawnSync(path.join(root,'node_modules/.bin/tsx'),[generated,team],{cwd:root,encoding:'utf8',maxBuffer:8e6});
 fs.writeFileSync(path.join(root,`output/awp-character-${team}-conformance.log`),result.stdout+result.stderr);
 if(result.status!==0)throw Error(`AWP ${team} original conformance failed: `+result.stdout+result.stderr);
 console.log(`AWP ${team} original frame/IBM conformance passed`);
}
