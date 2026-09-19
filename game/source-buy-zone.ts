/** The original buy zones: `func_buyzone`'s own brushes, from the shipped map data.
 *
 * The port buys inside the buy window anywhere on the map. The original also requires the
 * player to stand in a `func_buyzone` volume, and each volume belongs to one team. Both
 * halves are data this repository already stages — the brush volumes in the collision
 * artifact's sensor list, the team key in the map's own entity list — and the two are
 * cross-checked here by the hammer id they share, so a volume without its team is refused
 * rather than treated as open to everyone.
 *
 * The volumes are convex brushes. The port only uses a volume it can test exactly: a brush
 * whose vertices collapse to eight distinct corners is a box, and only boxes are used. A
 * volume of any other shape stops the read instead of being approximated by its bounding
 * box.
 */

export type SourceBuyZone = {
  hammerId: string;
  /** The original `teamnum`: 2 is Terrorist, 3 is Counter-Terrorist, 0 is any team. */
  team: number;
  min: readonly [number, number, number];
  max: readonly [number, number, number];
};

type Triple = readonly [number, number, number];

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function triple(value: unknown, message: string): Triple {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite)) throw Error(message);
  return [value[0], value[1], value[2]] as const;
}

/** The original maps this port ships one team's zones from, by the key the entity uses. */
function zoneTeam(value: string | undefined, hammerId: string): number {
  if (value === undefined) throw Error(`Original func_buyzone ${hammerId} has no teamnum`);
  const team = Number(value);
  if (!Number.isInteger(team) || (team !== 0 && team !== 2 && team !== 3)) {
    throw Error(`Original func_buyzone ${hammerId} carries an unknown teamnum: ${value}`);
  }
  return team;
}

export function createSourceBuyZones(collision: unknown, entities: unknown): SourceBuyZone[] {
  const document = collision as { geometries?: unknown; sensors?: unknown };
  if (!Array.isArray(document.geometries) || !Array.isArray(document.sensors)) {
    throw Error('Original collision artifact has no geometries or sensors');
  }
  if (!Array.isArray(entities)) throw Error('Original entity list is not a list');
  const teams = new Map<string, number>();
  for (const entity of entities as Record<string, unknown>[]) {
    if (entity?.classname !== 'func_buyzone') continue;
    const hammerId = entity.hammerid;
    if (typeof hammerId !== 'string' || !hammerId) throw Error('Original func_buyzone has no hammerid');
    if (teams.has(hammerId)) throw Error('Original func_buyzone hammer id is duplicated: ' + hammerId);
    teams.set(hammerId, zoneTeam(entity.teamnum as string | undefined, hammerId));
  }
  const geometries = new Map<number, Record<string, unknown>>();
  for (const geometry of document.geometries as Record<string, unknown>[]) {
    if (typeof geometry?.id === 'number') geometries.set(geometry.id, geometry);
  }
  const zones: SourceBuyZone[] = [];
  for (const sensor of document.sensors as Record<string, unknown>[]) {
    const source = sensor?.source as Record<string, unknown> | undefined;
    if (source?.classname !== 'func_buyzone') continue;
    const hammerId = source.hammerid;
    if (typeof hammerId !== 'string' || !teams.has(hammerId)) {
      throw Error('Original func_buyzone volume has no matching entity: ' + String(hammerId));
    }
    // The original volume is a brush placed by these three values; anything but a pure
    // translation would make an axis-aligned test wrong, so it stops the read.
    const translation = triple(sensor.translation, 'Original func_buyzone volume needs a translation');
    const rotation = Array.isArray(sensor.rotation) ? sensor.rotation : null;
    if (!rotation || rotation.length !== 4 || !rotation.every(finite) ||
      rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0 || rotation[3] !== 1) {
      throw Error('Original func_buyzone volume is rotated, which this port does not test');
    }
    const scale = sensor.scale ?? 1;
    if (scale !== 1) throw Error('Original func_buyzone volume is scaled, which this port does not test');
    const geometry = geometries.get(sensor.geometry as number);
    if (!geometry || geometry.kind !== 'convex') throw Error('Original func_buyzone volume is not a convex brush');
    const vertices = geometry.vertices;
    if (!Array.isArray(vertices) || vertices.length < 24 || vertices.length % 3) {
      throw Error('Original func_buyzone brush vertices are not a triangle-free point list');
    }
    const corners = new Set<string>();
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let at = 0; at < vertices.length; at += 3) {
      const point = triple(vertices.slice(at, at + 3), 'Original func_buyzone brush has a non-finite corner');
      corners.add(point.map((value) => value.toFixed(3)).join(','));
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
    if (corners.size !== 8) {
      throw Error(`Original func_buyzone brush is not a box: ${corners.size} distinct corners`);
    }
    zones.push({
      hammerId, team: teams.get(hammerId)!,
      min: [min[0] + translation[0], min[1] + translation[1], min[2] + translation[2]],
      max: [max[0] + translation[0], max[1] + translation[1], max[2] + translation[2]],
    });
  }
  if (zones.length !== teams.size) throw Error('Original func_buyzone coverage is incomplete');
  return zones.sort((a, b) => a.hammerId.localeCompare(b.hammerId));
}

/** Whether the original would let this player buy where they stand. A zone with team 0 is
 * open to both teams, which is what the original's own teamnum says. */
export function sourceBuyZoneAllows(zones: readonly SourceBuyZone[], position: { x: number; y: number; z: number },
  team: number): boolean {
  if (!Number.isInteger(team) || (team !== 2 && team !== 3)) throw Error('Invalid team for the original buy zone');
  for (const zone of zones) {
    if (zone.team !== 0 && zone.team !== team) continue;
    if (position.x < zone.min[0] || position.x > zone.max[0]) continue;
    if (position.y < zone.min[1] || position.y > zone.max[1]) continue;
    if (position.z < zone.min[2] || position.z > zone.max[2]) continue;
    return true;
  }
  return false;
}
