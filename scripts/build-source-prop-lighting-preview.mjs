import {build} from 'esbuild';
await build({entryPoints:['scripts/preview-source-prop-lighting.ts'],bundle:true,format:'esm',platform:'browser',
  target:'es2022',external:['three'],outfile:'.reference-assets/source-exports/dust2-vhv/remap/preview-source-prop-lighting.js'});
