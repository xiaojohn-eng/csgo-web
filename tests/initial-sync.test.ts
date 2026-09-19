import { WEB_VERSION } from '../game/protocol';
import { REMOTE_DELAY } from '../game/pose-timeline';
import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest';
import { Client, Room } from '@colyseus/sdk';
import RAPIER from '@dimforge/rapier3d-compat';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { EMPTY_INPUT, type Input, type Player, type Snapshot } from '../game/types';

// Only GPU/audio are sinks. Real Game, DOM event consumers, Rapier, SDK and server are exercised.
vi.mock('../game/scene', () => ({ Art: class {
  ready = Promise.resolve(); hit = 0; damage = 0; quality = 'high'; kick = 0; assets={};
  inspection = {cancel() {}};
  clearEffects() {}
  setSourceParticleLightingWorld() {return Promise.resolve();}
  sourceFinishStatus(){return{status:'default',key:'default'};}
  setSourceWeaponFinish() {} sourceFirstPersonFlash() {}
  frame() {} updateSmoke() {} updateGrenades() {} updateDroppedWeapons() {} updateActors() {} trace() {}
  explosion() {} ejectCasing() {} resize() {} dispose() {} setQuality() {}
} }));
vi.mock('../game/audio', () => ({ AudioEngine: class {
  prepare(){return Promise.resolve();}
  shot() {} listener() {} reload() {} reloadStage() {} step() {} beep() {} hit() {}
  hiss() {} tone() {} round() {} explosion() {} unlock() {} dispose() {} setVolume() {}
} }));
import { Game, readRoomRecovery } from '../game/runtime';
import {createSourceRifleHandlingState,sourceRifleHandlingShot} from '../game/source-rifle-handling';

type Message = { type: string; playerId: string; value: Input | string | object };
type State = { players: Player[]; connected: string[]; retained: string[]; messages: Message[] };
class Surface extends EventTarget { closest() { return null; } }
class DocumentSurface extends Surface {
  pointerLockElement: Surface | null = null; hidden = false;
  exitPointerLock() { this.pointerLockElement = null; this.dispatchEvent(new Event('pointerlockchange')); }
}
const dom = new DocumentSurface();
const cwd = fileURLToPath(new URL('..', import.meta.url));
const output = fileURLToPath(new URL('../output/tests/initial-sync/', import.meta.url));
let child: ChildProcess, endpoint: string, requestId = 0, code = 0, log = '';
const replies = new Map<number, { resolve: (value: any) => void; reject: (e: Error) => void }>();
const games = new Set<Game>(), roomIds = new Set<string>();
const callbacks = new Map<Room, (s: Snapshot) => void>();
const observations: Record<string, unknown> = {};
function rpc<T = State>(action: string, roomId = '', extra: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => { replies.delete(id); reject(Error(`IPC timeout ${action}`)); }, 5000);
    replies.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
    child.send({ requestId: id, action, roomId, ...extra });
  });
}
async function until<T>(read: () => Promise<T>, check: (v: T) => boolean, label: string) {
  const end = Date.now() + 6000;
  do { const v = await read(); if (check(v)) return v; await delay(15); } while (Date.now() < end);
  throw Error(`Timeout: ${label}`);
}
function tick(g: Game) { g.acc = 1 / 60; g.frame(g.last || 1000); }
function stateMessages(s: State) { return s.messages.filter(m => ['input', 'buy', 'restart'].includes(m.type)); }
async function connect(g?: Game) {
  if (!g) {
    const canvas = Object.assign(new Surface(), { requestPointerLock: async () => {
      dom.pointerLockElement = canvas; dom.dispatchEvent(new Event('pointerlockchange'));
    } });
    g = new Game(canvas as unknown as HTMLCanvasElement, () => {}); games.add(g);
    await until(async () => g!.ready, Boolean, 'Game resources');
  }
  await g.connect(endpoint, `I${String(++code).padStart(5, '0')}`, '同步测试', true);
  expect(g.room, g.error).not.toBeNull(); roomIds.add(g.room!.roomId);
  return g;
}
async function seed(g: Game, patch: Partial<Player> = {}) {
  return rpc('seed', g.room!.roomId, { playerId: g.you,
    patch: { yaw: Math.PI / 2, pitch: 0.27, slot: 1, weapon: 'sidearm', ammo: 3, reserve: 7,
      pistolAmmo: 3, pistolReserve: 7, hp: 34, money: 150, ...patch } });
}
async function deliver(g: Game) {
  const snapshot = await rpc<Snapshot>('snapshot', g.room!.roomId, { playerId: g.you });
  await until(async () => g.snapshot?.tick, t => t === snapshot.tick, 'snapshot consumer');
  return snapshot;
}

beforeAll(async () => {
  vi.stubGlobal('document', dom);
  // Rapier's WASM clock selects window.performance when a window exists.
  vi.stubGlobal('window', Object.assign(new Surface(), { performance }));
  vi.stubGlobal('location', { protocol: 'http:' });
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {});
  const original = Room.prototype.onMessage;
  vi.spyOn(Room.prototype, 'onMessage').mockImplementation(function (this: Room, type: any, callback: any) {
    if (type === 'snapshot') callbacks.set(this, callback);
    return original.call(this, type, callback);
  });
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address(); if (!address || typeof address === 'string') throw Error('No isolated port');
  await new Promise<void>(resolve => socket.close(() => resolve()));
  endpoint = `http://127.0.0.1:${address.port}`;
  child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/initial-sync-server.mjs'], {
    cwd, env: { ...process.env, HOST: '127.0.0.1', PORT: String(address.port), ALLOWED_ORIGINS: endpoint,
      MAX_ROOMS: '4', NODE_ENV: 'production', TEST_LATENCY_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout!.on('data', data => { log += data; }); child.stderr!.on('data', data => { log += data; });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Startup timeout: ${log}`)), 12000);
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Own server exited ${code}: ${log}`)); });
    child.on('message', (m: any) => {
      if (m.ready) { observations.bootHashes = m.hashes; clearTimeout(timer); resolve(); return; }
      const r = replies.get(m.requestId); if (!r) return; replies.delete(m.requestId);
      if (m.error) r.reject(Error(m.error)); else r.resolve(m.value);
    });
  });
}, 15000);
afterEach(async () => {
  for (const g of games) g.dispose(); games.clear();
  for (const id of roomIds) await rpc('close', id); roomIds.clear(); callbacks.clear();
  dom.pointerLockElement = null;
});
afterAll(async () => {
  if (child?.exitCode === null) {
    observations.finalHashes = await rpc('hashes');
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited; clearTimeout(timer);
  }
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  await mkdir(output, { recursive: true });
  const tag = process.env.INITIAL_SYNC_EVIDENCE ?? 'latest';
  await writeFile(`${output}/${tag}-server.log`, log);
  await writeFile(`${output}/${tag}-observations.json`, JSON.stringify({ endpoint, childPid: child?.pid,
    stopped: child?.exitCode !== null || child?.signalCode !== null, observations }, null, 2));
});

it('publishes a local purchase while training is paused in the buy menu', async()=>{
  const g=await connect();g.start('training','采购测试');g.pause();g.buying=true;
  const before=g.snapshot!.players.find(p=>p.id===g.you)!;
  g.buy('armor');
  const bought=g.snapshot!.players.find(p=>p.id===g.you)!;
  expect(g.paused).toBe(true);expect(bought.armor).toBe(100);expect(bought.money).toBe(before.money-650);
  g.buy('armor');
  expect(g.snapshot!.players.find(p=>p.id===g.you)!.money).toBe(bought.money);
});

it('two real SDK clients preserve one remote pose time from snapshot interpolation into the shot packet', async () => {
  const g=await connect();
  const other=await new Client(endpoint).joinById(g.room!.roomId,{version:WEB_VERSION,name:'远端目标'});
  other.onMessage('snapshot',()=>{});other.onMessage('roomInfo',()=>{});other.onMessage('notice',()=>{});
  const clock=vi.spyOn(performance,'now');let clientNow=1000;clock.mockImplementation(()=>clientNow);
  try {
    await rpc('seed',g.room!.roomId,{playerId:other.sessionId,
      patch:{x:100,y:.015,z:100,yaw:0,pitch:-.6,stancePhase:0,stanceRate:0,stanceTarget:false}});
    const a=await deliver(g);
    await delay(100);
    await rpc('seed',g.room!.roomId,{playerId:other.sessionId,
      patch:{x:100.4,y:.015,z:100,yaw:.6,pitch:.6,stancePhase:1,stanceRate:0,stanceTarget:true}});
    clientNow=1100;const b=await deliver(g), span=b.time-a.time;
    // IPC/server scheduling can make the source gap exceed twice the playback
    // delay. Pick a target inside the available interpolation window, so this
    // fixture never asks the mocked client clock to run backwards before B.
    const wanted=b.time-Math.min(REMOTE_DELAY*.8,span/2), fraction=(wanted-a.time)/span;
    clientNow=1100+(REMOTE_DELAY-(b.time-wanted))*1000;
    let drawn:Player[]=[];const draw=vi.spyOn(g.art,'updateActors').mockImplementation((players:Player[])=>{drawn=players;});
    g.acc=0;g.frame(clientNow);
    const target=drawn.find(p=>p.id===other.sessionId)!;
    expect(target.x).toBeCloseTo(100+.4*fraction,7);expect(target.yaw).toBeCloseTo(.6*fraction,7);
    // The real server can advance stance between the seed IPC and snapshot IPC.
    // Interpolate the transmitted values, rather than assuming the seed stayed frozen.
    const stanceA=a.players.find(p=>p.id===other.sessionId)!.stancePhase;
    const stanceB=b.players.find(p=>p.id===other.sessionId)!.stancePhase;
    expect(target.pitch).toBeCloseTo(-.6+1.2*fraction,7);expect(target.stancePhase).toBeCloseTo(stanceA+(stanceB-stanceA)*fraction,7);
    expect(g.renderTime).toBeCloseTo(wanted,9);
    await rpc('clearMessages',g.room!.roomId);g.paused=false;g.firing=true;g.acc=1/60;g.frame(clientNow);
    const state=await until(()=>rpc('state',g.room!.roomId),s=>s.messages.some(m=>m.type==='input'),'interpolated shot packet');
    const sent=state.messages.find(m=>m.type==='input')!.value as Input;
    expect(sent.fire).toBe(true);expect(sent.time).toBeCloseTo(wanted,9);
    observations.remoteTimeline={aTime:a.time,bTime:b.time,drawn:target,shotTime:sent.time,
      actualSdkClients:2,gpuSink:true,pointerLockStub:true};
    draw.mockRestore();
  } finally {clock.mockRestore();other.reconnection.enabled=false;await other.leave();}
});

it('holds remote shot visuals for the drawn pose while local hit feedback stays immediate', async () => {
  const g=await connect();let clientNow=1000;
  const clock=vi.spyOn(performance,'now').mockImplementation(()=>clientNow);
  try {
    const a=await deliver(g), remote=a.players.find(p=>p.id!==g.you)!;
    const b=structuredClone(a);b.time+=.1;b.tick+=6;
    const id=Math.max(0,...a.events.map(e=>e.id))+100;
    // Controlled event timestamps at the real Game snapshot consumer; not a shooting-server test.
    b.events=[{id,type:'shot',by:remote.id,x:100,y:1.4,z:100,dx:1,dy:0,dz:0,weapon:'vandal',time:a.time+.08},
      {id:id+1,type:'hit',by:g.you,target:remote.id}];
    clientNow=1100;callbacks.get(g.room!)!(b);
    const trace=vi.spyOn(g.art,'trace'),hit=vi.spyOn(g.audio,'hit');
    g.acc=0;g.frame(clientNow);
    expect(trace).not.toHaveBeenCalled();expect(hit).toHaveBeenCalledTimes(1);
    clientNow=1190;g.frame(clientNow);
    expect(trace).toHaveBeenCalledTimes(1);
    g.frame(clientNow);expect(trace).toHaveBeenCalledTimes(1);expect(hit).toHaveBeenCalledTimes(1);
    trace.mockRestore();hit.mockRestore();
  } finally {clock.mockRestore();}
});

it('uses the accepted narrow-gap view for rendering and the next input in local and predicted play', async () => {
  for(const online of [false,true]) {
    const g=await connect();await deliver(g);
    if(!online)g.start('training','净空消费');
    const simulation=online?g.prediction!:g.sim!,p=online?g.predicted!:simulation.players.find(p=>p.id===g.you)!;
    Object.assign(p,{x:100,y:.015,z:100,yaw:0,pitch:0,crouch:true,stancePhase:1,stanceRate:0,stanceTarget:true,vx:0,vy:0,vz:0});
    simulation.bots=false;
    simulation.world.createCollider(RAPIER.ColliderDesc.cuboid(4,.1,4).setTranslation(100,-.1,100));
    for(const z of [99.62,100.38])simulation.world.createCollider(RAPIER.ColliderDesc.cuboid(2,1,.05).setTranslation(100,1,z));
    simulation.world.step();
    g.snapshot!.phase='live';g.keys.add('KeyC');g.paused=false;g.yaw=0;g.pitch=1.5;
    let displayed:Player|undefined;
    const frame=vi.spyOn(g.art,'frame').mockImplementation((_dt,player)=>{displayed=player;});
    const before={...p};g.acc=1/60;g.frame(g.last||1000);
    observations[`clearance-${online}`]={before,after:{...p},resolution:simulation.poseResolution(p),eyeAndHead:simulation.poseClearance(p)};
    expect(simulation.poseResolution(p)?.status,JSON.stringify(observations[`clearance-${online}`])).toBe('blocked');
    expect(p.pitch).toBe(0);expect(g.pitch).toBe(0);expect(displayed?.pitch).toBe(0);
    expect(g.input().pitch).toBe(0);frame.mockRestore();
  }
});

it('does not emit firearm FX for a predicted knife attack in the real frame loop', async () => {
  const g = await connect(); await deliver(g);
  const prediction = g.prediction!;
  g.sourceScenario = {} as any;
  g.snapshot!.phase = 'live'; g.active = true; g.paused = false;
  g.predicted!.weapon = 'knife'; g.predicted!.alive = true;
  vi.spyOn(prediction, 'predictSourceCommand').mockReturnValue(true);
  vi.spyOn(g, 'input').mockReturnValue({ ...EMPTY_INPUT, seq: 901, fire: true, slot: 2 });
  const shot = vi.spyOn(g.audio, 'shot');
  const casing = vi.spyOn(g.art, 'ejectCasing');
  const flash = vi.spyOn(g.art, 'sourceFirstPersonFlash');
  g.acc = 1 / 60; g.last = 1000;
  (g as any).frameStep(1017);
  expect(shot).not.toHaveBeenCalled();
  expect(casing).not.toHaveBeenCalled();
  expect(flash).not.toHaveBeenCalled();
  expect(g.art.kick).toBe(1);
});

it('keeps an explicit unacknowledged slot switch ahead of an old authority snapshot', async () => {
  const g = await connect(); await deliver(g);
  // Drive the real keydown/input path while the server still reports slot 0.
  g.paused = false; g.active = true;
  dom.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Digit2', repeat: false }));
  const requested = g.input();
  expect(requested).toMatchObject({ slot: 1, slotSelect: true });
  await deliver(g);
  // The stale snapshot must not mirror slot 0 back over the pending request.
  expect(g.keys.has('Digit2')).toBe(true);
  expect(g.input()).toMatchObject({ slot: 1, slotSelect: false });
  await rpc('seed', g.room!.roomId, { playerId: g.you, patch: { slot: 1, weapon: 'sidearm' } });
  await deliver(g);
  expect(g.keys.has('Digit2')).toBe(true);
});

it('latches one drop action per KeyX press and ignores autorepeat', async () => {
  const g = await connect(); await deliver(g);
  g.paused = false; g.active = true;
  dom.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyX', repeat: false }));
  expect(g.input().drop).toBe(true);
  // Browsers may emit repeated keydown events while the key remains held;
  // those must not enqueue another drop after the one-shot input was consumed.
  dom.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyX', repeat: true }));
  expect(g.input().drop).toBe(false);
  dom.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyX' }));
});

it('real Game sends no default frame input before its own authoritative snapshot', async () => {
  const g = await connect(); const before = await seed(g);
  for (let i = 0; i < 6; i++) tick(g);
  await delay(100);
  const held = await rpc('state', g.room!.roomId);
  observations.delayedFrame = { before, held, localYaw: g.yaw };
  expect(stateMessages(held), 'No state-dependent packet may precede own snapshot').toEqual([]);
  g.keys.add('KeyW'); g.pressed.add('KeyR'); g.firing = true;
  await deliver(g); g.resume(); tick(g);
  const state = await until(() => rpc('state', g.room!.roomId), s => s.messages.some(m => m.type === 'input'), 'first input');
  const first = state.messages.find(m => m.type === 'input')!.value;
  observations.firstInput = first;
  expect(first).toMatchObject({ seq: 1, yaw: Math.PI / 2, pitch: 0.27, slot: 1,
    mx: 0, mz: 0, fire: false, reload: false });
});

it('pause, buy, restart and resume remain gated before own state without queueing actions', async () => {
  const g = await connect(); await seed(g);
  g.pause(); g.buy('armor'); g.restart(); g.resume();
  await delay(100);
  const held = await rpc('state', g.room!.roomId); observations.earlyActions = held;
  expect(stateMessages(held)).toEqual([]); expect(dom.pointerLockElement).toBeNull();
  await deliver(g); tick(g); await delay(50);
  const synced = await rpc('state', g.room!.roomId);
  expect(synced.messages.filter(m => m.type === 'buy' || m.type === 'restart')).toEqual([]);
  g.pause(); await delay(50);
  expect((await rpc('state', g.room!.roomId)).messages.filter(m => m.type === 'input').at(-1)!.value)
    .toMatchObject({ yaw: Math.PI / 2, pitch: 0.27, slot: 1 });
});

it('a snapshot without self and a late old-room callback cannot unlock the current room', async () => {
  const g = await connect(); const oldRoom = g.room!, oldCallback = callbacks.get(oldRoom)!;
  const oldState = await rpc<Snapshot>('snapshot', oldRoom.roomId, { playerId: g.you });
  await until(async () => g.predicted, Boolean, 'initial old room ready');
  g.leave(); oldCallback(structuredClone(oldState));
  expect(g.snapshot).toBeNull(); expect(g.active).toBe(false);
  await connect(g); await seed(g);
  await rpc('snapshotWithoutOwn', g.room!.roomId, { playerId: g.you }); await delay(40);
  tick(g); oldCallback(structuredClone(oldState)); tick(g); g.pause();
  await delay(70);
  const held = await rpc('state', g.room!.roomId); observations.staleAndMissingSelf = held;
  expect(stateMessages(held)).toEqual([]);
  await deliver(g); tick(g); await delay(50);
  expect((await rpc('state', g.room!.roomId)).messages.find(m => m.type === 'input')!.value)
    .toMatchObject({ yaw: Math.PI / 2, pitch: 0.27, slot: 1 });
});

it('page teardown preserves the Colyseus seat for a fresh SDK reconnect', async () => {
  const storage = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
  vi.stubGlobal('localStorage', fakeStorage);
  try {
    const g = await connect(); await seed(g); await deliver(g);
    const id = g.you, roomId = g.room!.roomId;
    const token = readRoomRecovery()?.token;
    expect(token).toBe(g.room!.reconnectionToken);
    // This is the same path used by the page's React unmount on reload. It
    // closes with MAY_TRY_RECONNECT and removes room listeners, so the server
    // retains the spent seat and no old callback can clear the token.
    g.dispose({ preserveRoomRecovery: true });
    await until(async () => rpc<State>('state', roomId), state => state.retained.includes(id), 'page teardown seat reservation');
    const recovered = await new Client(endpoint).reconnect(token!);
    expect(recovered.sessionId).toBe(id);
    expect(recovered.roomId).toBe(roomId);
    observations.pageRefreshRecovery = { sameRoom: recovered.roomId === roomId, sameSession: recovered.sessionId === id };
    recovered.reconnection.enabled = false;
    await recovered.leave();
  } finally {
    vi.unstubAllGlobals();
    vi.stubGlobal('document', dom);
    vi.stubGlobal('window', Object.assign(new Surface(), { performance }));
    vi.stubGlobal('location', { protocol: 'http:' });
    vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {});
  }
});

it('real Game and SDK recovery require a fresh own snapshot and retain the spent seat', async () => {
  const g = await connect(); await seed(g); await deliver(g); tick(g); await delay(50);
  const room = g.room!, id = g.you;
  let reconnected = 0; room.onReconnect(() => reconnected++);
  await rpc('drop', room.roomId, { playerId: id });
  await until(async () => reconnected, n => n === 1, 'actual SDK recovery');
  await rpc('clearMessages', room.roomId);
  expect(g.recovering).toBe(true);
  tick(g); g.pause(); g.buy('armor'); g.restart(); g.resume(); await delay(70);
  const waiting = await rpc('state', room.roomId);
  expect(stateMessages(waiting)).toEqual([]);
  expect(waiting.players.find(p => p.id === id)).toMatchObject({ hp: 34, money: 150, ammo: 3, reserve: 7 });
  // Change only authority angles: do not reseed resources and mask a recovery regression.
  await rpc('seed', room.roomId, { playerId: id, patch: { yaw: 1.1, pitch: -0.18 } });
  const snapshot = await deliver(g);
  expect(g.recovering).toBe(false); expect(g.room).toBe(room); expect(g.you).toBe(id);
  expect(snapshot.players.find(p => p.id === id)).toMatchObject({ hp: 34, money: 150, ammo: 3, reserve: 7 });
  tick(g); await delay(60);
  const recovered = await rpc('state', room.roomId); observations.recovery = { waiting, recovered };
  expect(recovered.messages.find(m => m.type === 'input')!.value).toMatchObject({ yaw: 1.1, pitch: -0.18, slot: 1 });
});

it('cancellation before a real SDK create resolves leaves the late room without adopting its seat', async () => {
  const g = await connect(); g.leave();
  const originalCreate = Client.prototype.create;
  let lateRoom: Room | undefined, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  // Delay only delivery of the real SDK result, as a slow create request would do.
  const spy = vi.spyOn(Client.prototype, 'create').mockImplementation(async function (this: Client, ...args: any[]) {
    lateRoom = await originalCreate.apply(this, args as [string, any]);
    roomIds.add(lateRoom.roomId);
    await gate;
    return lateRoom;
  });
  try {
    const pending = g.connect(endpoint, `I${String(++code).padStart(5, '0')}`, '迟到连接', true);
    await until(async () => lateRoom, Boolean, 'real late create handshake');
    const before = await rpc('state', lateRoom!.roomId);
    g.cancelConnect(); release(); await pending; tick(g); g.pause();
    await until(() => rpc<State | null>('state', lateRoom!.roomId), s => s === null, 'late room cleaned');
    observations.cancelledCreate = { before, gameRoom: g.room, active: g.active, callbackInstalled: callbacks.has(lateRoom!) };
    expect(g.room).toBeNull(); expect(g.snapshot).toBeNull(); expect(g.active).toBe(false);
    expect(callbacks.has(lateRoom!)).toBe(false);
  } finally { release(); spy.mockRestore(); }
});

it('draws the Source authoritative bullet once after predicted local audio without duplicating a casing',async()=>{
 const g=await connect();const a=await deliver(g);g.active=false;
 const id=Math.max(0,...a.events.map(e=>e.id))+100,seq=812;
 g.predictedShots.add(seq);
 const b=structuredClone(a);b.events=[{id,type:'shot',by:g.you,seq,x:1,y:2,z:3,dx:4,dy:5,dz:6,weapon:'vandal',
  sourceRifleShot:sourceRifleHandlingShot(createSourceRifleHandlingState('ak47'),{grounded:true},a.time,77).shot}];
 callbacks.get(g.room!)!(b);
 const trace=vi.spyOn(g.art,'trace'),audio=vi.spyOn(g.audio,'shot');
 g.acc=0;g.frame(g.last||1000);
 expect(trace).toHaveBeenCalledExactlyOnceWith(1,2,3,4,5,6,true,false);expect(audio).not.toHaveBeenCalled();
 g.frame(g.last||1000);expect(trace).toHaveBeenCalledTimes(1);expect(g.predictedShots.has(seq)).toBe(false);
});
