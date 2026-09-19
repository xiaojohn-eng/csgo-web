import RAPIER from '@dimforge/rapier3d-compat';

export type SourceCollisionRole = 'player' | 'bullet' | 'projectile';
type VectorTuple = [number, number, number];
type RotationTuple = [number, number, number, number];
export type SourceCollisionGeometry = {
  id: number;
  kind: 'convex' | 'trimesh';
  vertices: number[];
  indices?: number[];
  source: Record<string, unknown>;
};
export type SourceCollisionInstance = {
  geometry: number;
  translation: VectorTuple;
  rotation: RotationTuple;
  scale: number;
  roles: SourceCollisionRole[];
  source: Record<string, unknown>;
};
export type SourceMapCollisionData = {
  format: 'source-map-collision-v1';
  sourceMap: string;
  sourceBspSha256: string;
  metersPerSourceUnit: number;
  geometries: SourceCollisionGeometry[];
  colliders: SourceCollisionInstance[];
  sensors: SourceCollisionInstance[];
  missingPHY: { index: number; model: string; origin: VectorTuple; rotation: VectorTuple }[];
  limits: string[];
};

const ROLE_BITS = { player: 1, bullet: 2, projectile: 4 } as const;
const SENSOR_BIT = 8;
/** Use for both actor collision groups and the matching query filterGroups.
 * A source collider can serve several roles. Default Rapier ALL groups would
 * also hit playerclip on bullet queries and overlap BSP/VPHY representations.
 */
export function sourceMapQueryGroups(role: SourceCollisionRole): number {
  const bit = ROLE_BITS[role];
  return ((bit << 16) | bit) >>> 0;
}
export const SOURCE_SENSOR_QUERY_GROUPS = ((SENSOR_BIT << 16) | SENSOR_BIT) >>> 0;

/** Adds only original convex/triangle data to the supplied World.
 * Caller initializes Rapier and owns the world. Call dispose() before world.free().
 * This function does not change the world's gravity, step it, or build AABBs.
 */
export function attachSourceMapCollision(
  world: RAPIER.World,
  data: SourceMapCollisionData,
  options: { roles?: readonly SourceCollisionRole[]; sensors?: boolean } = {},
) {
  if (data.format !== 'source-map-collision-v1') throw new Error('Unsupported Source collision format');
  if (!Array.isArray(data.missingPHY) || data.missingPHY.some(item => !item || typeof item.model !== 'string'))
    throw new Error('Invalid Source missingPHY metadata');
  const missingPHYModels = new Set(data.missingPHY.map(item => item.model)).size;
  const enabled = new Set(options.roles ?? ['player', 'bullet', 'projectile']);
  const geometries = new Map(data.geometries.map(geometry => [geometry.id, geometry]));
  const owned: RAPIER.Collider[] = [];
  const metadata = new Map<number, SourceCollisionInstance & { sensor: boolean }>();
  const counts = { player: 0, bullet: 0, projectile: 0, sensors: 0, convex: 0, trimesh: 0 };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const collider of owned) {
      if (world.getCollider(collider.handle)) world.removeCollider(collider, false);
    }
    metadata.clear();
  };
  try {
    for (const [items, sensor] of [[data.colliders, false], [options.sensors === false ? [] : data.sensors, true]] as const) {
      for (const instance of items) {
        const roles = instance.roles.filter(role => enabled.has(role));
        if (!sensor && !roles.length) continue;
        const geometry = geometries.get(instance.geometry);
        if (!geometry) throw new Error(`Missing original geometry ${instance.geometry}`);
        if (!(instance.scale > 0) || !Number.isFinite(instance.scale)) throw new Error('Invalid Source instance scale');
        if (geometry.vertices.length % 3 || geometry.vertices.some(value => !Number.isFinite(value)))
          throw new Error('Invalid Source vertex data');
        const vertices = new Float32Array(geometry.vertices.map(value => value * instance.scale));
        let desc: RAPIER.ColliderDesc | null;
        if (geometry.kind === 'convex') {
          desc = RAPIER.ColliderDesc.convexHull(vertices);
        } else {
          if (!geometry.indices || geometry.indices.length % 3 || geometry.indices.some(index =>
            !Number.isInteger(index) || index < 0 || index >= vertices.length / 3))
            throw new Error('Invalid Source triangle indices');
          desc = RAPIER.ColliderDesc.trimesh(vertices, new Uint32Array(geometry.indices), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
        }
        if (!desc) throw new Error(`Original convex shape ${instance.geometry} could not be constructed`);
        const [x, y, z] = instance.translation;
        const [qx, qy, qz, qw] = instance.rotation;
        if (![x, y, z, qx, qy, qz, qw].every(Number.isFinite)) throw new Error('Invalid Source transform');
        const bits = sensor ? SENSOR_BIT : roles.reduce((value, role) => value | ROLE_BITS[role], 0);
        desc.setTranslation(x, y, z).setRotation({ x: qx, y: qy, z: qz, w: qw });
        desc.setSensor(sensor).setCollisionGroups(((bits << 16) | bits) >>> 0);
        let collider: RAPIER.Collider;
        try { collider = world.createCollider(desc); }
        catch (cause) { throw new Error(`Failed original ${geometry.kind} geometry ${geometry.id}: ${JSON.stringify(geometry.source)}`, { cause }); }
        owned.push(collider);
        metadata.set(collider.handle, { ...instance, sensor });
        counts[geometry.kind]++;
        if (sensor) counts.sensors++;
        else for (const role of roles) counts[role]++;
      }
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    colliders: owned as readonly RAPIER.Collider[],
    metadata: metadata as ReadonlyMap<number, SourceCollisionInstance & { sensor: boolean }>,
    stats: { ...counts, total: owned.length, missingPHYInstances: data.missingPHY.length,
      missingPHYModels },
    queryGroups: sourceMapQueryGroups,
    dispose,
  };
}
