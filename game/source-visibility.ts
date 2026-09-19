/** Original Source PVS queries, independent of Three, network and scene mutation.
 * Input storage is produced by scripts/extract-source-visibility.py. The caller
 * owns loading/caching; unknown data or positions always remain visible.
 */
export type SourceVisibilityPoint = { x: number; y: number; z: number };
export type SourceVisibilityData = {
  format: 'source-visibility-v1'; sourceBspSha256: string; metersPerSourceUnit: number;
  sourceBounds: [number[], number[]]; worldHeadNode: number; worldFirstFace: number; worldFaceCount: number; faceCount: number;
  planes: number[][]; nodes: { plane: number; children: number[]; firstFace: number; faceCount: number }[];
  leaves: { cluster: number; area: number; firstLeafFace: number; leafFaceCount: number }[];
  leafFaces: number[]; clusterCount: number; pvsRows: (string | null)[];
  faceClusters: number[][]; staticProps: { id: number; leafIds: number[] }[];
  alwaysVisibleFaceIds: number[]; alwaysVisiblePropIds: number[];
};
type Node = { plane: number; children: readonly number[] };
export type SourceVisibilityIndex = {
  readonly valid: boolean; readonly reason: string; readonly scale: number;
  readonly sourceBounds: readonly (readonly number[])[]; readonly head: number;
  readonly planes: readonly (readonly number[])[]; readonly nodes: readonly Node[]; readonly leafClusters: readonly number[];
  readonly clusterCount: number; readonly rows: readonly (Uint8Array | null)[];
  readonly firstFace: number; readonly allWorldFaceIds: readonly number[]; readonly allStaticPropIds: readonly number[];
  readonly clusterFaces: readonly (readonly number[])[]; readonly clusterProps: readonly (readonly number[])[];
  readonly alwaysFaces: readonly number[]; readonly alwaysProps: readonly number[];
};
export type SourceLeafLocation = { leaf: number; cluster: number; boundary: boolean; reason: string };
export type SourceVisibilityResult = SourceLeafLocation & {
  allVisible: boolean; worldFirstFace: number; worldFaceIds: number[]; staticPropIds: number[];
  worldFaceMask: Uint8Array; staticPropMask: Uint8Array;
};

const integer = (n: unknown, min = 0, max = 1_000_000): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
function requireValue(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function emptyIndex(reason: string): SourceVisibilityIndex {
  return { valid: false, reason, scale: .0254, sourceBounds: [], head: 0, planes: [], nodes: [], leafClusters: [], clusterCount: 0,
    rows: [], firstFace: 0, allWorldFaceIds: [], allStaticPropIds: [], clusterFaces: [], clusterProps: [], alwaysFaces: [], alwaysProps: [] };
}

/** Validates and copies the data once; no input arrays or renderer objects mutate.
 * Invalid input yields an all-visible index rather than throwing into rendering.
 */
export function prepareSourceVisibility(input: unknown): SourceVisibilityIndex {
  try {
    requireValue(input && typeof input === 'object', 'missing-data');
    const data = input as SourceVisibilityData;
    requireValue(data.format === 'source-visibility-v1', 'unsupported-format');
    requireValue(Number.isFinite(data.metersPerSourceUnit) && data.metersPerSourceUnit > 0, 'invalid-scale');
    requireValue(integer(data.clusterCount, 1, 65536) && integer(data.worldFirstFace, 0, 65535) && integer(data.worldFaceCount, 0, 65536), 'invalid-count');
    requireValue(integer(data.faceCount, 0, 65536) && data.worldFirstFace + data.worldFaceCount <= data.faceCount, 'invalid-face-range');
    requireValue(Array.isArray(data.planes) && data.planes.length <= 65536 && Array.isArray(data.nodes) && data.nodes.length <= 65536, 'invalid-bsp');
    requireValue(Array.isArray(data.leaves) && data.leaves.length > 0 && data.leaves.length <= 65536, 'invalid-leaves');
    requireValue(data.sourceBounds.length === 2 && data.sourceBounds.every(v => v.length === 3 && v.every(Number.isFinite)) && data.sourceBounds[0].every((v, i) => v <= data.sourceBounds[1][i]), 'invalid-bounds');
    const planes = data.planes.map(p => { requireValue(p.length === 4 && p.every(Number.isFinite), 'invalid-plane'); requireValue(Math.hypot(p[0], p[1], p[2]) > .5, 'invalid-plane-normal'); return p.slice(); });
    const validChild = (child: unknown) => integer(child, -data.leaves.length, data.nodes.length - 1);
    const nodes = data.nodes.map(n => {
      requireValue(integer(n.plane, 0, planes.length - 1) && n.children.length === 2 && n.children.every(validChild), 'invalid-node-reference');
      requireValue(integer(n.firstFace) && integer(n.faceCount) && n.firstFace + n.faceCount <= data.faceCount, 'invalid-node-faces');
      return { plane: n.plane, children: n.children.slice() };
    });
    requireValue(validChild(data.worldHeadNode), 'invalid-root-node');
    requireValue(Array.isArray(data.leafFaces) && data.leafFaces.every(f => integer(f, 0, data.faceCount - 1)), 'invalid-leafface');
    const leafClusters = data.leaves.map(l => {
      requireValue(integer(l.cluster, -1, data.clusterCount - 1), 'invalid-leaf-cluster');
      requireValue(integer(l.firstLeafFace) && integer(l.leafFaceCount) && l.firstLeafFace + l.leafFaceCount <= data.leafFaces.length, 'invalid-leafface-range');
      return l.cluster;
    });
    requireValue(data.pvsRows.length === data.clusterCount, 'invalid-pvs-count');
    const rowBytes = Math.ceil(data.clusterCount / 8);
    const rows = data.pvsRows.map(row => {
      if (row === null) return null;
      requireValue(typeof row === 'string' && row.length === 4 * Math.ceil(rowBytes / 3), 'invalid-pvs-row');
      const raw = atob(row); requireValue(raw.length === rowBytes, 'invalid-pvs-bytes');
      return Uint8Array.from(raw, c => c.charCodeAt(0));
    });
    requireValue(data.faceClusters.length === data.worldFaceCount && Array.isArray(data.staticProps) && data.staticProps.length <= 100_000, 'invalid-membership-count');
    const clusterFaces: number[][] = Array.from({ length: data.clusterCount }, () => []);
    const clusterProps: number[][] = Array.from({ length: data.clusterCount }, () => []);
    const firstFace = data.worldFirstFace;
    const allWorldFaceIds = Array.from({ length: data.worldFaceCount }, (_, i) => firstFace + i);
    const allStaticPropIds = Array.from({ length: data.staticProps.length }, (_, i) => i);
    requireValue(data.alwaysVisibleFaceIds.every(f => integer(f, firstFace, firstFace + data.worldFaceCount - 1)), 'invalid-always-face');
    requireValue(data.alwaysVisiblePropIds.every(p => integer(p, 0, data.staticProps.length - 1)), 'invalid-always-prop');
    const alwaysFaces = new Set(data.alwaysVisibleFaceIds), alwaysProps = new Set(data.alwaysVisiblePropIds);
    for (const [index, clusters] of data.faceClusters.entries()) {
      requireValue(Array.isArray(clusters) && clusters.every(c => integer(c, 0, data.clusterCount - 1)), 'invalid-face-cluster');
      if (!clusters.length) alwaysFaces.add(firstFace + index);
      for (const c of new Set(clusters)) clusterFaces[c].push(firstFace + index);
    }
    for (const [index, prop] of data.staticProps.entries()) {
      requireValue(prop.id === index && Array.isArray(prop.leafIds) && prop.leafIds.every(l => integer(l, 0, leafClusters.length - 1)), 'invalid-prop-leaf');
      if (!prop.leafIds.length || prop.leafIds.some(l => leafClusters[l] < 0)) alwaysProps.add(index);
      for (const c of new Set(prop.leafIds.map(l => leafClusters[l]))) if (c >= 0) clusterProps[c].push(index);
    }
    return { valid: true, reason: 'ready', scale: data.metersPerSourceUnit, sourceBounds: data.sourceBounds.map(v => v.slice()), head: data.worldHeadNode,
      planes, nodes, leafClusters, clusterCount: data.clusterCount, rows, firstFace, allWorldFaceIds, allStaticPropIds, clusterFaces, clusterProps,
      alwaysFaces: [...alwaysFaces], alwaysProps: [...alwaysProps] };
  } catch (error) { return emptyIndex(error instanceof Error ? error.message : 'invalid-data'); }
}

/** Source(x,y,z) -> browser(scale*x, scale*z, -scale*y). Map transform differs
 * from the first-person weapon's additional camera yaw; do not use that here.
 */
export function browserToSourcePoint(point: SourceVisibilityPoint, scale = .0254): SourceVisibilityPoint {
  return { x: point.x / scale, y: -point.z / scale, z: point.y / scale };
}

export function findSourceLeaf(index: SourceVisibilityIndex, browser: SourceVisibilityPoint): SourceLeafLocation {
  const failure = (reason: string): SourceLeafLocation => ({ leaf: -1, cluster: -1, boundary: false, reason });
  if (!index.valid) return failure(index.reason);
  if (![browser.x, browser.y, browser.z].every(Number.isFinite)) return failure('invalid-camera');
  const point = browserToSourcePoint(browser, index.scale), xyz = [point.x, point.y, point.z];
  if (xyz.some((v, i) => v < index.sourceBounds[0][i] || v > index.sourceBounds[1][i])) return failure('outside-world-bounds');
  let node = index.head, boundary = false, steps = 0;
  while (node >= 0) {
    if (++steps > index.nodes.length || !index.nodes[node]) return failure('cyclic-or-invalid-node');
    const n = index.nodes[node], p = index.planes[n.plane];
    const distance = point.x * p[0] + point.y * p[1] + point.z * p[2] - p[3];
    boundary ||= distance === 0;
    node = n.children[distance >= 0 ? 0 : 1];
  }
  const leaf = -1 - node, cluster = index.leafClusters[leaf];
  if (cluster === undefined) return failure('invalid-leaf');
  return { leaf, cluster, boundary, reason: cluster < 0 ? 'no-cluster' : boundary ? 'partition-boundary' : 'located' };
}

/** Pure deterministic PVS query. No distance, camera-facing or frustum deletion.
 * Caller may cache by cluster only after a non-boundary, valid leaf location.
 */
export function querySourceVisibility(index: SourceVisibilityIndex, browser: SourceVisibilityPoint): SourceVisibilityResult {
  const location = findSourceLeaf(index, browser);
  const allVisible = (reason: string): SourceVisibilityResult => ({ ...location, reason, allVisible: true, worldFirstFace: index.firstFace,
    worldFaceIds: [...index.allWorldFaceIds], staticPropIds: [...index.allStaticPropIds],
    worldFaceMask: new Uint8Array(index.allWorldFaceIds.length).fill(1), staticPropMask: new Uint8Array(index.allStaticPropIds.length).fill(1) });
  if (!index.valid || location.cluster < 0 || location.boundary) return allVisible(location.reason);
  const row = index.rows[location.cluster];
  if (!row || !(row[location.cluster >> 3] & (1 << (location.cluster & 7)))) return allVisible('missing-or-invalid-pvs-row');
  const faceMask = new Uint8Array(index.allWorldFaceIds.length), propMask = new Uint8Array(index.allStaticPropIds.length);
  for (const face of index.alwaysFaces) faceMask[face - index.firstFace] = 1;
  for (const prop of index.alwaysProps) propMask[prop] = 1;
  for (let c = 0; c < index.clusterCount; c++) if (row[c >> 3] & (1 << (c & 7))) {
    for (const face of index.clusterFaces[c]) faceMask[face - index.firstFace] = 1;
    for (const prop of index.clusterProps[c]) propMask[prop] = 1;
  }
  return { ...location, reason: 'pvs', allVisible: false, worldFirstFace: index.firstFace,
    worldFaceIds: index.allWorldFaceIds.filter(id => faceMask[id - index.firstFace] !== 0),
    staticPropIds: index.allStaticPropIds.filter(id => propMask[id] !== 0), worldFaceMask: faceMask, staticPropMask: propMask };
}

/** Unknown IDs (dynamic brush models, new assets) must remain visible. */
export function isSourceFaceVisible(result: SourceVisibilityResult, id: number): boolean {
  const offset = id - result.worldFirstFace;
  return result.allVisible || !integer(offset, 0, result.worldFaceMask.length - 1) || result.worldFaceMask[offset] !== 0;
}
export function isSourcePropVisible(result: SourceVisibilityResult, id: number): boolean {
  return result.allVisible || !integer(id, 0, result.staticPropMask.length - 1) || result.staticPropMask[id] !== 0;
}
