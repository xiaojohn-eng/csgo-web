#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, existsSync, unlinkSync, renameSync, rmdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[3] === 'source';
if(process.argv[3] && !source)throw Error('未知的服务配置');
const directory = resolve(root, source?'.lan-source-service':'.lan-service');
const stateFile = resolve(directory, 'state.json');
const lockDirectory = resolve(directory, 'lock');
const lockOwnerFile = resolve(lockDirectory, 'owner.json');
const entry = resolve(root, source?'release/source-r4/server/server/index.js':'release/server/server/index.js');
const webRoot = resolve(root, source?'release/source-r4/web':'release/web');
const protocol = source?'csgo-web-r4':'csgo-web-r3';
const action = process.argv[2] || 'start';
const port = Number(process.env.PORT || (source?27019:27015));
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('PORT 必须为 1–65535 的整数');
mkdirSync(directory, { recursive: true });
function fingerprint(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return '';
  try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'args='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}
function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
function owns(state) {
  return state?.root === root && state.entry === entry && typeof state.instanceId === 'string' &&
    !!state.fingerprint && state.fingerprint === fingerprint(state.pid) && state.fingerprint.includes(entry);
}
async function health(servicePort) {
  try {
    const response = await fetch(`http://127.0.0.1:${servicePort}/health`, { signal: AbortSignal.timeout(700) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}
async function info(servicePort) {
  try { return await (await fetch(`http://127.0.0.1:${servicePort}/api/server-info`, { signal: AbortSignal.timeout(700) })).json(); }
  catch { return null; }
}
async function show(state) {
  const details = await info(state.port);
  console.log(`CSGO WEB ${protocol} · PID ${state.pid}`);
  const suffix=source?'?map=de_dust2':'';
  console.log(`本机：http://127.0.0.1:${state.port}/${suffix}`);
  for (const url of details?.lanUrls || []) console.log(`局域网：${url}${suffix}`);
  if (!details?.lanUrls?.length) console.log('当前没有可分享的 LAN IPv4 地址，请连接局域网后重新启动。');
  console.log(`日志：${resolve(directory, 'server.log')}`);
}
async function lock() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      mkdirSync(lockDirectory);
      writeFileSync(lockOwnerFile, JSON.stringify({ pid: process.pid, fingerprint: fingerprint(process.pid) }));
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = readJson(lockOwnerFile);
      if (owner?.fingerprint && fingerprint(owner.pid) !== owner.fingerprint) {
        try { unlinkSync(lockOwnerFile); rmdirSync(lockDirectory); } catch { /* another caller acquired it */ }
      }
      await delay(100);
    }
  }
  throw Error('另一个局域网启停操作尚未结束，请稍后重试。');
}
function unlock() {
  const owner = readJson(lockOwnerFile);
  if (owner?.pid === process.pid) { unlinkSync(lockOwnerFile); rmdirSync(lockDirectory); }
}
async function freePort() {
  const probe = createServer();
  try {
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '0.0.0.0', resolve); });
    await new Promise(resolve => probe.close(resolve));
  } catch (error) {
    if (error.code === 'EADDRINUSE') throw Error(`${port} 已被占用；未接管或停止该服务。`);
    throw error;
  }
}
let locked = false;
try {
  if (!['start', 'stop', 'status'].includes(action)) throw Error('仅支持 start / stop / status');
  await lock(); locked = true;
  const state = readJson(stateFile);
  if (action === 'stop') {
    if (!owns(state)) {
      if (existsSync(stateFile)) unlinkSync(stateFile);
      console.log('服务未运行，未向任何其他进程发送信号。');
    } else {
      process.kill(state.pid, 'SIGTERM');
      for (let count = 0; count < 60 && owns(state); count++) await delay(100);
      if (owns(state)) throw Error('本项目服务尚未退出，已保留状态文件，请检查日志。');
      unlinkSync(stateFile);
      console.log('CSGO WEB 局域网服务已停止。');
    }
  } else if (action === 'status') {
    if (!owns(state)) console.log('服务未运行。');
    else {
      const response = await health(state.port);
      if (response?.instanceId !== state.instanceId || response?.version !== protocol) throw Error('本项目进程存在但健康状态不匹配，请检查日志。');
      await show(state);
    }
  } else if (owns(state)) {
    if (state.port !== port) throw Error(`本项目已在 ${state.port} 运行；先停止后再改端口。`);
    const response = await health(state.port);
    if (response?.instanceId !== state.instanceId || response?.version !== protocol) throw Error('本项目进程存在但健康状态不匹配，请检查日志。');
    await show(state);
  } else {
    await freePort();
    if (!existsSync(entry) || !existsSync(resolve(webRoot, 'index.html')))
      throw Error(`构建文件缺失，请先运行 npm run ${source?'source:build':'build'}。`);
    const instanceId = randomUUID();
    const fd = openSync(resolve(directory, 'server.log'), 'a');
    const child = spawn(process.execPath, [entry], { cwd: root, detached: true,
      env: { ...process.env, HOST: '0.0.0.0', PORT: String(port), NODE_ENV: 'production', WEB_ROOT: webRoot, CSGO_INSTANCE_ID: instanceId },
      stdio: ['ignore', fd, fd] });
    closeSync(fd);
    let spawnError;
    child.on('error', error => { spawnError = error; }); child.unref();
    let launched;
    for (let count = 0; count < 80; count++) {
      await delay(100);
      if (spawnError) throw spawnError;
      const identity = fingerprint(child.pid);
      if (!identity.includes(entry)) break;
      const response = await health(port);
      if (response?.instanceId === instanceId && response?.version === protocol) {
        launched = { root, pid: child.pid, entry, fingerprint: identity, instanceId, port, protocol, startedAt: new Date().toISOString() };
        break;
      }
    }
    if (!launched || !owns(launched)) {
      if (fingerprint(child.pid).includes(entry)) process.kill(child.pid, 'SIGTERM');
      throw Error(`本次启动未通过实例健康检查，请查看 ${resolve(directory,'server.log')}。`);
    }
    try {
      const temporary = stateFile + '.' + process.pid;
      writeFileSync(temporary, JSON.stringify(launched, null, 2)); renameSync(temporary, stateFile);
    } catch (error) { if (owns(launched)) process.kill(launched.pid, 'SIGTERM'); throw error; }
    await show(launched);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (locked) unlock(); }
