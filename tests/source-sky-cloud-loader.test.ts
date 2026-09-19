import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { loadSourceSkyCloudLayer } from '../game/source-sky-cloud-loader';
import type { SourceSkySecondTexture } from '../game/source-sky';

/** The staged pair this port ships: the descriptor beside the map's data and the lossless copy
 * of the cloud material's own $texture2 the descriptor names. */
const SKY = 'public/source/csgo-12426148/dust2/sky.json';
const PNG = 'public/source/csgo-12426148/dust2/sky-cloud-texture2.png';
const CLOUD = 'models/props/de_nuke/hr_nuke/nuke_skydome_001/nuke_clouds_002';
const available = existsSync(SKY) && existsSync(PNG);
const rule = (): SourceSkySecondTexture => (JSON.parse(readFileSync(SKY, 'utf8')).unlitMaterials as
  { source: string; second: SourceSkySecondTexture | null }[]).find(m => m.source === CLOUD)!.second!;
const staged = () => new Uint8Array(readFileSync(PNG));

/** A decoder that reports the size the original declares, like the browser's own. */
function decoder(width: number, height: number) {
  const close = vi.fn();
  return { decode: vi.fn(async (_blob: Blob, _options?: unknown) => ({ width, height, close })), close };
}

afterEach(() => vi.unstubAllGlobals());

describe.runIf(available)('the cloud layer\'s staged second texture', () => {
  it('reads the staged copy exactly the way the base texture is read', async () => {
    const { decode } = decoder(rule().width, rule().height);
    vi.stubGlobal('createImageBitmap', decode);
    const layer = await loadSourceSkyCloudLayer({ rule: rule(), read: async () => staged() });
    const texture = layer.texture as T.Texture;
    expect(texture.name).toBe(rule().texture);
    expect(texture.colorSpace).toBe(T.SRGBColorSpace);
    // glTF textures keep glTF's orientation; both samplers have to address one texel per UV.
    expect(texture.flipY).toBe(false);
    // The material's own VTF flags decide the wrap, and the shipped copy carries no clamp flag.
    expect(texture.wrapS).toBe(T.RepeatWrapping);
    expect(texture.wrapT).toBe(T.RepeatWrapping);
    expect(decode).toHaveBeenCalledTimes(1);
    const dispose = vi.spyOn(texture, 'dispose');
    layer.dispose(); layer.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('refuses bytes that are not the staged copy before any texture exists', async () => {
    const { decode } = decoder(rule().width, rule().height);
    vi.stubGlobal('createImageBitmap', decode);
    const short = staged().slice(0, staged().byteLength - 1);
    await expect(loadSourceSkyCloudLayer({ rule: rule(), read: async () => short }))
      .rejects.toThrow(/byte count differs/);
    const altered = staged(); altered[0] ^= 0xff;
    await expect(loadSourceSkyCloudLayer({ rule: rule(), read: async () => altered }))
      .rejects.toThrow(/checksum differs/);
    expect(decode).not.toHaveBeenCalled();
  });

  it('refuses a decoded size that is not the original\'s, and releases the image', async () => {
    const { decode, close } = decoder(rule().width, rule().height + 1);
    vi.stubGlobal('createImageBitmap', decode);
    await expect(loadSourceSkyCloudLayer({ rule: rule(), read: async () => staged() }))
      .rejects.toThrow(/decoded size differs/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('clamps only where the original asks it to', async () => {
    const { decode } = decoder(rule().width, rule().height);
    vi.stubGlobal('createImageBitmap', decode);
    const clamped = { ...rule(), clampS: true, clampT: true };
    const layer = await loadSourceSkyCloudLayer({ rule: clamped, read: async () => staged() });
    expect(layer.texture.wrapS).toBe(T.ClampToEdgeWrapping);
    expect(layer.texture.wrapT).toBe(T.ClampToEdgeWrapping);
    layer.dispose();
  });
});
