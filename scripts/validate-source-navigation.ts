import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareSourceNavigation, nearestSourceNavArea, findSourceNavPath, sourceNavHeight } from '../game/source-navigation';

const directory = resolve('.reference-assets/source-exports/dust2/navigation');
const raw = readFileSync(resolve('.reference-assets/source-exports/dust2/source-metadata/de_dust2.nav'));
const json = readFileSync(resolve(directory, 'navigation.json')), data = JSON.parse(json.toString());
const fixtures = JSON.parse(readFileSync(resolve(directory, 'route-fixtures.json'), 'utf8'));
const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength); let offset = 0, fields = 0;
// A second reader checks every field directly against the original bytes. It
// does not execute/import the Python parser, repacker or its record offsets.
function value(kind: 'u8' | 'u16' | 'u32' | 'f32') {
  const width = kind === 'u8' ? 1 : kind === 'u16' ? 2 : 4; assert(offset + width <= raw.byteLength);
  const result = kind === 'u8' ? view.getUint8(offset) : kind === 'u16' ? view.getUint16(offset, true) :
    kind === 'u32' ? view.getUint32(offset, true) : view.getFloat32(offset, true);
  offset += width; fields++; return result;
}
const same = (kind: 'u8' | 'u16' | 'u32' | 'f32', expected: number) => assert.equal(value(kind), expected, `NAV field at ${offset}`);
function list(kind: 'u8' | 'u16' | 'u32', expected: any[], item: (entry: any) => void) { const count = value(kind); assert.equal(count, expected.length); for (let i = 0; i < count; i++) item(expected[i]); }
const vector = (values: number[]) => { for (const v of values) same('f32', v); };
const ids = (values: number[]) => list('u32', values, id => same('u32', id));
same('u32', 0xFEEDFACE); same('u32', 16); same('u32', 1); same('u32', data.sourceBspBytes); same('u8', data.analyzed);
list('u16', data.places, name => {
  const length = value('u16'); assert(offset + length <= raw.byteLength);
  assert.equal(raw.subarray(offset, offset + length).toString(), name + '\0'); offset += length;
});
same('u8', data.hasUnnamedAreas);
list('u32', data.areas, a => {
  const begin = offset;
  same('u32', a.id); same('u32', a.flags); vector(a.nw); vector(a.se); same('f32', a.neZ); same('f32', a.swZ);
  for (const direction of a.connections) ids(direction);
  list('u8', a.hidingSpots, s => { same('u32', s.id); vector(s.position); same('u8', s.flags); });
  list('u32', a.encounters, e => {
    same('u32', e.fromArea); same('u8', e.fromDirection); same('u32', e.toArea); same('u8', e.toDirection);
    list('u8', e.spots, s => { same('u32', s.id); same('u8', s.tByte); });
  });
  same('u16', a.place); for (const direction of a.ladders) ids(direction);
  vector(a.earliestOccupyTimes); vector(a.lightIntensity);
  list('u32', a.visibleAreas, v => { same('u32', v.id); same('u8', v.attributes); });
  same('u32', a.inheritVisibilityFrom);
  list('u8', a.sub1ApproachRecords, r => { same('u32', r[0]); same('u32', r[1]); same('u8', r[2]); same('u32', r[3]); same('u8', r[4]); });
  assert.equal(a.sourceBytes.start, begin); assert.equal(a.sourceBytes.end, offset);
});
list('u32', data.ladders, l => {
  same('u32', l.id); same('f32', l.width); vector(l.top); vector(l.bottom); same('f32', l.length); same('u32', l.direction);
  for (const key of ['topForwardArea', 'topLeftArea', 'topRightArea', 'topBehindArea', 'bottomArea']) same('u32', l[key]);
});
assert.equal(offset, raw.byteLength); assert.equal(data.areas.length, 1118); assert.equal(data.ladders.length, 0);

const time = performance.now(), index = prepareSourceNavigation(data), prepareMs = performance.now() - time;
assert(index.valid, index.reason); const routes: any[] = []; let waypoints = 0;
const point = (v: number[]) => ({ x: v[0], y: v[1], z: v[2] });
for (const fixture of fixtures.routes) {
  const began = performance.now(), path = findSourceNavPath(index, point(fixture.browserStart), point(fixture.target.browserPoint));
  const durationMs = performance.now() - began;
  assert.equal(path.start?.areaId, fixture.start.areaId); assert.equal(path.goal?.areaId, fixture.target.areaId);
  assert.equal(path.status, fixture.expectedCost === null ? 'unreachable' : 'path');
  if (path.status !== 'path') continue;
  assert(Math.abs(path.graphCost - fixture.expectedCost) < 1e-8);
  for (const [i, edge] of path.edges.entries()) {
    assert.equal(edge.from, path.areaIds[i]); assert.equal(edge.to, path.areaIds[i + 1]);
    assert.equal(edge.kind, 'connection'); assert(index.areaById.get(edge.from)!.connections[edge.direction!].includes(edge.to));
  }
  for (const p of path.waypoints) {
    const a = index.areaById.get(p.areaId)!;
    assert(p.sourcePoint[0] >= a.nw[0] && p.sourcePoint[0] <= a.se[0] && p.sourcePoint[1] >= a.nw[1] && p.sourcePoint[1] <= a.se[1]);
    assert.equal(p.sourcePoint[2], sourceNavHeight(a, p.sourcePoint[0], p.sourcePoint[1]));
    assert.equal(p.flags, a.flags); assert.deepEqual([p.x, p.y, p.z], [p.sourcePoint[0] * index.scale, p.sourcePoint[2] * index.scale, -p.sourcePoint[1] * index.scale]);
  }
  waypoints += path.waypoints.length;
  routes.push({ hammerid: fixture.hammerid, team: fixture.classname, target: fixture.target.place, startArea: path.start!.areaId,
    goalArea: path.goal!.areaId, costMetres: path.graphCost, areaIds: path.areaIds, waypointCount: path.waypoints.length,
    heightRangeMetres: [Math.min(...path.waypoints.map(p => p.y)), Math.max(...path.waypoints.map(p => p.y))], durationMs });
}
let floorSamples = 0;
for (const pair of fixtures.overlappingFloors) for (const sample of pair.samples) {
  const nearest = nearestSourceNavArea(index, point(sample.browserPoint)); assert(nearest);
  assert.equal(nearest.areaId, sample.expected.areaId);
  assert(Math.abs(nearest.distance - sample.expected.distance) < 1e-8); floorSamples++;
}
const upper = fixtures.namedTargets.find((t: any) => t.place === 'UpperTunnel'), lower = fixtures.namedTargets.find((t: any) => t.place === 'LowerTunnel');
const tunnelPath = findSourceNavPath(index, point(upper.browserPoint), point(lower.browserPoint));
assert.equal(tunnelPath.status, 'path'); assert(Math.abs(tunnelPath.start!.point.y - tunnelPath.goal!.point.y) > 3);
const sha = (b: ArrayBufferView) => createHash('sha256').update(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)).digest('hex');
const receipt = { status: 'passed', sourceNavSha256: sha(raw), jsonSha256: sha(json), moduleSha256: sha(readFileSync(resolve('game/source-navigation.ts'))),
  originalBytesConsumed: offset, unparsedBytes: raw.byteLength - offset, independentNumericFields: fields, prepareMs,
  originalAreas: index.areas.length, originalLadders: index.ladders.size, spawnToNamedSiteRoutes: routes.length,
  checkedWaypoints: waypoints, overlappingFloorSamples: floorSamples, tunnel: { areaIds: tunnelPath.areaIds,
    start: tunnelPath.start, goal: tunnelPath.goal, costMetres: tunnelPath.graphCost }, details: routes,
  boundary: 'Static NAV routes only. Named BombsiteA/B NAV diagnostic centers are not validated plant-trigger points; no AABB sweep, stair/jump/ladder movement or dynamic blocker acceptance.' };
writeFileSync(resolve(directory, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ ...receipt, details: undefined }));
