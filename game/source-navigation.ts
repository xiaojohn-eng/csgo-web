/** Original NAV area graph in Source units, queried using browser metres.
 * Static graph reachability is not a collision, support or movement verdict.
 */
export type SourceNavPoint = { x: number; y: number; z: number };
type V3 = [number, number, number];
export type SourceNavArea = {
  id: number; flags: number; nw: V3; se: V3; neZ: number; swZ: number;
  connections: number[][]; ladders: number[][]; place: number;
};
export type SourceNavLadder = {
  id: number; width: number; top: V3; bottom: V3; length: number; direction: number;
  topForwardArea: number; topLeftArea: number; topRightArea: number; topBehindArea: number; bottomArea: number;
};
export type SourceNavigationData = {
  format: 'source-navigation-v1'; version: number; subVersion: number; sourceNavSha256: string; sourceBspSha256: string;
  metersPerSourceUnit: number; places: string[]; areas: SourceNavArea[]; ladders: SourceNavLadder[];
};
export type SourceNavEdge = { from: number; to: number; kind: 'connection' | 'ladder-up' | 'ladder-down';
  direction: number | null; ladderId: number | null; cost: number };
export type SourceNavigationIndex = {
  readonly valid: boolean; readonly reason: string; readonly scale: number; readonly sourceNavSha256: string; readonly sourceBspSha256: string;
  readonly areas: readonly SourceNavArea[]; readonly areaById: ReadonlyMap<number, SourceNavArea>;
  readonly ladders: ReadonlyMap<number, SourceNavLadder>; readonly edges: ReadonlyMap<number, readonly SourceNavEdge[]>; readonly places: readonly string[];
};
export type SourceNavOptions = { blockedFlags?: number; allowLadders?: boolean; maxSnapDistance?: number; fromAreaId?: number };
export type SourceNavLocation = { areaId: number; point: SourceNavPoint; sourcePoint: V3; distance: number; flags: number; place: string | null;
  reachableFromAreaId: number | null };
export type SourceNavWaypoint = SourceNavPoint & { areaId: number; sourcePoint: V3; flags: number;
  kind: 'start' | 'portal-exit' | 'portal-enter' | 'ladder-bottom' | 'ladder-top' | 'goal'; ladderId: number | null };
export type SourceNavRoute = { status: 'path' | 'unreachable' | 'invalid-data' | 'invalid-endpoint' | 'no-start-area' | 'no-goal-area';
  areaIds: number[]; edges: SourceNavEdge[]; waypoints: SourceNavWaypoint[]; graphCost: number; staticOnly: true;
  start: SourceNavLocation | null; goal: SourceNavLocation | null };
export const SOURCE_NAV_FLAGS = {
  CROUCH: 1, JUMP: 2, PRECISE: 4, NO_JUMP: 8, STOP: 16, RUN: 32, WALK: 64, AVOID: 128,
  TRANSIENT: 256, STAIRS: 4096, NO_MERGE: 8192, OBSTACLE_TOP: 16384, CLIFF: 32768,
} as const;
const finitePoint = (p: SourceNavPoint) => p && [p.x, p.y, p.z].every(Number.isFinite);
const integer = (n: unknown, min = 0, max = 0xffffffff): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const browser = (v: V3, scale: number): SourceNavPoint => ({ x: v[0] * scale, y: v[2] * scale, z: -v[1] * scale });
const source = (p: SourceNavPoint, scale: number): V3 => [p.x / scale, -p.z / scale, p.y / scale];

/** SDK CNavArea::GetZ bilinear surface height, including its degenerate guard. */
export function sourceNavHeight(area: SourceNavArea, x: number, y: number): number {
  const dx = area.se[0] - area.nw[0], dy = area.se[1] - area.nw[1];
  if (dx === 0 || dy === 0) return area.neZ;
  const u = clamp((x - area.nw[0]) / dx, 0, 1), v = clamp((y - area.nw[1]) / dy, 0, 1);
  const north = area.nw[2] + u * (area.neZ - area.nw[2]), south = area.swZ + u * (area.se[2] - area.swZ);
  return north + v * (south - north);
}
function center(a: SourceNavArea): V3 { const x = (a.nw[0] + a.se[0]) / 2, y = (a.nw[1] + a.se[1]) / 2; return [x, y, sourceNavHeight(a, x, y)]; }
function failure(reason: string): SourceNavigationIndex { return { valid: false, reason, scale: .0254, sourceNavSha256: '', sourceBspSha256: '',
  areas: [], areaById: new Map(), ladders: new Map(), edges: new Map(), places: [] }; }
function check(condition: unknown, reason: string): asserts condition { if (!condition) throw new Error(reason); }

/** Validate/copy once. Invalid data never fabricates a fallback ground route. */
export function prepareSourceNavigation(input: unknown): SourceNavigationIndex {
  try {
    const d = input as SourceNavigationData;
    check(d?.format === 'source-navigation-v1' && d.version === 16 && d.subVersion === 1, 'unsupported-navigation-format');
    check(Number.isFinite(d.metersPerSourceUnit) && d.metersPerSourceUnit > 0, 'invalid-scale');
    check(Array.isArray(d.areas) && d.areas.length > 0 && d.areas.length <= 100000 && Array.isArray(d.ladders), 'invalid-count');
    check(Array.isArray(d.places) && d.places.every(p => typeof p === 'string'), 'invalid-places');
    const vector = (v: unknown): v is V3 => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
    const areas = d.areas.map(a => {
      check(integer(a.id, 1) && integer(a.flags) && vector(a.nw) && vector(a.se) && Number.isFinite(a.neZ) && Number.isFinite(a.swZ), 'invalid-area');
      check(a.se[0] >= a.nw[0] && a.se[1] >= a.nw[1] && integer(a.place, 0, d.places.length), 'invalid-area-bounds-place');
      check(a.connections.length === 4 && a.ladders.length === 2 && [...a.connections, ...a.ladders].every(v => Array.isArray(v) && v.every(id => integer(id, 1))), 'invalid-area-links');
      return { id: a.id, flags: a.flags, nw: [...a.nw] as V3, se: [...a.se] as V3, neZ: a.neZ, swZ: a.swZ,
        connections: a.connections.map(v => v.slice()), ladders: a.ladders.map(v => v.slice()), place: a.place };
    });
    const byId = new Map(areas.map(a => [a.id, a])); check(byId.size === areas.length, 'duplicate-area-id');
    const ladders = new Map<number, SourceNavLadder>();
    for (const l of d.ladders) {
      check(integer(l.id, 1) && !ladders.has(l.id) && vector(l.top) && vector(l.bottom) && Number.isFinite(l.width) && l.width > 0 &&
        Number.isFinite(l.length) && l.length > 0 && integer(l.direction, 0, 3), 'invalid-ladder');
      for (const id of [l.topForwardArea, l.topLeftArea, l.topRightArea, l.topBehindArea, l.bottomArea]) check(id === 0 || byId.has(id), 'invalid-ladder-area');
      ladders.set(l.id, { ...l, top: [...l.top], bottom: [...l.bottom] });
    }
    const edges = new Map<number, SourceNavEdge[]>(), scale = d.metersPerSourceUnit;
    for (const a of areas) {
      const list: SourceNavEdge[] = []; edges.set(a.id, list);
      for (const [direction, ids] of a.connections.entries()) for (const id of ids) {
        const b = byId.get(id); check(b, 'invalid-connection-area');
        if (id !== a.id) list.push({ from: a.id, to: id, direction, kind: 'connection', ladderId: null, cost: distance(center(a), center(b)) * scale });
      }
      for (const [direction, ids] of a.ladders.entries()) for (const id of ids) {
        const l = ladders.get(id); check(l, 'invalid-area-ladder');
        // SDK ascent uses forward/left/right; topBehind is preserved but is
        // deliberately not an upward exit in the documented SDK graph search.
        const destinations = direction === 0 ? [l.topForwardArea, l.topLeftArea, l.topRightArea] : [l.bottomArea];
        for (const target of destinations) if (target && target !== a.id) {
          const b = byId.get(target)!;
          const enter = direction === 0 ? l.bottom : l.top, exit = direction === 0 ? l.top : l.bottom;
          list.push({ from: a.id, to: target, direction: null, kind: direction === 0 ? 'ladder-up' : 'ladder-down', ladderId: id,
            cost: (distance(center(a), enter) + distance(enter, exit) + distance(exit, center(b))) * scale });
        }
      }
    }
    return { valid: true, reason: 'ready', scale, sourceNavSha256: d.sourceNavSha256, sourceBspSha256: d.sourceBspSha256,
      areas, areaById: byId, ladders, edges, places: d.places.slice() };
  } catch (error) { return failure(error instanceof Error ? error.message : 'invalid-data'); }
}
function allowed(area: SourceNavArea, options: SourceNavOptions) { return !(area.flags & (options.blockedFlags ?? 0)); }
function outgoing(index: SourceNavigationIndex, id: number, options: SourceNavOptions) {
  return (index.edges.get(id) ?? []).filter(e => (e.kind === 'connection' || options.allowLadders === true) && allowed(index.areaById.get(e.to)!, options));
}
function reachable(index: SourceNavigationIndex, id: number, options: SourceNavOptions) {
  const found = new Set<number>(), a = index.areaById.get(id); if (!a || !allowed(a, options)) return found;
  const queue = [id]; found.add(id);
  for (let i = 0; i < queue.length; i++) for (const e of outgoing(index, queue[i], options)) if (!found.has(e.to)) { found.add(e.to); queue.push(e.to); }
  return found;
}

/** Uses XY clamping + original bilinear Z and full 3D distance, not XZ-only
 * snapping. fromAreaId optionally restricts candidates to directed reachability.
 * Default max snap is 2 metres; a distant/unsupported endpoint yields null.
 */
export function nearestSourceNavArea(index: SourceNavigationIndex, point: SourceNavPoint, options: SourceNavOptions = {}): SourceNavLocation | null {
  if (!index.valid || !finitePoint(point)) return null;
  const maxDistance = options.maxSnapDistance ?? 2;
  if (!(maxDistance >= 0)) return null;
  const p = source(point, index.scale), permitted = options.fromAreaId === undefined ? null : reachable(index, options.fromAreaId, options);
  let result: SourceNavLocation | null = null;
  for (const area of index.areas) {
    if (!allowed(area, options) || permitted && !permitted.has(area.id)) continue;
    const x = clamp(p[0], area.nw[0], area.se[0]), y = clamp(p[1], area.nw[1], area.se[1]);
    const target: V3 = [x, y, sourceNavHeight(area, x, y)], d = distance(p, target) * index.scale;
    if (d > maxDistance || result && (d > result.distance || d === result.distance && area.id >= result.areaId)) continue;
    result = { areaId: area.id, point: browser(target, index.scale), sourcePoint: target, distance: d, flags: area.flags,
      place: index.places[area.place - 1] ?? null, reachableFromAreaId: options.fromAreaId ?? null };
  }
  return result;
}

type Entry = { id: number; cost: number };
class MinQueue {
  items: Entry[] = [];
  before(a: Entry, b: Entry) { return a.cost < b.cost || a.cost === b.cost && a.id < b.id; }
  push(value: Entry) { const a = this.items; let i = a.length; a.push(value); while (i > 0) { const p = (i - 1) >> 1; if (!this.before(value, a[p])) break; a[i] = a[p]; i = p; } a[i] = value; }
  pop() { const a = this.items, first = a[0], last = a.pop()!; if (a.length) { let i = 0; while (2 * i + 1 < a.length) {
    let c = 2 * i + 1; if (c + 1 < a.length && this.before(a[c + 1], a[c])) c++; if (!this.before(a[c], last)) break; a[i] = a[c]; i = c;
  } a[i] = last; } return first; }
}

/** Directed deterministic Dijkstra over original links. Cost is geometric
 * metres, not reconstructed CSGO tactical bot cost or a movement duration.
 */
export function findSourceNavAreaPath(index: SourceNavigationIndex, startId: number, goalId: number, options: SourceNavOptions = {}): { areaIds: number[]; edges: SourceNavEdge[]; cost: number } | null {
  const start = index.areaById.get(startId), goal = index.areaById.get(goalId);
  if (!index.valid || !start || !goal || !allowed(start, options) || !allowed(goal, options)) return null;
  const distances = new Map([[startId, 0]]), previous = new Map<number, SourceNavEdge>(), queue = new MinQueue(); queue.push({ id: startId, cost: 0 });
  while (queue.items.length) {
    const current = queue.pop(); if (current.cost !== distances.get(current.id)) continue; if (current.id === goalId) break;
    for (const edge of outgoing(index, current.id, options)) {
      const cost = current.cost + edge.cost;
      if (cost >= (distances.get(edge.to) ?? Infinity)) continue;
      distances.set(edge.to, cost); previous.set(edge.to, edge); queue.push({ id: edge.to, cost });
    }
  }
  if (!distances.has(goalId)) return null;
  const edges: SourceNavEdge[] = []; let id = goalId;
  while (id !== startId) { const e = previous.get(id); if (!e || edges.length > index.areas.length) return null; edges.push({ ...e }); id = e.from; }
  edges.reverse(); return { areaIds: [startId, ...edges.map(e => e.to)], edges, cost: distances.get(goalId)! };
}

function portal(a: SourceNavArea, b: SourceNavArea, direction: number): [V3, V3] {
  const axis = direction % 2 === 0 ? 0 : 1, cross = 1 - axis;
  const lo = Math.max(a.nw[axis], b.nw[axis]), hi = Math.min(a.se[axis], b.se[axis]);
  const shared = (lo + hi) / 2;
  const from = center(a), to = center(b);
  from[axis] = clamp(shared, a.nw[axis], a.se[axis]); to[axis] = clamp(shared, b.nw[axis], b.se[axis]);
  const positive = direction === 1 || direction === 2;
  from[cross] = positive ? a.se[cross] : a.nw[cross]; to[cross] = positive ? b.nw[cross] : b.se[cross];
  from[2] = sourceNavHeight(a, from[0], from[1]); to[2] = sourceNavHeight(b, to[0], to[1]); return [from, to];
}

/** Produces 3D feet/surface waypoints. Vertical portal pairs and ladder endpoints
 * stay separate; callers must not consume them solely by horizontal distance.
 */
export function findSourceNavPath(index: SourceNavigationIndex, from: SourceNavPoint, to: SourceNavPoint, options: SourceNavOptions = {}): SourceNavRoute {
  const result: SourceNavRoute = { status: 'invalid-data', areaIds: [], edges: [], waypoints: [], graphCost: Infinity, staticOnly: true, start: null, goal: null };
  if (!index.valid) return result;
  if (!finitePoint(from) || !finitePoint(to)) return { ...result, status: 'invalid-endpoint' };
  // Destination snapping is geometric, never silently moved into the start's
  // reachable component. A disconnected requested destination stays unreachable.
  const snapOptions = { ...options, fromAreaId: undefined }, start = nearestSourceNavArea(index, from, snapOptions), goal = nearestSourceNavArea(index, to, snapOptions);
  result.start = start; result.goal = goal;
  if (!start || !goal) return { ...result, status: !start ? 'no-start-area' : 'no-goal-area' };
  const path = findSourceNavAreaPath(index, start.areaId, goal.areaId, options);
  if (!path) return { ...result, status: 'unreachable' };
  const points: SourceNavWaypoint[] = [];
  const add = (p: V3, id: number, kind: SourceNavWaypoint['kind'], ladderId: number | null = null) => {
    points.push({ ...browser(p, index.scale), sourcePoint: [...p], areaId: id, flags: index.areaById.get(id)!.flags, kind, ladderId });
  };
  add(start.sourcePoint, start.areaId, 'start');
  for (const edge of path.edges) {
    if (edge.kind === 'connection') {
      const [a, b] = portal(index.areaById.get(edge.from)!, index.areaById.get(edge.to)!, edge.direction!);
      add(a, edge.from, 'portal-exit'); add(b, edge.to, 'portal-enter');
    } else {
      const l = index.ladders.get(edge.ladderId!)!;
      if (edge.kind === 'ladder-up') { add(l.bottom, edge.from, 'ladder-bottom', l.id); add(l.top, edge.to, 'ladder-top', l.id); }
      else { add(l.top, edge.from, 'ladder-top', l.id); add(l.bottom, edge.to, 'ladder-bottom', l.id); }
    }
  }
  add(goal.sourcePoint, goal.areaId, 'goal');
  return { ...result, status: 'path', areaIds: path.areaIds, edges: path.edges, waypoints: points, graphCost: path.cost };
}
