/** Two real SDK connections to an already-running Dust II service. This script
 * sends only the same room, purchase and input messages a player can send. It
 * does not start a server or alter authority state, and is not browser/device QA.
 *
 * node --import tsx scripts/verify-source-handoff-lan.ts \
 *   --server-url http://192.168.1.100:27019 \
 *   --baseline output/handoff/2026-09-13-trae-inheritance/browser-baseline.json
 * The long identity may instead be passed as --simulation-version or
 * CSGO_SIMULATION_VERSION. --output chooses the JSON evidence destination.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Room } from '@colyseus/sdk';
import WebSocket from 'ws';
import { WEB_VERSION } from '../game/protocol.js';
import { SOURCE_DUST2_ID } from '../game/source-identity.js';
import { EMPTY_INPUT, WEAPONS, type Event, type Player, type Snapshot } from '../game/types.js';

// Node's browser-compatible WebSocket ignores the SDK's Origin headers.
// Use the same ws transport as the existing real-network smoke tests.
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
const { Client } = await import('@colyseus/sdk');

const { values } = parseArgs({ options: {
  'server-url': { type: 'string' }, 'local-url': { type: 'string' },
  'simulation-version': { type: 'string' }, baseline: { type: 'string' },
  output: { type: 'string' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('Usage: node --import tsx scripts/verify-source-handoff-lan.ts --server-url http://LAN_IP:27019 [--local-url http://127.0.0.1:27019] [--simulation-version ID | --baseline JSON] [--output JSON]');
  process.exit(0);
}
const project = fileURLToPath(new URL('..', import.meta.url));
function endpoint(value: string): string {
  const url = new URL(value);
  assert.ok(['http:', 'https:'].includes(url.protocol), 'Expected an HTTP(S) server URL');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Expected a plain origin without credentials, query or path');
  return url.origin;
}
const lan = endpoint(values['server-url'] ?? process.env.CSGO_SERVER_URL ?? 'http://192.168.1.100:27019');
const lanUrl = new URL(lan);
assert.ok(isIP(lanUrl.hostname) === 4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(lanUrl.hostname),
  '--server-url must name the actual private LAN IPv4 interface, not loopback or a hostname');
const local = endpoint(values['local-url'] ?? `${lanUrl.protocol}//127.0.0.1${lanUrl.port ? ':' + lanUrl.port : ''}`);
assert.ok(['localhost', '127.0.0.1'].includes(new URL(local).hostname), '--local-url must be loopback');
assert.equal(new URL(local).port, lanUrl.port, 'Both clients must use the same server port');
assert.equal(new URL(local).protocol, lanUrl.protocol, 'Both clients must use the same server protocol');
let simulationVersion = values['simulation-version'] ?? process.env.CSGO_SIMULATION_VERSION;
let identitySource = simulationVersion ? 'explicit input' : '';
if (!simulationVersion) {
  const relative = 'output/handoff/2026-09-13-trae-inheritance/browser-baseline.json';
  const candidates = values.baseline ? [resolve(values.baseline)] : [resolve(project, relative), resolve(project, '../..', relative)];
  let baselineError: unknown;
  for (const path of candidates) {
    try {
      const baseline: unknown = JSON.parse(await readFile(path, 'utf8'));
      assert.ok(baseline && typeof baseline === 'object' && 'simulationVersion' in baseline && typeof baseline.simulationVersion === 'string');
      simulationVersion = baseline.simulationVersion; identitySource = path; break;
    } catch (error) { baselineError = error; }
  }
  assert.ok(simulationVersion, `No baseline identity was readable; pass --simulation-version or --baseline. ${String(baselineError)}`);
}
assert.ok(simulationVersion.startsWith('source-sim-v1:'), 'The simulation identity must be the full Source identity');
const output = resolve(values.output ?? resolve(project, 'output/handoff/2026-09-13-trae-inheritance/sdk-lan.json'));
type DirectoryEntry = { roomId: string; players: number; bots: number; rules: string; simulationVersion: string; mapId: string; hostId: string };
type Watched = { room: Room; endpoint: string; snapshot?: Snapshot; firstSnapshot?: Snapshot; events: Map<number, Event>; notices: string[]; errors: string[]; sequence: number; fire: boolean; slot?: 0 | 1 };
const watched: Watched[] = [];
const evidence: Record<string, unknown> = {
  at: new Date().toISOString(), status: 'running',
  scope: 'One physical host, two real Colyseus SDK clients: loopback and actual LAN interface. No browser rendering, pointer lock, or second-device claim.',
  endpoints: { local, lan }, identitySource, simulationVersion,
};
let heartbeat: ReturnType<typeof setInterval> | undefined;
let createdRoom: string | undefined;
let failure: unknown;
const errorText = (error: unknown) => error instanceof Error ? error.stack ?? error.message : String(error);
async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `HTTP read failed: ${url}`);
  return await response.json() as T;
}
const directory = async (base = local) => (await json<{ rooms: DirectoryEntry[] }>(`${base}/api/rooms`)).rooms;
function watch(room: Room, origin: string): Watched {
  const entry: Watched = { room, endpoint: origin, events: new Map(), notices: [], errors: [], sequence: 0, fire: false };
  watched.push(entry); room.reconnection.enabled = false;
  room.onMessage('snapshot', (snapshot: Snapshot) => {
    entry.firstSnapshot ??= snapshot;
    entry.snapshot = snapshot;
    for (const event of snapshot.events) entry.events.set(event.id, event);
  });
  room.onMessage('roomInfo', () => {});
  room.onMessage('notice', (notice: unknown) => entry.notices.push(String(notice)));
  room.onError((code, message) => entry.errors.push(`${code}: ${message}`));
  return entry;
}
const own = (entry: Watched): Player | undefined => entry.snapshot?.players.find(player => player.id === entry.room.sessionId);
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 10000, includeRoomErrors = true): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (includeRoomErrors) assert.deepEqual(watched.flatMap(entry => entry.errors), [], `SDK room error while waiting for ${label}`);
    if (await check()) return;
    await delay(30);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
function sendInput(entry: Watched) {
  const player = own(entry), snapshot = entry.snapshot;
  if (!player || !snapshot) return;
  entry.sequence = Math.max(entry.sequence + 1, player.ack + 1);
  entry.room.send('input', { ...EMPTY_INPUT, seq: entry.sequence, time: snapshot.time,
    yaw: player.yaw, pitch: player.pitch, slot: entry.slot ?? player.slot, fire: entry.fire });
}
try {
  const [localHealth, lanHealth, serverInfo, existing] = await Promise.all([
    json<{ status: string; version: string; instanceId: string | null }>(`${local}/health`),
    json<{ status: string; version: string; instanceId: string | null }>(`${lan}/health`),
    json<{ version: string; lanUrls: string[] }>(`${local}/api/server-info`), directory(),
  ]);
  assert.equal(localHealth.status, 'ok'); assert.equal(lanHealth.status, 'ok');
  assert.equal(localHealth.version, WEB_VERSION); assert.equal(lanHealth.version, WEB_VERSION);
  assert.equal(localHealth.instanceId, lanHealth.instanceId, 'The two origins must reach the same running instance');
  assert.ok(serverInfo.lanUrls.some(url => new URL(url).origin === lan), 'LAN origin is not advertised by the running server');
  evidence.server = { localHealth, lanHealth, advertisedLanUrls: serverInfo.lanUrls, roomCountBefore: existing.length };
  const code = Array.from(randomBytes(3), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  const options = { version: WEB_VERSION, mapId: SOURCE_DUST2_ID, simulationVersion,
    rules: 'competitiveShort', code, roomName: `接续验收 ${code}` };
  const host = watch(await new Client(local, { headers: { Origin: local } }).create('operation', { ...options, name: '接续本机' }), local);
  createdRoom = host.room.roomId;
  const peer = watch(await new Client(lan, { headers: { Origin: lan } }).joinById(createdRoom, { ...options, name: '接续局域网' }), lan);
  await until(() => !!own(host) && !!own(peer), 'both authority snapshots');
  for (const entry of watched) {
    assert.equal(entry.snapshot!.simulationVersion, simulationVersion);
    assert.equal(entry.snapshot!.mapId, SOURCE_DUST2_ID);
    assert.equal(entry.snapshot!.rules, 'competitiveShort');
    assert.equal(entry.snapshot!.mode, 'demolition');
    assert.equal(entry.snapshot!.phase, 'buy', 'New room must still be in its natural freeze phase');
    assert.equal(own(entry)!.money, 800, 'New human seat must start with 800');
  }
  assert.equal(own(host)!.team, 'amber'); assert.equal(own(peer)!.team, 'blue');
  const firstRemaining = host.firstSnapshot!.remaining;
  assert.ok(firstRemaining > 14 && firstRemaining <= 15, `The first round must use the original 15-second freeze (first observed ${firstRemaining})`);
  const roomInfo = (await directory()).find(room => room.roomId === createdRoom)!;
  assert.ok(roomInfo); assert.equal(roomInfo.players, 2); assert.equal(roomInfo.bots, 8);
  assert.equal(roomInfo.hostId, host.room.sessionId); assert.equal(roomInfo.rules, 'competitiveShort');
  assert.equal(roomInfo.simulationVersion, simulationVersion);
  assert.ok((await directory(lan)).some(room => room.roomId === createdRoom && room.players === 2));
  evidence.admission = { roomId: createdRoom, code, roomInfo, teams: { host: own(host)!.team, peer: own(peer)!.team },
    money: { host: own(host)!.money, peer: own(peer)!.money }, firstSnapshotRemaining: firstRemaining, currentRemaining: host.snapshot!.remaining };
  assert.equal(host.snapshot!.canBuy, true, 'Host must be inside its actual team buy zone');
  host.room.send('buy', 'deagle');
  await until(() => own(host)?.weapon === 'deagle' && own(host)?.secondary === 'deagle' && own(host)?.money === 100, 'legal Deagle purchase');
  assert.equal(own(host)!.ammo, 7); assert.equal(own(host)!.reserve, 35);
  assert.equal(own(peer)!.money, 800, 'Buying must not debit the other seat');
  host.slot = 1;
  evidence.purchase = { message: 'buy deagle', canBuy: host.snapshot!.canBuy, money: own(host)!.money,
    weapon: own(host)!.weapon, ammo: own(host)!.ammo, reserve: own(host)!.reserve };
  heartbeat = setInterval(() => { for (const entry of watched) sendInput(entry); }, 34);
  const freezeStarted = Date.now(), beforeLiveTime = host.snapshot!.time;
  await until(() => host.snapshot?.phase === 'live' && peer.snapshot?.phase === 'live', 'natural end of freeze', 30000);
  evidence.freeze = { waitedMilliseconds: Date.now() - freezeStarted, beforeLiveTime, liveTime: host.snapshot!.time,
    remainingAtLiveSnapshot: host.snapshot!.remaining, advancedNaturally: true };
  assert.equal(own(host)!.alive, true); assert.equal(own(peer)!.alive, true);
  assert.equal(own(host)!.weapon, 'deagle');
  const hiddenHost = peer.snapshot!.players.find(player => player.id === host.room.sessionId)!;
  assert.ok(hiddenHost); assert.equal(hiddenHost.y, -100, 'Peer must lack sight of the host at the original spawn; no repositioning fallback is used');
  const beforeShot = Math.max(0, ...host.events.keys());
  const beforeAmmo = own(host)!.ammo;
  host.fire = true; sendInput(host);
  let shot: Event | undefined;
  try {
    await until(() => {
      shot = [...host.events.values()].find(event => event.id > beforeShot && event.type === 'shot' && event.by === host.room.sessionId);
      return !!shot;
    }, 'owner shot from actual input', 5000);
  } finally { host.fire = false; sendInput(host); }
  assert.ok(shot && shot.type === 'shot'); assert.equal(shot.weapon, 'deagle');
  assert.ok(shot.sourcePistolShot, 'Owner must receive the native pistol shot metadata');
  assert.ok(shot.sourceTracer, 'Updated authority must send the full Source shot endpoint');
  assert.equal(shot.sourceTracer.end.length, 3);
  assert.ok(shot.sourceTracer.end.every(Number.isFinite));
  const distance = Math.hypot(shot.sourceTracer.end[0] - shot.x!, shot.sourceTracer.end[1] - shot.y!, shot.sourceTracer.end[2] - shot.z!);
  assert.ok(distance > 0 && distance <= WEAPONS.deagle.range + .001, 'Endpoint must lie on the accepted shot range');
  await until(() => own(host)!.ammo === beforeAmmo - 1 && peer.events.has(shot!.id), 'ammo debit and matching peer event');
  const report = peer.events.get(shot.id)!;
  assert.equal(report.type, 'report'); assert.equal(report.by, host.room.sessionId); assert.equal(report.weapon, 'deagle');
  assert.equal(report.id, shot.id);
  for (const key of ['sourceTracer', 'impact', 'sourceRifleShot', 'sourcePistolShot', 'sourceAWPShot', 'dx', 'dy', 'dz', 'seq'])
    assert.equal(Object.hasOwn(report, key), false, `Hidden-shooter report leaked ${key}`);
  assert.deepEqual(Object.keys(report).sort(), ['id', 'time', 'type', 'by', 'weapon', 'x', 'y', 'z'].sort());
  assert.equal(report.x, Math.round(shot.x! / 2) * 2); assert.equal(report.z, Math.round(shot.z! / 2) * 2);
  evidence.shot = { owner: shot, peer: report, beforeAmmo, afterAmmo: own(host)!.ammo, distance,
    sameEventId: true, peerSourceEndpointAbsent: true, observerHiddenHostY: hiddenHost.y };
} catch (error) {
  failure = error; evidence.failure = errorText(error);
} finally {
  if (heartbeat) clearInterval(heartbeat);
  const cleanupErrors: string[] = [];
  for (const entry of [...watched].reverse()) {
    try { await entry.room.leave(true); } catch (error) { cleanupErrors.push(errorText(error)); }
  }
  let roomRemoved = createdRoom === undefined;
  try {
    if (createdRoom) await until(async () => !(await directory()).some(room => room.roomId === createdRoom), 'dedicated room cleanup', 10000, false);
    roomRemoved = true;
  } catch (error) { cleanupErrors.push(errorText(error)); }
  evidence.clients = watched.map(entry => ({ endpoint: entry.endpoint, sessionId: entry.room.sessionId,
    notices: entry.notices, errors: entry.errors, finalPhase: entry.snapshot?.phase, finalTick: entry.snapshot?.tick }));
  evidence.cleanup = { normalLeaveRequested: watched.length, dedicatedRoomRemoved: roomRemoved, errors: cleanupErrors };
  if (cleanupErrors.length && !failure) failure = new Error(cleanupErrors.join('\n'));
  evidence.status = failure ? 'failed' : 'passed';
  evidence.completedAt = new Date().toISOString();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify({ status: evidence.status, evidence: output, roomId: createdRoom, endpoints: { local, lan } }));
if (failure) throw failure;
