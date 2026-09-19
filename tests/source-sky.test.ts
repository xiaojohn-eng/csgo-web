import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { prepareSourceSky, querySourceSkyView, type SourceSkyData } from '../game/source-sky';
import type { SourceVisibilityData } from '../game/source-visibility';

const base = '.reference-assets/source-exports/dust2/';
const available = existsSync(base + 'sky/sky.json');
const read = (path: string) => JSON.parse(readFileSync(base + path, 'utf8'));
describe.runIf(available)('Original Dust2 sky CPU contract', () => {
  const data: SourceSkyData = available ? read('sky/sky.json') : null;
  const visibility: SourceVisibilityData = available ? read('visibility/visibility.json') : null;
  it('uses the original isolated area/PVS and excludes every other sprp instance', () => {
    const sky = prepareSourceSky(data, visibility);
    expect([sky.data.camera.leaf, sky.data.camera.cluster, sky.data.camera.area]).toEqual([2497, 0, 1]);
    expect(sky.data.worldFaceIds).toEqual([9711, 9712, 9713, 9714]);
    expect(sky.data.staticPropIds).toHaveLength(75);
    expect(sky.data.staticPropIds).toEqual(visibility.alwaysVisiblePropIds);
    expect(sky.data.staticPropIds).toContain(146); expect(sky.data.staticPropIds).toContain(164);
    expect(sky.data.staticPropIds).not.toContain(0); // Original warmup-island prop; classification uses leaves, not names.
    expect(sky.data.skyLeafIds).toHaveLength(76);
    expect(sky.data.skyLeafIds.every(i => visibility.leaves[i].area === 1 && visibility.leaves[i].cluster === 0)).toBe(true);
  });
  it('uses translated/scaled viewing position but a fixed PVS origin and independent clipping', () => {
    const sky = prepareSourceSky(data, visibility), point = { x: 13, y: -2, z: 37 };
    const a = querySourceSkyView(sky, point), b = querySourceSkyView(sky, { x: point.x + 16, y: point.y, z: point.z });
    expect(b.position.x - a.position.x).toBeCloseTo(1, 13);
    expect(a.position).toEqual({ x: data.camera.sourceOrigin[0] * .0254 + 13 / 16,
      y: data.camera.sourceOrigin[2] * .0254 - 2 / 16, z: -data.camera.sourceOrigin[1] * .0254 + 37 / 16 });
    expect(a.visibilityOrigin).toEqual(b.visibilityOrigin);
    expect(a.near).toBe(.0508); expect(a.far).toBeCloseTo(32768 * Math.sqrt(3) * .0254, 8);
    expect(a.fog.start).toBe(-.0142875); expect(a.fog.end).toBe(14.2875); expect(a.fog.maxDensity).toBe(.6);
  });
  it('checks original leaf sky flags at all 30 source spawn eyes', () => {
    const sky = prepareSourceSky(data, visibility), fixtures = read('visibility/spawn-fixtures.json');
    expect(fixtures).toHaveLength(30);
    for (const f of fixtures) {
      const [x, y, z] = f.browserEye64, view = querySourceSkyView(sky, { x, y, z });
      expect(view.mainLeaf, f.hammerid).toBe(f.eyeExpected.leaf);
      expect(view.enabled, f.hammerid).toBe((data.leafFlags[view.mainLeaf] & 1) !== 0);
    }
  });
  it('copies data, fails before use on mismatched identity/membership, and never changes visibility', () => {
    const original = JSON.stringify(visibility), copy = structuredClone(data), sky = prepareSourceSky(copy, visibility);
    copy.camera.sourceOrigin[0] += 10; copy.staticPropIds.length = 0;
    expect(sky.data.staticPropIds).toHaveLength(75); expect(sky.data.camera.sourceOrigin).toEqual(data.camera.sourceOrigin);
    expect(JSON.stringify(visibility)).toBe(original);
    expect(() => prepareSourceSky({ ...data, sourceBspSha256: '0'.repeat(64) }, visibility)).toThrow(/identity/);
    expect(() => prepareSourceSky({ ...data, staticPropIds: [...data.staticPropIds, 0] }, visibility)).toThrow(/membership|sorted/);
    expect(() => prepareSourceSky({ ...data, camera: { ...data.camera, area: 2 } }, visibility)).toThrow(/area|membership/);
    expect(() => querySourceSkyView(sky, { x: NaN, y: 0, z: 0 })).toThrow(/finite/);
  });
  it('refuses a two-texture layer whose branch, texture or second-texture receipt is not the measured one', () => {
    const at = (data.unlitMaterials as { source: string }[]).findIndex(m => m.source.endsWith('/nuke_clouds_002'));
    expect(at).toBeGreaterThanOrEqual(0);
    const withCloud = (change: (cloud: SourceSkyData['unlitMaterials'][number]) => unknown) => {
      const materials = structuredClone(data.unlitMaterials); change(materials[at]); return { ...data, unlitMaterials: materials };
    };
    expect(prepareSourceSky(withCloud(() => undefined), visibility).data.unlitMaterials[at].program)
      .toMatchObject({ static: '0x1', dynamic: 1 });
    // A different combo, or different terms, is a different branch than the measured one.
    for (const program of [{ static: '0x2', dynamic: 1 }, { static: '0x1', dynamic: 0 },
      { static: '0x1', dynamic: 1, rgb: 'texture0.rgb * texture1.rgb' }])
      expect(() => prepareSourceSky(withCloud(cloud => { cloud.program = { ...cloud.program!, ...program }; }), visibility))
        .toThrow(/material contract/);
    // The fog dynamic combo and `$nofog` come from one measurement, so they have to agree.
    expect(() => prepareSourceSky(withCloud(cloud => { cloud.noFog = false; }), visibility))
      .toThrow(/material contract/);
    // A declared second texture without its receipt, or without its branch, is refused.
    expect(() => prepareSourceSky(withCloud(cloud => { cloud.second = null; }), visibility))
      .toThrow(/material contract|contract differs/);
    expect(() => prepareSourceSky(withCloud(cloud => { cloud.second = { ...cloud.second!, sha256: 'x' }; }), visibility))
      .toThrow(/material contract/);
    expect(() => prepareSourceSky(withCloud(cloud => { cloud.second!.bytes = 0; }), visibility))
      .toThrow(/material contract/);
    // The one-texture layer may not grow either one.
    const base = (data.unlitMaterials as { source: string }[]).findIndex(m => m.source.endsWith('/sky_dust2'));
    const withBase = structuredClone(data.unlitMaterials); withBase[base].translucent = true;
    expect(() => prepareSourceSky({ ...data, unlitMaterials: withBase }, visibility)).toThrow(/contract differs/);
  });
});
