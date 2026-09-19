import {mkdtemp, mkdir, readFile, writeFile, symlink, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {ASSET_POLICY, copyRuntimeAssets, createRuntimeManifest, hashFile, safeRelative, verifyDeclaredAssets, verifyRuntimeManifest} from '../scripts/source-runtime-assets.mjs';
import {assertCandidate, buildCommands, checkCommands, operationPlan, preflight, stage, validateId, verifyCandidate} from '../scripts/source-release.mjs';

const roots:string[]=[];
async function fixture(){
  const root=await mkdtemp(resolve(tmpdir(),'csgo-r4-release-'));roots.push(root);
  // macOS /var is a symlink; tools intentionally require canonical roots.
  const {realpath}=await import('node:fs/promises');return realpath(root);
}
async function put(root:string,path:string,body='fixture'){
  const full=resolve(root,path);await mkdir(dirname(full),{recursive:true});await writeFile(full,body);return full;
}
async function runtime(root:string){
  for(const path of ['web/index.html','web/assets/app.js','server/server/index.js','package.json','package-lock.json'])await put(root,path);
}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

it.each(['../source-r4','r4-../active','source-r4','r4-x/y','r4-x\\y','r4-x\n'])('refuses unsafe/reserved candidate id %j',id=>{
  expect(()=>validateId(id)).toThrow();
});
it('confines both build commands to one new R4 candidate, never default R3 or the active R4',async()=>{
  const root=await fixture(),candidate=resolve(root,'release/source-candidates/r4-test');
  await expect(assertCandidate(root,candidate)).resolves.toBe('r4-test');
  for(const path of ['release/web','release/source-r4','release/source-candidates/r4-test/nested'])
    await expect(assertCandidate(root,resolve(root,path))).rejects.toThrow();
  const builds=buildCommands(root,candidate),checks=checkCommands(root,candidate,['tests/source-release.test.ts']);
  expect(builds[0].args).toEqual([resolve(root,'scripts/source-release-build.mjs'),root,candidate]);
  expect(builds[1].args.slice(-2)).toEqual(['--outDir',resolve(candidate,'server')]);
  expect(checks[0].args).toContain('--noEmit');expect(checks[0].args).toContain('--incremental');
  expect(checks[1].args).toContain('tests/source-release.test.ts');
  expect(JSON.stringify([...builds,...checks])).not.toMatch(/npm|build:standalone|release\/web/);
});
it('rejects a candidate parent symlink to the running directory',async()=>{
  const root=await fixture();await mkdir(resolve(root,'release/source-r4'),{recursive:true});
  await symlink(resolve(root,'release/source-r4'),resolve(root,'release/source-candidates'));
  await expect(assertCandidate(root,resolve(root,'release/source-candidates/r4-test'))).rejects.toThrow('Symlink forbidden');
});
it('will not reuse even an empty candidate or alter existing R3/R4 content',async()=>{
  const root=await fixture(),candidate=resolve(root,'release/source-candidates/r4-test');
  await mkdir(candidate,{recursive:true});
  await put(root,'release/web/index.html','R3 unchanged');await put(root,'release/source-r4/web/index.html','R4 unchanged');
  await expect(stage({root,id:'r4-test'})).rejects.toThrow();
  expect(await readFile(resolve(root,'release/web/index.html'),'utf8')).toBe('R3 unchanged');
  expect(await readFile(resolve(root,'release/source-r4/web/index.html'),'utf8')).toBe('R4 unchanged');
});
it('copies only the explicit R4 public groups without hardlinks or reference/R3 payloads',async()=>{
  const root=await fixture(),publicRoot=resolve(root,'public'),web=resolve(root,'web');await mkdir(web);
  await put(publicRoot,'source/csgo-12426148/test.bin','source bytes');await put(publicRoot,'audio/step1.wav');
  await put(publicRoot,'images/menu.png');await put(publicRoot,'favicon.svg');
  await put(publicRoot,'models/R3.glb');await put(publicRoot,'textures/R3.png');await put(publicRoot,'.reference-assets/depot.vpk');
  const receipt=await copyRuntimeAssets(publicRoot,web);
  expect(receipt.count).toBe(4);expect(receipt.policy).toEqual(ASSET_POLICY);
  expect(receipt.files.map(file=>file.path)).not.toEqual(expect.arrayContaining(['models/R3.glb','textures/R3.png','.reference-assets/depot.vpk']));
  const src=resolve(publicRoot,'source/csgo-12426148/test.bin'),copy=resolve(web,'source/csgo-12426148/test.bin');
  expect((await stat(copy)).ino).not.toBe((await stat(src)).ino);
  await writeFile(src,'changed public source');expect(await readFile(copy,'utf8')).toBe('source bytes');
});
it('fails on missing required public resources instead of emitting an incomplete success',async()=>{
  const root=await fixture();await mkdir(resolve(root,'public'));await mkdir(resolve(root,'web'));
  await expect(copyRuntimeAssets(resolve(root,'public'),resolve(root,'web'))).rejects.toThrow();
});
it('rejects symlinked runtime inputs and destination escape routes',async()=>{
  const root=await fixture();await put(root,'public/source/csgo-12426148/a.bin');await mkdir(resolve(root,'web'));
  await symlink(resolve(root,'public'),resolve(root,'web/source'));
  await expect(copyRuntimeAssets(resolve(root,'public'),resolve(root,'web'))).rejects.toThrow('Symlink forbidden');
  await rm(resolve(root,'web/source'));await symlink('/etc/passwd',resolve(root,'public/source/csgo-12426148/leak'));
  await expect(copyRuntimeAssets(resolve(root,'public'),resolve(root,'web'))).rejects.toThrow('Symlink forbidden');
});
it('rejects alternate public inputs for a full check, so tests and packaged assets cannot silently differ',async()=>{
  const root=await fixture();await mkdir(resolve(root,'public'));await mkdir(resolve(root,'other-public'));
  await expect(stage({root,check:true,publicRoot:resolve(root,'other-public')})).rejects.toThrow('same public directory');
  await expect(stat(resolve(root,'release'))).rejects.toThrow();
});
it('checks declared native resource hashes, not just hashes of whatever files happened to be copied',async()=>{
  const root=await fixture();await put(root,'test/asset.bin','original bytes');
  const asset={path:'test/asset.bin',...await hashFile(resolve(root,'test/asset.bin'))};
  await put(root,'test/manifest.json',JSON.stringify({files:{model:{url:'asset.bin',bytes:asset.bytes,sha256:asset.sha256}}}));
  const files=[asset,{path:'test/manifest.json',...await hashFile(resolve(root,'test/manifest.json'))}];
  expect((await verifyDeclaredAssets(root,files,['test/manifest.json'])).referencedFiles).toBe(1);
  await expect(verifyDeclaredAssets(root,[{...asset,sha256:'0'.repeat(64)},files[1]],['test/manifest.json'])).rejects.toThrow('SHA mismatch');
  await expect(verifyDeclaredAssets(root,[files[1]],['test/manifest.json'])).rejects.toThrow('missing or SHA');
  await expect(verifyDeclaredAssets(root,files,['missing.json'])).rejects.toThrow('Required R4 manifest missing');
});
it('records the unused old Dust2 environment descriptor separately, with a runtime FileKey evidence guard',async()=>{
  const source=await readFile(new URL('../game/source-dust2.ts',import.meta.url),'utf8');
  const keys=source.match(/type FileKey=([^;]+);/)?.[1];expect(keys).toBeTruthy();expect(keys).not.toContain("'environment'");
  expect(source).toContain("import {SOURCE_DUST2_ENVIRONMENT} from './source-environment.js'");
  const root=await fixture(),path='source/csgo-12426148/dust2/manifest.json';
  await put(root,path,JSON.stringify({files:{environment:{url:'environment.json',bytes:1,sha256:'0'.repeat(64)}}}));
  const result=await verifyDeclaredAssets(root,[{path,...await hashFile(resolve(root,path))}],[path]);
  expect(result.referencedFiles).toBe(0);expect(result.unconsumedDeclarations[0].matches).toBe(false);
  expect(result.unconsumedDeclarations[0].declared.sha256).toBe('0'.repeat(64));
});
it('verifies every runtime byte, counts and entry points, and detects tampering, additions and deletion',async()=>{
  const root=await fixture();await runtime(root);
  const manifest=await createRuntimeManifest(root,{source:{commit:'test'}}),original=await hashFile(resolve(root,'runtime-manifest.json'));
  expect(manifest.count).toBe(5);expect((await verifyRuntimeManifest(root,original.sha256)).passed).toBe(true);
  await put(root,'web/assets/app.js','modified');await expect(verifyRuntimeManifest(root)).rejects.toThrow('Mismatch: web/assets/app.js');
  await put(root,'web/assets/app.js');await put(root,'web/extra.js');await expect(verifyRuntimeManifest(root)).rejects.toThrow('Unlisted runtime file');
  await rm(resolve(root,'web/extra.js'));await rm(resolve(root,'server/server/index.js'));
  await expect(verifyRuntimeManifest(root)).rejects.toThrow('server/server/index.js');
});
it('pins the complete manifest to the candidate receipt and refuses forged paths/duplicates',async()=>{
  const root=await fixture();await runtime(root);const manifest=await createRuntimeManifest(root,{});
  const path=resolve(root,'runtime-manifest.json'),before=await hashFile(path);
  manifest.files.push({...manifest.files[0]});await writeFile(path,JSON.stringify(manifest));
  await expect(verifyRuntimeManifest(root,before.sha256)).rejects.toThrow('receipt SHA');
  await expect(verifyRuntimeManifest(root)).rejects.toThrow('Duplicate');
  manifest.files[0].path='../outside';await writeFile(path,JSON.stringify(manifest));
  await expect(verifyRuntimeManifest(root)).rejects.toThrow('Unsafe relative path');
});
it.each(['/etc/passwd','../a','a/../b','a\\b','a//b','a/./b','a\n'])('rejects manifest escape path %j',path=>{
  expect(()=>safeRelative(path)).toThrow();
});
it('rejects a failed/incomplete candidate and does not claim acceptance from SHA alone',async()=>{
  const root=await fixture(),candidate=resolve(root,'release/source-candidates/r4-test');await runtime(candidate);
  await put(candidate,'candidate.json',JSON.stringify({schema:1,profile:'source-r4',status:'failed'}));
  await expect(verifyCandidate(candidate)).rejects.toThrow('completed R4 stage');
});
it('a byte-valid but unchecked candidate is blocked from operator approval; it never creates service state',async()=>{
  const root=await fixture(),candidate=resolve(root,'release/source-candidates/r4-test');await runtime(candidate);
  await put(root,'package-lock.json');await createRuntimeManifest(candidate,{});
  await put(candidate,'candidate.json',JSON.stringify({schema:1,profile:'source-r4',status:'staged',id:'r4-test',
    manifestSha256:(await hashFile(resolve(candidate,'runtime-manifest.json'))).sha256,
    source:{clean:false},validation:{typecheck:false,tests:'not-run',browser:false,lan:false}}));
  const report=await preflight({candidate,serviceRoot:root,checkHealth:false});
  expect(report.readyForOperatorReview).toBe(false);
  expect(report.blockers).toContain('Candidate was built from a dirty source tree');
  expect(report.blockers).toContain('Complete source:check is not recorded');
  expect(report.acceptance.browser).toBe(false);expect(report.plan.automaticExecution).toBe(false);
  await expect(stat(resolve(root,'.lan-source-service'))).rejects.toThrow();
});
it('plans explicit Source-only commands and preserves both previous and rejected releases',()=>{
  const plan=operationPlan('/tmp/repo with space', '/tmp/candidate', 'r4-fixture');
  expect(plan.promotion[0]).toContain('stop source');expect(plan.rollback.at(-1)).toContain('status source');
  expect(plan.backup).toContain('source-r4-backups/r4-fixture-previous');expect(plan.rejected).toContain('r4-fixture-rejected');
  expect(JSON.stringify(plan)).not.toMatch(/rm -|27015|release\/web/);
});
