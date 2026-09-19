import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateRoot = path.join(root, '.reference-assets');
const app = express();
const port = Number(process.env.CSGO_ASSET_PORT || 27018);
// This inspection service is local only. It neither copies Valve content to the
// game's release tree nor exposes paths outside the explicit asset/tool roots.
app.disable('x-powered-by');
app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.get('/', (_req, res) => res.sendFile(path.join(root, 'scripts/asset-preview.html')));
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three'), {dotfiles:'deny', index:false}));
app.use('/assets', express.static(privateRoot, {dotfiles:'ignore', index:false}));
// Read the already staged, checksum-frozen local Source assets for owner GPU QA.
app.use('/source', express.static(path.join(root,'public/source'), {dotfiles:'deny',index:false}));
app.get('/catalog', async (_req, res) => {
  const assets = [];
  async function walk(directory) {
    let entries;
    try { entries = await fs.readdir(directory, {withFileTypes:true}); } catch { return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        // Raw game installation is not a browser preview asset library.
        if (entry.name !== 'csgo-legacy') await walk(file);
      } else if (entry.isFile() && /\.glb$/i.test(entry.name)) {
        const relative = path.relative(privateRoot, file).split(path.sep).join('/');
        assets.push({name:relative, url:'/assets/' + relative.split('/').map(encodeURIComponent).join('/'), bytes:(await fs.stat(file)).size});
      }
    }
  }
  await walk(privateRoot);
  res.json(assets.sort((a,b) => a.name.localeCompare(b.name)));
});
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`原版资产本机检查：http://127.0.0.1:${port}/`);
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
