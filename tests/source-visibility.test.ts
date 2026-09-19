import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { browserToSourcePoint, findSourceLeaf, isSourceFaceVisible, isSourcePropVisible,
  prepareSourceVisibility, querySourceVisibility, type SourceVisibilityData } from '../game/source-visibility';

function fixture(): SourceVisibilityData {
  return { format: 'source-visibility-v1', sourceBspSha256: 'synthetic', metersPerSourceUnit: .0254,
    sourceBounds: [[-10, -10, -10], [10, 10, 10]], worldHeadNode: 0, worldFirstFace: 0, worldFaceCount: 3, faceCount: 3,
    planes: [[1, 0, 0, 0]], nodes: [{ plane: 0, children: [-1, -2], firstFace: 0, faceCount: 0 }],
    leaves: [{ cluster: 0, area: 1, firstLeafFace: 0, leafFaceCount: 1 }, { cluster: 1, area: 2, firstLeafFace: 1, leafFaceCount: 1 }],
    leafFaces: [0, 1], clusterCount: 2, pvsRows: ['AQ==', 'Ag=='], faceClusters: [[0], [1], []],
    staticProps: [{ id: 0, leafIds: [0] }, { id: 1, leafIds: [1] }, { id: 2, leafIds: [] }], alwaysVisibleFaceIds: [], alwaysVisiblePropIds: [] };
}
const front = { x: .0254, y: 0, z: 0 }, back = { x: -.0254, y: 0, z: 0 };

describe('Source visibility deterministic conservative contract', () => {
  it('uses the map transform, including the opposite horizontal axis sign', () => {
    expect(browserToSourcePoint({ x: .254, y: .508, z: -.762 })).toEqual({ x: 10, y: 30, z: 20 });
  });
  it('uses original cluster bits and keeps unknown membership visible', () => {
    const index = prepareSourceVisibility(fixture()); expect(index.valid).toBe(true);
    const a = querySourceVisibility(index, front), b = querySourceVisibility(index, back);
    expect([a.leaf, a.cluster, a.allVisible, a.worldFaceIds, a.staticPropIds]).toEqual([0, 0, false, [0, 2], [0, 2]]);
    expect([b.leaf, b.cluster, b.worldFaceIds, b.staticPropIds]).toEqual([1, 1, [1, 2], [1, 2]]);
    expect(isSourceFaceVisible(a, 1)).toBe(false); expect(isSourcePropVisible(a, 1)).toBe(false);
    expect(isSourceFaceVisible(a, 9999)).toBe(true); expect(isSourcePropVisible(a, 9999)).toBe(true);
  });
  it('does not mutate input, preserves its own copied tree, and repeats exactly', () => {
    const data = fixture(), before = JSON.stringify(data), index = prepareSourceVisibility(data);
    const a = querySourceVisibility(index, front); expect(querySourceVisibility(index, front)).toEqual(a);
    expect(JSON.stringify(data)).toBe(before); data.planes[0][0] = -1;
    expect(querySourceVisibility(index, front)).toEqual(a);
  });
  it('keeps no-cluster positions and exact partition boundaries visible', () => {
    const data = fixture(); data.leaves[0].cluster = -1;
    const noCluster = querySourceVisibility(prepareSourceVisibility(data), front);
    expect(noCluster.allVisible).toBe(true); expect(noCluster.reason).toBe('no-cluster');
    const boundary = querySourceVisibility(prepareSourceVisibility(fixture()), { x: 0, y: 0, z: 0 });
    expect(boundary.allVisible).toBe(true); expect(boundary.reason).toBe('partition-boundary');
  });
  it('does not hide on missing PVS, invalid camera or outside world bounds', () => {
    const data = fixture(); data.pvsRows[0] = null; const index = prepareSourceVisibility(data);
    expect(querySourceVisibility(index, front).allVisible).toBe(true);
    expect(querySourceVisibility(index, { x: NaN, y: 0, z: 0 }).allVisible).toBe(true);
    expect(querySourceVisibility(index, { x: 1e9, y: 0, z: 0 }).allVisible).toBe(true);
  });
  it.each(['child', 'plane', 'leafFace', 'faceCluster', 'propLeaf', 'pvsRow'] as const)('fails conservatively on corrupted %s indices/data', kind => {
    const data = fixture();
    if (kind === 'child') data.nodes[0].children[0] = 100;
    if (kind === 'plane') data.nodes[0].plane = 100;
    if (kind === 'leafFace') data.leafFaces[0] = 100;
    if (kind === 'faceCluster') data.faceClusters[0] = [100];
    if (kind === 'propLeaf') data.staticProps[0].leafIds = [100];
    if (kind === 'pvsRow') data.pvsRows[0] = 'broken';
    const index = prepareSourceVisibility(data); expect(index.valid).toBe(false);
    const result = querySourceVisibility(index, front); expect(result.allVisible).toBe(true);
    expect(isSourceFaceVisible(result, 0)).toBe(true); expect(isSourcePropVisible(result, 0)).toBe(true);
  });
  it('bounds cyclic traversal instead of hanging or using a partial mask', () => {
    const data = fixture(); data.nodes[0].children[0] = 0;
    const result = querySourceVisibility(prepareSourceVisibility(data), front);
    expect(result.allVisible).toBe(true); expect(result.reason).toBe('cyclic-or-invalid-node');
  });
});

const directory = resolve('.reference-assets/source-exports/dust2/visibility');
const available = existsSync(resolve(directory, 'spawn-fixtures.json'));
describe.runIf(available)('Actual original Dust2: all 30 spawns', () => {
  const data = available ? JSON.parse(readFileSync(resolve(directory, 'visibility.json'), 'utf8')) : null;
  const fixtures = available ? JSON.parse(readFileSync(resolve(directory, 'spawn-fixtures.json'), 'utf8')) : [];
  const index = prepareSourceVisibility(data);
  it('validates every original tree/leaf/face/prop index and all 1795 PVS rows', () => {
    expect(index.valid).toBe(true); expect(index.clusterCount).toBe(1795); expect(fixtures).toHaveLength(30);
  });
  it('matches independent Python original-source queries at origin and eye+64', () => {
    for (const spawn of fixtures) for (const [point, expected] of [[spawn.browserOrigin, spawn.originExpected], [spawn.browserEye64, spawn.eyeExpected]]) {
      const p = { x: point[0], y: point[1], z: point[2] }, found = findSourceLeaf(index, p), result = querySourceVisibility(index, p);
      expect([found.leaf, found.cluster], spawn.hammerid).toEqual([expected.leaf, expected.cluster]);
      expect(result.allVisible, spawn.hammerid).toBe(expected.allVisible);
      expect(result.worldFaceIds, spawn.hammerid).toEqual(expected.faces);
      expect(result.staticPropIds, spawn.hammerid).toEqual(expected.props);
    }
  });
});
