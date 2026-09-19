// Real SDK/network smoke. Starts and stops only this invocation's server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Room } from '@colyseus/sdk';
import WebSocket from 'ws';
import { EMPTY_INPUT, type Snapshot } from '../game/types.js';
import type { serverInfo } from '../server/lan.js';

// Node 22's browser-compatible WebSocket drops custom Origin headers. Use the
// actual ws transport supported by this SDK to exercise HTTP and WS origins.
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
const { Client } = await import('@colyseus/sdk');

const cwd = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.CSGO_TEST_PORT || 27015);
const probe = createServer();
await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(port, '0.0.0.0', resolve); });
await new Promise<void>(resolve => probe.close(() => resolve()));
const endpoint = `http://127.0.0.1:${port}`;
const { ALLOWED_ORIGINS: _discard, ...environment } = process.env;
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd, env: { ...environment, HOST: '0.0.0.0', PORT: String(port), MAX_ROOMS: '4', NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', value => { serverLog += value; });
child.stderr.on('data', value => { serverLog += value; });
const rooms = new Set<Room>();
const snapshots = new Map<string, Snapshot>();
const observations: Record<string, unknown> = {};
const watchdog = setTimeout(() => child.kill('SIGTERM'), 55000);
async function until(check: () => boolean | Promise<boolean>, name: string, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (child.exitCode !== null || child.signalCode !== null) throw Error(`Server exited: ${serverLog}`);
    if (await check()) return;
    await delay(25);
  }
  throw Error('Timed out: ' + name);
}
function watch(room: Room) {
  rooms.add(room);
  room.reconnection.enabled = false;
  room.onMessage('snapshot', (snapshot: Snapshot) => snapshots.set(room.sessionId, snapshot));
  room.onMessage('roomInfo', () => {});
  room.onMessage('notice', () => {});
  return room;
}
const directory = async () => ((await (await fetch(endpoint + '/api/rooms')).json()) as { rooms: any[] }).rooms;
const own = (room: Room) => snapshots.get(room.sessionId)?.players.find(player => player.id === room.sessionId);
let failure: unknown;
try {
  await until(async () => {
    try { return (await fetch(endpoint + '/health', { signal: AbortSignal.timeout(250) })).ok; }
    catch { return false; }
  }, 'server startup');
  const infoResponse = await fetch(endpoint + '/api/server-info');
  assert.equal(infoResponse.status, 200);
  const info = await infoResponse.json() as ReturnType<typeof serverInfo>;
  assert.equal(info.protocol, 'csgo-web-r4');
  assert.equal(info.port, port);
  assert.equal(info.localUrl, endpoint + '/');
  assert.ok(info.lanUrls.length > 0, 'host must have an actual LAN IPv4 interface for this test');
  const lanEndpoint = info.lanUrls[0].replace(/\/$/, '');
  const lanResponse = await fetch(lanEndpoint + '/api/server-info', { headers: { Origin: lanEndpoint } });
  assert.equal(lanResponse.status, 200);
  assert.equal(lanResponse.headers.get('access-control-allow-origin'), lanEndpoint);
  assert.equal(lanResponse.headers.get('cross-origin-opener-policy'), null);
  assert.equal(lanResponse.headers.get('origin-agent-cluster'), null);
  assert.ok(lanResponse.headers.get('content-security-policy')?.includes("default-src 'self'"));
  observations.httpHeaders = {
    coop: lanResponse.headers.get('cross-origin-opener-policy'),
    originAgentCluster: lanResponse.headers.get('origin-agent-cluster'),
    csp: lanResponse.headers.get('content-security-policy'),
    allowedOrigin: lanResponse.headers.get('access-control-allow-origin'),
  };
  observations.serverInfo = info;
  observations.testNetwork = { hostInterface: lanEndpoint, deviceCount: 1, sdkClients: 2 };

  const first = new Client(endpoint, { headers: { Origin: endpoint } });
  const second = new Client(lanEndpoint, { headers: { Origin: lanEndpoint } });
  await assert.rejects(first.create('operation', { version: 'web-w04', code: 'OLD001' }), /VERSION_MISMATCH.*csgo-web-r4/);
  assert.equal((await directory()).length, 0);
  const a = watch(await first.create('operation', { version: 'csgo-web-r4', code: 'CSG001', name: '测试甲', roomName: 'LAN真实双端' }));
  const b = watch(await second.join('operation', { version: 'csgo-web-r4', code: 'CSG001', name: '测试乙' }));
  assert.equal(a.roomId, b.roomId);
  await until(() => !!own(a) && !!own(b), 'both authority snapshots');
  const roomInfo = (await directory())[0];
  assert.equal(roomInfo.players, 2);
  assert.equal(roomInfo.bots, 8);
  assert.equal(own(a)!.team, 'amber');
  assert.equal(own(b)!.team, 'blue');
  observations.twoSdkRoom = roomInfo;
  const before = { hp: own(a)!.hp, money: own(a)!.money, ack: own(a)!.ack };
  a.send('input', { ...EMPTY_INPUT, seq: 9999, mx: 999, hp: 99999, money: 99999 });
  a.send('buy', { item: 'vandal', money: 99999 });
  await delay(150);
  assert.deepEqual({ hp: own(a)!.hp, money: own(a)!.money, ack: own(a)!.ack }, before);
  observations.authorityRejectsInjectedState = true;

  a.send('skin', 'redline');
  await until(() => snapshots.get(b.sessionId)?.players.find(p => p.id === a.sessionId)?.skin === 'redline', 'remote skin snapshot');
  a.send('skin', { id: 'arctic', hp: 99999 });
  a.send('skin', 'invented');
  await delay(150);
  assert.equal(own(a)!.skin, 'redline');
  assert.equal(own(a)!.hp, before.hp);
  assert.equal(snapshots.get(b.sessionId)?.players.find(p => p.id === a.sessionId)?.skin, 'redline');
  observations.skinSyncAndAuthority = true;

  a.send('buy', 'marshal');
  await until(() => own(a)?.weapon === 'marshal', 'authority purchase');
  assert.equal(own(a)!.money, before.money - 3200);
  assert.equal(own(a)!.ammo, 8);
  assert.equal(own(a)!.reserve, 32);
  observations.authorityPurchase = { weapon: own(a)!.weapon, money: own(a)!.money, ammo: own(a)!.ammo };
  const sessionId = a.sessionId;
  const token = a.reconnectionToken;
  const resources = { hp: own(a)!.hp, money: own(a)!.money, ammo: own(a)!.ammo, reserve: own(a)!.reserve };
  (a.connection as any).transport.ws.terminate();
  rooms.delete(a);
  await until(async () => (await directory())[0]?.reconnectingPlayers === 1, 'retained disconnected seat');
  assert.equal((await directory())[0].hostId, b.sessionId);
  snapshots.delete(sessionId);
  const recovered = watch(await first.reconnect(token));
  assert.equal(recovered.sessionId, sessionId);
  await until(() => !!own(recovered) && (own(recovered)?.money === resources.money), 'reconnect snapshot');
  assert.deepEqual({ hp: own(recovered)!.hp, money: own(recovered)!.money, ammo: own(recovered)!.ammo, reserve: own(recovered)!.reserve }, resources);
  assert.equal(own(recovered)!.skin, 'redline');
  observations.reconnect = { sameSession: true, preservedResources: resources, hostStayedWithPeer: (await directory())[0].hostId === b.sessionId };

  await until(() => snapshots.get(recovered.sessionId)?.phase === 'live', 'natural buy phase ends', 16000);
  const position = { x: own(recovered)!.x, z: own(recovered)!.z, yaw: own(recovered)!.yaw };
  for (let seq = 1; seq <= 60; seq++) {
    recovered.send('input', { ...EMPTY_INPUT, seq, mx: -Math.cos(position.yaw), mz: -Math.sin(position.yaw),
      yaw: position.yaw, time: snapshots.get(recovered.sessionId)!.time });
    await delay(17);
  }
  await delay(100);
  assert.ok(own(recovered)!.x < position.x - 2 && own(recovered)!.x > position.x - 6, 'actual authority movement is speed bounded');
  assert.ok(own(recovered)!.ack >= 50 && own(recovered)!.ack <= 60);
  observations.authorityMovement = { from: position, to: { x: own(recovered)!.x, z: own(recovered)!.z }, ack: own(recovered)!.ack };

  for (const path of ['/api/server-info', '/api/rooms', '/matchmake/create/operation']) {
    const response = await fetch(endpoint + path, { headers: { Origin: 'http://foreign.invalid' } });
    assert.equal(response.status, 403);
  }
  const status = await new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(endpoint.replace(/^http/, 'ws'), { origin: 'http://foreign.invalid' });
    ws.on('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode ?? 0); });
    ws.on('open', () => { ws.close(); reject(Error('Foreign WebSocket accepted')); });
    ws.on('error', reject);
  });
  assert.equal(status, 403);
  observations.foreignHttpAndWsRejected = true;

  await recovered.leave(); rooms.delete(recovered);
  await b.leave(); rooms.delete(b);
  await until(async () => (await directory()).length === 0, 'last human cleanup');
  observations.roomCleaned = true;
} catch (error) { failure = error; }
finally {
  for (const room of rooms) {
    room.reconnection.enabled = false;
    await Promise.race([room.leave().catch(() => {}), delay(500)]);
  }
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await exited;
  }
  clearTimeout(watchdog);
  const output = fileURLToPath(new URL('../output/lan/', import.meta.url));
  await mkdir(output, { recursive: true });
  await writeFile(output + 'smoke-server.log', serverLog);
  await writeFile(output + 'smoke.json', JSON.stringify({ passed: !failure, at: new Date().toISOString(), childStopped: child.exitCode !== null || child.signalCode !== null,
    observations, ...(failure ? { error: String(failure) } : {}) }, null, 2));
}
if (failure) throw failure;
console.log(JSON.stringify({ passed: true, observations }, null, 2));
