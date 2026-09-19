/** The original bullet-impact sounds, owned explicitly.
 *
 * `game/source-impact-audio.json` is staged from the shipped sound scripts: each record
 * is one original wave of one original event, with the event's own `volume` and `pitch`
 * range. Every wave is fetched, checked against its receipt and decoded before the first
 * draw, so a shot either plays an original wave or nothing.
 *
 * What is NOT reproduced: the events' `operator_stacks` (`CS_limit_bullet_impact`,
 * `CS_up...`), `soundlevel` attenuation, room acoustics and the original's own draw
 * inside the wave list. The port picks a wave with the caller's draw so one shot is one
 * sound, matching the decal choice instead of drawing twice.
 */
import type { AudioEngine } from './audio';
import catalog from './source-impact-audio.json';
import { sourceSha256 } from './source-sha256';

export type SourceImpactSound = {
  key: string; event: string; url: string; sha256: string; bytes: number;
  pitch: [number, number]; volume: [number, number]; source: string;
};

export type SourceImpactAudioOwner = {
  hashVerified: Record<string, boolean>;
  records: readonly SourceImpactSound[];
  played: Record<string, number>;
  history: { event: string; key: string; volume: number; playbackRate: number }[];
  event(name: string, volume: number, pan: number, position?: { x: number; y: number; z: number },
    occluded?: boolean, draw?: number): boolean;
  dispose(): void;
};

export async function loadSourceImpactAudio(audio: AudioEngine, options: { signal?: AbortSignal } = {}): Promise<SourceImpactAudioOwner> {
  const { signal } = options;
  const records = catalog as unknown as SourceImpactSound[];
  if (!Array.isArray(records) || !records.length) throw Error('Original impact sound catalogue is empty');
  for (const row of records) {
    if (typeof row.key !== 'string' || typeof row.event !== 'string' || typeof row.url !== 'string'
      || typeof row.sha256 !== 'string' || !Array.isArray(row.pitch) || !Array.isArray(row.volume)
      || !(row.bytes > 0))
      throw Error('Original impact sound record is malformed: ' + String(row?.key));
  }
  if (audio.disposed) throw Error('Audio engine disposed');
  signal?.throwIfAborted();
  if (typeof OfflineAudioContext === 'undefined') throw Error('Original impact audio decoder unavailable');
  const decoder = new OfflineAudioContext(1, 1, 44100);
  const decoded = new Map<string, Promise<AudioBuffer>>();
  const owned = new Map<string, AudioBuffer>();
  const hashVerified: Record<string, boolean> = {};
  const played: Record<string, number> = {};
  const history: SourceImpactAudioOwner['history'] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const [key, buffer] of owned) if (audio.buffers.get(key) === buffer) audio.buffers.delete(key);
    owned.clear();
  };
  try {
    const pending = await Promise.allSettled(records.map(async row => {
      let buffer = decoded.get(row.sha256);
      if (!buffer) {
        buffer = (async () => {
          const response = await fetch(row.url, { cache: 'no-cache', signal });
          if (!response.ok) throw Error('Impact sound HTTP ' + response.status);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.byteLength !== row.bytes || await sourceSha256(bytes, signal) !== row.sha256)
            throw Error('Original impact sound SHA mismatch: ' + row.key);
          return decoder.decodeAudioData(bytes.buffer as ArrayBuffer);
        })();
        decoded.set(row.sha256, buffer);
      }
      const value = await buffer;
      signal?.throwIfAborted();
      if (audio.disposed) throw Error('Audio engine disposed');
      owned.set(row.key, value);
      audio.buffers.set(row.key, value);
      hashVerified[row.key] = true;
    }));
    for (const result of pending) if (result.status === 'rejected') throw result.reason;
    signal?.throwIfAborted();
    function event(name: string, volume: number, pan: number,
      position?: { x: number; y: number; z: number }, occluded = false, draw?: number) {
      if (disposed || audio.disposed) return false;
      const choices = records.filter(row => row.event === name);
      if (!choices.length) return false;
      const index = draw === undefined ? Math.floor(Math.random() * choices.length)
        : Math.max(0, Math.min(choices.length - 1, Math.floor(draw * choices.length)));
      const row = choices[index];
      const pitch = row.pitch[0] + Math.random() * (row.pitch[1] - row.pitch[0]);
      const gain = row.volume[0] + Math.random() * (row.volume[1] - row.volume[0]);
      const started = audio.sample(row.key, volume * gain, pan, position, occluded, pitch / 100);
      if (started) {
        played[row.event] = (played[row.event] ?? 0) + 1;
        history.push({ event: row.event, key: row.key, volume: volume * gain, playbackRate: pitch / 100 });
        if (history.length > 64) history.shift();
      }
      return started;
    }
    return { hashVerified, records, played, history, event, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
