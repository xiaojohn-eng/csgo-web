/** Verify finish boundary values through two real SDK clients on a running candidate.
 * Only creates its own room, changes each test client's own finish, then leaves.
 * Does not start/restart a service or prove browser rendering / two physical devices.
 *
 * BASE_URL=http://127.0.0.1:27039 node --import tsx scripts/verify-source-finish-gallery-lan.ts \
 *   --baseline output/fidelity-fixes-2026-09-13/sdk-lan.json --output output/skin-gallery/finish-lan.json
 * Use --peer-url http://LAN_IP:27039 to exercise a second origin on the same instance.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import type { Room } from '@colyseus/sdk';
import WebSocket from 'ws';
import { WEB_VERSION } from '../game/protocol.js';
import { SOURCE_DUST2_ID } from '../game/source-identity.js';
import type { SourceWeaponFinish } from '../game/source-weapon-finish.js';
import type { Player, Snapshot } from '../game/types.js';

const { values } = parseArgs({ options: {
  'server-url': { type: 'string' }, 'peer-url': { type: 'string' },
  'simulation-version': { type: 'string' }, baseline: { type: 'string' },
  output: { type: 'string' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('BASE_URL=http://CANDIDATE:PORT node --import tsx scripts/verify-source-finish-gallery-lan.ts [--server-url URL] [--peer-url URL] (--simulation-version ID | --baseline JSON) [--output JSON]');
  process.exit(0);
}
function origin(value: string | undefined): string {
  assert.ok(value, 'Pass BASE_URL or --server-url explicitly; this script has no production default');
  const url = new URL(value);
  assert.ok(['http:', 'https:'].includes(url.protocol), 'Expected an HTTP(S) origin');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Expected a plain origin without credentials or path');
  return url.origin;
}
const base = origin(values['server-url'] ?? process.env.BASE_URL);
const peerOrigin = origin(values['peer-url'] ?? base);
const output = resolve(values.output ?? 'output/skin-gallery-2026-09-13/finish-lan.json');
let simulationVersion = values['simulation-version'] ?? process.env.CSGO_SIMULATION_VERSION;
if (!simulationVersion && values.baseline) {
  const baseline: unknown = JSON.parse(await readFile(resolve(values.baseline), 'utf8'));
  assert.ok(baseline && typeof baseline === 'object' && 'simulationVersion' in baseline && typeof baseline.simulationVersion === 'string', 'Baseline must contain the authoritative simulationVersion');
  simulationVersion = baseline.simulationVersion;
}
assert.ok(simulationVersion?.startsWith('source-sim-v1:'), 'Pass the full authoritative identity as --simulation-version, CSGO_SIMULATION_VERSION, or --baseline');

// Node's built-in WebSocket drops the SDK Origin header; the existing LAN QA uses ws.
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
const { Client } = await import('@colyseus/sdk');
type Watched = { room: Room; origin: string; snapshot?: Snapshot; errors: string[]; notices: string[]; expected?: SourceWeaponFinish };
type DirectoryEntry = { roomId: string; players: number; hostId: string; simulationVersion: string; mapId: string };
const clients: Watched[] = [];
const cases: Record<string, unknown>[] = [];
const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(), status: 'running', simulationVersion,
  scope: 'One physical host, two real Colyseus SDK clients. Authoritative finish parameters and per-player isolation only; no browser rendering or second-device claim.',
  endpoints: { host: base, peer: peerOrigin }, cases,
};
let roomId: string | undefined;
let failure: unknown;
const errorText = (error: unknown) => error instanceof Error ? error.stack ?? error.message : String(error);
async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `HTTP read failed: ${url}`);
  return await response.json() as T;
}
async function directory(): Promise<DirectoryEntry[]> {
  return (await json<{ rooms: DirectoryEntry[] }>(`${base}/api/rooms`)).rooms;
}
function watch(room: Room, endpoint: string): Watched {
  const client: Watched = { room, origin: endpoint, errors: [], notices: [] };
  clients.push(client);
  room.reconnection.enabled = false;
  room.onMessage('snapshot', (snapshot: Snapshot) => { client.snapshot = snapshot; });
  room.onMessage('roomInfo', () => {});
  room.onMessage('notice', (notice: unknown) => client.notices.push(String(notice)));
  room.onError((code, message) => client.errors.push(`${code}: ${message}`));
  return client;
}
async function until(check: () => boolean | Promise<boolean>, label: string, checkErrors = true): Promise<void> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (checkErrors) assert.deepEqual(clients.flatMap(client => client.errors), [], `SDK error during ${label}`);
    if (await check()) return;
    await delay(40);
  }
  throw Error(`Timed out: ${label}`);
}
function player(viewer: Watched, subject: Watched): Player | undefined {
  return viewer.snapshot?.players.find(row => row.id === subject.room.sessionId);
}
function matches(actual: SourceWeaponFinish | undefined, expected: SourceWeaponFinish | undefined): boolean {
  if (!actual || !expected) return actual === expected;
  return actual.weapon === expected.weapon && actual.paintKitId === expected.paintKitId && actual.seed === expected.seed && actual.wear === expected.wear;
}
async function applyFinish(sender: Watched, input: SourceWeaponFinish | null, label: string): Promise<void> {
  const previousTicks = clients.map(client => client.snapshot!.tick);
  const previousTime = Date.now();
  // The expected value is computed independently from the validator under test.
  sender.expected = input ? { ...input, wear: Math.fround(input.wear) } : undefined;
  sender.room.send('sourceFinish', input);
  await until(() => clients.every((viewer, index) => viewer.snapshot!.tick > previousTicks[index]
    && clients.every(subject => !!player(viewer, subject) && matches(player(viewer, subject)!.sourceWeaponFinish, subject.expected))), label);
  const snapshots = clients.map(viewer => ({ viewer: viewer.room.sessionId, tick: viewer.snapshot!.tick,
    players: clients.map(subject => {
      const actual = player(viewer, subject)!;
      assert.deepEqual(actual.sourceWeaponFinish, subject.expected, `${label}: exact finish fields and per-player isolation`);
      return { id: actual.id, weapon: actual.weapon, finish: actual.sourceWeaponFinish ?? null };
    }) }));
  cases.push({ label, sender: sender.room.sessionId, sent: input, expected: sender.expected ?? null,
    elapsedMilliseconds: Date.now() - previousTime, snapshots });
}
try {
  const [hostHealth, peerHealth] = await Promise.all([base, peerOrigin].map(endpoint =>
    json<{ status: string; version: string; instanceId: string | null }>(`${endpoint}/health`)));
  assert.equal(hostHealth.status, 'ok'); assert.equal(peerHealth.status, 'ok');
  assert.equal(hostHealth.version, WEB_VERSION); assert.equal(peerHealth.version, WEB_VERSION);
  assert.equal(hostHealth.instanceId, peerHealth.instanceId, 'Both endpoints must identify the same server');
  evidence.health = { host: hostHealth, peer: peerHealth };
  const code = Array.from(randomBytes(3), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  const options = { version: WEB_VERSION, mapId: SOURCE_DUST2_ID, simulationVersion,
    rules: 'competitiveShort', code, roomName: `皮肤列表验收 ${code}` };
  const host = watch(await new Client(base, { headers: { Origin: base } }).create('operation', { ...options, name: '皮肤边界主机' }), base);
  roomId = host.room.roomId;
  const peer = watch(await new Client(peerOrigin, { headers: { Origin: peerOrigin } }).joinById(roomId, { ...options, name: '皮肤边界观察' }), peerOrigin);
  await until(() => clients.every(viewer => clients.every(subject => !!player(viewer, subject))), 'both clients and both players in authority snapshots');
  for (const viewer of clients) {
    assert.equal(viewer.snapshot!.mapId, SOURCE_DUST2_ID);
    assert.equal(viewer.snapshot!.simulationVersion, simulationVersion);
    for (const subject of clients) assert.equal(player(viewer, subject)!.sourceWeaponFinish, undefined);
  }
  const room = (await directory()).find(row => row.roomId === roomId);
  assert.ok(room); assert.equal(room.players, 2); assert.equal(room.hostId, host.room.sessionId);
  evidence.room = room;
  // Different seeds make each acknowledgment distinct even when raw .8 and its
  // float32 representation normalize to the same authoritative wear value.
  const finish: SourceWeaponFinish = { weapon: 'vandal', paintKitId: 14, seed: 422, wear: Math.fround(.06) };
  await applyFinish(host, finish, 'AK-47 kit 14 accepts float32 lower endpoint .06');
  await applyFinish(peer, { weapon: 'm4a4', paintKitId: 8, seed: 777, wear: .8 }, 'Peer independent finish accepts raw upper endpoint .8');
  await applyFinish(host, { ...finish, seed: 423, wear: .8 }, 'AK-47 kit 14 accepts raw upper endpoint .8');
  await applyFinish(host, { ...finish, seed: 424, wear: Math.fround(.8) }, 'AK-47 kit 14 accepts serialized float32 upper endpoint .8');
  await applyFinish(peer, { weapon: 'm4a4', paintKitId: 8, seed: 778, wear: Math.fround(.8) }, 'Peer accepts serialized float32 upper endpoint without changing host');
  await applyFinish(host, null, 'Host restores default while peer keeps its finish');
  await applyFinish(peer, null, 'Peer restores default on both clients');
} catch (error) {
  failure = error;
  evidence.failure = errorText(error);
} finally {
  const cleanupErrors: string[] = [];
  for (const client of [...clients].reverse()) {
    try { await client.room.leave(true); } catch (error) { cleanupErrors.push(errorText(error)); }
  }
  let roomRemoved = roomId === undefined;
  if (roomId) {
    try {
      await until(async () => !(await directory()).some(room => room.roomId === roomId), 'dedicated test room removal', false);
      roomRemoved = true;
    } catch (error) { cleanupErrors.push(errorText(error)); }
  }
  evidence.clients = clients.map(client => ({ origin: client.origin, sessionId: client.room.sessionId,
    errors: client.errors, notices: client.notices }));
  evidence.cleanup = { normalLeaveRequested: clients.length, dedicatedRoomRemoved: roomRemoved, errors: cleanupErrors };
  if (cleanupErrors.length && !failure) failure = Error(cleanupErrors.join('\n'));
  evidence.status = failure ? 'failed' : 'passed';
  evidence.completedAt = new Date().toISOString();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify({ status: evidence.status, cases: cases.length, roomId, evidence: output }));
if (failure) throw failure;
