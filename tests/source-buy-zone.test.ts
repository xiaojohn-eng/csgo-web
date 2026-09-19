import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, afterEach } from 'vitest';
import { Simulation, initPhysics } from '../game/simulation';
import { createSourceBuyZones, sourceBuyZoneAllows } from '../game/source-buy-zone';
import { sourceSimulationFixture } from './fixtures/source-simulation-fixture';
import { SOURCE_BUY_ZONES, SOURCE_BUY_ZONE_SOURCES } from '../game/source-buy-zone-data';
import { createHash } from 'node:crypto';

const collision = JSON.parse(readFileSync(resolve('public/source/csgo-12426148/dust2/collision.json'), 'utf8'));
const entities = JSON.parse(readFileSync(resolve('.reference-assets/source-exports/dust2/source-metadata/entities.json'), 'utf8'));
const sha256 = (path: string) => createHash('sha256').update(readFileSync(resolve(path))).digest('hex');
const box = (over: Record<string, unknown> = {}) => ({
  geometry: 0, translation: [10, 0, 0], rotation: [0, 0, 0, 1], scale: 1,
  roles: ['player'], source: { layer: 'brush', brush: 1, model: 2, classname: 'func_buyzone', hammerid: '1' }, ...over,
});
const convex = (vertices: number[]) => ({ id: 0, kind: 'convex', vertices, source: { layer: 'brush', brush: 1, contents: 1 } });
const cube = () => [-1, -1, -1, -1, -1, 1, -1, 1, -1, -1, 1, 1, 1, -1, -1, 1, -1, 1, 1, 1, -1, 1, 1, 1];
const zone = (over: Record<string, unknown> = {}) => ({ geometries: [convex(cube())], sensors: [box(over)],
  entities: [{ classname: 'func_buyzone', hammerid: '1', teamnum: '2' }] });

describe('the original buy zones', () => {
  it('reads the two zones the shipped map has, and its own team for each', () => {
    const lump = entities.filter((e: { classname: string }) => e.classname === 'func_buyzone');
    expect(lump.map((e: { teamnum: string }) => e.teamnum).sort()).toEqual(['2', '3']);
    const zones = createSourceBuyZones(collision, entities);
    expect(zones.map((z) => z.hammerId)).toEqual(lump.map((e: { hammerid: string }) => e.hammerid).sort());
    expect(zones.map((z) => ({ hammerId: z.hammerId, team: z.team })))
      .toEqual([{ hammerId: '2568320', team: 2 }, { hammerId: '2568324', team: 3 }]);
    // The generated table the simulation reads is that read, round through the generator.
    // The generated table carries the generator's own rounding of the same read.
    const rounded = (values: readonly number[]) => values.map((value) => Number(value.toFixed(6)));
    expect(SOURCE_BUY_ZONES).toEqual(zones.map((z) => ({ ...z, min: rounded(z.min), max: rounded(z.max) })));
    expect(sha256('public/source/csgo-12426148/dust2/collision.json')).toBe(SOURCE_BUY_ZONE_SOURCES.collisionJsonSha256);
    expect(sha256('.reference-assets/source-exports/dust2/source-metadata/entities.json')).toBe(SOURCE_BUY_ZONE_SOURCES.entitiesJsonSha256);
    // The two shipped sources agree on the hammer ids, so a volume cannot lose its team.
    const volumeIds = collision.sensors.filter((s: { source: { classname: string } }) => s.source.classname === 'func_buyzone')
      .map((s: { source: { hammerid: string } }) => s.source.hammerid).sort();
    expect(volumeIds).toEqual(zones.map((z) => z.hammerId));
  });

  it('lets a team buy only in its own volume, and the volume is exclusive', () => {
    const zones = createSourceBuyZones(collision, entities);
    const t = zones.find((z) => z.team === 2)!, ct = zones.find((z) => z.team === 3)!;
    const centre = (z: typeof t) => ({ x: (z.min[0] + z.max[0]) / 2, y: (z.min[1] + z.max[1]) / 2, z: (z.min[2] + z.max[2]) / 2 });
    expect(sourceBuyZoneAllows(zones, centre(t), 2)).toBe(true);
    expect(sourceBuyZoneAllows(zones, centre(t), 3)).toBe(false);
    expect(sourceBuyZoneAllows(zones, centre(ct), 3)).toBe(true);
    expect(sourceBuyZoneAllows(zones, centre(ct), 2)).toBe(false);
    // Outside both, neither team may buy.
    expect(sourceBuyZoneAllows(zones, { x: 500, y: 0, z: 500 }, 2)).toBe(false);
    expect(sourceBuyZoneAllows(zones, { x: 500, y: 0, z: 500 }, 3)).toBe(false);
    // A corner of the volume counts as inside, and one step past it does not.
    const corner = { x: t.max[0], y: t.max[1], z: t.max[2] };
    expect(sourceBuyZoneAllows(zones, corner, 2)).toBe(true);
    expect(sourceBuyZoneAllows(zones, { ...corner, x: corner.x + 0.01 }, 2)).toBe(false);
  });

  it('refuses anything it cannot test exactly, rather than opening the zone up', () => {
    const rotated = zone({ rotation: [0, 0, 0.7071, 0.7071] });
    expect(() => createSourceBuyZones(rotated, rotated.entities)).toThrow('rotated');
    const scaled = zone({ scale: 2 });
    expect(() => createSourceBuyZones(scaled, scaled.entities)).toThrow('scaled');
    // A volume whose vertices are not eight corners is not a box, so it is not used.
    // A triangular prism: eight listed points, six distinct corners.
    const prism = { geometries: [convex([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 1, 0, 2, 0, 1, 2, 0, 0, 0, 1, 0, 0])],
      sensors: [box()], entities: [{ classname: 'func_buyzone', hammerid: '1', teamnum: '2' }] };
    expect(() => createSourceBuyZones(prism, prism.entities)).toThrow('not a box');
    // A volume with no entity is a volume whose team is unknown.
    expect(() => createSourceBuyZones(zone(), [])).toThrow('no matching entity');
    // An entity with no teamnum is not a zone open to everyone.
    expect(() => createSourceBuyZones(zone(), [{ classname: 'func_buyzone', hammerid: '1' }])).toThrow('no teamnum');
    expect(() => createSourceBuyZones(zone(), [{ classname: 'func_buyzone', hammerid: '1', teamnum: '1' }])).toThrow('unknown teamnum');
    // A volume the artifact carries but the entity list does not is refused as unknown.
    const orphan = { geometries: [convex(cube())], sensors: [box(), box({ source: { classname: 'func_buyzone', hammerid: '2' } })],
      entities: [{ classname: 'func_buyzone', hammerid: '1', teamnum: '2' }] };
    expect(() => createSourceBuyZones(orphan, orphan.entities)).toThrow('no matching entity');
    // And an entity whose volume is missing is incomplete coverage, not a zone.
    const incomplete = { geometries: [convex(cube())], sensors: [box()],
      entities: [{ classname: 'func_buyzone', hammerid: '1', teamnum: '2' },
        { classname: 'func_buyzone', hammerid: '2', teamnum: '3' }] };
    expect(() => createSourceBuyZones(incomplete, incomplete.entities)).toThrow('coverage is incomplete');
    // And a team that is not one of the original's two is not a team this port tests.
    expect(() => sourceBuyZoneAllows([], { x: 0, y: 0, z: 0 }, 1)).toThrow('Invalid team');
  });
});

describe('the buy rule where the map declares its own volumes', () => {
  beforeAll(initPhysics);
  const live: Simulation[] = [];
  afterEach(() => live.splice(0).forEach((sim) => sim.dispose()));

  it('lets a team buy inside its own volume and refuses it one metre outside', () => {
    const fixture = sourceSimulationFixture();
    fixture.weapons = ['vandal', 'm4a4', 'glock', 'usp', 'deagle'];
    fixture.defaultWeaponByTeam = { amber: 'vandal', blue: 'm4a4' };
    // The shipped Dust2 volumes, on a scenario that declares them.
    const zones = SOURCE_BUY_ZONES;
    const t = zones.find((z) => z.team === 2)!;
    fixture.buyZones = zones;
    const sim = new Simulation('training', false, fixture); live.push(sim);
    const tPlayer = sim.addPlayer('t', 'T', 'amber'), ctPlayer = sim.addPlayer('ct', 'CT', 'blue');
    // Stand where the volume is; the fixture's own ground sits below it, so the rule is read
    // from the position rather than from the fixture's landing height.
    for (const player of [tPlayer, ctPlayer]) {
      player.x = (t.min[0] + t.max[0]) / 2; player.y = (t.min[1] + t.max[1]) / 2; player.z = (t.min[2] + t.max[2]) / 2;
    }
    // Inside the T volume the Terrorist may buy and the Counter-Terrorist may not.
    expect(sim.canBuy(tPlayer)).toBe(true);
    expect(sim.canBuy(ctPlayer)).toBe(false);
    expect(sim.buy(ctPlayer.id, 'deagle')).toBe(false);
    // One step past the volume's edge, the Terrorist may not.
    tPlayer.x = t.max[0] + 1;
    expect(sim.canBuy(tPlayer)).toBe(false);
    expect(sim.buy(tPlayer.id, 'deagle')).toBe(false);
    // The snapshot the port sends carries that answer for the player it is for.
    expect(sim.snapshot('t').canBuy).toBe(false);
    expect(sim.snapshot('ct').canBuy).toBe(false);
  });
});
