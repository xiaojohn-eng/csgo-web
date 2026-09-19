// Child process: preserves the repository config while overriding all output/public writes.
import {build} from 'vite';
import {resolve} from 'node:path';
import {assertCandidate} from './source-release.mjs';
const [root, candidate] = process.argv.slice(2);
if (!root || !candidate) throw Error('Internal build driver needs root and candidate');
await assertCandidate(root,candidate);
process.chdir(root);
process.env.CSGO_BUILD_PROFILE = 'source';
await build({configFile: resolve(root, 'vite.standalone.ts'),
  root: resolve(root, 'standalone'), publicDir: false,
  build: {outDir: resolve(candidate, 'web'), emptyOutDir: false, copyPublicDir: false}});
