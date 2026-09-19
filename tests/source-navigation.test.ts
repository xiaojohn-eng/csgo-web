import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findSourceNavAreaPath, findSourceNavPath, nearestSourceNavArea, prepareSourceNavigation, sourceNavHeight,
  SOURCE_NAV_FLAGS, type SourceNavArea, type SourceNavigationData } from '../game/source-navigation';

const area = (id: number, x: number, z: number): SourceNavArea => ({ id, flags: 0, nw: [x, 0, z], se: [x + 10, 10, z],
  neZ: z, swZ: z, connections: [[], [], [], []], ladders: [[], []], place: 1 });
function fixture(): SourceNavigationData {
  const a = area(1, 0, 0), b = area(2, 10, 4), c = area(3, 0, 100), d = area(4, 20, 4);
  a.connections[1] = [2]; b.connections[1] = [4]; b.flags = SOURCE_NAV_FLAGS.CROUCH; d.flags = SOURCE_NAV_FLAGS.JUMP | SOURCE_NAV_FLAGS.NO_JUMP;
  return { format: 'source-navigation-v1', version: 16, subVersion: 1, metersPerSourceUnit: 1,
    sourceNavSha256: 'synthetic', sourceBspSha256: 'synthetic', places: ['test'], areas: [a, b, c, d], ladders: [] };
}
const low = { x: 5, y: 0, z: -5 }, high = { x: 5, y: 100, z: -5 }, goal = { x: 25, y: 4, z: -5 };

describe('original Source navigation contract', () => {
  it('preserves all four corner heights with the SDK bilinear sampling formula', () => {
    const a = area(1, 0, 0); a.neZ = 10; a.swZ = 20; a.se[2] = 40;
    expect([sourceNavHeight(a, 0, 0), sourceNavHeight(a, 10, 0), sourceNavHeight(a, 10, 10), sourceNavHeight(a, 0, 10)]).toEqual([0, 10, 40, 20]);
    expect(sourceNavHeight(a, 5, 5)).toBe(17.5); expect(sourceNavHeight(a, -10, 20)).toBe(20);
    a.se[0] = 0; expect(sourceNavHeight(a, 0, 0)).toBe(10);
  });
  it('uses full 3D nearest area and directed reachable candidates without inventing an inter-floor edge', () => {
    const index = prepareSourceNavigation(fixture());
    expect(nearestSourceNavArea(index, low)?.areaId).toBe(1); expect(nearestSourceNavArea(index, high)?.areaId).toBe(3);
    const reachable = nearestSourceNavArea(index, high, { fromAreaId: 1, maxSnapDistance: Infinity });
    expect(reachable?.areaId).toBe(2); expect(reachable?.reachableFromAreaId).toBe(1);
    expect(findSourceNavPath(index, low, high).status).toBe('unreachable');
  });
  it('preserves one-way graph connections and retains height differences at a shared portal', () => {
    const index = prepareSourceNavigation(fixture()), path = findSourceNavPath(index, low, goal);
    expect(path.status).toBe('path'); expect(path.areaIds).toEqual([1, 2, 4]); expect(findSourceNavAreaPath(index, 4, 1)).toBeNull();
    expect(path.waypoints[1].sourcePoint).toEqual([10, 5, 0]); expect(path.waypoints[2].sourcePoint).toEqual([10, 5, 4]);
    expect([path.waypoints[1].x, path.waypoints[1].z]).toEqual([path.waypoints[2].x, path.waypoints[2].z]);
    expect(path.waypoints[2].flags).toBe(SOURCE_NAV_FLAGS.CROUCH);
    expect(path.waypoints.at(-1)?.flags).toBe(SOURCE_NAV_FLAGS.JUMP | SOURCE_NAV_FLAGS.NO_JUMP); expect(path.staticOnly).toBe(true);
  });
  it('honors excluded flags and never silently moves an unreachable destination into the reachable component', () => {
    const index = prepareSourceNavigation(fixture());
    expect(findSourceNavPath(index, low, goal, { blockedFlags: SOURCE_NAV_FLAGS.CROUCH }).status).toBe('unreachable');
    expect(findSourceNavPath(index, low, high, { fromAreaId: 1, maxSnapDistance: Infinity }).goal?.areaId).toBe(3);
  });
  it('does not mutate original data and repeats the same graph path exactly', () => {
    const data = fixture(), raw = JSON.stringify(data), index = prepareSourceNavigation(data), first = findSourceNavPath(index, low, goal);
    expect(JSON.stringify(data)).toBe(raw); data.areas[0].connections[1] = []; data.areas[1].nw[2] = 900;
    expect(findSourceNavPath(index, low, goal)).toEqual(first);
    first.edges[0].to = 999; expect(findSourceNavPath(index, low, goal).areaIds).toEqual([1, 2, 4]);
  });
  it('fails without a fabricated grid on corrupt references, versions and distant/nonfinite endpoints', () => {
    const data = fixture(); data.areas[0].connections[1] = [999];
    expect(prepareSourceNavigation(data).valid).toBe(false);
    expect(findSourceNavPath(prepareSourceNavigation(data), low, goal).status).toBe('invalid-data');
    const wrong = fixture(); wrong.subVersion = 2; expect(prepareSourceNavigation(wrong).valid).toBe(false);
    const index = prepareSourceNavigation(fixture());
    expect(nearestSourceNavArea(index, { x: 1e6, y: 0, z: 0 })).toBeNull();
    expect(findSourceNavPath(index, { x: NaN, y: 0, z: 0 }, goal).status).toBe('invalid-endpoint');
    expect(findSourceNavPath(index, low, { x: 1e6, y: 0, z: 0 }).status).toBe('no-goal-area');
    expect(nearestSourceNavArea(index, low, { fromAreaId: 999 })).toBeNull();
  });
  it('handles a same-area route with exact snapped source height', () => {
    const index = prepareSourceNavigation(fixture()), path = findSourceNavPath(index, low, { x: 8, y: .5, z: -6 });
    expect(path.areaIds).toEqual([1]); expect(path.graphCost).toBe(0); expect(path.waypoints.map(p => p.kind)).toEqual(['start', 'goal']);
    expect(path.goal?.point).toEqual({ x: 8, y: 0, z: -6 });
  });
  it('preserves ladder records while requiring explicit opt-in, and keeps topBehind out of ascent as in SDK search', () => {
    const data = fixture(); data.areas = [area(1, 0, 0), area(2, 0, 100), area(3, 10, 100)];
    data.areas[0].ladders[0] = [77]; data.areas[1].ladders[1] = [77]; data.areas[2].ladders[1] = [77];
    data.ladders = [{ id: 77, width: 4, top: [5, 5, 100], bottom: [5, 5, 0], length: 100, direction: 0,
      topForwardArea: 2, topLeftArea: 0, topRightArea: 0, topBehindArea: 3, bottomArea: 1 }];
    const index = prepareSourceNavigation(data);
    expect(findSourceNavAreaPath(index, 1, 2)).toBeNull(); expect(index.ladders.get(77)?.topBehindArea).toBe(3);
    const path = findSourceNavPath(index, low, high, { allowLadders: true });
    expect(path.status).toBe('path'); expect(path.edges[0].kind).toBe('ladder-up');
    expect(path.waypoints.map(p => p.kind)).toEqual(['start', 'ladder-bottom', 'ladder-top', 'goal']);
    expect(path.waypoints[2].y - path.waypoints[1].y).toBe(100);
    expect(findSourceNavAreaPath(index, 1, 3, { allowLadders: true })).toBeNull();
    expect(findSourceNavAreaPath(index, 3, 1, { allowLadders: true })?.edges[0].kind).toBe('ladder-down');
  });
});

const directory = resolve('.reference-assets/source-exports/dust2/navigation');
const available = existsSync(resolve(directory, 'route-fixtures.json'));
describe.runIf(available)('actual Dust2 NAV: independent Python fixtures', () => {
  const data = available ? JSON.parse(readFileSync(resolve(directory, 'navigation.json'), 'utf8')) : null;
  const fixtures = available ? JSON.parse(readFileSync(resolve(directory, 'route-fixtures.json'), 'utf8')) : null;
  const index = prepareSourceNavigation(data), point = (v: number[]) => ({ x: v[0], y: v[1], z: v[2] });
  it('routes all 30 original spawns to both original named bombsite areas with matching independent costs', () => {
    expect(index.valid).toBe(true); expect(index.areas).toHaveLength(1118); expect(index.ladders.size).toBe(0); expect(fixtures.routes).toHaveLength(60);
    for (const f of fixtures.routes) {
      const p = findSourceNavPath(index, point(f.browserStart), point(f.target.browserPoint));
      expect(p.status).toBe('path'); expect(p.start?.areaId).toBe(f.start.areaId); expect(p.goal?.areaId).toBe(f.target.areaId);
      expect(p.graphCost).toBeCloseTo(f.expectedCost, 8);
    }
  });
  it('distinguishes all 48 overlapping-floor probes using their original heights', () => {
    expect(fixtures.overlappingFloors).toHaveLength(24);
    for (const pair of fixtures.overlappingFloors) for (const s of pair.samples) expect(nearestSourceNavArea(index, point(s.browserPoint))?.areaId).toBe(s.expected.areaId);
  });
});
