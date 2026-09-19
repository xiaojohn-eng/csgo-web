import {build} from 'esbuild';
await build({entryPoints:['scripts/preview-source-dust2.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',
  external:['three','three/*'],outfile:'.reference-assets/source-exports/dust2-runtime/preview-source-dust2.js'});
