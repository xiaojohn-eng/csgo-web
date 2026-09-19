import {build} from 'esbuild';
await build({entryPoints:['scripts/preview-source-lightmaps.ts'],bundle:true,format:'esm',platform:'browser',
  target:'es2022',external:['three'],outfile:'.reference-assets/source-exports/dust2-lightmapped/preview-source-lightmaps.js'});
