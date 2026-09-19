import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSourceRopes,
  SOURCE_ROPES,
  SOURCE_ROPE_LIMITATIONS,
} from '../game/source-ropes';
import { SOURCE_ROPES_DATA, SOURCE_ROPES_SOURCES } from '../game/source-ropes-data';

const reportPath = resolve(__dirname, '..', 'research/source-ropes.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
  format: string;
  sources: Record<string, string>;
  map: { ropes: number; classes: Record<string, number>; materials: Record<string, string>;
    chained: number; movers: number; widths: Record<string, number>; slacks: Record<string, number>;
    ropeSet: Record<string, unknown>[] };
  class: { members: {name: string; offset: number; type: number}[]; tableAt: string;
    serverMembers: {name: string; offset: number; type: number}[];
    serverRegistrationOrder: string[]; serverMeaning: string;
    datamap: { at: string; entryBytes: number; root: string; fields: number; builtBy: string;
      linkage: string;
      rows: {field: string; offset: number; typeCode: number; key: string | null}[];
      keyed: Record<string, string>; derived: string[]; meaning: string } };
  structure: { spans: number; ends: number; chains: number; ropesReached: number; hopsWalked: number;
    chainRopes: number; sharedLinks: number; sharedLinksExtra: number; longestChain: number;
    hopMetres: Record<string, number>; reading: string };
  drawing: { methods: string[]; solver: string; materials: string[];
    materialFlags: string[]; serverKeys: string[]; serverMaterials: string[];
    materialRule: string;
    mesh: { at: string; vertices: string; indices: string; textureAlong: string;
      segments: string; meaning: string };
    nSegmentsProxy: { function: string; slot: string; slotStrings: string[]; whatItIs: string;
      whatItIsNot: string; expression: string;
      neighbours: {at: string; slot: string; slotStrings: string[]};
      region: string; meaning: string };
    physics: { gravityAt: string; gravity: number; setup: string; meaning: string };
    clientInit: {at: string; segments: string; simulation: string; material: string; meaning: string};
    derivation: {
      frameBounds: string;
      classTable: {at: string; entries: number; anchor: string};
      typeKey: {handledAt: string; keys: string[]; segments: Record<string, number>;
        at0: string; map: string};
      spawnValidation: {at: string; segments: number[]; textureScale: number[]; says: string};
      length: {at: string; calledFrom: string; rule: string;
        withSlack: {at: string; rule: string}; open: string};
      runtimeCreate: {at: string; calledBy: {at: string; class: string}; length: string;
        className: string; material: string};
      deadCode: {at: string; why: string};
    };
    convars: Record<string, {default: string | null; help: string | null}> };
  reading: string;
  boundary: string;
};

const base = SOURCE_ROPES_DATA as unknown as Record<string, unknown>;
const rows = base['ropes'] as Record<string, unknown>[];
const withRope = (index: number, patch: Record<string, unknown>) => ({
  ...base, ropes: rows.map((row, at) => (at === index ? {...row, ...patch} : row)),
});
const withRopeNumber = (index: number) => rows[index]['hammerId'];

describe('Dust2\'s own ropes', () => {
  it('is generated from the probe report, so the table cannot drift from the map', () => {
    expect(report.format).toBe('source-ropes-v1');
    expect(SOURCE_ROPES_DATA).toMatchObject({format: 'source-ropes-data-v1'});
    expect(SOURCE_ROPES_SOURCES.source).toBe('research/source-ropes.json');
    const digest = createHash('sha256').update(readFileSync(reportPath)).digest('hex');
    expect(SOURCE_ROPES_SOURCES.reportSha256).toBe(digest);
    expect(SOURCE_ROPES_SOURCES.sourceBspSha256).toBe(report.sources['sourceBspSha256']);
    expect(SOURCE_ROPES_SOURCES.client64Sha256).toBe(report.sources['client64Sha256']);
  });

  it('carries every rope the map states, field for field', () => {
    expect(report.map.ropes).toBe(142);
    expect(rows).toHaveLength(report.map.ropes);
    // The map's own histograms, which the probe read off the BSP itself.
    expect(Object.keys(report.map.widths)).toContain(String(rows[0]['width']));
    expect(report.map.slacks[String(rows[0]['slack'])]).toBeGreaterThan(0);
    for (const [index, stated] of report.map.ropeSet.entries()) {
      const staged = rows[index];
      expect(staged['hammerId']).toBe(stated['hammerId']);
      expect(staged['classname']).toBe(stated['classname']);
      expect(staged['origin']).toEqual(stated['origin']);
      expect(staged['angles']).toEqual(stated['angles']);
      expect(staged['width']).toBe(stated['width']);
      expect(staged['slack']).toBe(stated['slack']);
      expect(staged['subdiv']).toBe(stated['subdiv']);
      expect(staged['textureScale']).toBe(stated['textureScale']);
      expect(staged['moveSpeed']).toBe(stated['moveSpeed']);
      expect(staged['targetname'] ?? null).toBe(stated['targetname'] ?? null);
      expect(staged['nextKey'] ?? null).toBe(stated['nextKey'] ?? null);
      expect(staged['positionInterpolator'] ?? null).toBe(stated['positionInterpolator'] ?? null);
    }
  });

  it('states the chains the map builds rather than one run per mover', () => {
    const audit = SOURCE_ROPES.audit();
    expect(audit.ropes).toBe(142);
    expect(audit.segments).toBe(109);
    expect(audit.movers).toBe(33);
    expect(audit.chained).toBe(120);
    expect(audit.moversWithAPath).toBe(33);
    expect(audit.material).toBe('cable/nuke_cable');
    expect(audit.metresPerSourceUnit).toBe(0.0254);
    // Each segment is named as some rope's next key, and fewer segments name a next key of their
    // own than there are movers - so the chains share segments rather than running straight.
    expect(SOURCE_ROPES.byName.size).toBe(109);
    expect(SOURCE_ROPES.ropes.filter((rope) => rope.nextKey === null)).toHaveLength(22);
    for (const rope of SOURCE_ROPES.ropes) {
      if (rope.nextKey !== null) expect(SOURCE_ROPES.byName.has(rope.nextKey)).toBe(true);
    }
    expect(report.map.chained).toBe(audit.chained);
    expect(report.map.classes).toEqual({keyframe_rope: 109, move_rope: 33});
    expect(report.map.materials).toEqual({'cable/nuke_cable': 142});
  });

  it('follows the links to the whole network, and says how far a hop is', () => {
    const structure = report.structure;
    expect(structure.spans).toBe(120);
    expect(structure.ends).toBe(22);
    expect(structure.chains).toBe(33);
    expect(structure.ropesReached).toBe(142);
    expect(structure.sharedLinks).toBe(8);
    expect(structure.sharedLinksExtra).toBe(11);
    expect(structure.longestChain).toBe(9);
    // The chains overlap: between them they walk more ropes than the map has.
    expect(structure.chainRopes).toBe(181);
    expect(structure.hopsWalked).toBe(148);
    expect(structure.chainRopes).toBeGreaterThan(structure.ropesReached);
    expect(structure.hopMetres['min']).toBeGreaterThan(0);
    expect(structure.hopMetres['max']).toBeGreaterThan(structure.hopMetres['median']);
    // The loader walks the same network at load, so the runtime audit states it too.
    const audit = SOURCE_ROPES.audit();
    expect(audit.spans).toBe(structure.spans);
    expect(audit.ends).toBe(structure.ends);
    expect(audit.chains).toBe(structure.chains);
    expect(audit.chainsReach).toBe(structure.ropesReached);
    expect(structure.reading).toMatch(/hangs from its own origin/);
  });

  it('takes the class and its constants from the shipped build, not from its names', () => {
    expect(report.class.members).toHaveLength(16);
    const byName = new Map(report.class.members.map((row) => [row.name, row]));
    expect(byName.get('m_Width')).toEqual({name: 'm_Width', offset: 0x12c0, type: 4});
    expect(byName.get('m_Slack')).toEqual({name: 'm_Slack', offset: 0x12b0, type: 4});
    expect(byName.get('m_RopeLength')).toEqual({name: 'm_RopeLength', offset: 0x12ac, type: 4});
    expect(byName.get('m_Subdiv')).toEqual({name: 'm_Subdiv', offset: 0x12a8, type: 4});
    expect(byName.get('m_nSegments')).toEqual({name: 'm_nSegments', offset: 0x1298, type: 4});
    expect(byName.get('m_bConstrainBetweenEndpoints')).
      toEqual({name: 'm_bConstrainBetweenEndpoints', offset: 0x1350, type: 1});
    // The defaults are read from each convar's own registration, so they are the build's numbers.
    expect(report.drawing.convars['rope_subdiv'].default).toBe('2');
    expect(report.drawing.convars['rope_smooth_enlarge']).toEqual({
      default: '1.4', help: 'How much to enlarge ropes in screen space for antialiasing effect'});
    expect(report.drawing.convars['rope_smooth_minwidth'].default).toBe('0.3');
    expect(report.drawing.convars['rope_smooth_maxalphawidth'].default).toBe('1.75');
    expect(report.drawing.convars['rope_wind_dist'].default).toBe('1000');
    expect(report.drawing.solver).toMatch(/ten constraint passes/);
    expect(report.drawing.materials).toEqual(['cable/cable', 'cable/rope_shadowdepth',
      'missing_rope_material']);
    expect(report.drawing.methods).toContain('C_RopeKeyframe::DrawModel');
    // The material rule is read off the server, not inferred: what the map writes is what is used.
    expect(report.drawing.serverKeys).toContain('RopeMaterial');
    expect(report.drawing.serverMaterials).toEqual(['cable/cable.vmt', 'cable/rope.vmt',
      'cable/chain.vmt']);
    expect(report.drawing.materialRule).toMatch(/cable\/nuke_cable\.vmt/);
    expect(report.drawing.materialRule).toMatch(/RopeShader/);
    // The tube the renderer builds, and the numbers the physics is set up with, are read where
    // they sit - and both are recorded as unread-in-role rather than acted on.
    expect(report.drawing.mesh.at).toBe('0x860fb5');
    expect(report.drawing.mesh.vertices).toMatch(/3 \* \(m_Subdiv \+ 1\)/);
    expect(report.drawing.mesh.indices).toMatch(/6 \* \(m_Subdiv \+ 1\)/);
    expect(report.drawing.mesh.textureAlong).toBe('(m_Slack + m_RopeLength - 100) / m_TextureScale');
    expect(report.drawing.mesh.segments).toMatch(/2\.\.10/);
    expect(report.drawing.mesh.meaning).toMatch(/0xfc8/);
    // The function once taken for the segment count's proxy is an entity input handler, and the
    // rope's own registration proves it is not that prop's proxy.
    expect(report.drawing.nSegmentsProxy.function).toBe('0x72a820');
    expect(report.drawing.nSegmentsProxy.slot).toBe('0x1bab8c0');
    expect(report.drawing.nSegmentsProxy.slotStrings).toEqual(['InputFadeIn', 'FadeIn']);
    expect(report.drawing.nSegmentsProxy.whatItIs).toMatch(/entity input/);
    expect(report.drawing.nSegmentsProxy.whatItIsNot).toMatch(/pushes a null proxy/);
    expect(report.drawing.nSegmentsProxy.expression).toMatch(/25600 \/ \(5 \* n\)/);
    // The handler beside it is the same class's FadeOut, so the region is that class's.
    expect(report.drawing.nSegmentsProxy.neighbours.slotStrings).toEqual(['InputFadeOut', 'FadeOut']);
    expect(report.drawing.nSegmentsProxy.neighbours.slot).toBe('0x1bab928');
    expect(report.drawing.nSegmentsProxy.region).toMatch(/not evidence about the\s+rope/);
    expect(report.drawing.nSegmentsProxy.meaning).toMatch(/remains unread/);
    // The server's copy of the class is laid out differently, so the port acts on the map's keys.
    const server = new Map(report.class.serverMembers.map((row) => [row.name, row]));
    expect(server.get('m_Slack')).toEqual({name: 'm_Slack', offset: 0x4f0, type: 4});
    expect(server.get('m_nSegments')).toEqual({name: 'm_nSegments', offset: 0x4fc, type: 4});
    expect(server.get('m_Width')).toEqual({name: 'm_Width', offset: 0x4f4, type: 4});
    expect(server.get('m_bConstrainBetweenEndpoints'))
      .toEqual({name: 'm_bConstrainBetweenEndpoints', offset: 0x500, type: 1});
    expect(report.class.serverMembers).toHaveLength(12);
    expect(report.class.serverRegistrationOrder[0]).toBe('m_Slack');
    expect(report.class.serverMeaning).toMatch(/differently/);
    // The datamap: what the map's keys land on, and what a rope derives for itself instead.
    expect(report.class.datamap.entryBytes).toBe(0x68);
    // It is this class's table, proven through the registration rather than matched by offsets.
    expect(report.class.datamap.root).toBe('0x1c0dc28');
    expect(report.class.datamap.fields).toBe(0x17);
    expect(report.class.datamap.builtBy).toBe('0x9cc430');
    expect(report.class.datamap.linkage).toMatch(/CRopeKeyframe/);
    expect(report.class.datamap.rows).toHaveLength(18);
    expect(report.class.datamap.keyed).toEqual({Slack: 'm_Slack', Width: 'm_Width',
      TextureScale: 'm_TextureScale', Subdiv: 'm_Subdiv', ScrollSpeed: 'm_flScrollSpeed'});
    // The map writes `MoveSpeed`, which is not the key that reaches the scroll speed.
    expect(report.class.datamap.keyed['MoveSpeed']).toBeUndefined();
    expect(report.class.datamap.derived).toContain('m_nSegments');
    expect(report.class.datamap.derived).toContain('m_RopeLength');
    expect(report.class.datamap.derived).toContain('m_hStartPoint');
    expect(report.class.datamap.derived).not.toContain('m_Slack');
    const field = (name: string) => report.class.datamap.rows.find((row) => row.field === name);
    expect(field('m_Slack')).toEqual({field: 'm_Slack', offset: 0x4f0, typeCode: 0x00060001,
      key: 'Slack'});
    expect(field('m_Width')?.offset).toBe(0x4f4);
    expect(field('m_Subdiv')?.offset).toBe(0x514);
    expect(field('m_nSegments')).toEqual({field: 'm_nSegments', offset: 0x4fc, typeCode: 0x00020001,
      key: null});
    expect(report.class.datamap.meaning).toMatch(/derived rather than set/);
    expect(report.drawing.physics.gravityAt).toBe('0x19358c0');
    expect(report.drawing.physics.gravity).toBe(-1293);
    // The physics is set up with two whole vectors, not two scalars of ten.
    expect(report.drawing.physics.setup).toMatch(/two whole vectors/);
    expect(report.drawing.physics.setup).toMatch(/-10, -10, -10/);
    expect(report.drawing.physics.setup).toMatch(/10, 10, 10/);
    expect(report.drawing.physics.setup).toMatch(/three floats each/);
    expect(report.drawing.physics.setup).toMatch(/0x8d0980/);
    expect(report.drawing.physics.setup).toMatch(/\[vtable \+ 0x528\]/);
    expect(report.drawing.physics.setup).toMatch(/corrects it/);
    expect(report.drawing.physics.meaning).toMatch(/has not been read/);
    expect(report.drawing.physics.meaning).toMatch(/no rope shape may be built/);
    // What the client does with a rope where it initialises: clamps, simulates, resolves material.
    expect(report.drawing.clientInit.at).toBe('0x85d930');
    expect(report.drawing.clientInit.segments).toMatch(/2\.\.10/);
    expect(report.drawing.clientInit.segments).toMatch(/m_nSegments \(0x1298\)/);
    expect(report.drawing.clientInit.segments).toMatch(/0x85d98b-0x85d9a5/);
    expect(report.drawing.clientInit.segments).toMatch(/writing it back/);
    expect(report.drawing.clientInit.simulation).toMatch(/this \+ 0xfb0/);
    expect(report.drawing.clientInit.simulation).toMatch(/0xaa9340/);
    expect(report.drawing.clientInit.simulation).toMatch(/0x8d0980/);
    expect(report.drawing.clientInit.material).toMatch(/Other textures/);
    expect(report.drawing.clientInit.material).toMatch(/this \+ 0x12d8/);
    expect(report.drawing.clientInit.material).toMatch(/0x12e0/);
    expect(report.drawing.clientInit.material).toMatch(/cable\/rope_shadowdepth/);
    expect(report.drawing.clientInit.material).toMatch(/\*model\*/);
    expect(report.drawing.clientInit.material).toMatch(/0x85d958/);
    // It explicitly refuses to stand in for the derivation the port still lacks.
    expect(report.drawing.clientInit.meaning).toMatch(/handed the length and the count over the network/);
    expect(report.drawing.clientInit.meaning).toMatch(/does not give the derivation/);
    // What the two numbers a rope is made of are derived from, and how it was proved to be this
    // class's code rather than a neighbour's.
    const derivation = report.drawing.derivation;
    expect(derivation.frameBounds).toMatch(/frame information/);
    // A virtual table's slot -1 points at the class's type information, whose name is a string.
    expect(derivation.classTable.at).toBe('0x1a8d3e8');
    expect(derivation.classTable.entries).toBe(203);
    expect(derivation.classTable.anchor).toMatch(/membership in it/);
    expect(derivation.classTable.anchor).toMatch(/keeps members at the\s+same numbers/);
    // The map's `Type` key sets the simulated point count, which is why no key reaches it directly.
    expect(derivation.typeKey.handledAt).toBe('0x9d16d0');
    expect(derivation.typeKey.keys).toEqual(['Breakable', 'Collide', 'Barbed', 'UseWind',
      'Dangling', 'Type', 'RopeShader', 'RopeMaterial']);
    expect(derivation.typeKey.segments).toEqual({'0': 10, '1': 4, other: 2});
    expect(derivation.typeKey.at0).toMatch(/derived from a key/);
    expect(derivation.typeKey.map).toMatch(/Type 0/);
    // Every rope the map states writes `Type 0`, so the count the client uses is ten.
    expect(rows.every((row) => row['type'] === 0)).toBe(true);
    expect(derivation.spawnValidation.at).toBe('0x9d2520');
    expect(derivation.spawnValidation.segments).toEqual([2, 10]);
    expect(derivation.spawnValidation.textureScale).toEqual([0.1, 10]);
    expect(derivation.spawnValidation.says).toBe(
      'move_rope has TextureScale less than 0.1 at (%2.2f, %2.2f, %2.2f)');
    // The length, and the slack the two reachable paths disagree about.
    expect(derivation.length.at).toBe('0x9cfda0');
    expect(derivation.length.calledFrom).toBe('0x9d2520');
    expect(derivation.length.rule).toMatch(/trunc\(/);
    expect(derivation.length.rule).toMatch(/three-component distance/);
    expect(derivation.length.withSlack.at).toBe('0x9d2c00');
    expect(derivation.length.withSlack.rule).toMatch(/m_Slack/);
    expect(derivation.length.open).toMatch(/not resolved here/);
    // The runtime creation path, which is CRopeAnchor's and takes its length from a height.
    expect(derivation.runtimeCreate.at).toBe('0x9cf500');
    expect(derivation.runtimeCreate.calledBy).toEqual({at: '0x6ab080', class: 'CRopeAnchor'});
    expect(derivation.runtimeCreate.length).toMatch(/vertical distance/);
    expect(derivation.runtimeCreate.length).toMatch(/384/);
    expect(derivation.runtimeCreate.className).toBe('keyframe_rope');
    expect(derivation.runtimeCreate.material).toBe('cable/cable.vmt');
    // And the shape that looks right but nothing reaches, recorded as such.
    expect(derivation.deadCode.at).toBe('0x9ce1a0');
    expect(derivation.deadCode.why).toMatch(/reached by nothing/);
    expect(derivation.deadCode.why).toMatch(/not the rule the game follows/);
  });

  it('refuses a table that contradicts itself before anything is built from it', () => {
    expect(() => createSourceRopes(null)).toThrow(/format/);
    expect(() => createSourceRopes({...base, format: 'nope'})).toThrow(/format/);
    expect(() => createSourceRopes({...base, material: 'cable/cable'}))
      .toThrow(/not the map's cable\/nuke_cable/);
    expect(() => createSourceRopes({...base, metresPerSourceUnit: 0}))
      .toThrow(/metresPerSourceUnit/);
    expect(() => createSourceRopes({...base, ropes: []})).toThrow(/empty/);
    expect(() => createSourceRopes(withRope(0, {width: 0}))).toThrow(/no width/);
    expect(() => createSourceRopes(withRope(0, {slack: 0}))).toThrow(/slack/);
    expect(() => createSourceRopes(withRope(0, {subdiv: 0}))).toThrow(/subdivision/);
    expect(() => createSourceRopes(withRope(0, {textureScale: 0}))).toThrow(/texture scale/);
    expect(() => createSourceRopes(withRope(0, {moveSpeed: 0}))).toThrow(/move speed/);
    expect(() => createSourceRopes(withRope(0, {origin: [1, 2]}))).toThrow(/three numbers/);
    expect(() => createSourceRopes(withRope(0, {origin: [1, 2, 'three']})))
      .toThrow(/finite number/);
    expect(() => createSourceRopes(withRope(0, {classname: 'rope'}))).toThrow(/is a rope/);
    // A mover starts a chain rather than joining one, and a segment says what it is called.
    const mover = rows.findIndex((row) => row['classname'] === 'move_rope');
    const segment = rows.findIndex((row) => row['classname'] === 'keyframe_rope');
    expect(() => createSourceRopes(withRope(mover, {targetname: 'x'}))).toThrow(/is a mover and is named/);
    expect(() => createSourceRopes(withRope(segment, {targetname: null})))
      .toThrow(/is a segment and unnamed/);
    // Two ropes cannot share an identity, and a chain cannot name a rope the map does not state.
    const other = rows.findIndex((row) => row['hammerId'] !== withRopeNumber(0));
    expect(() => createSourceRopes(withRope(other, {hammerId: withRopeNumber(0)})))
      .toThrow(/share a hammer id/);
    expect(() => createSourceRopes(withRope(mover, {nextKey: 'not a rope'})))
      .toThrow(/does not state/);
    // A table whose links do not reach every rope is refused: with no links at all the movers
    // reach only themselves.
    const unlinked = {...base, ropes: rows.map((row) => ({...row, nextKey: null}))};
    expect(() => createSourceRopes(unlinked)).toThrow(/reach 33 of 142|link is missing/);
  });

  it('says what it did not read rather than implying it did', () => {
    expect(report.boundary).toMatch(/the sag they are hung on is not/);
    expect(report.boundary).toMatch(/Slack/);
    expect(report.boundary).toMatch(/named without\s+being attributed/);
    expect(report.boundary).toMatch(/No renderer may assume a rope shape yet/);
    const limitations = SOURCE_ROPES.audit().limitations;
    expect(limitations).toBe(SOURCE_ROPE_LIMITATIONS);
    expect(limitations).toHaveLength(3);
    const text = limitations.join(' ');
    expect(text).toMatch(/Type/);
    expect(text).toMatch(/0x9d2c00/);
    expect(text).toMatch(/0x9cfda0/);
    expect(text).toMatch(/damping/);
    expect(text).toMatch(/vertex offsets/);
    expect(text).toMatch(/0x863f4c/);
    expect(report.reading).toMatch(/142 ropes/);
  });
});
