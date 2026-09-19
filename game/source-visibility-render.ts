/** Shared renderer adapter. It only selects original triangles and toggles
 * original sprp anchors. No vertex edits, merging, texture changes or distances.
 */
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, type Mesh, type Object3D } from 'three';
import { findSourceLeaf, isSourceFaceVisible, isSourcePropVisible, prepareSourceVisibility, querySourceVisibility,
  type SourceVisibilityPoint, type SourceVisibilityResult } from './source-visibility';

type IndexArray = Uint8Array | Uint16Array | Uint32Array;
type Segment = { start: number; count: number; materialIndex: number };
type WorldBinding = {
  mesh: Mesh; original: BufferGeometry; visible: boolean; indices: IndexArray; faces: Float64Array;
  segments: Segment[]; renderTriangles: number; filtered: BufferGeometry | null; output: IndexArray | null;
};
export type SourceVisibilityPreviewStats = {
  changed: boolean; enabled: boolean; leaf: number; cluster: number; allVisible: boolean; reason: string;
  worldMeshes: number; worldFilteredMeshes: number; worldAlwaysMeshes: number; worldTriangles: number; worldVisibleTriangles: number;
  mappedProps: number; visibleProps: number; unknownPropAnchors: number; queryMs: number; applyMs: number;
};

function bindWorldMesh(mesh: Mesh): WorldBinding | null {
  const original = mesh.geometry, index = original.index, face = original.getAttribute('uv2'), position = original.getAttribute('position');
  // Unsupported topology stays as-is. The map currently has only indexed,
  // unskinned triangles with all source face IDs in TEXCOORD_2.x (Three uv2).
  if (!index || index.itemSize !== 1 || !face || !position || face.itemSize < 1 || face.count !== position.count ||
    ![Uint8Array, Uint16Array, Uint32Array].some(t => index.array instanceof t) ||
    index.count % 3 || (mesh as Mesh & { isSkinnedMesh?: boolean; isInstancedMesh?: boolean }).isSkinnedMesh ||
    (mesh as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh) return null;
  const start = original.drawRange.start, end = Math.min(index.count, start + original.drawRange.count);
  if (!Number.isInteger(start) || start < 0 || start % 3 || !Number.isInteger(end) || end < start || end % 3) return null;
  const segments: Segment[] = [];
  const groups = Array.isArray(mesh.material) ? original.groups : [{ start, count: end - start, materialIndex: 0 }];
  if (!groups.length) return null;
  for (const g of groups) {
    if (!Number.isInteger(g.start) || !Number.isInteger(g.count) || g.start < 0 || g.count < 0 || g.start % 3 || g.count % 3 ||
      g.start + g.count > index.count) return null;
    const from = Math.max(start, g.start), until = Math.min(end, g.start + g.count);
    if (until > from) segments.push({ start: from, count: until - from, materialIndex: g.materialIndex ?? 0 });
  }
  const indices = (index.array as IndexArray).slice(), faces = new Float64Array(index.count / 3).fill(-1);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    if (a >= face.count || b >= face.count || c >= face.count) return null;
    const id = face.getX(a);
    if (Number.isSafeInteger(id) && id >= 0 && face.getX(b) === id && face.getX(c) === id) faces[i / 3] = id;
  }
  return { mesh, original, visible: mesh.visible, indices, faces, segments,
    renderTriangles: segments.reduce((n, g) => n + g.count / 3, 0), filtered: null, output: null };
}

function filteredGeometry(binding: WorldBinding): BufferGeometry {
  if (binding.filtered) return binding.filtered;
  const { original } = binding, geometry = new BufferGeometry();
  geometry.name = original.name;
  for (const [name, attribute] of Object.entries(original.attributes)) geometry.setAttribute(name, attribute);
  geometry.morphAttributes = original.morphAttributes; geometry.morphTargetsRelative = original.morphTargetsRelative;
  geometry.userData = original.userData;
  // Keep full original bounds: filtering can only reduce geometry. Recomputing
  // a smaller bound is unnecessary and risks extra popping at boundaries.
  geometry.boundingBox = original.boundingBox; geometry.boundingSphere = original.boundingSphere;
  const length = binding.segments.reduce((n, group) => n + group.count, 0);
  const Constructor = binding.indices.constructor as typeof Uint32Array;
  binding.output = new Constructor(length) as IndexArray;
  geometry.setIndex(new BufferAttribute(binding.output, 1).setUsage(DynamicDrawUsage));
  binding.filtered = geometry;
  return geometry;
}

function selectTriangles(binding: WorldBinding, result: SourceVisibilityResult,excluded:ReadonlySet<number>): number {
  if (result.allVisible&&!excluded.size) {
    binding.mesh.geometry = binding.original; binding.mesh.visible = binding.visible;
    return binding.renderTriangles;
  }
  const geometry = filteredGeometry(binding), output = binding.output!;
  geometry.clearGroups(); let count = 0;
  for (const segment of binding.segments) {
    const first = count;
    for (let i = segment.start, end = i + segment.count; i < end; i += 3) {
      if (excluded.has(binding.faces[i/3])||!isSourceFaceVisible(result, binding.faces[i / 3])) continue;
      // No vertex remap or winding rotation. Opposite and duplicate source
      // triangles are copied independently in their original segment order.
      output[count++] = binding.indices[i]; output[count++] = binding.indices[i + 1]; output[count++] = binding.indices[i + 2];
    }
    if (count > first) geometry.addGroup(first, count - first, segment.materialIndex);
  }
  geometry.setDrawRange(0, count);
  geometry.index!.clearUpdateRanges();
  if (count) geometry.index!.addUpdateRange(0, count);
  geometry.index!.needsUpdate = true;
  binding.mesh.geometry = geometry; binding.mesh.visible = binding.visible && count > 0;
  return count / 3;
}

/** Create after both glTF scenes and their original visibility flags are ready.
 * Call update with a world-space browser camera position before each render.
 * Inputs/GLBs are never modified. Scene geometry references and visible flags
 * are restored by dispose(); only this adapter's generated geometry is disposed.
 * onStaticProps receives the raw per-prop-id mask whenever the PVS cluster
 * changes (null = every prop visible), so merged batch owners can apply the
 * same culling on the GPU; short-circuit repeats are not re-sent. onWorldFaces
 * receives the equivalent per-face mask (plus the first face id it indexes)
 * for GPU world-face batches. worldMeshFilter excludes merged batch meshes
 * from both the CPU refilter and the always-visible accounting.
 */
export function createSourceVisibilityPreview(options: { world: Object3D; props?: Object3D; data: unknown;
  excludeWorldFaceIds?:readonly number[];excludeStaticPropIds?:readonly number[];
  onStaticProps?:(mask:Uint8Array|null)=>void;
  onWorldFaces?:(mask:Uint8Array|null,firstFace:number)=>void;
  worldMeshFilter?:(mesh:Mesh)=>boolean }) {
  const index = prepareSourceVisibility(options.data), world: WorldBinding[] = [];
  const excludedFaces=new Set(options.excludeWorldFaceIds),excludedProps=new Set(options.excludeStaticPropIds);
  if([...excludedFaces].some(id=>!Number.isSafeInteger(id)||!index.allWorldFaceIds.includes(id))||
    [...excludedProps].some(id=>!Number.isSafeInteger(id)||!index.allStaticPropIds.includes(id)))throw Error('Unknown Source sky exclusion identity');
  const props: { object: Object3D; id: number; visible: boolean }[] = [];
  let worldMeshes = 0, worldAlwaysMeshes = 0, unknownPropAnchors = 0;
  options.world.traverse(object => {
    const mesh = object as Mesh; if (!mesh.isMesh) return;
    if (options.worldMeshFilter && !options.worldMeshFilter(mesh)) return;
    worldMeshes++;
    const binding = bindWorldMesh(mesh);
    if (binding) world.push(binding); else worldAlwaysMeshes++;
  });
  const candidates: { object: Object3D; id: number }[] = [], idCounts = new Map<number, number>();
  options.props?.traverse(object => {
    const match = /^static_prop_(\d+)$/.exec(object.name);
    if (!match) return;
    const id = Number(match[1]);
    if (!Number.isSafeInteger(id) || id < 0 || id >= index.allStaticPropIds.length || typeof object.userData.sourceModel !== 'string') {
      unknownPropAnchors++; return;
    }
    candidates.push({ object, id }); idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  });
  for (const candidate of candidates) {
    if (idCounts.get(candidate.id) !== 1) { unknownPropAnchors++; continue; }
    props.push({ ...candidate, visible: candidate.object.visible });
  }
  if((excludedFaces.size&&worldAlwaysMeshes)||[...excludedProps].some(id=>!props.some(p=>p.id===id)))throw Error('Source sky exclusion cannot be mapped to original geometry');
  const worldTriangles = world.reduce((n, binding) => n + binding.renderTriangles, 0);
  let key = '', disposed = false;
  let stats: SourceVisibilityPreviewStats = { changed: false, enabled: false, leaf: -1, cluster: -1, allVisible: true, reason: 'not-updated',
    worldMeshes, worldFilteredMeshes: world.length, worldAlwaysMeshes, worldTriangles, worldVisibleTriangles: worldTriangles,
    mappedProps: props.length, visibleProps: props.length, unknownPropAnchors, queryMs: 0, applyMs: 0 };
  return {
    index,
    update(camera: SourceVisibilityPoint, enabled = true): SourceVisibilityPreviewStats {
      if (disposed) throw new Error('Source visibility preview was disposed');
      const begin = performance.now(), location = findSourceLeaf(index, camera);
      const next = enabled && location.cluster >= 0 && !location.boundary ? `cluster:${location.cluster}` : 'all';
      if (next === key) {
        stats = { ...stats, changed: false, enabled, leaf: location.leaf, cluster: location.cluster,
          reason: next === 'all' ? enabled ? location.reason : 'disabled' : stats.reason,
          queryMs: performance.now() - begin, applyMs: 0 };
        return stats;
      }
      const result = querySourceVisibility(index, enabled ? camera : { x: NaN, y: NaN, z: NaN });
      options.onStaticProps?.(result.allVisible ? null : result.staticPropMask);
      options.onWorldFaces?.(result.allVisible ? null : result.worldFaceMask, index.firstFace);
      const applied = performance.now(); let worldVisibleTriangles = 0, visibleProps = 0;
      for (const binding of world) worldVisibleTriangles += selectTriangles(binding, result,excludedFaces);
      for (const prop of props) { const visible = !excludedProps.has(prop.id)&&isSourcePropVisible(result, prop.id); prop.object.visible = prop.visible && visible; visibleProps += +visible; }
      key = next;
      stats = { ...stats, changed: true, enabled, leaf: location.leaf, cluster: location.cluster, allVisible: result.allVisible,
        reason: enabled ? result.reason : 'disabled', worldVisibleTriangles, visibleProps,
        queryMs: applied - begin, applyMs: performance.now() - applied };
      return stats;
    },
    dispose() {
      if (disposed) return;
      for (const binding of world) {
        binding.mesh.geometry = binding.original; binding.mesh.visible = binding.visible;
        binding.filtered?.dispose();
      }
      for (const prop of props) prop.object.visible = prop.visible;
      disposed = true;
    },
  };
}
