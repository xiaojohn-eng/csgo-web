import RAPIER from '@dimforge/rapier3d-compat';
import { attachSourceMapCollision, sourceMapQueryGroups, SOURCE_SENSOR_QUERY_GROUPS,
  type SourceCollisionRole, type SourceMapCollisionData } from './source-map-collision.js';
import {prepareSourceNavigation,findSourceNavPath,type SourceNavOptions} from './source-navigation.js';

type Vec3 = { x: number; y: number; z: number };
type Tuple3 = [number, number, number];
type Bounds = { min: Tuple3; max: Tuple3 };
export type SourceSpawn = Vec3 & { id: string; team: 'blue' | 'amber'; yaw: number; pitch: number;
  sourceClassname: string; sourceOrigin: Tuple3; sourceAngles: Tuple3 };
export type SourcePlayerHull = { halfExtents: Tuple3; eyeHeight: number };
/** Where a bullet stopped on the original collision: the point, the surface normal the
 * engine reports there, and the collision instance that owns the face. */
export type SourceBulletTrace = Vec3 & { distance: number; nx: number; ny: number; nz: number;
  /** Rapier collider that owns this face; used to measure a penetrated solid. */
  collider: number; source: Record<string, unknown> | null };
export type SourceLevelData = {
  format: 'source-level-v1'; id: string; name: string; sourceBspSha256: string; metersPerSourceUnit: number;
  worldBounds: Bounds; boundsMeaning: string; spawns: SourceSpawn[];
  sites: { name: 'A' | 'B'; sourceModel: number; hammerid: string; bounds: Bounds }[];
  siteBinding: string;
  player: { standing: SourcePlayerHull; crouching: SourcePlayerHull; gravity: number; stepHeight: number;
    standableNormal: number; sourceServerSha256: string; hullMeaning: string };
  navigation: null; navigationStatus: string; sourceNavSha256: string;
};
const identity = { x: 0, y: 0, z: 0, w: 1 };
const validPoint = (point: Vec3) => [point.x, point.y, point.z].every(Number.isFinite);
/** How far above a standing actor's own origin the world asks for the surface
 * under them, in world metres: high enough to clear the actor's feet (the
 * original model sits ON its origin) yet far below any ceiling a reload could
 * happen under. */
export const SOURCE_PROP_GROUND_PROBE = .25;

/** Caller loads the two JSON files, initializes Rapier, and owns World stepping.
 * Queries use this map's original colliders only. Actor/weapon hit tests remain
 * with the caller. No BOXES, implicit ground plane, fallback NAV, or network I/O.
 */
export function createSourceLevel(world: RAPIER.World, data: SourceLevelData, collision: SourceMapCollisionData, options:{navigation?:unknown}={}) {
  if (data.format !== 'source-level-v1' || data.sourceBspSha256 !== collision.sourceBspSha256 ||
    data.metersPerSourceUnit !== collision.metersPerSourceUnit || data.id !== collision.sourceMap)
    throw new Error('Source level/collision identity mismatch');
  if (data.navigation !== null) throw new Error('Unimplemented original Source navigation descriptor');
  const navigation=options.navigation===undefined?null:prepareSourceNavigation(options.navigation);
  if(navigation&&(!navigation.valid||navigation.sourceBspSha256!==data.sourceBspSha256||
    navigation.sourceNavSha256!==data.sourceNavSha256||navigation.scale!==data.metersPerSourceUnit))
    throw new Error('Source level/NAV identity mismatch or invalid graph');
  // Derive caller-supplied JSON before allocating any world resources.
  const spawns = { blue: data.spawns.filter(spawn => spawn.team === 'blue'), amber: data.spawns.filter(spawn => spawn.team === 'amber') };
  const map = attachSourceMapCollision(world, collision);
  let disposed = false;
  const ensureLive = () => { if (disposed) throw new Error('Source level already disposed'); };
  const onlyMap = (collider: RAPIER.Collider) => map.metadata.has(collider.handle) && !collider.isSensor();
  const sites: (SourceLevelData['sites'][number] & Vec3 & { colliders: readonly RAPIER.Collider[] })[] = [];
  const siteForHandle = new Map<number, 'A' | 'B'>();
  try {
    for (const site of data.sites) {
      if (sites.some(previous => previous.name === site.name)) throw new Error('Duplicate Source site binding');
      const colliders = map.colliders.filter(collider => {
        const source = map.metadata.get(collider.handle);
        return source?.sensor && source.source.classname === 'func_bomb_target' && source.source.model === site.sourceModel &&
          source.source.hammerid === site.hammerid;
      });
      if (!colliders.length) throw new Error(`Missing original bomb trigger ${site.name}`);
      // Local convex vertices are centered at their mean. This is a real point
      // inside the first original trigger convex, not an inferred X/Z rectangle.
      const center = colliders[0].translation();
      sites.push({ ...site, ...center, colliders });
      for (const collider of colliders) siteForHandle.set(collider.handle, site.name);
    }
    if (!spawns.blue.length || !spawns.amber.length || sites.length !== 2) throw new Error('Incomplete Source level spawns/sites');
  } catch (error) { map.dispose(); throw error; }

  function wallDistance(x: number, y: number, z: number, dx: number, dy: number, dz: number,
    role: SourceCollisionRole = 'bullet', maxDistance = 10000): number {
    ensureLive();
    const length = Math.hypot(dx, dy, dz);
    if (![x, y, z, dx, dy, dz, maxDistance].every(Number.isFinite) || length < 1e-9 || maxDistance <= 0) return Infinity;
    const ray = new RAPIER.Ray({ x, y, z }, { x: dx / length, y: dy / length, z: dz / length });
    const hit = world.castRay(ray, maxDistance, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      sourceMapQueryGroups(role), undefined, undefined, onlyMap);
    return hit?.timeOfImpact ?? Infinity;
  }
  /** The original collision's own answer to "where does this bullet stop".
   *
   * `wallDistance` only reports how far the ray ran; a decal and a surface sound need the
   * point, the surface normal and which original face was hit. The face is returned as the
   * collision instance's own `source` record, so the caller names the surface with the same
   * table the exporter used rather than re-deriving it here.
   */
  function traceBullet(x: number, y: number, z: number, dx: number, dy: number, dz: number,
    maxDistance = 10000, role: SourceCollisionRole = 'bullet', solid = true, onlyCollider?: number): SourceBulletTrace | null {
    ensureLive();
    const length = Math.hypot(dx, dy, dz);
    if (![x, y, z, dx, dy, dz, maxDistance].every(Number.isFinite) || length < 1e-9 || maxDistance <= 0) return null;
    const ray = new RAPIER.Ray({ x, y, z }, { x: dx / length, y: dy / length, z: dz / length });
    const hit = world.castRayAndGetNormal(ray, maxDistance, solid, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      sourceMapQueryGroups(role), undefined, undefined, (collider) => onlyMap(collider) &&
        (onlyCollider === undefined || collider.handle === onlyCollider));
    if (!hit) return null;
    const distance = hit.timeOfImpact;
    const meta = map.metadata.get(hit.collider.handle);
    return { distance, x: x + (dx / length) * distance, y: y + (dy / length) * distance,
      z: z + (dz / length) * distance, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z,
      collider: hit.collider.handle, source: (meta?.source ?? null) as Record<string, unknown> | null };
  }
  function sight(a: Vec3, b: Vec3, role: SourceCollisionRole = 'bullet', endpointTolerance = .001): boolean {
    ensureLive();
    if (!validPoint(a) || !validPoint(b) || !Number.isFinite(endpointTolerance) || endpointTolerance < 0) return false;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, length = Math.hypot(dx, dy, dz);
    if (length < 1e-9) return true;
    const distance = wallDistance(a.x, a.y, a.z, dx, dy, dz, role, length);
    return distance > 0 && distance >= length - Math.min(endpointTolerance, length);
  }
  /** World height of the first original map surface directly under (x, z) at or
   * below `fromY`, or null when the ray leaves the world or starts inside a
   * solid. Original physics props (corpses, dropped magazines) rest on
   * MASK_SOLID, which is exactly this level's 'projectile' role, so playerclip
   * does not hold them up. */
  function groundHeight(x: number, z: number, fromY: number, maxDrop = 512): number | null {
    ensureLive();
    if (![x, z, fromY, maxDrop].every(Number.isFinite) || maxDrop <= 0) return null;
    const hit = world.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), maxDrop, true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, sourceMapQueryGroups('projectile'), undefined, undefined, onlyMap);
    // A ray that starts inside a solid reports a zero distance; that is not a
    // surface, so the caller keeps its own fallback instead of popping the prop.
    return hit && hit.timeOfImpact > 0 ? fromY - hit.timeOfImpact : null;
  }
  function siteContainsPoint(name: 'A' | 'B', point: Vec3): boolean {
    ensureLive();
    return validPoint(point) && (sites.find(site => site.name === name)?.colliders.some(collider => collider.containsPoint(point)) ?? false);
  }
  function sitesOverlappingShape(center: Vec3, shape: RAPIER.Shape, rotation = identity): ('A' | 'B')[] {
    ensureLive(); if (!validPoint(center)) return [];
    const touched = new Set<'A' | 'B'>();
    world.intersectionsWithShape(center, rotation, shape, collider => {
      const name = siteForHandle.get(collider.handle); if (name) touched.add(name); return true;
    }, undefined, SOURCE_SENSOR_QUERY_GROUPS);
    return sites.filter(site => touched.has(site.name)).map(site => site.name);
  }
  function sitesForSourcePlayer(feet: Vec3, stance: 'standing' | 'crouching'): ('A' | 'B')[] {
    const [x, y, z] = data.player[stance].halfExtents;
    return sitesOverlappingShape({ ...feet, y: feet.y + y }, new RAPIER.Cuboid(x, y, z));
  }
  function settleSourceSpawn(spawn: SourceSpawn, stance: 'standing' | 'crouching' = 'standing', maxDrop = 5) {
    ensureLive();
    const [x, y, z] = data.player[stance].halfExtents;
    const hit = world.castShape({ x: spawn.x, y: spawn.y + y, z: spawn.z }, identity, { x: 0, y: -1, z: 0 },
      new RAPIER.Cuboid(x, y, z), .02, maxDrop, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      sourceMapQueryGroups('player'), undefined, undefined, onlyMap);
    return hit && hit.time_of_impact > 0 ? { ...spawn, y: spawn.y - hit.time_of_impact } : null;
  }
  return { id: data.id, name: data.name, sourceBspSha256: data.sourceBspSha256, metersPerSourceUnit: data.metersPerSourceUnit,
    worldBounds: data.worldBounds, boundsMeaning: data.boundsMeaning, spawns, sites,
    player: data.player, navigation, navigationStatus: navigation?'Original NAV static area graph; physical traversal still requires AABB sweeps':data.navigationStatus, sourceNavSha256: data.sourceNavSha256,
    pathfind(from:Vec3,to:Vec3,options:SourceNavOptions={}){
      ensureLive();if(!navigation)throw new Error('Original Source NAV is not loaded');
      return findSourceNavPath(navigation,from,to,options);
    },
    collision: map, queryGroups: sourceMapQueryGroups, wallDistance, traceBullet, sight, groundHeight,
    siteContainsPoint, sitesOverlappingShape, sitesForSourcePlayer, settleSourceSpawn,
    dispose() { if (!disposed) { disposed = true; map.dispose(); } },
  };
}
