import {createHash} from 'node:crypto';
import {createReadStream, constants} from 'node:fs';
import {copyFile, lstat, mkdir, readdir, realpath, readFile, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';

export const ASSET_POLICY = Object.freeze({
  id: 'source-r4-public-v1',
  include: ['source/csgo-12426148', 'audio', 'images', 'favicon.svg'],
  scope: 'Conservative R4 public resource superset; inclusion is not proof of runtime draw coverage.',
  excluded: ['.reference-assets', '.tools', 'node_modules', 'public/models', 'public/textures', 'R3 releases'],
});
export const MANIFEST_NAME = 'runtime-manifest.json';
export const R4_REQUIRED_MANIFESTS = [
  'dust2/manifest.json', 'character-ak/manifest.json', 'character-ct-ak/manifest.json',
  ...['m4','glock','usp','deagle','awp'].flatMap(weapon => ['t','ct'].map(team=>`character-${team}-${weapon}/manifest.json`)),
  'environment-probes/manifest.json', 'grenade-models/manifest.json', 'skin-previews-20260913/index.json',
].map(path=>'source/csgo-12426148/'+path);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function safeRelative(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') ||
      path.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f]/.test(path))
    throw Error(`Unsafe relative path: ${JSON.stringify(path)}`);
  return path;
}
export function inside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}
// Destination trees must never route through a symlink to a running release.
export async function assertNoSymlinks(root, path) {
  const base = await realpath(root);
  if (resolve(root) !== base) throw Error(`Root must be canonical: ${root}`);
  if (resolve(path) !== base && !inside(base, path)) throw Error(`Outside root: ${path}`);
  let cursor = base;
  for (const part of relative(base, resolve(path)).split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    try { if ((await lstat(cursor)).isSymbolicLink()) throw Error(`Symlink forbidden: ${cursor}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
export async function regularFiles(root, prefix = '') {
  const at = resolve(root, prefix), stat = await lstat(at);
  if (stat.isSymbolicLink()) throw Error(`Symlink forbidden: ${at}`);
  if (stat.isFile()) return [safeRelative(prefix)];
  if (!stat.isDirectory()) throw Error(`Not a regular file or directory: ${at}`);
  const result = [];
  for (const name of (await readdir(at)).sort()) {
    if (name === '.DS_Store') continue;
    result.push(...await regularFiles(root, prefix ? `${prefix}/${name}` : name));
  }
  return result;
}
export async function hashFile(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) throw Error(`Not a regular file: ${path}`);
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  const after = await lstat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino)
    throw Error(`File changed while hashing: ${path}`);
  return {bytes: before.size, sha256: hash.digest('hex')};
}
export async function copyRuntimeAssets(publicRoot, webRoot) {
  publicRoot = await realpath(publicRoot);
  const entries = [];
  for (const include of ASSET_POLICY.include) {
    await assertNoSymlinks(publicRoot, resolve(publicRoot, include));
    const paths = await regularFiles(publicRoot, include);
    if (!paths.length) throw Error(`Empty required asset group: ${include}`);
    for (const path of paths) {
      const from = resolve(publicRoot, path), to = resolve(webRoot, path);
      const original = await hashFile(from);
      await assertNoSymlinks(webRoot, to);
      await mkdir(dirname(to), {recursive: true});
      // APFS may clone storage, but never hardlink mutable public files into a release.
      await copyFile(from, to, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
      const copied = await hashFile(to);
      if (copied.sha256 !== original.sha256) throw Error(`Asset changed during copy: ${path}`);
      entries.push({path, ...copied});
    }
  }
  entries.sort((a,b) => a.path.localeCompare(b.path, 'en'));
  return {policy: ASSET_POLICY, publicRoot, count: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    fileListSha256: sha256(JSON.stringify(entries)), files: entries};
}
// Cross-check principal runtime manifests against the copied bytes, rather than
// merely producing a self-consistent hash inventory of an incomplete input directory.
export async function verifyDeclaredAssets(webRoot, files, manifestPaths = R4_REQUIRED_MANIFESTS) {
  const copied = new Map(files.map(file=>[file.path,file]));
  let referencedFiles = 0;
  const unique = new Set(), unconsumedDeclarations = [];
  for(const manifestPath of manifestPaths) {
    safeRelative(manifestPath);
    if(!copied.has(manifestPath)) throw Error(`Required R4 manifest missing: ${manifestPath}`);
    const data = JSON.parse(await readFile(resolve(webRoot,manifestPath),'utf8'));
    const records = [
      ...Object.entries(data.files ?? {}).map(([key,value])=>({...value,key,local:value.url ?? value.path ?? key})),
      ...(data.records ?? []).map(value=>({...value,local:value.path})),
      ...(data.images ?? []).map(value=>({...value,local:value.file})),
    ];
    if(!records.length) throw Error(`No recognized file declarations: ${manifestPath}`);
    for(const record of records) {
      safeRelative(record.local);
      const path = relative(webRoot,resolve(webRoot,dirname(manifestPath),record.local)).split(sep).join('/');
      safeRelative(path);
      const actual=copied.get(path);
      // source-dust2.ts FileKey and its actual bytes() requests exclude this
      // legacy descriptor. Lighting comes from compiled source-environment.ts.
      // Preserve the discrepancy visibly; all copied bytes remain SHA inventoried.
      if(manifestPath==='source/csgo-12426148/dust2/manifest.json' && record.key==='environment') {
        unconsumedDeclarations.push({manifestPath,path,declared:{bytes:record.bytes,sha256:record.sha256},actual,
          matches:!!actual&&actual.bytes===record.bytes&&actual.sha256===record.sha256,
          reason:'Not a source-dust2.ts FileKey or runtime request; environment uses compiled source-environment.ts.'});
        continue;
      }
      if(!actual || actual.bytes!==record.bytes || actual.sha256!==record.sha256)
        throw Error(`Declared resource missing or SHA mismatch: ${manifestPath} → ${record.local}`);
      referencedFiles++;
      unique.add(path);
    }
  }
  return {manifestCount:manifestPaths.length, referencedFiles,uniqueReferencedFiles:unique.size,unconsumedDeclarations,
    scope:'Principal map, character, probe-record, grenade and gallery manifest declarations; not exhaustive proof of all dynamic URL branches or actual GPU loads.'};
}
export async function createRuntimeManifest(candidate, metadata) {
  const files = [];
  for (const prefix of ['web', 'server', 'package.json', 'package-lock.json']) {
    for (const path of await regularFiles(candidate, prefix))
      files.push({path, ...await hashFile(resolve(candidate, path))});
  }
  files.sort((a,b) => a.path.localeCompare(b.path, 'en'));
  const manifest = {...metadata, schema: 1, profile: 'source-r4', createdAt: new Date().toISOString(),
    files, count: files.length, bytes: files.reduce((n, file) => n + file.bytes, 0),
    fileListSha256: sha256(JSON.stringify(files))};
  await writeFile(resolve(candidate, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n', {flag:'wx'});
  return manifest;
}
export async function verifyRuntimeManifest(candidate, expectedManifestSha256) {
  candidate = await realpath(candidate);
  const raw = await readFile(resolve(candidate, MANIFEST_NAME));
  if (expectedManifestSha256 && sha256(raw) !== expectedManifestSha256) throw Error('Manifest receipt SHA mismatch');
  const manifest = JSON.parse(raw.toString());
  if (manifest.schema !== 1 || manifest.profile !== 'source-r4' || !Array.isArray(manifest.files))
    throw Error('Invalid R4 runtime manifest');
  const seen = new Set(), errors = [];
  let total = 0;
  for (const file of manifest.files) {
    safeRelative(file.path);
    if (!/^(web\/|server\/|package(?:-lock)?\.json$)/.test(file.path)) throw Error(`Non-runtime path: ${file.path}`);
    if (seen.has(file.path)) throw Error(`Duplicate manifest path: ${file.path}`);
    seen.add(file.path);
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0)
      throw Error(`Invalid hash or size: ${file.path}`);
    try {
      await assertNoSymlinks(candidate, resolve(candidate, file.path));
      const actual = await hashFile(resolve(candidate, file.path));
      if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes) errors.push(`Mismatch: ${file.path}`);
    } catch (error) { errors.push(`${file.path}: ${error.message}`); }
    total += file.bytes;
  }
  const actualPaths = [];
  for (const prefix of ['web', 'server', 'package.json', 'package-lock.json']) {
    try { actualPaths.push(...await regularFiles(candidate, prefix)); }
    catch (error) { errors.push(error.message); }
  }
  for (const path of actualPaths) if (!seen.has(path)) errors.push(`Unlisted runtime file: ${path}`);
  if (manifest.count !== seen.size || manifest.bytes !== total || manifest.fileListSha256 !== sha256(JSON.stringify(manifest.files)))
    errors.push('Manifest totals or file-list SHA mismatch');
  for (const entry of ['web/index.html', 'server/server/index.js']) if (!seen.has(entry)) errors.push(`Missing entry: ${entry}`);
  if (errors.length) throw Error(`Runtime verification failed (${errors.length}):\n${errors.slice(0,20).join('\n')}`);
  return {passed: true, profile: manifest.profile, count: seen.size, bytes: total,
    manifestSha256: sha256(raw), fileListSha256: manifest.fileListSha256};
}
