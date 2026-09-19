#!/usr/bin/env node
import {spawn, execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {copyFile, lstat, mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {resolve, dirname, basename, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {ASSET_POLICY, MANIFEST_NAME, assertNoSymlinks, copyRuntimeAssets, createRuntimeManifest,
  hashFile, sha256, verifyDeclaredAssets, verifyRuntimeManifest} from './source-runtime-assets.mjs';

export const PROFILE = 'source-r4';
const ownRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = value => JSON.stringify(value, null, 2) + '\n';
const timestampId = () => `r4-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
export function validateId(id) {
  if (typeof id !== 'string' || !/^r4-[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(id) || id.includes('..'))
    throw Error('Candidate id must be r4- followed by 1–100 letters, digits, dot, dash or underscore; no ..');
  return id;
}
export async function assertCandidate(root, candidate) {
  const canonical = await realpath(root);
  if (canonical !== resolve(root)) throw Error('Repository root must be canonical');
  const id = validateId(basename(candidate));
  if (resolve(candidate) !== resolve(root, 'release/source-candidates', id))
    throw Error('Candidate must be a direct child of release/source-candidates; active R3/R4 paths are forbidden');
  await assertNoSymlinks(root, candidate);
  return id;
}
function git(root, args) {
  return execFileSync('git', ['-C',root,...args], {encoding:'utf8', maxBuffer:32*1024*1024}).trim();
}
function provenance(root) {
  const status = git(root,['status','--porcelain=v1','--untracked-files=all']);
  return {commit:git(root,['rev-parse','HEAD']), branch:git(root,['rev-parse','--abbrev-ref','HEAD']),
    clean: status === '', status, trackedDiffSha256:sha256(git(root,['diff','HEAD','--binary'])), node:process.version};
}
export function checkCommands(root, candidate, testFiles = []) {
  return [
    {name:'typecheck', executable:process.execPath, args:[resolve(root,'node_modules/typescript/bin/tsc'),'--noEmit','--incremental','false']},
    {name:'tests', executable:process.execPath, args:[resolve(root,'node_modules/vitest/vitest.mjs'),'run',...testFiles,
      '--reporter=json',`--outputFile=${resolve(candidate,'checks/vitest.json')}`]},
  ];
}
export function buildCommands(root, candidate) {
  return [
    {name:'web-build', executable:process.execPath, args:[resolve(root,'scripts/source-release-build.mjs'),root,candidate]},
    {name:'server-build', executable:process.execPath, args:[resolve(root,'node_modules/typescript/bin/tsc'),
      '--project',resolve(root,'tsconfig.server.json'),'--outDir',resolve(candidate,'server')]},
  ];
}
async function runLogged(command, root, candidate) {
  const log = resolve(candidate, 'checks', `${command.name}.log`);
  const startedAt = new Date().toISOString();
  process.stdout.write(`[source-release] ${command.name} → ${log}\n`);
  const stream = createWriteStream(log, {flags:'wx'});
  const result = await new Promise((done,reject) => {
    const child = spawn(command.executable, command.args, {cwd:root,
      env:{...process.env,CSGO_BUILD_PROFILE:'source'}, stdio:['ignore','pipe','pipe']});
    child.stdout.pipe(stream,{end:false}); child.stderr.pipe(stream,{end:false});
    child.once('error',reject);
    child.once('close',(code,signal)=>done({code,signal}));
    stream.once('error',error=>{child.kill('SIGTERM');reject(error);});
  }).finally(()=>new Promise(done=>stream.end(done)));
  const receipt = {...command, log:relative(candidate,log), startedAt, finishedAt:new Date().toISOString(), ...result};
  if (result.code !== 0) throw Error(`${command.name} failed (${result.code ?? result.signal}); see ${log}`);
  return receipt;
}
export async function stage({root = ownRoot, id = timestampId(), publicRoot = resolve(root,'public'), check = false, testFiles = []} = {}) {
  root = await realpath(root);
  if(check && !testFiles.length && await realpath(publicRoot) !== await realpath(resolve(root,'public')))
    throw Error('Full source:check must package the same public directory used by its tests; a different --public-root is allowed only for stage/targeted checks');
  const candidate = resolve(root,'release/source-candidates',validateId(id));
  await assertCandidate(root,candidate);
  await mkdir(dirname(candidate),{recursive:true});
  await mkdir(candidate); // Exclusive: even an empty existing directory is never reused.
  await mkdir(resolve(candidate,'checks'));
  const receipt = {schema:1, profile:PROFILE, id, createdAt:new Date().toISOString(), status:'building',
    source:provenance(root), dependencies:{bundled:false, resolution:'Existing repository node_modules; lockfile must match at promotion.'},
    validation:{typecheck:false, tests:'not-run', testFiles, build:false, assets:false, browser:false, lan:false}, commands:[]};
  const receiptPath = resolve(candidate,'candidate.json');
  const save = () => writeFile(receiptPath,json(receipt));
  await save();
  try {
    if(check) {
      for(const command of checkCommands(root,candidate,testFiles)) receipt.commands.push(await runLogged(command,root,candidate));
      receipt.validation.typecheck = true;
      const tests = JSON.parse(await readFile(resolve(candidate,'checks/vitest.json'),'utf8'));
      if (!tests.success || tests.numFailedTests || !tests.numTotalTests) throw Error('Vitest JSON did not confirm a non-empty successful run');
      receipt.validation.tests = testFiles.length ? 'targeted-passed' : 'full-passed';
      receipt.validation.testCount = tests.numTotalTests;
      receipt.validation.passedTests = tests.numPassedTests;
      receipt.validation.pendingTests = tests.numPendingTests;
    }
    for(const command of buildCommands(root,candidate)) receipt.commands.push(await runLogged(command,root,candidate));
    receipt.validation.build = true;
    process.stdout.write('[source-release] Copying and hashing R4 public assets (no reference depot or R3 models/textures)\n');
    const assets = await copyRuntimeAssets(publicRoot,resolve(candidate,'web'));
    receipt.declaredAssets = await verifyDeclaredAssets(resolve(candidate,'web'),assets.files);
    await writeFile(resolve(candidate,'checks/public-assets.json'),json(assets),{flag:'wx'});
    for(const file of ['package.json','package-lock.json']) await copyFile(resolve(root,file),resolve(candidate,file));
    const after = provenance(root);
    if (after.commit !== receipt.source.commit || after.status !== receipt.source.status || after.trackedDiffSha256 !== receipt.source.trackedDiffSha256)
      throw Error('Source tree changed during candidate construction; candidate retained but rejected');
    const manifest = await createRuntimeManifest(candidate,{source:receipt.source,
      assetPolicy:ASSET_POLICY, publicAssets:{count:assets.count,bytes:assets.bytes,fileListSha256:assets.fileListSha256},
      dependencyLockSha256:(await hashFile(resolve(candidate,'package-lock.json'))).sha256});
    receipt.manifestSha256 = (await hashFile(resolve(candidate,MANIFEST_NAME))).sha256;
    receipt.runtime = await verifyRuntimeManifest(candidate,receipt.manifestSha256);
    receipt.validation.assets = true;
    receipt.status = 'staged'; receipt.finishedAt = new Date().toISOString();
    await save();
    return {candidate, ...receipt, runtimeFiles:manifest.count, runtimeBytes:manifest.bytes};
  } catch(error) {
    receipt.status = 'failed'; receipt.error = error.message; receipt.finishedAt = new Date().toISOString();
    await save(); throw error;
  }
}
export async function verifyCandidate(candidate) {
  // Accepts an activated/backup release as well as a candidate, but only reads.
  const stat = await lstat(candidate);
  if (stat.isSymbolicLink()) throw Error('Release symlink is not supported by this directory-swap workflow');
  const receipt = JSON.parse(await readFile(resolve(candidate,'candidate.json'),'utf8'));
  if (receipt.schema !== 1 || receipt.profile !== PROFILE || receipt.status !== 'staged' || !/^[0-9a-f]{64}$/.test(receipt.manifestSha256))
    throw Error('Candidate is not a completed R4 stage');
  return {receipt, runtime:await verifyRuntimeManifest(candidate,receipt.manifestSha256)};
}
const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
function renameCommand(from,to) {
  // fs.rename avoids mv's surprising "put source inside existing directory" behavior.
  // This is printed for reviewed, sequential use; no release command executes it.
  const code="import {lstatSync,renameSync} from 'node:fs';const [from,to]=process.argv.slice(1);let exists=false;try{lstatSync(to);exists=true}catch(e){if(e.code!=='ENOENT')throw e}if(exists)throw Error('Destination already exists: '+to);const stat=lstatSync(from);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Expected a real directory');renameSync(from,to);";
  return `${shellQuote(process.execPath)} --input-type=module -e ${shellQuote(code)} -- ${shellQuote(from)} ${shellQuote(to)}`;
}
export function operationPlan(serviceRoot, candidate, id) {
  validateId(id);
  const active = resolve(serviceRoot,'release/source-r4');
  const backup = resolve(serviceRoot,`release/source-r4-backups/${id}-previous`);
  const rejected = resolve(serviceRoot,`release/source-r4-backups/${id}-rejected`);
  const service = `env PORT=27019 ${shellQuote(process.execPath)} ${shellQuote(resolve(serviceRoot,'scripts/lan-service.mjs'))}`;
  const verify = location => `${shellQuote(process.execPath)} ${shellQuote(resolve(serviceRoot,'scripts/source-release.mjs'))} verify --candidate ${shellQuote(location)}`;
  return {active,backup,rejected,
    promotion:[`${service} stop source`,
      `mkdir -p ${shellQuote(dirname(backup))}`,
      renameCommand(active,backup),
      renameCommand(candidate,active),
      verify(active), `${service} start source`, `${service} status source`],
    rollback:[`${service} stop source`,
      renameCommand(active,rejected),
      renameCommand(backup,active),
      `${service} start source`, `${service} status source`],
    warning:'Review and run each line only after the previous step succeeds, with no concurrent release/start operations. Each directory rename is atomic on one filesystem; the whole stop/rename/start sequence is not. Do not paste as an unattended batch. Re-run preflight immediately before stopping. On promotion failure preserve both directories and restore previous before restarting.',
    automaticExecution:false};
}
export async function preflight({candidate, serviceRoot = ownRoot, checkHealth = true}) {
  serviceRoot = await realpath(serviceRoot);
  if (resolve(candidate) !== await realpath(candidate) || basename(dirname(candidate)) !== 'source-candidates')
    throw Error('Preflight accepts only canonical paths in a source-candidates directory');
  const {receipt,runtime} = await verifyCandidate(candidate);
  if (basename(candidate) !== receipt.id) throw Error('Candidate directory/id mismatch');
  const plan = operationPlan(serviceRoot,resolve(candidate),receipt.id);
  const blockers = [], inspectedAt = new Date().toISOString();
  if (!receipt.source.clean) blockers.push('Candidate was built from a dirty source tree');
  if (!receipt.validation.typecheck || receipt.validation.tests !== 'full-passed') blockers.push('Complete source:check is not recorded');
  for(const path of [plan.active,plan.backup,plan.rejected]) await assertNoSymlinks(serviceRoot,path);
  for(const path of [plan.backup,plan.rejected]) {
    try { await lstat(path); blockers.push(`Rollback destination already exists: ${path}`); }
    catch(error) { if(error.code !== 'ENOENT') throw error; }
  }
  if (resolve(candidate) === plan.active || resolve(candidate) === plan.backup || resolve(candidate) === plan.rejected)
    throw Error('Preflight requires a separate candidate, never the active or rollback directory');
  const dependencies = {bundled:false, lockMatches:(await hashFile(resolve(serviceRoot,'package-lock.json'))).sha256 ===
    (await hashFile(resolve(candidate,'package-lock.json'))).sha256};
  if(!dependencies.lockMatches) blockers.push('Target repository package-lock differs; dependency installation needs separate verification');
  for(const name of ['lan-service.mjs','source-release.mjs']) {
    try { if(!(await lstat(resolve(serviceRoot,'scripts',name))).isFile()) throw Error('not a regular file'); }
    catch { blockers.push(`Target operation script is missing: scripts/${name}`); }
  }
  const current = {state:null, ownsProcess:false, health:null, entry:null, index:null};
  try {
    const state = JSON.parse(await readFile(resolve(serviceRoot,'.lan-source-service/state.json'),'utf8'));
    current.state = state;
    const expectedEntry = resolve(plan.active,'server/server/index.js');
    let fingerprint = '';
    if (Number.isSafeInteger(state.pid) && state.pid > 0)
      try { fingerprint = execFileSync('/bin/ps',['-p',String(state.pid),'-o','lstart=','-o','args='],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); } catch { /* not running */ }
    current.ownsProcess = state.root === serviceRoot && state.entry === expectedEntry && state.port === 27019 &&
      state.protocol === 'csgo-web-r4' && typeof state.instanceId === 'string' && !!fingerprint &&
      state.fingerprint === fingerprint && fingerprint.includes(expectedEntry);
    if(!current.ownsProcess) blockers.push('R4 process/state ownership does not match; do not stop or replace it');
    if(checkHealth && current.ownsProcess) {
      try { const response = await fetch('http://127.0.0.1:27019/health',{signal:AbortSignal.timeout(2000)});
        current.health = response.ok ? await response.json() : null; } catch { /* reported below */ }
      if(current.health?.instanceId !== state.instanceId || current.health?.version !== 'csgo-web-r4') blockers.push('R4 health identity does not match');
    } else blockers.push('Live R4 health identity was not checked');
    current.entry = await hashFile(expectedEntry);
    current.index = await hashFile(resolve(plan.active,'web/index.html'));
    const a = await lstat(plan.active), b = await lstat(candidate);
    if(a.dev !== b.dev) blockers.push('Candidate and active release are not on the same filesystem; directory rename is not safe');
  } catch(error) { blockers.push(`Cannot validate active R4: ${error.message}`); }
  return {schema:1,profile:PROFILE,inspectedAt,candidate:resolve(candidate),
    runtime,dependencies,current,blockers,readyForOperatorReview:blockers.length===0,
    acceptance:{browser:receipt.validation.browser,lan:receipt.validation.lan,
      note:'Build/SHA checks do not prove gameplay, GPU output, or two-device LAN acceptance; attach those receipts separately.'},plan};
}
function parseArgs(args) {
  const options = {testFiles:[]};
  for(let i=0;i<args.length;i++) {
    const key=args[i];
    if(!['--id','--public-root','--candidate','--service-root','--test-file'].includes(key) || !args[i+1] || args[i+1].startsWith('--'))
      throw Error(`Unknown or incomplete option: ${key}`);
    const value=args[++i];
    if(key==='--test-file') options.testFiles.push(value);
    else options[{'--id':'id','--public-root':'publicRoot','--candidate':'candidate','--service-root':'serviceRoot'}[key]]=value;
  }
  return options;
}
export async function main(args=process.argv.slice(2)) {
  const [action,...rest]=args, options=parseArgs(rest);
  if(action==='stage'||action==='check') {
    if(options.candidate||options.serviceRoot) throw Error('stage/check use only the script repository and a new candidate id');
    if(action==='stage'&&options.testFiles.length) throw Error('--test-file requires check');
    console.log(json(await stage({...options,check:action==='check'})));
  } else if(action==='verify'||action==='preflight'||action==='plan') {
    if(!options.candidate||options.id||options.publicRoot||options.testFiles.length) throw Error(`${action} needs --candidate and optional --service-root`);
    if(action==='verify') console.log(json(await verifyCandidate(resolve(options.candidate))));
    else { const report=await preflight({...options,candidate:resolve(options.candidate)});console.log(json(report));if(report.blockers.length)process.exitCode=2; }
  } else throw Error('Usage: source-release.mjs check|stage [--id r4-NAME] [--public-root PATH] [--test-file PATH]; verify|preflight|plan --candidate PATH [--service-root PATH]. No command activates or stops a service.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error(`[source-release] ${error.message}`);process.exitCode=1;});
