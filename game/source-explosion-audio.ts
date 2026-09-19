import type { AudioEngine } from './audio';
import catalog from './source-explosion-audio.json';
import { sourceSha256 } from './source-sha256';

export type SourceExplosionKind = 'he' | 'c4';
type Position = { x: number; y: number; z: number };
export type SourceExplosionAudioOwner = {
  hashVerified: Record<string, boolean>;
  played: Record<string, number>;
  event(kind: SourceExplosionKind, position?: Position, draw?: number): boolean;
  dispose(): void;
};

/** Original wave bytes and script gain/pitch. HE's distant operator graph and
 * Source soundlevel attenuation remain separate from browser positional audio. */
export async function loadSourceExplosionAudio(
  audio: Pick<AudioEngine, 'buffers' | 'disposed' | 'sample'>,
  options: { signal?: AbortSignal } = {},
): Promise<SourceExplosionAudioOwner> {
  const { signal } = options;
  signal?.throwIfAborted();
  if (audio.disposed) throw Error('Audio engine disposed');
  if (typeof OfflineAudioContext === 'undefined') throw Error('Original explosion audio decoder unavailable');
  const decoder = new OfflineAudioContext(1, 1, 44100);
  const owned = new Map<string, AudioBuffer>();
  const hashVerified: Record<string, boolean> = {};
  const played: Record<string, number> = {};
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const [key, buffer] of owned) if (audio.buffers.get(key) === buffer) audio.buffers.delete(key);
    owned.clear();
  };
  try {
    const results = await Promise.allSettled(catalog.map(async row => {
      const response = await fetch(row.url, { cache: 'no-cache', signal });
      if (!response.ok) throw Error('Explosion audio HTTP ' + response.status);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== row.bytes || await sourceSha256(bytes, signal) !== row.sha256)
        throw Error('Original explosion sound SHA mismatch: ' + row.key);
      const buffer = await decoder.decodeAudioData(bytes.buffer as ArrayBuffer);
      signal?.throwIfAborted();
      if (audio.disposed) throw Error('Audio engine disposed');
      owned.set(row.key, buffer);
      audio.buffers.set(row.key, buffer);
      hashVerified[row.key] = true;
    }));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    signal?.throwIfAborted();
    return {
      hashVerified, played, dispose,
      event(kind, position, draw = Math.random()) {
        if (disposed || audio.disposed || !Number.isFinite(draw)) return false;
        const choices = catalog.filter(row => row.kind === kind);
        if (!choices.length) return false;
        const row = choices[Math.max(0, Math.min(choices.length - 1, Math.floor(draw * choices.length)))];
        const pitch = row.pitch[0] + Math.random() * (row.pitch[1] - row.pitch[0]);
        const volume = row.volume[0] + Math.random() * (row.volume[1] - row.volume[0]);
        // c4.explode explicitly has SNDLVL_NONE: do not add a distance panner.
        const started = audio.sample(row.key, volume, 0,
          row.soundlevel === 'SNDLVL_NONE' ? undefined : position, false, pitch / 100);
        if (started) played[row.event] = (played[row.event] ?? 0) + 1;
        return started;
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
