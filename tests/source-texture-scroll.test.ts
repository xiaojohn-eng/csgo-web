import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SOURCE_TEXTURE_SCROLL_DEGREES_TO_RADIANS, SOURCE_TEXTURE_SCROLL_LIMITATIONS,
  SOURCE_TEXTURE_SCROLL_TRANSFORMS, sourceTextureScrollBlocks, sourceTextureScrollFor,
  sourceTextureScrollFraction, sourceTextureScrollMatrix, sourceTextureScrollOffsets } from '../game/source-texture-scroll';

const SKY = 'public/source/csgo-12426148/dust2/sky.json';
const skyAvailable = existsSync(SKY);
const sky = () => JSON.parse(readFileSync(SKY, 'utf8'));
const CLOUD = 'models/props/de_nuke/hr_nuke/nuke_skydome_001/nuke_clouds_002';
const cloudMaterial = () => (sky().unlitMaterials as
  { source: string; scrolls: unknown; shader: string; alpha: number; limitations: string[] }[])
  .find((m) => m.source === CLOUD)!;
/** Dust2's own cloud block, exactly as the shipped material states it. */
const DUST2 = { rate: 0.00209, angleDegrees: 80, scale: 3.5 };

describe('the original TextureScroll proxy, as its own client composes it', () => {
  it('uses the client\'s own degrees-to-radians double', () => {
    expect(SOURCE_TEXTURE_SCROLL_DEGREES_TO_RADIANS).toBe(0.017453292519943295);
    expect(90 * SOURCE_TEXTURE_SCROLL_DEGREES_TO_RADIANS).toBeCloseTo(Math.PI / 2, 15);
  });

  it('wraps the way the proxy does, including for negative products', () => {
    expect(sourceTextureScrollFraction(0)).toBe(0);
    expect(sourceTextureScrollFraction(0.25)).toBeCloseTo(0.25, 15);
    expect(sourceTextureScrollFraction(3.75)).toBeCloseTo(0.75, 15);
    // The proxy adds its own 1.0 when the product is negative, so a negative clock still
    // yields an offset in [0, 1) rather than a negative translation.
    expect(sourceTextureScrollFraction(-0.25)).toBeCloseTo(0.75, 15);
    expect(sourceTextureScrollFraction(-3.75)).toBeCloseTo(0.25, 15);
    expect(() => sourceTextureScrollFraction(Number.NaN)).toThrow(/non-finite/);
  });

  it('drifts in the angle\'s direction at the stated rate, wrapping into [0,1)', () => {
    expect(sourceTextureScrollOffsets(DUST2, 0)).toEqual({ u: 0, v: 0 });
    const radians = 80 * SOURCE_TEXTURE_SCROLL_DEGREES_TO_RADIANS;
    for (const time of [1, 7.5, 1000, 12345.678]) {
      const { u, v } = sourceTextureScrollOffsets(DUST2, time);
      expect(u).toBeCloseTo(sourceTextureScrollFraction(time * 0.00209 * Math.cos(radians)), 15);
      expect(v).toBeCloseTo(sourceTextureScrollFraction(time * 0.00209 * Math.sin(radians)), 15);
      expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThan(1);
      expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1);
    }
    // The angle steers the drift, and before anything wraps the two offsets are exactly the
    // angle's own components: at 80 degrees the sine axis moves further than the cosine axis.
    const early = sourceTextureScrollOffsets(DUST2, 10);
    expect(early.u).toBeCloseTo(10 * 0.00209 * Math.cos(radians), 15);
    expect(early.v).toBeCloseTo(10 * 0.00209 * Math.sin(radians), 15);
    expect(early.v / early.u).toBeCloseTo(Math.tan(radians), 9);
    expect(early.v).toBeGreaterThan(early.u);
    // A zero rate does not move at all, which is what the material's second transform states.
    expect(sourceTextureScrollOffsets({ rate: 0, angleDegrees: 0, scale: 1 }, 999)).toEqual({ u: 0, v: 0 });
    expect(() => sourceTextureScrollOffsets(DUST2, Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });

  it('writes the matrix the proxy writes: scale on the diagonal, offsets in the last column', () => {
    const matrix = sourceTextureScrollMatrix(DUST2, 60);
    const { u, v } = sourceTextureScrollOffsets(DUST2, 60);
    expect(matrix).toHaveLength(16);
    expect(matrix).toEqual([3.5, 0, 0, u, 0, 3.5, 0, v, 0, 0, 1, 0, 0, 0, 0, 1]);
    // The angle appears nowhere else: there is no rotation term, only the drift direction.
    for (const index of [1, 2, 4, 6, 8, 9, 11, 12, 13, 14]) expect(matrix[index]).toBe(0);
    expect(matrix[10]).toBe(1);
    expect(matrix[15]).toBe(1);
    // At the clock's zero the transform is a pure scale.
    expect(sourceTextureScrollMatrix(DUST2, 0)).toEqual([3.5, 0, 0, 0, 0, 3.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it('reads the staged blocks and refuses anything it cannot apply', () => {
    const blocks = sourceTextureScrollBlocks([
      { variable: '$basetexturetransform', rate: 0.00209, angle: 80, scale: 3.5 },
      { variable: '$texture2transform', rate: 0, angle: 0, scale: 1 },
    ]);
    expect(blocks).toHaveLength(2);
    expect(sourceTextureScrollFor(blocks, '$basetexturetransform'))
      .toEqual({ variable: '$basetexturetransform', rate: 0.00209, angleDegrees: 80, scale: 3.5 });
    expect(sourceTextureScrollFor(blocks, '$texture2transform')!.rate).toBe(0);
    expect(sourceTextureScrollFor([], '$basetexturetransform')).toBeNull();
    expect(sourceTextureScrollBlocks(undefined)).toEqual([]);
    // A transform the material does not name, a missing number and a non-list each fail.
    expect(() => sourceTextureScrollBlocks([{ variable: '$bumpmap', rate: 1, angle: 0, scale: 1 }]))
      .toThrow(/not one of the two transforms/);
    expect(() => sourceTextureScrollBlocks([{ variable: '$basetexturetransform', rate: 1, angle: 0 }]))
      .toThrow(/non-numeric scale/);
    expect(() => sourceTextureScrollBlocks('texturescroll')).toThrow(/not a list/);
    expect(() => sourceTextureScrollBlocks([{ variable: '$basetexturetransform', rate: 'x', angle: 0, scale: 1 }]))
      .toThrow(/non-numeric rate/);
    expect(SOURCE_TEXTURE_SCROLL_TRANSFORMS).toEqual(['$basetexturetransform', '$texture2transform']);
    expect(SOURCE_TEXTURE_SCROLL_LIMITATIONS).toHaveLength(2);
  });
});

describe.skipIf(!skyAvailable)('the staged sky material the scroll came from', () => {
  it('stages the cloud layer\'s two blocks with the shipped numbers, and nothing on the base layer', () => {
    const cloud = cloudMaterial();
    const blocks = sourceTextureScrollBlocks(cloud.scrolls);
    expect(sourceTextureScrollFor(blocks, '$basetexturetransform'))
      .toEqual({ variable: '$basetexturetransform', rate: 0.00209, angleDegrees: 80, scale: 3.5 });
    expect(sourceTextureScrollFor(blocks, '$texture2transform'))
      .toEqual({ variable: '$texture2transform', rate: 0, angleDegrees: 0, scale: 1 });
    const base = (sky().unlitMaterials as { source: string; scrolls: unknown }[])
      .find((m) => m.source === 'models/props/de_dust/hr_dust/dust_skybox/sky_dust2')!;
    expect(sourceTextureScrollBlocks(base.scrolls)).toEqual([]);
  });

  it('leaves the cloud layer\'s alpha, its branch and its own stated limitations as the file has them', () => {
    const cloud = cloudMaterial();
    expect(cloud.shader).toBe('unlittwotexture');
    expect(cloud.alpha).toBe(0.35);
    expect(cloud.limitations.join(' ')).toMatch(/its own program's product/);
    expect(cloud.limitations.join(' ')).toMatch(/TextureScroll transform/);
    expect(cloud.limitations.join(' ')).toMatch(/cLightScale factor is not applied/);
  });

  it('stages the second texture the cloud layer draws and the branch it selects', () => {
    const cloud = cloudMaterial() as unknown as { second: Record<string, unknown>; translucent: boolean;
      program: { static: string; dynamic: number; rgb: string; alpha: string; unapplied: string[] } };
    expect(cloud.translucent).toBe(true);
    // The branch is the combo a material declaring only `$translucent 1` lands on, not a choice
    // made here: it is measured in scripts/probe-source-cloud-layer-branch.py.
    expect(cloud.program.static).toBe('0x1');
    expect(cloud.program.dynamic).toBe(1);
    expect(cloud.program.rgb).toBe('texture0.rgb * texture1.rgb * c1.rgb');
    expect(cloud.program.alpha).toBe('texture0.a * texture1.a * c1.a');
    expect(cloud.program.unapplied.join(' ')).toMatch(/cLightScale/);
    expect(cloud.second.texture).toBe('models/props/de_nuke/hr_nuke/nuke_skydome_001/nuke_clouds_001');
    expect(cloud.second.width).toBe(256);
    expect(cloud.second.height).toBe(256);
    expect(cloud.second.bytes).toBe(85350);
    expect(cloud.second.sha256).toBe('9f283d226b2f7707eaa7f94e425cfe3debf31a8969ad1de2f8b18f07c56a015a');
    // Both cloud textures carry no CLAMPS/CLAMPT flag, which is why the layer wraps.
    expect(cloud.second.clampS).toBe(false);
    expect(cloud.second.clampT).toBe(false);
    const base = (sky().unlitMaterials as { source: string; second: unknown; program: unknown; translucent: boolean }[])
      .find((m) => m.source === 'models/props/de_dust/hr_dust/dust_skybox/sky_dust2')!;
    expect(base.second).toBe(null);
    expect(base.program).toBe(null);
    expect(base.translucent).toBe(false);
  });
});
