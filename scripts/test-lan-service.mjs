import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || 27015);
const run = (action) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['scripts/lan-service.mjs', action], { cwd, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', value => { text += value; }); child.stderr.on('data', value => { text += value; });
  child.on('error', reject); child.on('exit', code => resolve({ code, text }));
});
const status = await run('status');
assert.equal(status.code, 0, status.text);
assert.match(status.text, /服务未运行/);
const foreign = createServer(socket => socket.end());
await new Promise((resolve, reject) => { foreign.once('error', reject); foreign.listen(port, '0.0.0.0', resolve); });
let blocked;
try {
  blocked = await run('start');
  assert.equal(blocked.code, 1, 'occupied foreign port must reject startup');
  assert.match(blocked.text, /已被占用/);
  assert.equal(foreign.listening, true, 'foreign listener remains alive');
} finally { await new Promise(resolve => foreign.close(resolve)); }
// A stale state naming another command must never signal that command's PID.
await writeFile(new URL('../.lan-service/state.json', import.meta.url), JSON.stringify({
  root: cwd.replace(/\/$/, ''), pid: process.pid, entry: process.execPath,
  fingerprint: 'unrelated-process', instanceId: 'not-our-instance', port,
}));
const staleStop = await run('stop');
assert.equal(staleStop.code, 0, staleStop.text);
assert.match(staleStop.text, /未向任何其他进程发送信号/);
let started;
try {
  started = await run('start');
  assert.equal(started.code, 0, started.text);
  const state = JSON.parse(await readFile(new URL('../.lan-service/state.json', import.meta.url), 'utf8'));
  const again = await run('start');
  assert.equal(again.code, 0, again.text);
  const current = JSON.parse(await readFile(new URL('../.lan-service/state.json', import.meta.url), 'utf8'));
  assert.equal(current.pid, state.pid, 'repeated start is idempotent');
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(health.version, 'csgo-web-r3');
  assert.equal(health.instanceId, state.instanceId);
  const running = await run('status');
  assert.equal(running.code, 0, running.text);
  assert.match(running.text, /csgo-web-r3/);
  const stopped = await run('stop');
  assert.equal(stopped.code, 0, stopped.text);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(400) }));
  const stoppedAgain = await run('stop');
  assert.equal(stoppedAgain.code, 0, stoppedAgain.text);
  await mkdir(new URL('../output/lan/', import.meta.url), { recursive: true });
  await writeFile(new URL('../output/lan/launcher.json', import.meta.url), JSON.stringify({ passed: true,
    foreignPortProtected: true, staleForeignPidProtected: true, repeatedStartSamePid: state.pid, protocol: health.version,
    instanceVerified: true, stoppedPortClosed: true, at: new Date().toISOString() }, null, 2));
  console.log('PASS launcher: foreign port protected, start/status/stop, idempotent start, verified instance, closed port');
} finally { if (started?.code === 0) await run('stop'); }
