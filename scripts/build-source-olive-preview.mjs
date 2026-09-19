import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),out=root+'.reference-assets/source-exports/olive-preview';
await mkdir(out,{recursive:true});
await build({stdin:{contents:"import {createSourceOlivePreview} from './scripts/preview-source-olive'; import {probeSourceOliveTreeswayGPU} from './scripts/probe-source-olive-treesway-gpu'; import {probeSourceOliveTrace} from './scripts/probe-source-olive-trace'; window.__SOURCE_OLIVE__=createSourceOlivePreview(); window.__SOURCE_OLIVE_PROBE__=probeSourceOliveTreeswayGPU; window.__SOURCE_OLIVE_TRACE__=probeSourceOliveTrace;",resolveDir:root,sourcefile:'source-olive-private.ts'},outfile:out+'/preview.js',bundle:true,format:'esm',platform:'browser',target:'es2022'});
await writeFile(out+'/index.html','<!doctype html><html><head><meta charset="utf-8"><title>Original olive material comparison</title><style>html,body{margin:0;background:#111}canvas{display:block}</style></head><body><script type="module" src="./preview.js"></script></body></html>\n');
console.log(out);
