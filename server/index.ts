import {loadServerSourceDeagle} from './source-deagle-data.js';
import {loadServerSourceAWP} from './source-awp-data.js';
import { filterVisibility } from './visibility.js';
import { Server, Room, matchMaker, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import helmet from 'helmet';
import { resolve,sep } from 'node:path';
import {readFile} from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  WEB_VERSION, MAP_ID, requireWebVersion, cleanRoomName,requestedMapId,requireSimulationVersion,
  parseAllowedOrigins, installHttpGuard, defaultOrigins, serverInfo, requestedRuleSet, requireRoomRuleSet, type JoinOptions,
} from './lan.js';
import { Simulation, initPhysics } from '../game/simulation.js';
import { SOURCE_DEFAULT_RULE_SET, type SourceRuleSetId } from '../game/source-gamemode.js';
import { validSkinId } from '../game/skin-catalog.js';
import {validSourceWeaponFinish,sourceFinishWeapon} from '../game/source-weapon-finish.js';
import {SOURCE_DUST2_ID,DUST2_BSP_SHA256} from '../game/source-identity.js';
import {loadServerSourceMap} from './source-map-data.js';
import {loadServerSourceCharacter} from './source-character-data.js';
import {createSourceRifleProfiles} from '../game/source-rifle-profiles.js';
import {loadServerSourcePistol} from './source-pistol-data.js';
import {parseSourceRagdollData} from '../game/source-ragdoll.js';
import type {SourceScenario} from '../game/source-scenario.js';
import {SOURCE_BUY_ZONES} from '../game/source-buy-zone-data.js';
import {
  validateInput,
  cleanName,
  EMPTY_INPUT,
  type Input,
} from '../game/types.js';
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 24);
if (!Number.isSafeInteger(MAX_ROOMS) || MAX_ROOMS < 1) throw new Error('MAX_ROOMS must be a positive integer');
let activeRooms = 0;
const directory = new Map<string, OperationRoom>();
const reservedCodes = new Set<string>();
const port = Number(process.env.PORT || 27015);
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535');
const host = process.env.HOST || '0.0.0.0';
let actualPort = port;
const webRoot=process.env.WEB_ROOT?resolve(process.env.WEB_ROOT):fileURLToPath(new URL(
  import.meta.url.endsWith('.ts')?'../release/web/':'../../web/',import.meta.url));
const allowedOrigins = parseAllowedOrigins(
  process.env.ALLOWED_ORIGINS ?? defaultOrigins(port).join(',')
);
export class OperationRoom extends Room {
  maxClients = 10;
  /** The original mode this room plays, fixed for the room's lifetime. */
  ruleSet: SourceRuleSetId = SOURCE_DEFAULT_RULE_SET;
  sim!: Simulation;
  queues = new Map<string, Input[]>();
  connectedSessions = new Set<string>();
  reconnectingSessions = new Map<string, number>();
  seatOrigins = new Map<string, { id: string; name: string }>();
  lastSeq = new Map<string, number>();
  lastPacket = new Map<string, number>();
  counts = new Map<string, { start: number; count: number }>();
  host = '';
  eventCursor = new Map<string, number>();
  lastBroadcast = 0;
  counted = false;
  displayName = '';
  code = '';
  closing = false;
  disposed = false;
  mapId:string=MAP_ID;
  simulationVersion?:string;
  static async onAuth(_token: string, options: unknown) {
    requireWebVersion(options);
    return true;
  }
  async onCreate(options: JoinOptions) {
    requireWebVersion(options);
    this.mapId=requestedMapId(options);
    if (activeRooms >= MAX_ROOMS) throw new Error('服务器房间已满，请稍后再试');
    if (typeof options.code !== 'string' || !/^[A-Z0-9]{6}$/.test(options.code))
      throw new Error('房间代码需要 6 位字母或数字');
    if (reservedCodes.has(options.code)) throw new Error('CODE_IN_USE: 房间代码已存在，请重新创建');
    this.code = options.code;
    this.displayName = cleanRoomName(options.roomName);
    this.ruleSet = requestedRuleSet(options);
    reservedCodes.add(this.code);
    activeRooms++;
    this.counted = true;
    try {
      await initPhysics();
      let scenario:SourceScenario|undefined;
      if(this.mapId===SOURCE_DUST2_ID){
        const [map,character,ct,tM4,ctM4,tGlock,ctGlock,tUSP,ctUSP,tDeagle,ctDeagle,tAWP,ctAWP,ragdollRaw,impactRaw]=await Promise.all([
          loadServerSourceMap(resolve(webRoot,'source/csgo-12426148/dust2/manifest.json')),
          loadServerSourceCharacter(resolve(webRoot,'source/csgo-12426148/character-ak/manifest.json')),
          loadServerSourceCharacter(resolve(webRoot,'source/csgo-12426148/character-ct-ak/manifest.json')),
          loadServerSourceCharacter(resolve(webRoot,'source/csgo-12426148/character-t-m4/manifest.json')),
          loadServerSourceCharacter(resolve(webRoot,'source/csgo-12426148/character-ct-m4/manifest.json')),
          loadServerSourcePistol(resolve(webRoot,'source/csgo-12426148/character-t-glock/manifest.json'),'t','glock'),
          loadServerSourcePistol(resolve(webRoot,'source/csgo-12426148/character-ct-glock/manifest.json'),'ct','glock'),
          loadServerSourcePistol(resolve(webRoot,'source/csgo-12426148/character-t-usp/manifest.json'),'t','usp'),
          loadServerSourcePistol(resolve(webRoot,'source/csgo-12426148/character-ct-usp/manifest.json'),'ct','usp'),
          loadServerSourceDeagle(resolve(webRoot,'source/csgo-12426148/character-t-deagle/manifest.json'),'t'),
          loadServerSourceDeagle(resolve(webRoot,'source/csgo-12426148/character-ct-deagle/manifest.json'),'ct'),
          loadServerSourceAWP(resolve(webRoot,'source/csgo-12426148/character-t-awp/manifest.json'),'t'),
          loadServerSourceAWP(resolve(webRoot,'source/csgo-12426148/character-ct-awp/manifest.json'),'ct'),
          readFile(resolve(webRoot,'source/csgo-12426148/ragdoll/ragdoll-data.json'),'utf8'),
          readFile(resolve(webRoot,'source/csgo-12426148/impact/surface-props.json'),'utf8'),
        ]);
        const ragdoll=parseSourceRagdollData(JSON.parse(ragdollRaw));
        // The room's shots report the original surface property of the face they hit, from
        // the same staged table the browser bundle carries.
        const impacts:unknown=JSON.parse(impactRaw);
        const profiles=createSourceRifleProfiles({amber:{vandal:character,m4a4:tM4},blue:{vandal:ct,m4a4:ctM4}},map.simulationVersion,{amber:tGlock,blue:ctGlock},{amber:tUSP,blue:ctUSP},{amber:tDeagle,blue:ctDeagle},{amber:tAWP,blue:ctAWP},ragdoll);
        requireSimulationVersion(options,profiles.simulationVersion);
        this.simulationVersion=profiles.simulationVersion;
        scenario={...map,mapId:this.mapId,...profiles,buyZones:SOURCE_BUY_ZONES,impacts};
      }
      await this.setMetadata({ code: this.code, name: this.displayName, version: WEB_VERSION, mode: 'demolition', rules: this.ruleSet, mapId: this.mapId,simulationVersion:this.simulationVersion });
      this.sim = new Simulation('demolition',true,scenario,this.ruleSet);
      this.sim.fillBots();
      directory.set(this.roomId, this);
      this.onMessage('input', (client: Client, value: unknown) => {
        if (!this.connectedSessions.has(client.sessionId)) return;
        if (!this.rate(client.sessionId, 100)) return;
        const i = validateInput(value, this.lastSeq.get(client.sessionId) ?? -1);
        if (!i) return;
        const q = this.queues.get(client.sessionId);
        if (!q) return;
        this.lastSeq.set(client.sessionId, i.seq);
        this.lastPacket.set(client.sessionId, Date.now());
        if (q.length >= 8) q.shift();
        q.push({
          ...i,
          time: Math.max(this.sim.time - 0.2, Math.min(this.sim.time, i.time)),
        });
      });
      this.onMessage('buy', (client: Client, item: unknown) => {
        if (!this.connectedSessions.has(client.sessionId)) return;
        if (!this.rate(client.sessionId, 100) || typeof item !== 'string') return;
        if (!this.sim.buy(client.sessionId, item))
          client.send('notice', '购买失败：请检查余额、阵营、装备持有上限与购买区时限');
      });
      this.onMessage('skin', (client: Client, value: unknown) => {
        if (!this.connectedSessions.has(client.sessionId) || !this.rate(client.sessionId, 100)) return;
        if (typeof value !== 'string' || validSkinId(value) !== value) return;
        const player = this.sim.players.find(candidate => candidate.id === client.sessionId);
        if (player) player.skin = value;
      });
      this.onMessage('sourceFinish',(client:Client,value:unknown)=>{
        if(this.mapId!==SOURCE_DUST2_ID||!this.connectedSessions.has(client.sessionId)||!this.rate(client.sessionId,100))return;
        const finish=validSourceWeaponFinish(value);if(value!==null&&!finish)return;
        const p=this.sim.players.find(p=>p.id===client.sessionId);if(!p)return;
        // Legacy clients may still send one active finish. Never let a packet
        // for another weapon overwrite the entity currently in hand.
        if(finish&&finish.weapon===p.weapon)p.sourceWeaponFinish=finish;
        else if(value===null)delete p.sourceWeaponFinish;
      });
      this.onMessage('sourceFinishLoadout',(client:Client,value:unknown)=>{
        if(this.mapId!==SOURCE_DUST2_ID||!this.connectedSessions.has(client.sessionId)||!this.rate(client.sessionId,100))return;
        const p=this.sim.players.find(row=>row.id===client.sessionId);if(!p)return;
        if(Array.isArray(value)){this.sim.setSourceFinishLoadoutBulk(client.sessionId,value);return;}
        if(!value||typeof value!=='object')return;
        const row=value as Record<string,unknown>,weapon=typeof row.weapon==='string'?row.weapon:null;
        if(!weapon)return;
        const finish=row.finish===null?null:validSourceWeaponFinish(row.finish),finishWeapon=sourceFinishWeapon(weapon);
        if(!finishWeapon||row.finish!==null&&(!finish||finish.weapon!==finishWeapon))return;
        this.sim.setSourceFinishLoadout(client.sessionId,finishWeapon,finish);
      });
      this.onMessage('ping', (client: Client, n: unknown) => {
        if (
          this.rate(client.sessionId, 100) &&
          typeof n === 'number' &&
          Number.isFinite(n)
        )
          client.send('pong', n);
      });
      this.onMessage('restart', (client: Client) => {
        if (!this.connectedSessions.has(client.sessionId)) return;
        if (this.sim.phase === 'match' && client.sessionId === this.host) {
          this.sim.restart();
          this.queues.forEach((q) => (q.length = 0));
        } else client.send('notice', '整场结束后，房主可以发起下一场行动');
      });
      this.setFixedTimestep(() => {
        for (const p of this.sim.players.filter((p) => !p.bot)) {
          if (!this.connectedSessions.has(p.id)) {
            this.clearSessionInput(p.id);
            continue;
          }
          const q = this.queues.get(p.id),
            input = q?.shift();
          if (input) this.sim.setInput(p.id, input);
          else if (Date.now() - (this.lastPacket.get(p.id) ?? 0) > 200)
            this.sim.setInput(p.id, {
              ...EMPTY_INPUT,
              seq: p.ack,
              yaw: p.yaw,
              pitch: p.pitch,
              slot: p.slot,
              time: this.sim.time,
            });
        }
        this.sim.step();
        if (this.sim.tick % 3 === 0) this.sendSnapshots();
      }, 60);
    } catch (error) {
      // Colyseus has not registered its disposal callback while onCreate runs.
      this.onDispose();
      throw error;
    }
  }
  rate(id: string, max: number) {
    let v = this.counts.get(id);
    if (!v || Date.now() - v.start > 1000) {
      v = { start: Date.now(), count: 0 };
      this.counts.set(id, v);
    }
    return ++v.count <= max;
  }
  onJoin(client: Client, options: JoinOptions) {
    requireWebVersion(options);
    requireRoomRuleSet(options,this.ruleSet);
    if(requestedMapId(options)!==this.mapId)throw Error('MAP_MISMATCH: 房间与客户端地图不同');
    requireSimulationVersion(options,this.simulationVersion);
    if (this.closing) throw new Error('ROOM_CLOSED: 房间已经关闭');
    const count = (team: string) => this.sim.players.filter(p => p.team === team && !p.bot).length;
    const teams = count('amber') <= count('blue') ? ['amber', 'blue'] : ['blue', 'amber'];
    const bot = teams.map(team => [...this.sim.players].reverse().find(p => p.team === team && p.bot)).find(Boolean);
    if (!bot) throw new Error('ROOM_FULL: 所有战斗席位已占用或等待重连');
    const origin = { id: bot.id, name: bot.name };
    this.sim.transferControl(bot.id, client.sessionId, cleanName(options.name), false);
    this.seatOrigins.set(client.sessionId, origin);
    this.queues.set(client.sessionId, []);
    this.connectedSessions.add(client.sessionId);
    this.lastPacket.set(client.sessionId, Date.now());
    this.eventCursor.set(client.sessionId, this.sim.eid);
    if (!this.host) this.host = client.sessionId;
    this.sendRoomInfo();
  }
  roomInfo() {
    return { roomId: this.roomId, name: this.displayName, code: this.code,
      players: this.connectedSessions.size, reconnectingPlayers: this.reconnectingSessions.size,
      maxPlayers: this.maxClients, mode: 'demolition' as const, rules: this.ruleSet,
      mapId: this.mapId, sourceBspSha256:this.mapId===SOURCE_DUST2_ID?DUST2_BSP_SHA256:undefined,simulationVersion:this.simulationVersion,status: this.sim.phase, version: WEB_VERSION,
      bots: this.sim.players.filter(p => p.bot).length, hostId: this.host };
  }
  sendRoomInfo() {
    this.broadcast('roomInfo', this.roomInfo());
  }
  sendSnapshots() {
    for (const client of this.clients) {
      const s = this.sim.snapshot(client.sessionId),
        own = s.players.find((p) => p.id === client.sessionId);
      if (!own) continue;
      filterVisibility(
        s,
        client.sessionId,
        this.eventCursor.get(client.sessionId) ?? 0,
        this.sim,
      );
      this.eventCursor.set(client.sessionId, this.sim.eid);
      client.send('snapshot', s);
    }
  }
  clearSessionInput(id: string) {
    const p = this.sim.players.find(p => p.id === id);
    if (!p) return;
    const q = this.queues.get(id);
    if (q) q.length = 0;
    p.vx = p.vz = 0;
    p.use = p.reload = 0;
    this.sim.setInput(id, { ...EMPTY_INPUT, seq: p.ack, yaw: p.yaw, pitch: p.pitch,
      crouch: p.crouch, slot: p.slot, time: this.sim.time });
  }
  chooseConnectedHost() {
    if (!this.connectedSessions.has(this.host)) this.host = this.connectedSessions.values().next().value ?? '';
  }
  onDrop(client: Client) {
    if (!this.queues.has(client.sessionId) || this.closing) return;
    this.connectedSessions.delete(client.sessionId);
    this.reconnectingSessions.set(client.sessionId, Date.now() + 30000);
    this.clearSessionInput(client.sessionId);
    this.chooseConnectedHost();
    // Colyseus calls onLeave after this reservation expires. That callback alone
    // transfers the seat to AI; a drop itself must not create another combat life.
    void this.allowReconnection(client, 30).catch(() => {});
    this.sendRoomInfo();
  }
  onReconnect(client: Client) {
    if (this.closing || !this.reconnectingSessions.has(client.sessionId))
      throw new Error('RECONNECT_EXPIRED: 原席位已结束保留');
    const p = this.sim.players.find(p => p.id === client.sessionId);
    if (!p) throw new Error('RECONNECT_EXPIRED: 原战斗席位不存在');
    this.reconnectingSessions.delete(client.sessionId);
    this.connectedSessions.add(client.sessionId);
    this.clearSessionInput(client.sessionId);
    this.lastSeq.set(client.sessionId, p.ack);
    this.lastPacket.set(client.sessionId, Date.now());
    this.counts.delete(client.sessionId);
    this.eventCursor.set(client.sessionId, this.sim.eid);
    this.chooseConnectedHost();
    this.sendRoomInfo();
  }
  onLeave(client: Client) {
    // A failed join/auth never became a human; it must not remove the host.
    if (!this.queues.has(client.sessionId)) return;
    this.connectedSessions.delete(client.sessionId);
    this.reconnectingSessions.delete(client.sessionId);
    this.clearSessionInput(client.sessionId);
    const origin = this.seatOrigins.get(client.sessionId);
    if (origin) this.sim.transferControl(client.sessionId, origin.id, origin.name, true);
    this.seatOrigins.delete(client.sessionId);
    this.queues.delete(client.sessionId);
    this.lastSeq.delete(client.sessionId);
    this.lastPacket.delete(client.sessionId);
    this.counts.delete(client.sessionId);
    this.eventCursor.delete(client.sessionId);
    this.chooseConnectedHost();
    if (this.connectedSessions.size === 0 && this.reconnectingSessions.size === 0) {
      this.closing = true;
      // Do not retain a bot-only room even if an unused seat reservation exists.
      void this.disconnect().catch(error => console.error('Room cleanup failed', error));
    } else this.sendRoomInfo();
  }
  onDispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.closing = true;
    this.connectedSessions.clear();
    this.reconnectingSessions.clear();
    this.seatOrigins.clear();
    this.sim?.dispose();
    directory.delete(this.roomId);
    if (this.counted) {
      reservedCodes.delete(this.code);
      activeRooms--;
      this.counted = false;
    }
  }
}
// Colyseus defaults to wildcard/reflected CORS independently of Express.
Reflect.deleteProperty(matchMaker.controller.DEFAULT_CORS_HEADERS, 'Access-Control-Allow-Origin');
matchMaker.controller.getCorsHeaders = (headers): Record<string, string> => {
  const origin = headers.get('origin');
  return origin && allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {};
};
const transport = new WebSocketTransport({
  maxPayload: 8192,
  beforeUpgrade: async (req) => {
    const origin = req.headers.get('origin');
    if (origin && !allowedOrigins.includes(origin))
      return new Response('Origin not allowed', { status: 403 });
  },
});
const server = new Server({
  transport,
  express: (app) => {
    app.disable('x-powered-by');
    app.use(
      helmet({
        // This server is served directly over LAN HTTP. Origin isolation headers
        // are not usable on that untrusted origin; retain CSP and exact guards.
        crossOriginOpenerPolicy: false,
        originAgentCluster: false,
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: [
              "'self'",
              // GLTFLoader fetches embedded images through local blob URLs.
              'blob:',
              ...allowedOrigins.map((o) => o.replace(/^http/, 'ws')),
            ],
            workerSrc: ["'self'", 'blob:'],
            // Local LAN play uses same-origin HTTP and WebSocket connections.
            upgradeInsecureRequests: null,
          },
        },
      }),
    );
    app.get('/api/server-info', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json(serverInfo(actualPort, host, allowedOrigins));
    });
    app.get('/api/rooms', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ version: WEB_VERSION, rooms: [...directory.values()]
        .filter(room => !room.closing && !!room.host && !room.locked && !room.hasReachedMaxClients())
        .map(room => room.roomInfo()) });
    });
    app.get('/health', (_req, res) =>
      res.setHeader('Cache-Control', 'no-store').json({
        status: 'ok',
        version: WEB_VERSION,
        instanceId: process.env.CSGO_INSTANCE_ID ?? null,
        rooms: activeRooms,
        maxRooms: MAX_ROOMS,
      }),
    );
    app.use(
      express.static(webRoot, {
        maxAge: '1h',
        setHeaders: (res, path) => {
          // Original asset URLs are stable across corrected exports. Revalidate
          // their ETags so a refresh cannot retain an old manifest/physics pair.
          if (path.endsWith('.html')||path.startsWith(resolve(webRoot,'source')+sep))
            res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
  },
});
server.define('operation', OperationRoom).filterBy(['code']);
const testLatency = Math.max(
  0,
  Math.min(1000, Number(process.env.TEST_LATENCY_MS) || 0),
);
if (process.env.NODE_ENV !== 'production' && testLatency > 0)
  server.simulateLatency(testLatency);
await server.listen(port, host);
if (!transport.server) throw new Error('HTTP transport server missing');
installHttpGuard(transport.server, allowedOrigins);
const bound = transport.server.address();
actualPort = typeof bound === 'object' && bound ? bound.port : port;
if (!process.env.ALLOWED_ORIGINS && actualPort !== port)
  allowedOrigins.splice(0, allowedOrigins.length, ...defaultOrigins(actualPort));
console.log(
  `CSGO WEB ${WEB_VERSION} authority server ready on ${host}:${actualPort}`,
);
