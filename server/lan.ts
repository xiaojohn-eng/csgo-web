import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { WEB_VERSION } from '../game/protocol.js';
import { networkInterfaces } from 'node:os';
import {SOURCE_DUST2_ID,LEGACY_MAP_ID} from '../game/source-identity.js';
import {SOURCE_DEFAULT_RULE_SET,isSourceRuleSetId,type SourceRuleSetId} from '../game/source-gamemode.js';

export { WEB_VERSION };
export const MAP_ID = LEGACY_MAP_ID;
export type JoinOptions = { version?: unknown; name?: unknown; roomName?: unknown; code?: unknown; mapId?:unknown;simulationVersion?:unknown;rules?:unknown };
/** The original rule set the client asks the room to be created or joined on. An
 * unknown id is refused instead of silently falling back to the default, so a peer
 * can never end up on rules the authority is not running. */
export function requestedRuleSet(options:JoinOptions):SourceRuleSetId{
  const rules=options.rules??SOURCE_DEFAULT_RULE_SET;
  if(!isSourceRuleSetId(rules))throw Error('RULES_MISMATCH: 不支持此赛制');
  return rules;
}
/** Code-only joins adopt the room's rules. An explicitly selected directory
 * entry must still match when the join arrives at the authority. */
export function requireRoomRuleSet(options:JoinOptions,expected:SourceRuleSetId):void{
  if(options.rules!==undefined && requestedRuleSet(options)!==expected)
    throw Error('RULES_MISMATCH: 房间赛制已变化，请刷新房间列表后加入');
}
export function requestedMapId(options:JoinOptions){
  const map=options.mapId??LEGACY_MAP_ID;
  if(map!==LEGACY_MAP_ID&&map!==SOURCE_DUST2_ID)throw Error('MAP_MISMATCH: 不支持此地图版本');
  return map;
}
export function requireSimulationVersion(options:JoinOptions,expected?:string){
  if(requestedMapId(options)===SOURCE_DUST2_ID&&(!expected||options.simulationVersion!==expected))
    throw Error('SIMULATION_MISMATCH: 地图物理数据已更新，请刷新网页后重新加入');
}

export function lanAddresses(interfaces = networkInterfaces()): string[] {
  // macOS VM bridges (bridge100/101/…) give the host .0-style addresses the
  // kernel refuses to connect to (EADDRNOTAVAIL); LAN peers reach the server
  // through physical/wireless adapters, never through these bridges.
  return [...new Set(Object.entries(interfaces).flatMap(([name, entries]) =>
    (name.startsWith('bridge') ? [] : entries ?? [])
      .filter(entry => entry.family === 'IPv4' && !entry.internal &&
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(entry.address))
      .map(entry => entry.address)))].sort();
}

export function defaultOrigins(port: number, addresses = lanAddresses()): string[] {
  return ['http://127.0.0.1:' + port, 'http://localhost:' + port,
    ...addresses.map(address => `http://${address}:${port}`)];
}

export function serverInfo(port: number, host: string, origins: readonly string[], addresses = lanAddresses()) {
  const allInterfaces = host === '0.0.0.0' || host === '::';
  const loopback = allInterfaces || host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const localOrigin = `http://127.0.0.1:${port}`;
  const localUrl = loopback && origins.includes(localOrigin) ? localOrigin + '/' : null;
  const lanUrls = addresses.filter(address => allInterfaces || address === host)
    .map(address => `http://${address}:${port}`)
    .filter(origin => origins.includes(origin)).map(origin => origin + '/');
  return { name: 'CSGO WEB', version: WEB_VERSION, protocol: WEB_VERSION, host, port,
    localUrl, lanUrls, urls: [...(localUrl ? [localUrl] : []), ...lanUrls], maxPlayers: 10 };
}

export function requireWebVersion(options: unknown): asserts options is JoinOptions {
  if (!options || typeof options !== 'object' || (options as JoinOptions).version !== WEB_VERSION)
    throw new Error(`VERSION_MISMATCH: 客户端版本不支持，请刷新网页，要求 ${WEB_VERSION}`);
}

export function cleanRoomName(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/[\p{C}<>]/gu, '').trim() : '';
  return Array.from(text).slice(0, 32).join('') || '局域网行动';
}

export function parseAllowedOrigins(value: string): string[] {
  const origins = value.split(',').map(origin => origin.trim());
  for (const origin of origins) {
    let valid = false;
    try {
      const url = new URL(origin);
      valid = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
        !origin.includes('*') && url.origin === origin;
    } catch { /* invalid origin below */ }
    if (!valid) throw new Error('ALLOWED_ORIGINS 必须为逗号分隔的准确 HTTP/HTTPS origin，不允许 *、路径或凭据');
  }
  return [...new Set(origins)];
}

export function isControlRequest(url: string): boolean {
  const path = decodeURIComponent(new URL(url, 'http://local.invalid').pathname);
  return /^\/(api|matchmake)(\/|$)/i.test(path);
}

// Colyseus 0.18 installs its own HTTP router ahead of Express, including CORS
// preflights. Wrap that final dispatcher so matching cannot bypass this policy.
// Call synchronously after server.listen resolves, before the next I/O turn.
export function installHttpGuard(server: HttpServer, origins: readonly string[]) {
  const listeners = server.listeners('request');
  if (listeners.length !== 1) throw new Error(`Expected one Colyseus HTTP dispatcher, received ${listeners.length}`);
  const rates = new Map<string, { count: number; time: number }>();
  server.removeListener('request', listeners[0] as (req: IncomingMessage, res: ServerResponse) => void);
  server.on('request', (req, res) => {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');
    if (origin && !origins.includes(origin)) {
      res.writeHead(403).end('Origin not allowed');
      return;
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    let controlRequest: boolean;
    try { controlRequest = isControlRequest(req.url ?? '/'); }
    catch { res.writeHead(400).end('Malformed URL'); return; }
    if (controlRequest) {
      const now = Date.now();
      const key = req.socket.remoteAddress ?? 'unknown';
      let rate = rates.get(key);
      if (!rate || now - rate.time >= 10000) {
        rate = { count: 0, time: now };
        rates.set(key, rate);
      }
      if (++rate.count > 300) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((rate.time + 10000 - now) / 1000))));
        res.writeHead(429).end('Too many control requests');
        return;
      }
      if (rates.size > 10000) rates.delete(rates.keys().next().value!);
    }
    listeners[0].call(server, req, res);
  });
}
