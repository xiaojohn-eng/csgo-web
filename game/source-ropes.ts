/** Dust2's own ropes, and what the shipped build states about them.
 *
 * The map hangs 142 ropes - chains of `keyframe_rope` segments with `move_rope` movers - and this
 * original base converter runs with `load_ropes=False`. The independent renderer
 * in source-ropes-render.ts now draws all 120 linked spans from this table. They are the map's own
 * geometry, not decoration, so the numbers are read out of the map twice and the class out of the
 * shipped build (`scripts/probe-source-ropes.py`, `research/source-ropes.json`) and staged here.
 *
 * What is read: every rope's own origin, width, slack, subdivision, texture scale, move speed and
 * class, the rope it names as the next in its chain, and the material all 142 of them name. The
 * client's own members for those keys are pinned too (`DT_RopeKeyframe`, sixteen of them, with the
 * offset each is stored at), along with the class's materials, its method names and its ten-pass
 * solver.
 *
 * What is NOT read, and therefore what a renderer may not assume: the rules. Which endpoint of a
 * chained rope is which, and what `Slack` is a percentage of, are read by the server's `KeyValue`
 * handlers, which have not been read; so are the client's integration constants (gravity and
 * damping) and the vertex widths `DrawModel` builds. This module therefore validates and exposes
 * the map's numbers only, and says so in `SOURCE_ROPE_LIMITATIONS`.
 */
import { SOURCE_ROPES_DATA, SOURCE_ROPES_SOURCES } from './source-ropes-data.js';

export type SourceRope = {
  readonly hammerId: string;
  readonly classname: 'keyframe_rope' | 'move_rope';
  readonly origin: readonly [number, number, number];
  readonly angles: readonly [number, number, number];
  readonly width: number;
  readonly slack: number;
  readonly subdiv: number;
  readonly type: number;
  readonly textureScale: number;
  readonly moveSpeed: number;
  readonly targetname: string | null;
  readonly nextKey: string | null;
  readonly positionInterpolator: string | null;
};

export type SourceRopesAudit = {
  source: string;
  ropes: number;
  segments: number;
  movers: number;
  chained: number;
  moversWithAPath: number;
  /** Ropes that name a next key, so they hang from their own origin to that rope's. */
  spans: number;
  /** Ropes nothing names as its next: each ends a chain. */
  ends: number;
  /** Chains followed from the movers, and how many distinct ropes they reach. */
  chains: number;
  chainsReach: number;
  material: string;
  metresPerSourceUnit: number;
  limitations: readonly string[];
};

export type SourceRopes = {
  readonly ropes: readonly SourceRope[];
  readonly material: string;
  readonly metresPerSourceUnit: number;
  /** Every rope whose next key names it, so a chain can be walked. */
  readonly byName: ReadonlyMap<string, SourceRope>;
  audit(): SourceRopesAudit;
};

/** Historical inventory boundaries. source-ropes-render.ts and the native
 * solver fixture supersede the initial geometry/physics unknowns below. */
export const SOURCE_ROPE_LIMITATIONS = [
  'A rope\'s simulated point count comes from the map\'s `Type` key rather than from its length: '
  + '`Type 0` sets it to 10 (all 142 ropes here write 0), `Type 1` to 4 and anything else to 2, and '
  + 'the client then uses it between 2 and 10 (0x863f4c). Its length is the three-component distance '
  + 'between the two resolved endpoints truncated to whole units - but the class has two reachable '
  + 'paths, one that adds `m_Slack` to that distance (0x9d2c00) and one that does not (0x9cfda0), and '
  + 'which of them a static map rope ends up with is unread. Whether `Slack` is a length or a '
  + 'percentage of one is unread too.',
  'The sag itself is not read. The ten constraint passes and the -1293.0 at 0x19358c0 are named '
  + 'without being attributed, and so are the two vectors (-10, -10, -10) and (10, 10, 10) handed to '
  + 'one call from 0x85d9db: which of these is the rope\'s gravity and which is damping is unread, so '
  + 'no rope shape is built from them.',
  'The vertex offsets `C_RopeKeyframe::DrawModel` builds around the centreline are not read, only '
  + 'how many there are: three vertices per point with m_Subdiv + 1 points per simulated segment.',
] as const;

const CLASSES = ['keyframe_rope', 'move_rope'];
const MATERIAL = 'cable/nuke_cable';

function fail(what: string): never {
  throw new Error('Dust2 rope table differs: ' + what);
}

function vector(value: unknown, what: string): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) fail(what + ' is not three numbers');
  return [number(value[0], what), number(value[1], what), number(value[2], what)] as const;
}

function number(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(what + ' is not a finite number');
  return value;
}

function text(value: unknown, what: string, mayBeAbsent = false): string | null {
  if (mayBeAbsent && (value === null || value === undefined)) return null;
  if (typeof value !== 'string') fail(what + ' is not a string');
  return value;
}

export function createSourceRopes(data: unknown): SourceRopes {
  const source = data as Record<string, unknown>;
  if (source['format'] !== 'source-ropes-data-v1') fail('the format is not source-ropes-data-v1');
  const material = text(source['material'], 'material');
  if (material !== MATERIAL) fail(`the material is ${material}, not the map's ${MATERIAL}`);
  const metresPerSourceUnit = number(source['metresPerSourceUnit'], 'metresPerSourceUnit');
  if (!(metresPerSourceUnit > 0)) fail('metresPerSourceUnit is not positive');
  const rows = source['ropes'];
  if (!Array.isArray(rows) || rows.length === 0) fail('the rope set is empty');

  const ropes: SourceRope[] = rows.map((row: Record<string, unknown>, index: number) => {
    const where = `rope ${index}`;
    const classname = text(row['classname'], where + ' classname');
    if (!CLASSES.includes(classname!)) fail(`${where} is a ${classname}`);
    const width = number(row['width'], where + ' width');
    if (!(width > 0)) fail(`${where} has no width`);
    const slack = number(row['slack'], where + ' slack');
    if (!(slack > 0)) fail(`${where} has a slack of ${slack}`);
    const subdiv = number(row['subdiv'], where + ' subdiv');
    if (!(Number.isInteger(subdiv) && subdiv >= 1)) fail(`${where} has a subdivision of ${subdiv}`);
    const textureScale = number(row['textureScale'], where + ' textureScale');
    if (!(textureScale > 0)) fail(`${where} has a texture scale of ${textureScale}`);
    const moveSpeed = number(row['moveSpeed'], where + ' moveSpeed');
    if (!(moveSpeed > 0)) fail(`${where} has a move speed of ${moveSpeed}`);
    const targetname = text(row['targetname'], where + ' targetname', true);
    if (classname === 'move_rope' && targetname !== null) fail(`${where} is a mover and is named`);
    if (classname === 'keyframe_rope' && targetname === null) fail(`${where} is a segment and unnamed`);
    return {
      hammerId: text(row['hammerId'], where + ' hammer id')!,
      classname: classname as SourceRope['classname'],
      origin: vector(row['origin'], where + ' origin'),
      angles: vector(row['angles'], where + ' angles'),
      width, slack, subdiv,
      type: number(row['type'], where + ' type'),
      textureScale, moveSpeed, targetname,
      nextKey: text(row['nextKey'], where + ' next key', true),
      positionInterpolator: text(row['positionInterpolator'], where + ' position interpolator', true),
    };
  });

  const ids = new Set(ropes.map((rope) => rope.hammerId));
  if (ids.size !== ropes.length) fail('two ropes share a hammer id');
  const byName = new Map<string, SourceRope>();
  for (const rope of ropes) if (rope.targetname) byName.set(rope.targetname, rope);
  // A chain only means something if every rope it names is one the map also states.
  for (const rope of ropes) {
    if (rope.nextKey !== null && !byName.has(rope.nextKey)) {
      fail(`the rope ${rope.hammerId} names a next key the map does not state: ${rope.nextKey}`);
    }
  }
  const segments = ropes.filter((rope) => rope.classname === 'keyframe_rope');
  const movers = ropes.filter((rope) => rope.classname === 'move_rope');
  const chained = ropes.filter((rope) => rope.nextKey !== null);
  const moversWithAPath = movers.filter((rope) => rope.positionInterpolator !== null);
  const spans = chained;
  const ends = ropes.filter((rope) => rope.nextKey === null);
  // A rope that names a next key hangs from its own origin to that rope's origin, so following the
  // movers walks the whole network. It has to reach every rope, or the table is missing a link.
  const reached = new Set<string>();
  let chains = 0;
  for (const mover of movers) {
    chains += 1;
    let current: SourceRope | undefined = mover;
    const seen = new Set<string>();
    while (current) {
      reached.add(current.hammerId);
      const next = current.nextKey;
      if (next === null || seen.has(next)) break;
      seen.add(next);
      current = byName.get(next);
    }
  }
  if (reached.size !== ropes.length) {
    fail(`the chains reach ${reached.size} of ${ropes.length} ropes, so a link is missing`);
  }
  // Every segment is named as some rope's next key, and fewer of them name a next key of their
  // own than there are movers, so the chains are not one straight run per mover.
  if (byName.size !== segments.length) fail('a segment is never named as a next key');
  if (ends.length >= movers.length) fail('the chain ends outnumber the movers that start them');

  const list: readonly SourceRope[] = Object.freeze(ropes);
  return {
    ropes: list,
    material,
    metresPerSourceUnit,
    byName,
    audit: () => ({source: 'source-ropes-v1', ropes: list.length, segments: segments.length,
      movers: movers.length, chained: chained.length, moversWithAPath: moversWithAPath.length,
      spans: spans.length, ends: ends.length, chains, chainsReach: reached.size,
      material, metresPerSourceUnit, limitations: SOURCE_ROPE_LIMITATIONS}),
  };
}

/** What the staged table was generated from, so a run can cite the bytes it acted on. */
export const SOURCE_ROPES_SOURCE = SOURCE_ROPES_SOURCES;

export const SOURCE_ROPES = createSourceRopes(SOURCE_ROPES_DATA);
