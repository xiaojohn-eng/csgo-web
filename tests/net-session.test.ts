import { WEB_VERSION } from '../game/protocol';
import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { EMPTY_INPUT, type Player } from '../game/types';

type State = {
  info: { hostId: string; players: number; bots: number; reconnectingPlayers?: number };
  players: Player[];
  bodies: Record<string, { body: number; collider: number; enabled: boolean }>;
  inputs: Record<string, typeof EMPTY_INPUT>;
  queues: Record<string, typeof EMPTY_INPUT[]>;
  connected: string[];
  retained: string[];
};
const cwd = fileURLToPath(new URL('..', import.meta.url));
const output = fileURLToPath(new URL('../output/tests/net-session/', import.meta.url));
let child: ChildProcess, endpoint: string, client: Client, requestId = 0, code = 0;
let serverLog = '';
const replies = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const clients = new Set<Room>();
const roomIds = new Set<string>();
const observations: Record<string, unknown> = {};
function rpc<T = State | null>(action: string, roomId: string, extra: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timeout = setTimeout(() => { replies.delete(id); reject(Error(`IPC timeout: ${action}`)); }, 5000);
    replies.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); },
      reject: error => { clearTimeout(timeout); reject(error); } });
    child.send({ requestId: id, action, roomId, ...extra });
  });
}
async function until<T>(read: () => Promise<T>, check: (value: T) => boolean, label: string, timeout = 5000): Promise<T> {
  const end = Date.now() + timeout;
  let value: T;
  do {
    value = await read();
    if (check(value)) return value;
    await delay(20);
  } while (Date.now() < end);
  throw Error(`Timed out: ${label}; last=${JSON.stringify(value!)}`);
}
function watch(room: Room) {
  clients.add(room); roomIds.add(room.roomId);
  room.onMessage('snapshot', () => {});
  room.onMessage('roomInfo', () => {});
  room.onMessage('notice', () => {});
  room.onError(() => {});
  return room;
}
async function pair() {
  const a = watch(await client.create('operation', { version: WEB_VERSION, code: `S${String(++code).padStart(5, '0')}`, name: '甲' }));
  const b = watch(await client.joinById(a.roomId, { version: WEB_VERSION, name: '乙' }));
  await until(() => rpc('state', a.roomId), s => s?.connected.length === 2, 'two live clients');
  return { a, b };
}
const resources = (p: Player) => ({ hp: p.hp, alive: p.alive, money: p.money, ammo: p.ammo,
  reserve: p.reserve, kills: p.kills, deaths: p.deaths, team: p.team, weapon: p.weapon });

beforeAll(async () => {
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  if (!address || typeof address === 'string') throw Error('No test port');
  await new Promise<void>(resolve => socket.close(() => resolve()));
  endpoint = `http://127.0.0.1:${address.port}`;
  child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/net-session-server.mjs'], {
    cwd, env: { ...process.env, HOST: '127.0.0.1', PORT: String(address.port), ALLOWED_ORIGINS: endpoint,
      MAX_ROOMS: '4', NODE_ENV: 'production', TEST_LATENCY_MS: '0' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout!.on('data', data => { serverLog += data; });
  child.stderr!.on('data', data => { serverLog += data; });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error(`Test server startup timeout: ${serverLog}`)), 12000);
    child.once('exit', code => { clearTimeout(timeout); reject(Error(`Test server exited ${code}: ${serverLog}`)); });
    child.on('message', (message: any) => {
      if (message.ready) { observations.bootSourceHashes = message.sourceHashes; clearTimeout(timeout); resolve(); return; }
      const r = replies.get(message.requestId);
      if (!r) return;
      replies.delete(message.requestId);
      if (message.error) r.reject(Error(message.error)); else r.resolve(message.value);
    });
  });
  client = new Client(endpoint, { headers: { Origin: endpoint } });
}, 15000);

afterEach(async () => {
  for (const room of clients) room.reconnection.enabled = false;
  for (const id of roomIds) await rpc('closeRoom', id);
  clients.clear(); roomIds.clear();
});
afterAll(async () => {
  if (child && child.exitCode === null) {
    observations.finalSourceHashes = await rpc('sourceHashes', '');
    const ended = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    await ended; clearTimeout(timeout);
  }
  await mkdir(output, { recursive: true });
  const tag = process.env.NET_SESSION_EVIDENCE ?? 'latest';
  await writeFile(`${output}/${tag}-server.log`, serverLog);
  await writeFile(`${output}/${tag}-observations.json`, JSON.stringify({ endpoint, childPid: child?.pid,
    childStopped: child?.exitCode !== null || child?.signalCode !== null, observations }, null, 2));
});

it('the session contract rejects the old client version before allocating a combat room', async () => {
  await expect(client.create('operation', { version: 'web-w03', code: 'OLD001', name: '旧客户端' }))
    .rejects.toThrow(/VERSION_MISMATCH.*csgo-web-r4/);
  const health = await (await fetch(endpoint + '/health')).json() as { rooms: number };
  expect(health.rooms).toBe(0);
  observations.oldVersionRejected = true;
});

it('refuses an explicit mismatched rule set without taking a seat and lets code-only peers adopt the room rules', async () => {
  const host = watch(await client.create('operation', {version:WEB_VERSION,code:`S${String(++code).padStart(5,'0')}`,name:'完整竞技主机',rules:'competitive'}));
  await expect(client.joinById(host.roomId,{version:WEB_VERSION,name:'错误赛制',rules:'competitiveShort'})).rejects.toThrow(/RULES_MISMATCH/);
  await expect(client.joinById(host.roomId,{version:WEB_VERSION,name:'未知赛制',rules:'unknown'})).rejects.toThrow(/RULES_MISMATCH/);
  expect((await rpc('state',host.roomId))?.connected).toEqual([host.sessionId]);
  const peer=watch(await client.joinById(host.roomId,{version:WEB_VERSION,name:'仅代码加入'}));
  const matched=watch(await client.joinById(host.roomId,{version:WEB_VERSION,name:'正确赛制',rules:'competitive'}));
  const state=await until(()=>rpc('state',host.roomId),s=>s?.connected.length===3,'three valid seats');
  expect(new Set(state!.connected)).toEqual(new Set([host.sessionId,peer.sessionId,matched.sessionId]));
  const directory=await (await fetch(endpoint+'/api/rooms')).json() as {rooms:{roomId:string;rules:string;players:number}[]};
  expect(directory.rooms.find(r=>r.roomId===host.roomId)).toMatchObject({rules:'competitive',players:3});
});

it('death and spent resources survive an unexpected drop and token reconnection in the same seat', async () => {
  const { a, b } = await pair();
  a.reconnection.enabled = false;
  const token = a.reconnectionToken;
  const before = (await rpc('seedAndDrop', a.roomId, { playerId: a.sessionId,
    patch: { hp: 0, alive: false, money: 150, ammo: 0, reserve: 7, kills: 3, deaths: 2 } }))!;
  const after = await until(() => rpc('state', a.roomId), s => !s?.connected.includes(a.sessionId), 'drop observed');
  observations.deadDrop = { before: resources(before.players.find(p => p.id === a.sessionId)!), after };
  expect(after?.players.find(p => p.id === a.sessionId), 'same dead entity must survive drop').toBeDefined();
  expect(after!.retained).toContain(a.sessionId);
  expect(after!.info.hostId).toBe(b.sessionId);
  const recovered = watch(await client.reconnect(token));
  expect(recovered.sessionId).toBe(a.sessionId);
  const state = (await until(() => rpc('state', a.roomId), s => s?.connected.includes(a.sessionId) === true, 'same seat reconnected'))!;
  expect(resources(state.players.find(p => p.id === recovered.sessionId)!)).toEqual(resources(before.players.find(p => p.id === a.sessionId)!));
  expect(state.bodies[recovered.sessionId]).toEqual(before.bodies[a.sessionId]);
  expect(state.info.hostId).toBe(b.sessionId);
});

it('consented leave and replacement preserve the dead bot seat instead of minting a new combat life', async () => {
  const { a } = await pair();
  const before = (await rpc('seed', a.roomId, { playerId: a.sessionId,
    patch: { hp: 0, alive: false, money: 150, ammo: 0, reserve: 7, kills: 3, deaths: 2 } }))!;
  await a.leave();
  const left = (await until(() => rpc('state', a.roomId), s => !s?.players.some(p => p.id === a.sessionId), 'bot control transfer'))!;
  observations.consent = { before: resources(before.players.find(p => p.id === a.sessionId)!), after: left };
  expect(left.players.filter(p => p.alive).length).toBe(before.players.filter(p => p.alive).length);
  const c = watch(await client.joinById(a.roomId, { version: WEB_VERSION, name: '丙' }));
  const joined = (await rpc('state', a.roomId))!;
  expect(joined.players.length).toBe(10);
  expect(resources(joined.players.find(p => p.id === c.sessionId)!)).toEqual(resources(before.players.find(p => p.id === a.sessionId)!));
  expect(joined.bodies[c.sessionId]).toEqual(before.bodies[a.sessionId]);
});

it('drop immediately clears queued actions, partial reload and objective use without granting ammunition', async () => {
  const { a } = await pair();
  a.reconnection.enabled = false;
  await rpc('seedAndDrop', a.roomId, { playerId: a.sessionId,
    patch: { hp: 34, ammo: 0, reserve: 7, money: 150, reload: 1.5, use: 1, vx: 2, vz: 2 },
    input: { ...EMPTY_INPUT, seq: 15, mx: 1, mz: -1, fire: true, reload: true, use: true, grenade: true } });
  const state = (await until(() => rpc('state', a.roomId), s => !s?.connected.includes(a.sessionId), 'dropped controller'))!;
  const p = state.players.find(p => p.id === a.sessionId);
  observations.inputDrop = state;
  expect(p, 'drop must retain player').toBeDefined();
  expect(state.queues[a.sessionId]).toEqual([]);
  expect(state.inputs[a.sessionId]).toMatchObject({ mx: 0, mz: 0, fire: false, reload: false, use: false, grenade: false });
  expect(p).toMatchObject({ ammo: 0, reserve: 7, money: 150, reload: 0, use: 0, vx: 0, vz: 0 });
});

it('a late join inherits an existing bot state and never increases combat life count', async () => {
  const { a } = await pair();
  const state = (await rpc('state', a.roomId))!;
  // The next amber seat is the last bot in stable roster order, not a newly spawned player.
  const bot = state.players.filter(p => p.team === 'amber' && p.bot).at(-1)!;
  const before = (await rpc('seed', a.roomId, { playerId: bot.id,
    patch: { hp: 0, alive: false, money: 777, ammo: 4, reserve: 9, kills: 1, deaths: 4 } }))!;
  const c = watch(await client.joinById(a.roomId, { version: WEB_VERSION, name: '迟到' }));
  const joined = (await rpc('state', a.roomId))!;
  observations.lateJoin = { before, after: joined };
  expect(resources(joined.players.find(p => p.id === c.sessionId)!)).toEqual(resources(before.players.find(p => p.id === bot.id)!));
  expect(joined.players.filter(p => p.alive).length).toBe(before.players.filter(p => p.alive).length);
  expect(joined.bodies[c.sessionId]).toEqual(before.bodies[bot.id]);
});

it('the actual SDK automatically recovers an early drop with the same room and seat', async () => {
  const { a } = await pair();
  a.reconnection.minUptime = 0;
  let dropped = 0, reconnected = 0;
  a.onDrop(() => dropped++); a.onReconnect(() => reconnected++);
  const id = a.sessionId;
  await rpc('seed', a.roomId, { playerId: id, patch: { hp: 34, money: 150, ammo: 0, reserve: 7 } });
  await rpc('drop', a.roomId, { playerId: id });
  await until(async () => reconnected, n => n === 1, 'SDK automatic reconnection', 6000);
  const state = (await rpc('state', a.roomId))!;
  observations.autoReconnect = { dropped, reconnected, state };
  expect(dropped).toBe(1); expect(a.sessionId).toBe(id);
  expect(state.players.find(p => p.id === id)).toMatchObject({ hp: 34, money: 150, ammo: 0, reserve: 7 });
});

it('the last connected player can leave while a retained seat survives only its bounded reconnect window', async () => {
  const { a, b } = await pair();
  a.reconnection.enabled = false;
  await rpc('drop', a.roomId, { playerId: a.sessionId });
  await until(() => rpc('state', a.roomId), s => !s?.connected.includes(a.sessionId), 'last retained seat');
  await b.leave();
  const held = await rpc('state', a.roomId);
  observations.lastRetained = held;
  expect(held, 'retained seat must outlive the last connected player').not.toBeNull();
  expect(held!.retained).toEqual([a.sessionId]);
  expect(held!.info.players).toBe(0);
  const directory = await (await fetch(endpoint + '/api/rooms', { headers: { Origin: endpoint } })).json() as { rooms: unknown[] };
  expect(directory.rooms).toEqual([]);
  await until(() => rpc('state', a.roomId), s => s === null, '30 second seat expiration cleanup', 33000);
  const health = await (await fetch(endpoint + '/health')).json() as { rooms: number };
  expect(health.rooms).toBe(0);
}, 38000);

it('the last consented departure cleans the room immediately without a reconnect grace leak', async () => {
  const { a, b } = await pair();
  await a.leave(); await b.leave();
  await until(() => rpc('state', a.roomId), s => s === null, 'consented room cleanup');
  const health = await (await fetch(endpoint + '/health')).json() as { rooms: number };
  expect(health.rooms).toBe(0);
});

it('an expired retained seat becomes a bot with the same dead resources while another human remains', async () => {
  const { a, b } = await pair();
  a.reconnection.enabled = false;
  const before = (await rpc('seedAndDrop', a.roomId, { playerId: a.sessionId,
    patch: { hp: 0, alive: false, money: 150, ammo: 0, reserve: 7, kills: 3, deaths: 2 } }))!;
  const expired = (await until(() => rpc('state', a.roomId), s => !!s && !s.players.some(p => p.id === a.sessionId),
    'retained seat timeout transfers original entity', 33000))!;
  const sameBody = Object.entries(expired.bodies).find(([, v]) => v.body === before.bodies[a.sessionId].body)?.[0];
  expect(sameBody).toBeDefined();
  const bot = expired.players.find(p => p.id === sameBody)!;
  expect(bot.bot).toBe(true);
  expect(resources(bot)).toEqual(resources(before.players.find(p => p.id === a.sessionId)!));
  expect(expired.info.hostId).toBe(b.sessionId);
  expect(expired.info.reconnectingPlayers).toBe(0);
  observations.expiredBot = { before: resources(before.players.find(p => p.id === a.sessionId)!), after: resources(bot) };
}, 38000);

it('a cancelled client can leave an already scheduled automatic reconnect without an orphan human seat', async () => {
  const { a, b } = await pair();
  a.reconnection.minUptime = 0;
  let didDrop = false;
  a.onDrop(() => { didDrop = true; });
  a.onReconnect(() => {
    // Runtime cancellation guard: the SDK owns an already-scheduled retry timer.
    queueMicrotask(() => { if (a.connection.isOpen) void a.leave(); });
  });
  await rpc('drop', a.roomId, { playerId: a.sessionId });
  await until(async () => didDrop, Boolean, 'drop before menu cancellation');
  a.reconnection.enabled = false;
  a.reconnection.maxRetries = 0;
  a.reconnection.enqueuedMessages.length = 0;
  const cleaned = (await until(() => rpc('state', a.roomId), s => !!s && !s.players.some(p => p.id === a.sessionId),
    'late recovery immediately consents to leave'))!;
  expect(cleaned.info.players).toBe(1);
  expect(cleaned.retained).toEqual([]);
  expect(cleaned.info.hostId).toBe(b.sessionId);
  observations.cancelledRecovery = cleaned.info;
});

it('a connected input gap preserves the active pistol and does not cancel its reload', async () => {
  const { a } = await pair();
  await rpc('seed', a.roomId, { playerId: a.sessionId,
    patch: { slot: 1, weapon: 'sidearm', ammo: 3, reserve: 7, cooldown: 0, reload: 1.5 } });
  await delay(350);
  const state = (await rpc('state', a.roomId))!;
  const p = state.players.find(p => p.id === a.sessionId)!;
  observations.connectedInputGap = { slot: p.slot, weapon: p.weapon, ammo: p.ammo, reload: p.reload };
  expect(p.slot).toBe(1);
  expect(p.weapon).toBe('sidearm');
  expect(p.ammo).toBe(3);
  expect(p.reload).toBeGreaterThan(0.8);
});
