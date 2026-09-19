/** The cloud layer's second texture: the staged lossless copy of the material's own `$texture2`.
 *
 * The sky draw multiplies this texture into the layer's base texture
 * (game/source-sky-render.ts), so it has to be read the way the base one is: the map's glTF
 * textures are sampled sRGB with glTF's own orientation, and the original bound both of this
 * material's samplers to textures that carry no clamp flag. Decoding the staged copy the same
 * way is what makes both samplers agree on one texel for one UV.
 *
 * The descriptor's receipt is checked against the bytes before a texture exists, and the
 * decoded size is checked against the receipt before the draw uses it.
 */
import * as T from 'three';
import type { SourceSkySecondTexture } from './source-sky';
import { sourceSha256 } from './source-sha256';

export type SourceSkyCloudLayer = { texture: T.Texture; dispose: () => void };

export async function loadSourceSkyCloudLayer(options: {
  rule: SourceSkySecondTexture; read: () => Promise<Uint8Array>; signal?: AbortSignal;
}): Promise<SourceSkyCloudLayer> {
  const { rule } = options;
  const bytes = await options.read();
  options.signal?.throwIfAborted();
  if (bytes.byteLength !== rule.bytes) throw Error('Source sky second texture byte count differs');
  if (await sourceSha256(bytes, options.signal) !== rule.sha256)
    throw Error('Source sky second texture checksum differs');
  const image = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
    { colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'none' });
  if (image.width !== rule.width || image.height !== rule.height) {
    image.close();
    throw Error('Source sky second texture decoded size differs');
  }
  const texture = new T.Texture(image);
  texture.name = rule.texture;
  texture.colorSpace = T.SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = rule.clampS ? T.ClampToEdgeWrapping : T.RepeatWrapping;
  texture.wrapT = rule.clampT ? T.ClampToEdgeWrapping : T.RepeatWrapping;
  texture.needsUpdate = true;
  let disposed = false;
  return {
    texture,
    dispose() {
      if (disposed) return;
      disposed = true;
      texture.dispose();
      image.close();
    },
  };
}
