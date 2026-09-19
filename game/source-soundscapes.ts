/**
 * Dust2's own soundscapes, as the shipped build states them.
 *
 * The map declares 57 `env_soundscape` entities; this module holds those entities, the definitions
 * they name out of the shipped pak, and the two things the engine's own code says about them:
 *
 *  * **the gate**: a soundscape is a candidate for a listener when the listener is strictly inside
 *    its sphere, compared squared (`radius * radius > distanceSquared`, 0xa1a247-0xa1a2fd in the
 *    server's `CSoundscapeSystem` update). `candidatesAt` is that comparison and nothing more.
 *  * **the material**: what each definition would play - its looping sounds with their own world
 *    origins, volumes and pitches, and its random one-shots with the interval and the wave list
 *    they draw from, inherited definitions included.
 *
 * What is *not* read stays in `SOURCE_SOUNDSCAPE_LIMITATIONS` and nothing here acts on it: which
 * candidate is chosen when several contain the listener, and how a `soundlevel` becomes an audible
 * distance, are both unread - so this module reports the material and the gate and does not mix.
 */
import { SOURCE_SOUNDSCAPE_DATA, SOURCE_SOUNDSCAPE_SOURCES } from './source-soundscape-data.js';

/** A range the definition files write either as one number or as `low, high`. */
export type SourceRange = readonly [number, number];

export type SourceSoundscapeBlock = {
  /** `volume` as written, and the same parsed: one number means both ends are equal. */
  readonly volume: SourceRange;
  readonly pitch: SourceRange;
  /** Only random blocks state an interval; a loop has none. */
  readonly time: SourceRange | null;
  readonly soundlevel: string | null;
  /** The world position the block was authored at, when it states one. */
  readonly origin: readonly [number, number, number] | null;
  /** True when the block asks for a random position instead of an authored one. */
  readonly randomPosition: boolean;
  /** True when a range's low end is written above its high end; one block in this map does it. */
  readonly statedBackwards: boolean;
  readonly waves: readonly string[];
};

export type SourceSoundscapeDefinition = {
  /** The name as the map writes it, which differs in case from the file's own spelling. */
  readonly asWritten: string;
  readonly dsp: number;
  readonly dspName: string;
  /** This definition first, then whatever it plays soundscape-wise. */
  readonly chain: readonly string[];
  readonly loops: readonly SourceSoundscapeBlock[];
  readonly randoms: readonly SourceSoundscapeBlock[];
  /** False for the two that only exist to be inherited from: no entity names them itself. */
  readonly namedByMap: boolean;
};

export type SourceSoundscapeEntity = {
  readonly hammerId: number;
  readonly origin: readonly [number, number, number];
  readonly radius: number;
  /** The name the map writes, lower case in every one of the 57. */
  readonly name: string;
  readonly definition: string;
};

export type SourceSoundscapeAudit = {
  source: string;
  entities: number;
  definitions: number;
  /** Of those, the ones the map itself names: 18 of the 20 the definitions file holds. */
  namedByMap: number;
  blocks: number;
  waves: number;
  /** How many wave strings the definitions write; one file can be reached both ways. */
  waveReferences: number;
  soundscriptWaves: number;
  /** Definitions that name another soundscape, and the ones that do not. */
  inheriting: number;
  standalone: readonly string[];
  dspPresets: readonly number[];
  /** Blocks whose file writes a range's low end above its high end; the map has one. */
  backwardsRanges: number;
  metresPerSourceUnit: number;
  limitations: readonly string[];
};

export type SourceSoundscapes = {
  readonly entities: readonly SourceSoundscapeEntity[];
  readonly definitions: ReadonlyMap<string, SourceSoundscapeDefinition>;
  readonly waves: readonly string[];
  readonly metresPerSourceUnit: number;
  /**
   * The soundscapes whose sphere strictly contains a point, in the order the map states them.
   *
   * This is the whole of the engine's rule that was read. When more than one contains the point the
   * engine goes on to keep a per-listener list and choose from it, and that part is not read, so no
   * choice is made here either.
   */
  candidatesAt(point: readonly [number, number, number]): readonly SourceSoundscapeEntity[];
  audit(): SourceSoundscapeAudit;
};

export const SOURCE_SOUNDSCAPE_LIMITATIONS = [
  'Which soundscape plays when several contain the listener is not read. What is read is the gate - '
  + 'a soundscape is a candidate when the listener is strictly inside its sphere, radius squared '
  + 'against distance squared (0xa1a2fa) - and the two compares that guard the call handing a '
  + 'listener its block (0xa173d2, 0xa173dc, then 0xa16ca0). The first of those compares one of the '
  + 'walk\'s own stack slots, and **no instruction writes that slot**: the walk\'s whole 0xe9e bytes '
  + 'decode to 772 instructions covering it exactly, no store among them lands on it, it is never '
  + 'address-taken, no branch reaches the walk from outside it, and a scan of every one of the '
  + 'binary\'s 60282 functions finds no store there either. So what the guard tests is not '
  + 'established, and nothing here decides between two soundscapes that both reach the listener. The '
  + 'radii are not uniform (40 distinct values, 76 to 478 units), so the choice is not academic.',
  'How a `soundlevel` becomes an audible distance is not read. What is read is that a level is a '
  + 'decibel number: the build carries its own table of thirty of them in `.data.rel.ro` '
  + '(0x19ce6c0), twenty-four of which spell their own number out, and its only three readers turn a '
  + 'dB into a name or back. The manifest\'s comments state their own list and disagree with that '
  + 'table on exactly one level (`SNDLVL_TALKING`, 60 against 80), and the attenuation column those '
  + 'comments print is carried by no table in either binary - so it is documentation, and it is not '
  + 'used here. The arithmetic that turns a level into a radius is not read, so no falloff is '
  + 'applied to anything.',
  '`dsp` is read as a number and, from the manifest\'s own comments, as a preset name (Tunnel Small, '
  + 'Big 2, and so on). Nothing applies it: the engine\'s reverb is not read, so a soundscape\'s '
  + 'reverb is not reproduced.',
] as const;

function fail(what: string): never {
  throw new Error('Dust2 soundscape table differs: ' + what);
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(what + ' is not a string');
  return value as string;
}

function number(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(what + ' is not a finite number');
  return value as number;
}

function vector(value: unknown, what: string): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) fail(what + ' is not three numbers');
  return [number(value[0], what), number(value[1], what), number(value[2], what)] as const;
}

/**
 * A range as the definitions write it: one number, or two separated by a comma or a space. The two
 * ends are kept in the order the file states them - one block in this map writes `1,0.5`, and the
 * engine's random interpolates between the two ends rather than assuming an order, so the order is
 * data and is not sorted away. `statedBackwards` says when it is the unusual way round.
 */
function range(value: unknown, what: string): SourceRange {
  if (typeof value !== 'string') fail(what + ' is missing');
  const parts = (value as string).split(',').flatMap((part) => part.trim().split(/\s+/))
    .filter((part) => part.length > 0);
  if (parts.length === 0 || parts.length > 2) fail(`${what} is not one number or two: ${value}`);
  const values = parts.map((part) => {
    const parsed = Number(part);
    if (!Number.isFinite(parsed)) fail(`${what} is not a number: ${part}`);
    return parsed;
  });
  const [low, high] = values.length === 1 ? [values[0], values[0]] : values;
  return [low, high] as const;
}

function origin(value: unknown, what: string): readonly [number, number, number] {
  if (typeof value !== 'string') fail(what + ' is missing');
  const parts = (value as string).split(',').flatMap((part) => part.trim().split(/\s+/))
    .filter((part) => part.length > 0);
  if (parts.length !== 3) fail(`${what} is not three numbers: ${value}`);
  return [number(Number(parts[0]), what), number(Number(parts[1]), what),
    number(Number(parts[2]), what)] as const;
}

function block(value: unknown, what: string, random: boolean): SourceSoundscapeBlock {
  if (value === null || typeof value !== 'object') fail(what + ' is not a block');
  const row = value as Record<string, unknown>;
  const waves = row['waves'];
  if (!Array.isArray(waves) || waves.length === 0) fail(what + ' names no wave');
  const volume = range(row['volume'], what + ' volume');
  const pitch = range(row['pitch'] ?? '100', what + ' pitch');
  const time = random ? range(row['time'], what + ' time') : null;
  const backwards = [volume, pitch, time].some((item) => item !== null && item[0] > item[1]);
  return {
    volume,
    pitch,
    time,
    soundlevel: row['soundlevel'] === null || row['soundlevel'] === undefined
      ? null : text(row['soundlevel'], what + ' soundlevel'),
    origin: row['origin'] === null || row['origin'] === undefined
      ? null : origin(row['origin'], what + ' origin'),
    randomPosition: row['position'] === 'random',
    statedBackwards: backwards,
    waves: waves.map((wave) => text(wave, what + ' wave')),
  };
}

/**
 * Validate a staged table and return the soundscapes it states.
 *
 * Exported so a test can hand it a table that contradicts itself and watch it refuse, rather than
 * only exercising the one table that ships.
 */
export function createSourceSoundscapes(raw: unknown): SourceSoundscapes {
  if (raw === null || typeof raw !== 'object') fail('the table is not an object');
  const table = raw as Record<string, unknown>;
  if (table['format'] !== 'source-soundscape-data-v1') fail('the format is not the staged one');
  const metresPerSourceUnit = number(table['metresPerSourceUnit'], 'metresPerSourceUnit');
  if (metresPerSourceUnit <= 0) fail('metresPerSourceUnit is not positive');

  const dspPresets = table['dspPresets'] as Record<string, string>;
  if (dspPresets === null || typeof dspPresets !== 'object') fail('the preset table is missing');
  const soundLevels = table['soundLevels'] as Record<string, unknown>;
  if (soundLevels === null || typeof soundLevels !== 'object') fail('the sound level table is missing');

  const definitionRows = table['definitions'] as Record<string, Record<string, unknown>>;
  if (definitionRows === null || typeof definitionRows !== 'object') fail('no definitions');
  const waves = new Set<string>();
  const definitions = new Map<string, SourceSoundscapeDefinition>();
  for (const [name, row] of Object.entries(definitionRows)) {
    const chain = row['chain'];
    if (!Array.isArray(chain) || chain.length === 0) fail(name + ' has no chain');
    if (chain[0] !== name) fail(name + ' does not start its own chain');
    const dsp = number(row['dsp'], name + ' dsp');
    if (dspPresets[String(dsp)] === undefined) fail(`${name} names a preset that is not stated: ${dsp}`);
    const loops = (row['loops'] as unknown[]).map((item) => block(item, name + ' loop', false));
    const randoms = (row['randoms'] as unknown[]).map((item) => block(item, name + ' random', true));
    for (const item of [...loops, ...randoms]) {
      for (const wave of item.waves) waves.add(wave);
      if (item.soundlevel !== null && soundLevels[item.soundlevel] === undefined) {
        fail(`${name} asks for a sound level that is not stated: ${item.soundlevel}`);
      }
    }
    if (loops.length + randoms.length === 0) fail(name + ' would play nothing at all');
    definitions.set(name, {asWritten: text(row['asWritten'], name + ' asWritten'), dsp,
      dspName: text(dspPresets[String(dsp)], 'preset ' + dsp), chain: chain.map(String),
      loops, randoms, namedByMap: row['namedByMap'] === true});
  }
  for (const definition of definitions.values()) {
    for (const link of definition.chain.slice(1)) {
      if (!definitions.has(link)) fail(`${definition.chain[0]} inherits an undefined ${link}`);
    }
  }

  const waveRows = table['waves'];
  if (!Array.isArray(waveRows)) fail('the wave list is missing');
  const stated = new Set<string>();
  const statedPaths = new Set<string>();
  for (const row of waveRows as Record<string, unknown>[]) {
    const path = text(row['path'], 'wave path');
    if (!path.startsWith('sound/')) fail(path + ' is not under the sound folder');
    if (number(row['bytes'], path + ' bytes') <= 0) fail(path + ' states no size');
    stated.add(path.slice('sound/'.length));
    statedPaths.add(path);
  }
  // Every wave a block names is a file the pak was checked for, and no stated file is unclaimed. A
  // leading `~` says the engine resolves the name through a soundscript; the file behind it is the
  // same one, so the name is compared with the marker taken off and the separators normalised.
  const normalise = (wave: string) => wave.replace(/\\/g, '/').replace(/^~/, '');
  for (const wave of waves) {
    if (!stated.has(normalise(wave))) fail(wave + ' is not among the checked files');
  }
  if (stated.size === 0) fail('no wave files are stated');
  if (stated.size !== statedPaths.size) fail('a checked file is named twice');

  const entityRows = table['entities'];
  if (!Array.isArray(entityRows)) fail('the entity list is missing');
  const folded = new Map([...definitions.keys()].map((name) => [name.toLowerCase(), name]));
  const entities: SourceSoundscapeEntity[] = (entityRows as Record<string, unknown>[]).map((row) => {
    const name = text(row['name'], 'entity soundscape');
    const definition = folded.get(name.toLowerCase());
    if (definition === undefined) fail(name + ' names no definition in the table');
    const radius = number(row['radius'], name + ' radius');
    if (radius <= 0) fail(name + ' has no radius');
    return {hammerId: number(row['hammerId'], 'hammer id'), origin: vector(row['origin'], name),
      radius, name, definition};
  });
  const ids = new Set(entities.map((entity) => entity.hammerId));
  if (ids.size !== entities.length) fail('two soundscape entities share a hammer id');

  return {
    entities,
    definitions,
    waves: [...stated].map((path) => 'sound/' + path).sort(),
    metresPerSourceUnit,
    candidatesAt(point) {
      return entities.filter((entity) => {
        const dx = entity.origin[0] - point[0];
        const dy = entity.origin[1] - point[1];
        const dz = entity.origin[2] - point[2];
        const squared = dx * dx + dy * dy + dz * dz;
        return entity.radius * entity.radius > squared;
      });
    },
    audit() {
      const blocks = [...definitions.values()].reduce((total, row) =>
        total + row.loops.length + row.randoms.length, 0);
      const all = [...definitions.values()].flatMap((row) => [...row.loops, ...row.randoms]);
      const standalone = [...definitions.entries()].filter(([, row]) =>
        row.namedByMap && row.chain.length === 1).map(([name]) => name).sort();
      const namedByMap = [...definitions.values()].filter((row) => row.namedByMap).length;
      return {
        source: 'research/source-soundscapes.json',
        entities: entities.length,
        definitions: definitions.size,
        namedByMap,
        blocks,
        waves: stated.size,
        waveReferences: (waveRows as unknown[]).length,
        soundscriptWaves: (waveRows as Record<string, unknown>[])
          .filter((row) => row['soundscript'] === true).length,
        inheriting: namedByMap - standalone.length,
        standalone,
        dspPresets: [...new Set([...definitions.values()].map((row) => row.dsp))].sort((a, b) => a - b),
        backwardsRanges: all.filter((row) => row.statedBackwards).length,
        metresPerSourceUnit,
        limitations: SOURCE_SOUNDSCAPE_LIMITATIONS,
      };
    },
  };
}

/** What the staged table was generated from, so a run can cite the bytes it acted on. */
export const SOURCE_SOUNDSCAPE_SOURCE = SOURCE_SOUNDSCAPE_SOURCES;

export const SOURCE_SOUNDSCAPES = createSourceSoundscapes(SOURCE_SOUNDSCAPE_DATA);
