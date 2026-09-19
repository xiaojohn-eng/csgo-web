import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSourceSoundscapes,
  SOURCE_SOUNDSCAPE_LIMITATIONS,
  SOURCE_SOUNDSCAPES,
} from '../game/source-soundscapes';
import { SOURCE_SOUNDSCAPE_DATA, SOURCE_SOUNDSCAPE_SOURCES }
  from '../game/source-soundscape-data';

const reportPath = resolve(__dirname, '..', 'research/source-soundscapes.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
  format: string;
  sources: Record<string, string>;
  map: { entities: number; names: number; disabled: number; radii: Record<string, number>;
    soundscapeSet: { hammerId: number; origin: number[]; radius: number; name: string;
      startDisabled: number }[] };
  definitions: { file: string; blocks: number; duplicates: string[]; reading: string;
    used: Record<string, { asWritten: string; dsp: number; chain: string[]; ownLoops: number;
      ownRandoms: number; loops: {volume: string; pitch: string; soundlevel?: string;
        origin?: string; position?: string; waves: string[]}[];
      randoms: {time: string; volume: string; origin?: string; position?: string;
        waves: string[]}[] }>;
    bases: Record<string, { dsp: number; chain: string[]; ownLoops: number; ownRandoms: number;
      loops: {volume: string; waves: string[]}[];
      randoms: {time: string; volume: string; waves: string[]}[] }> };
  manifest: { file: string; key: string; files: string[]; notShipped: string[];
    commentedOut: string[]; dspPresets: Record<string, string>;
    soundLevels: Record<string, { db: number; attenuation: number | null }>;
    attentions: Record<string, number> };
  client: { tableAt: string; entries: number; loads: string;
    audioBlock: {props: string[]; reading: string};
    parsers: Record<string, number[]>; parsing: string };
  server: { tableAt: string; entries: number; updateAt: string;
    datamap: { field: string; offset: number; typeCode: number; key: string | null }[];
    candidateRule: string;
    audioIndex: {slot: string; offset: number; typeCode: number; neighbours: Record<string, number>};
    commit: {at: string; writes: string; warning: string; paths: string[]; callers: string[]};
    pick: {at: string; frame: {start: string; length: string; instructions: number; covers: string};
      reads: string; guardSlotsWritten: boolean; guardProof: string; open: string;
      listenerRecord: Record<string, string | number>; listenerReading: string};
    identity: {systemTable: string; systemSlots: number; gateSlot: number; driverSlot: number;
      triggerTable: string; triggerSlots: number; triggerTouchSlot: number;
      triggerSecondSlot: number; reading: string} };
  waves: { wave: string; path: string; soundscript: boolean; bytes: number; crc32: string }[];
  soundLevels: {tableAt: string; stride: number; entries: number;
    compiled: Record<string, number>;
    accessors: {nameToDB: string; dbToName: string[]; reading: string};
    reading: string;
    conflicts: Record<string, {manifestComment: number; build: number}>;
    missingFromBuild: string[];
    conflictReading: string};
  boundary: string;
};

const base = SOURCE_SOUNDSCAPE_DATA as unknown as Record<string, unknown>;
const definitions = base['definitions'] as Record<string, Record<string, unknown>>;
const entities = base['entities'] as Record<string, unknown>[];
const waves = base['waves'] as Record<string, unknown>[];
const withTable = (patch: Record<string, unknown>) => ({...base, ...patch});
const withDefinition = (name: string, patch: Record<string, unknown>) => withTable({
  definitions: {...definitions, [name]: {...definitions[name], ...patch}},
});
const withEntity = (index: number, patch: Record<string, unknown>) => withTable({
  entities: entities.map((row, at) => (at === index ? {...row, ...patch} : row)),
});

describe('Dust2\'s own soundscapes', () => {
  it('is generated from the probe report, so the table cannot drift from the map', () => {
    expect(report.format).toBe('source-soundscapes-v1');
    expect(SOURCE_SOUNDSCAPE_DATA).toMatchObject({format: 'source-soundscape-data-v1'});
    expect(SOURCE_SOUNDSCAPE_SOURCES.source).toBe('research/source-soundscapes.json');
    const digest = createHash('sha256').update(readFileSync(reportPath)).digest('hex');
    expect(SOURCE_SOUNDSCAPE_SOURCES.reportSha256).toBe(digest);
    expect(SOURCE_SOUNDSCAPE_SOURCES.sourceBspSha256).toBe(report.sources['sourceBspSha256']);
    expect(SOURCE_SOUNDSCAPE_SOURCES.client64Sha256).toBe(report.sources['client64Sha256']);
    expect(SOURCE_SOUNDSCAPE_SOURCES.server64Sha256).toBe(report.sources['server64Sha256']);
    expect(SOURCE_SOUNDSCAPE_SOURCES.definitionSha256).toBe(report.sources['definitionSha256']);
    expect(SOURCE_SOUNDSCAPE_SOURCES.manifestSha256).toBe(report.sources['manifestSha256']);
  });

  it('carries every soundscape the map states, field for field', () => {
    expect(report.map.entities).toBe(57);
    expect(SOURCE_SOUNDSCAPES.entities).toHaveLength(57);
    for (const [index, stated] of report.map.soundscapeSet.entries()) {
      const staged = SOURCE_SOUNDSCAPES.entities[index];
      expect(staged.hammerId).toBe(stated.hammerId);
      expect(staged.origin).toEqual(stated.origin);
      expect(staged.radius).toBe(stated.radius);
      expect(staged.name).toBe(stated.name);
      expect(stated.startDisabled).toBe(0);
    }
    // The radii are the map's own, and they are not uniform - so which sphere wins matters.
    expect(report.map.radii).toEqual({distinct: 40, min: 76, max: 478});
    expect(new Set(SOURCE_SOUNDSCAPES.entities.map((row) => row.radius)).size).toBe(40);
    expect(new Set(SOURCE_SOUNDSCAPES.entities.map((row) => row.name)).size).toBe(18);
    // Every name the map writes resolves, even though the file spells 15 of the 18 in mixed case
    // and the map writes all of them lower case.
    expect(SOURCE_SOUNDSCAPES.entities.every((row) => row.name === row.name.toLowerCase())).toBe(true);
    const mixed = [...SOURCE_SOUNDSCAPES.definitions.keys()].filter((name) => /[A-Z]/.test(name));
    expect(mixed).toHaveLength(15);
    expect([...SOURCE_SOUNDSCAPES.definitions.keys()].filter((name) => !/[A-Z]/.test(name)))
      .toEqual(['dust2_new.ctstart', 'dust2_new.lowertunnel', 'dust2_new.topmidtunnel',
        'dust2_new.indoors', 'dust2_new.outdoors']);
  });

  it('takes the definitions out of the shipped pak, inheritance and all', () => {
    // The file holds 20 blocks: the 18 the map names, plus the two that only exist to be inherited.
    expect(SOURCE_SOUNDSCAPES.definitions.size).toBe(20);
    expect(report.definitions.blocks).toBe(20);
    expect(report.definitions.duplicates).toEqual(['dust2_new.MidDoors']);
    expect(report.definitions.reading).toMatch(/first block is the/);
    expect(report.definitions.file).toBe('scripts/soundscapes_dust2_new.vsc');
    // Fifteen of the eighteen the map names build on one of two bases; three stand alone, and they
    // are the tunnels.
    const audit = SOURCE_SOUNDSCAPES.audit();
    expect(audit.namedByMap).toBe(18);
    expect(audit.inheriting).toBe(15);
    expect(audit.standalone).toEqual(['dust2_new.LongTunnel', 'dust2_new.lowertunnel',
      'dust2_new.topmidtunnel']);
    expect(SOURCE_SOUNDSCAPES.definitions.get('dust2_new.outdoors')!.namedByMap).toBe(false);
    expect(SOURCE_SOUNDSCAPES.definitions.get('dust2_new.indoors')!.namedByMap).toBe(false);
    expect(SOURCE_SOUNDSCAPES.definitions.get('dust2_new.ABomb')!.chain)
      .toEqual(['dust2_new.ABomb', 'dust2_new.outdoors']);
    expect(SOURCE_SOUNDSCAPES.definitions.get('dust2_new.ctstart')!.chain)
      .toEqual(['dust2_new.ctstart', 'dust2_new.indoors']);
    // An inheriting definition carries its own blocks plus its ancestor's.
    const abomb = SOURCE_SOUNDSCAPES.definitions.get('dust2_new.ABomb')!;
    const outdoors = report.definitions.bases['dust2_new.outdoors'];
    expect(outdoors.loops).toHaveLength(2);
    expect(outdoors.randoms).toHaveLength(2);
    expect(abomb.loops.length).toBe(1 + outdoors.loops.length);
    expect(abomb.randoms.length).toBe(2 + outdoors.randoms.length);
    // The preset numbers are read, and each is named by the manifest's own table. Six belongs to
    // one of the two bases rather than to a soundscape the map names itself.
    expect(audit.dspPresets).toEqual([0, 5, 6, 7, 9, 17, 18, 20, 21, 22]);
    expect(SOURCE_SOUNDSCAPES.definitions.get('dust2_new.indoors')!.dspName).toBe('Tunnel Medium');
    expect(SOURCE_SOUNDSCAPES.definitions.get('dust2_new.LongTunnel')!.dspName).toBe('Tunnel Small');
    expect(SOURCE_SOUNDSCAPES.definitions.get('dust2_new.ABomb')!.dspName).toBe('Big 3');
    expect(SOURCE_SOUNDSCAPES.definitions.get('dust2_new.BBomb')!.dspName).toBe('Normal (off)');
  });

  it('reads each block\'s own numbers, in the notation the file uses', () => {
    const longTunnel = SOURCE_SOUNDSCAPES.definitions.get('dust2_new.LongTunnel')!;
    // A loop with no origin is not positional, and one number means a range of one value.
    expect(longTunnel.loops[0].volume).toEqual([0.4, 0.4]);
    expect(longTunnel.loops[0].origin).toBeNull();
    expect(longTunnel.loops[0].randomPosition).toBe(false);
    expect(longTunnel.loops[0].waves).toEqual(['ambient/dust2/wind_alley_01.wav']);
    // A random block states the interval it draws from, and asks for a random position.
    expect(longTunnel.randoms[0].time).toEqual([13, 35]);
    expect(longTunnel.randoms[0].volume).toEqual([0.5, 1]);
    expect(longTunnel.randoms[0].randomPosition).toBe(true);
    expect(longTunnel.randoms[0].waves).toHaveLength(12);
    // The other tunnel writes its origin with spaces where the rest of the file uses commas.
    expect(longTunnel.loops[0].soundlevel).toBeNull();
    const tstart = SOURCE_SOUNDSCAPES.definitions.get('dust2_new.TStart')!;
    const withSpot = tstart.loops.find((loop) => loop.origin !== null)!;
    expect(withSpot.origin).toEqual([633.211609, -895.281189, 123.751556]);
    expect(withSpot.soundlevel).toBe('SNDLVL_75dB');
    expect(tstart.randoms.some((row) => row.waves.length === 5)).toBe(true);
    // The map's own random block is the one written with spaces between the numbers.
    const spaced = report.definitions.used['dust2_new.TStart'].randoms
      .find((row) => (row.origin ?? '').includes(' -'))!;
    expect(spaced.origin).toBeDefined();
    expect(SOURCE_SOUNDSCAPES.definitions.get('dust2_new.TStart')!.randoms
      .some((row) => row.origin !== null)).toBe(true);
  });

  it('states the gate the server uses, and nothing more than that', () => {
    expect(report.server.tableAt).toBe('0x19cea38');
    expect(report.server.updateAt).toBe('0xa19fe0');
    expect(report.server.candidateRule).toMatch(/radius \* radius > distanceSquared/);
    const fields = new Map(report.server.datamap.map((row) => [row.field, row]));
    expect(fields.get('m_flRadius')).toEqual({field: 'm_flRadius', offset: 0x4f8,
      typeCode: 0x00060001, key: 'radius'});
    expect(fields.get('m_bDisabled')).toEqual({field: 'm_bDisabled', offset: 0x554,
      typeCode: 0x00060001, key: 'StartDisabled'});
    expect(fields.get('m_soundscapeName')?.key).toBeNull();
    // The gate itself: strictly inside the sphere, compared squared.
    const [first] = SOURCE_SOUNDSCAPES.entities;
    const [x, y, z] = first.origin;
    expect(SOURCE_SOUNDSCAPES.candidatesAt([x, y, z])).toContain(first);
    const justInside = Math.sqrt(first.radius ** 2) - 0.5;
    expect(SOURCE_SOUNDSCAPES.candidatesAt([x + justInside, y, z])).toContain(first);
    expect(SOURCE_SOUNDSCAPES.candidatesAt([x + first.radius + 1, y, z])).not.toContain(first);
    // Exactly on the surface is not inside: the comparison is strict.
    expect(SOURCE_SOUNDSCAPES.candidatesAt([x + first.radius, y, z])).not.toContain(first);
    // Far above everything, nothing contains the listener.
    expect(SOURCE_SOUNDSCAPES.candidatesAt([0, 0, 100000])).toHaveLength(0);
    // And when several do contain it, all of them come back: the choice is not made here.
    const overlapping = SOURCE_SOUNDSCAPES.entities
      .filter((entity) => SOURCE_SOUNDSCAPES.candidatesAt(entity.origin).length > 1);
    expect(overlapping.length).toBeGreaterThan(0);
    expect(SOURCE_SOUNDSCAPES.candidatesAt(overlapping[0].origin).length).toBeGreaterThan(1);
  });

  it('names every wave the definitions reach, and where each came from', () => {
    // 66 wave strings, 55 distinct files: eleven are reached twice, once written plainly and once
    // through a soundscript.
    expect(SOURCE_SOUNDSCAPES.waves).toHaveLength(55);
    expect(SOURCE_SOUNDSCAPES.audit().waveReferences).toBe(66);
    expect(SOURCE_SOUNDSCAPES.waves.every((path) => path.startsWith('sound/ambient/'))).toBe(true);
    expect(report.waves).toHaveLength(66);
    expect(report.waves.filter((row) => row.soundscript)).toHaveLength(15);
    expect(SOURCE_SOUNDSCAPES.audit().soundscriptWaves).toBe(15);
    expect(SOURCE_SOUNDSCAPES.waves).toContain('sound/ambient/dust2/wind_alley_01.wav');
    expect(report.waves.every((row) => row.bytes > 0 && row.crc32.length === 8)).toBe(true);
    // The soundscript form and the plain form of one file are the same file.
    const doubled = report.waves.filter((row) => row.soundscript)
      .map((row) => row.path.slice(row.path.lastIndexOf('/') + 1))
      .filter((name) => report.waves.some((row) => !row.soundscript && row.path.endsWith(name)));
    expect(doubled.length).toBeGreaterThan(0);
  });

  it('says which definitions the client loads, and states the tables the manifest comments hold',
      () => {
        expect(report.client.tableAt).toBe('0x20c0f18');
        expect(report.client.entries).toBe(17);
        expect(report.client.loads).toMatch(/soundscapes_manifest\.txt/);
        expect(report.client.parsers['playlooping']).toEqual([0x86dcc0, 0x870250]);
        expect(report.client.parsers['rndwave']).toEqual([0x86dc00, 0x86fc20]);
        expect(report.client.parsing).toMatch(/soundscript/);
        expect(report.manifest.key).toBe('soundscaples_manifest');
        expect(report.manifest.files).toHaveLength(42);
        expect(report.manifest.files).toContain('scripts/soundscapes_dust2_new.vsc');
        // The list states two files the install does not ship, and one that is commented out.
        expect(report.manifest.notShipped).toEqual(['scripts/soundscapes_general.vsc',
          'scripts/soundscapes_tides.vsc']);
        expect(report.manifest.commentedOut).toEqual(['scripts/soundscapes_nuke.vsc']);
        expect(Object.keys(report.manifest.dspPresets)).toHaveLength(29);
        expect(report.manifest.dspPresets['0']).toBe('Normal (off)');
        expect(report.manifest.dspPresets['22']).toBe('Big 3');
        expect(Object.keys(report.manifest.soundLevels)).toHaveLength(21);
        expect(report.manifest.soundLevels['SNDLVL_75dB']).toEqual({db: 75, attenuation: 0.8});
        expect(report.manifest.soundLevels['SNDLVL_NORM']).toEqual({db: 75, attenuation: null});
        expect(report.manifest.attentions['ATTN_NORM']).toBe(0.8);
      });

  it('refuses a table that contradicts itself before anything is built from it', () => {
    expect(() => createSourceSoundscapes(null)).toThrow(/not an object/);
    expect(() => createSourceSoundscapes({...base, format: 'nope'})).toThrow(/format/);
    expect(() => createSourceSoundscapes({...base, metresPerSourceUnit: 0}))
      .toThrow(/metresPerSourceUnit/);
    expect(() => createSourceSoundscapes({...base, definitions: {}}))
      .toThrow(/names no definition/);
    // A definition whose chain does not start with itself, or names something undefined.
    expect(() => createSourceSoundscapes(withDefinition('dust2_new.Middle',
      {chain: ['dust2_new.outdoors']}))).toThrow(/start its own chain/);
    expect(() => createSourceSoundscapes(withDefinition('dust2_new.Middle',
      {chain: ['dust2_new.Middle', 'dust2_new.nowhere']}))).toThrow(/inherits an undefined/);
    // A preset number nothing states, and a sound level nothing states.
    expect(() => createSourceSoundscapes(withDefinition('dust2_new.Middle', {dsp: 99})))
      .toThrow(/preset that is not stated/);
    const withBadLevel = definitions['dust2_new.lowertunnel'];
    expect(() => createSourceSoundscapes(withDefinition('dust2_new.lowertunnel',
      {loops: (withBadLevel['loops'] as Record<string, unknown>[]).map((row, at) =>
        at === 0 ? {...row, soundlevel: 'SNDLVL_999dB'} : row)})))
      .toThrow(/sound level that is not stated/);
    // A block that names no wave, a range written the unusual way round, and an origin that is not
    // a point. The backwards range is data, not a fault: one block in this map states `1,0.5`, and
    // the module keeps the order it was written in and says so.
    expect(() => createSourceSoundscapes(withDefinition('dust2_new.LongTunnel',
      {loops: [{...withBadWaves(0), waves: []}]}))).toThrow(/names no wave/);
    expect(SOURCE_SOUNDSCAPES.audit().backwardsRanges).toBe(1);
    const backwards = [...SOURCE_SOUNDSCAPES.definitions.values()]
      .flatMap((row) => [...row.loops, ...row.randoms]).filter((row) => row.statedBackwards);
    expect(backwards).toHaveLength(1);
    expect(backwards[0].volume).toEqual([1, 0.5]);
    expect(() => createSourceSoundscapes(withDefinition('dust2_new.LongTunnel',
      {loops: [{...withBadWaves(0), origin: '1, 2'}]}))).toThrow(/not three numbers/);
    // A wave that is not among the files the pak was checked for.
    expect(() => createSourceSoundscapes(withDefinition('dust2_new.LongTunnel',
      {loops: [{...withBadWaves(0), waves: ['ambient/dust2/not_a_file.wav']}]})))
      .toThrow(/not among the checked files/);
    // An entity naming a definition the table does not state, an entity without a radius, and two
    // entities sharing a hammer id.
    expect(() => createSourceSoundscapes(withEntity(0, {name: 'dust2_new.nowhere'})))
      .toThrow(/names no definition/);
    expect(() => createSourceSoundscapes(withEntity(0, {radius: 0}))).toThrow(/no radius/);
    expect(() => createSourceSoundscapes(withEntity(1, {hammerId: entities[0]['hammerId']})))
      .toThrow(/share a hammer id/);
    expect(() => createSourceSoundscapes(withEntity(0, {origin: [1, 2]})))
      .toThrow(/three numbers/);
  });

  it('states how a chosen soundscape reaches a listener, and how far the choice is read', () => {
    // What the server sends: one audio block per player.
    expect(report.client.audioBlock.props).toEqual(['m_audio.localSound[7]',
      'm_audio.soundscapeIndex', 'm_audio.localBits', 'm_audio.entIndex', 'DT_Local']);
    expect(report.client.audioBlock.reading).toMatch(/eight world positions/);
    expect(report.server.audioIndex).toEqual({slot: '0x1c001d8', offset: 0x68,
      typeCode: 0x00020001, neighbours: {localSound: 0x8, localBits: 0x6c, entIndex: 0x70}});
    // What a commit writes, and the warning it can print.
    expect(report.server.commit.at).toBe('0xa16ca0');
    expect(report.server.commit.writes).toMatch(/soundscapeIndex.*0x508/);
    expect(report.server.commit.writes).toMatch(/m_positionNames\[0\.\.7\]/);
    expect(report.server.commit.warning).toMatch(/Setting invalid soundscape/);
    expect(report.server.commit.paths).toHaveLength(3);
    expect(report.server.commit.paths.join(' ')).toMatch(/trigger's touch handler/);
    expect(report.server.commit.callers).toEqual(['0xa173f4', '0xa17fe6', '0xa183a9']);
    // Where all of this lives, which is what says it is the soundscape system's and not merely near.
    expect(report.server.identity.systemTable).toBe('0x19cea38');
    expect(report.server.identity.systemSlots).toBe(18);
    expect(report.server.identity.gateSlot).toBe(5);
    expect(report.server.identity.driverSlot).toBe(15);
    expect(report.server.identity.triggerTable).toBe('0x1a96620');
    expect(report.server.identity.triggerSlots).toBe(216);
    expect(report.server.identity.triggerTouchSlot).toBe(105);
    expect(report.server.identity.triggerSecondSlot).toBe(103);
    // And how far the choice itself is read: the walk's own frame, the two compares that guard the
    // commit, and the finding that the slot the first compare reads is written by nothing.
    expect(report.server.pick.at).toBe('0xa16eb0');
    expect(report.server.pick.frame).toEqual({start: '0xa16eb0', length: '0xe9e',
      instructions: 772, covers: 'exactly'});
    expect(report.server.pick.reads).toMatch(/0x139fc14/);
    expect(report.server.pick.reads).toMatch(/0xa173d2/);
    expect(report.server.pick.reads).toMatch(/0xa173dc/);
    expect(report.server.pick.guardSlotsWritten).toBe(false);
    expect(report.server.pick.guardProof).toMatch(/60282 functions/);
    expect(report.server.pick.guardProof).toMatch(/empty answer/);
    // The reading it used to carry is named as withdrawn rather than quietly dropped.
    expect(report.server.pick.open).toMatch(/withdrawn/);
    expect(report.server.pick.open).toMatch(/nothing writes/);
    // The record the walk is handed, whose layout is readable off the caller that builds it.
    expect(report.server.pick.listenerRecord).toEqual({at: 'rbp - 0x60 in the caller', ent: 0,
      active: 8, floatAt: 0x10, float2At: 0x1c, counter: 0x20, activeFlag: 0x24});
    expect(report.server.pick.listenerReading).toMatch(/clears the flag/);
  });

  it('reads the build\'s own sound-level table and reports where the comments disagree with it', () => {
    // A sound level is a decibel number, and the build carries its own table of them.
    expect(report.soundLevels.tableAt).toBe('0x19ce6c0');
    expect(report.soundLevels.stride).toBe(0x10);
    expect(report.soundLevels.entries).toBe(30);
    expect(Object.keys(report.soundLevels.compiled)).toHaveLength(30);
    expect(report.soundLevels.compiled['SNDLVL_NONE']).toBe(0);
    expect(report.soundLevels.compiled['SNDLVL_70dB']).toBe(70);
    expect(report.soundLevels.compiled['SNDLVL_75dB']).toBe(75);
    expect(report.soundLevels.compiled['SNDLVL_NORM']).toBe(75);
    expect(report.soundLevels.compiled['SNDLVL_GUNFIRE']).toBe(140);
    expect(report.soundLevels.compiled['SNDLVL_180dB']).toBe(180);
    // Its only three readers, and the only thing they do with it.
    expect(report.soundLevels.accessors.nameToDB).toBe('0xa14c40');
    expect(report.soundLevels.accessors.dbToName).toEqual(['0xa14dd0', '0xa157f0']);
    expect(report.soundLevels.accessors.reading).toMatch(/falls back to 75/);
    // The comments are documentation: one level disagrees, and their attenuation column is in no
    // table in either binary - which is why nothing here applies one.
    expect(report.soundLevels.conflicts).toEqual({
      SNDLVL_TALKING: {manifestComment: 60, build: 80}});
    expect(report.soundLevels.missingFromBuild).toEqual([]);
    expect(report.soundLevels.conflictReading).toMatch(/no table in either binary carries one/);
  });

  it('says what it did not read rather than implying it did', () => {
    expect(report.boundary).toMatch(/the material, the gate and the two compares/);
    expect(report.boundary).toMatch(/not established/);
    expect(report.boundary).toMatch(/soundlevel/);
    expect(report.boundary).toMatch(/dsp/);
    expect(report.boundary).toMatch(/nothing is played from this report/i);
    const limitations = SOURCE_SOUNDSCAPES.audit().limitations;
    expect(limitations).toBe(SOURCE_SOUNDSCAPE_LIMITATIONS);
    expect(limitations).toHaveLength(3);
    const text = limitations.join(' ');
    expect(text).toMatch(/no instruction writes that slot/);
    expect(text).toMatch(/60282 functions/);
    expect(text).toMatch(/0xa1a2fa/);
    expect(text).toMatch(/40 distinct values/);
    expect(text).toMatch(/attenuation column those/);
    expect(text).toMatch(/turns a level into a radius is not read/);
    expect(text).toMatch(/reverb is not reproduced/);
  });
});

function withBadWaves(index: number): Record<string, unknown> {
  const loops = definitions['dust2_new.LongTunnel']['loops'] as Record<string, unknown>[];
  return loops[index];
}
