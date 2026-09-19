import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  SOURCE_IMPACT_BUILD, loadSourceImpactTable, sourceImpactDecalPick,
  sourceImpactDecalSize, sourceImpactDraws, sourceImpactSurfaceFor, sourceImpactSurfaceKey,
  type SourceImpactTable,
} from '../game/source-impact-table';
import { SOURCE_IMPACT_TABLE } from '../game/source-impact-table-data';

const digest = (bytes: Uint8Array) => Array.from(sha256(bytes), value => value.toString(16).padStart(2, '0')).join('');
const read = (relative: string) => readFileSync(resolve(relative));
const research = JSON.parse(read('research/source-surface-props.json').toString()) as {
  format: string; build: number; coverage: Record<string, unknown>; impact: Record<string, OriginalImpactRow>;
  decalMaterials: Record<string, OriginalDecalMaterial>; decalAtlases: Record<string, { width: number; height: number }>;
  decalGroups: Record<string, Record<string, string>>; gameMaterialToDecalGroup: Record<string, string>;
  surfaceGroups: Record<string, Record<string, unknown>>; sounds: Record<string, OriginalSound>;
  sourceFiles: Record<string, { bytes: number; sha256: string }>;
  unresolvedBrushAudit: { byReason: Record<string, number>; byMaterials: Record<string, number> };
  unresolvedPropAudit: [string, string][];
  surfaceSourceCounts: { brushes: number; displacementChunks: number; props: number };
};
type OriginalImpactRow = {
  surfaceProp: string; baseChain: string[]; gameMaterial: string | null; decalGroup: string | null;
  decals: { material: string; weight: number }[]; bulletImpact: string | null;
};
type OriginalDecalMaterial = {
  shader: string; atlas: string | null; pos?: number[]; size?: number[]; decalScale?: number;
  decalScaleVariation?: number; modelMaterial?: string; modelScale?: number | null;
  modelExtent?: number[] | null; subrectUnits?: number[]; modelUnits?: number[] | null;
  resolved?: boolean;
};
type OriginalSound = { event: string; script: string; volume: number[]; pitch: number[]; waves: { source: string; bytes: number; sha256: string }[] };
type StagedTable = SourceImpactTable & { atlases: Record<string, { url: string; bytes: number; sha256: string; width: number; height: number }> };
type StagedSound = { key: string; event: string; url: string; sha256: string; bytes: number; pitch: number[]; volume: number[]; source: string };

const level = JSON.parse(read('public/source/csgo-12426148/dust2/level.json').toString()) as { sourceBspSha256: string; metersPerSourceUnit: number };
const expected = { build: SOURCE_IMPACT_BUILD, sourceBspSha256: level.sourceBspSha256 };
const table = loadSourceImpactTable(SOURCE_IMPACT_TABLE, expected) as StagedTable;
const staged = JSON.parse(read('game/source-impact-table.json').toString()) as StagedTable;
const sounds = JSON.parse(read('game/source-impact-audio.json').toString()) as StagedSound[];

describe('original bullet impact surface table', () => {
  it('is cut from this build and this map, and refuses any other', () => {
    expect(research.format).toBe('source-surface-props-v1');
    expect(research.build).toBe(SOURCE_IMPACT_BUILD);
    expect((SOURCE_IMPACT_TABLE as { sourceBspSha256: string }).sourceBspSha256).toBe(level.sourceBspSha256);
    expect(() => loadSourceImpactTable(SOURCE_IMPACT_TABLE, { ...expected, build: 1 })).toThrow(/build/);
    expect(() => loadSourceImpactTable(SOURCE_IMPACT_TABLE, { ...expected, sourceBspSha256: 'ff'.repeat(32) })).toThrow(/another map/);
    expect(() => loadSourceImpactTable({ ...(SOURCE_IMPACT_TABLE as object), format: 'other' }, expected)).toThrow(/format/);
  });

  it('keeps the shipped surface files exact and records their bytes', () => {
    for (const path of ['scripts/surfaceproperties_cs.txt', 'scripts/decals_subrect.txt']) {
      const row = research.sourceFiles[path];
      expect(row.bytes).toBeGreaterThan(0);
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // The letter-to-group table is the shipped one, including the letter it refuses.
    expect(research.gameMaterialToDecalGroup['-']).toBe('');
    expect(research.gameMaterialToDecalGroup['c']).toBe('impact.concrete');
    expect(research.gameMaterialToDecalGroup['g']).toBeUndefined();
  });

  it('resolves a surface through the shipped base chain, not through a copy', () => {
    // `metal` inherits from `solidmetal`; `wood_panel` walks wood_panel -> wood_crate -> wood.
    expect(research.impact.metal).toMatchObject({ surfaceProp: 'metal', baseChain: ['metal', 'solidmetal'],
      gameMaterial: 'M', decalGroup: 'impact.metal', bulletImpact: 'SolidMetal.BulletImpact' });
    expect(research.impact.wood_panel).toMatchObject({ baseChain: ['wood_panel', 'wood_crate', 'wood'],
      gameMaterial: 'W', decalGroup: 'impact.wood', bulletImpact: 'Wood_Panel.BulletImpact' });
    expect(research.impact.concrete).toMatchObject({ gameMaterial: 'C', decalGroup: 'impact.concrete',
      bulletImpact: 'Concrete.BulletImpact' });
    expect(research.impact.concrete.decals.map(entry => entry.material)).toEqual([
      'decals/concrete/concrete1_subrect', 'decals/concrete/concrete2_subrect',
      'decals/concrete/concrete3_subrect', 'decals/concrete/concrete4_subrect',
    ]);
    expect(research.impact.sand).toMatchObject({ gameMaterial: 'N', decalGroup: 'impact.sand',
      bulletImpact: 'Sand.BulletImpact' });
    // `dirt` inherits the sand waves because its own group names none, exactly as shipped.
    expect(research.impact.dirt.decalGroup).toBe('impact.dirt');
    expect(research.sounds['Dirt.BulletImpact'].waves.map(wave => wave.source))
      .toEqual(research.sounds['Sand.BulletImpact'].waves.map(wave => wave.source));
  });

  it('refuses a decal for the surface the original refuses one for', () => {
    // Playerclip and the skybox report `default_silent`, whose letter `X` is absent from
    // the shipped translation table, so the original leaves no hole and plays no sound.
    expect(research.impact.default_silent).toMatchObject({ gameMaterial: 'X', decalGroup: null,
      decals: [], bulletImpact: null });
    // Chainlink's letter `G` is deliberately unmapped by the shipped decal script.
    expect(research.impact.chainlink).toMatchObject({ gameMaterial: 'G', decalGroup: null, decals: [] });
    expect(research.impact.chainlink.bulletImpact).toBe('ChainLink.BulletImpact');
    expect(table.impact.default_silent.decals).toHaveLength(0);
    expect(table.impact.default_silent.bulletImpact).toBeNull();
  });

  it('covers every collision layer bullets actually hit, and none of the ones they cannot', () => {
    const layers = new Set<string>();
    for (const instance of JSON.parse(read('public/source/csgo-12426148/dust2/collision.json').toString()).colliders as
      { roles: string[]; source: Record<string, unknown> }[]) {
      if (instance.roles.includes('bullet')) layers.add(String(instance.source.layer));
    }
    expect([...layers].sort()).toEqual(['brush', 'displacement', 'propPhy']);
    expect(Object.keys(table.surfaces.brushes).length).toBe(research.surfaceSourceCounts.brushes);
    expect(Object.keys(table.surfaces.props).length).toBe(research.surfaceSourceCounts.props);
    expect(Object.keys(table.surfaces.displacementChunks).length).toBe(research.surfaceSourceCounts.displacementChunks);
    expect(Object.keys(table.surfaces.displacementChunks).length).toBeGreaterThan(90);
    // The VPHY layer carries the projectile role only, so it is not a bullet face.
    expect(sourceImpactSurfaceFor(table, { layer: 'worldVphy', model: 0, solid: 1 })).toBeNull();
  });

  it('names the surface of a real exported instance and nothing else', () => {
    const first = Object.entries(table.surfaces.brushes)[0];
    expect(sourceImpactSurfaceKey({ layer: 'brush', brush: Number(first[0]) })).toEqual({ kind: 'brushes', key: first[0] });
    expect(sourceImpactSurfaceFor(table, { layer: 'brush', brush: Number(first[0]) })).toBe(first[1]);
    const prop = Object.entries(table.surfaces.props)[0];
    expect(sourceImpactSurfaceFor(table, { layer: 'propPhy', model: prop[0], prop: 3 })).toBe(prop[1]);
    const chunk = Object.entries(table.surfaces.displacementChunks)[0];
    expect(sourceImpactSurfaceFor(table, { layer: 'displacement', contents: Number(chunk[0].split(',')[3]),
      grid: chunk[0].split(',').slice(0, 3).map(Number) })).toBe(chunk[1]);
    expect(sourceImpactSurfaceKey(null)).toBeNull();
    expect(sourceImpactSurfaceKey({ layer: 'brush' })).toBeNull();
    expect(sourceImpactSurfaceKey({ layer: 'propPhy', model: 7 })).toBeNull();
    expect(sourceImpactSurfaceFor(table, { layer: 'brush', brush: 999_999 })).toBeNull();
    expect(sourceImpactSurfaceFor(table, { layer: 'displacement', grid: [1, 2], contents: 1 })).toBeNull();
  });

  it('records the faces this build cannot name instead of defaulting them', () => {
    expect(research.coverage).toMatchObject({
      brushes: table.surfaces.brushes && research.surfaceSourceCounts.brushes,
      displacementChunks: research.surfaceSourceCounts.displacementChunks,
      displacementChunkTotal: research.surfaceSourceCounts.displacementChunks,
      props: research.surfaceSourceCounts.props,
      atlases: Object.keys(table.atlases).length,
    });
    expect(research.coverage.brushUnresolvedReasons).toEqual({ 'no-surface-property': 928, ambiguous: 28 });
    expect(research.coverage.propUnresolvedReasons).toEqual({ 'no-surface-property': 12 });
    expect(research.unresolvedBrushAudit.byMaterials['tools/toolsnodraw']).toBe(682);
    // Nodraw, hint, skip, areaportal, trigger and clip carry no `$surfaceprop`; that is the
    // whole of the unresolved brush set apart from the ambiguous ones.
    expect(Object.values(research.unresolvedBrushAudit.byReason).reduce((sum, value) => sum + value, 0)).toBe(956);
    expect(research.unresolvedPropAudit.every(([, reason]) => reason === 'unresolved:stone')).toBe(true);
    // The one surface property the shipped file does not define at all is `stone`, and the
    // shipped surface list therefore does not contain it.
    expect(research.impact.stone).toBeUndefined();
  });
});

describe('original decal definitions', () => {
  it('keeps each decal rectangle, atlas and scale exactly as shipped', () => {
    expect(research.decalMaterials['decals/concrete/concrete1_subrect']).toMatchObject({
      shader: 'subrect', atlas: 'decals/decals_bulletsheet', pos: [128, 128], size: [64, 64],
      decalScale: 0.14, decalScaleVariation: 0.18, modelMaterial: 'decals/concrete/concrete1' });
    expect(research.decalMaterials['decals/metal/metal01_subrect']).toMatchObject({
      pos: [128, 384], size: [32, 32], decalScale: 0.135, decalScaleVariation: 0.09 });
    expect(research.decalMaterials['decals/rubber/rubber1_subrect']).toMatchObject({
      pos: [192, 64], size: [32, 32], decalScale: 0.075, decalScaleVariation: 0.1 });
    expect(research.decalMaterials['decals/wood/wood1_subrect']).toMatchObject({
      pos: [0, 256], size: [32, 32], decalScale: 0.22, modelMaterial: 'decals/wood/shot1' });
    expect(research.decalAtlases['decals/decals_bulletsheet']).toMatchObject({ width: 256, height: 512 });
    // The staged table carries exactly the decals an impact on this map can reach.
    expect(Object.keys(table.decalMaterials).length).toBe(42);
    for (const [name, material] of Object.entries(table.decalMaterials)) {
      const sheet = table.atlases[material.atlas];
      expect(sheet, name).toBeDefined();
      expect(material.pos[0] + material.size[0]).toBeLessThanOrEqual(sheet.width);
      expect(material.pos[1] + material.size[1]).toBeLessThanOrEqual(sheet.height);
      expect(material.scale).toBeGreaterThan(0);
    }
  });

  it('proves the size convention against the same decal\'s model counterpart', () => {
    // The shipped set states a decal's world size as its own texel extent times its own
    // `$decalscale`. That reading is not assumed: the same decal also ships as a standalone
    // material for models, and where the author kept the same number the two products agree
    // exactly, which no other reading of the shader parameter would produce.
    const comparable = Object.entries(research.decalMaterials).filter(([, row]) => row.modelUnits);
    const agreeing = comparable.filter(([, row]) => row.modelUnits![0] === row.subrectUnits![0]);
    expect(comparable.length).toBe(76);
    expect(agreeing.length).toBe(52);
    for (const [, row] of comparable) {
      // Every counterpart is within an order of magnitude, so no reading of the parameter
      // could be off by a scale of ten.
      expect(row.modelUnits![0] / row.subrectUnits![0]).toBeGreaterThan(0.1);
      expect(row.modelUnits![0] / row.subrectUnits![0]).toBeLessThan(10);
    }
    // The Atlas' own bullet-hole stamps are the sizes a wall impact uses.
    expect(sourceImpactDecalSize(table.decalMaterials['decals/concrete/concrete1_subrect'], 0.0254, 0.5))
      .toBeCloseTo(8.96 * 0.0254, 12);
    // A draw at either end of `$decalScaleVariation` moves the size by exactly that fraction.
    const material = table.decalMaterials['decals/concrete/concrete1_subrect'];
    expect(sourceImpactDecalSize(material, 0.0254, 1)).toBeCloseTo(8.96 * 1.18 * 0.0254, 12);
    expect(sourceImpactDecalSize(material, 0.0254, 0)).toBeCloseTo(8.96 * 0.82 * 0.0254, 12);
  });

  it('picks inside the shipped group by its weights, never outside it', () => {
    const row = table.impact.concrete;
    expect(sourceImpactDecalPick(row, 0)).toBe(row.decals[0].material);
    expect(sourceImpactDecalPick(row, 0.999999)).toBe(row.decals[row.decals.length - 1].material);
    const seen = new Set<string>();
    for (let step = 0; step < 400; step++) seen.add(String(sourceImpactDecalPick(row, step / 400)));
    expect(seen.size).toBe(row.decals.length);
    expect(sourceImpactDecalPick(table.impact.default_silent, 0.5)).toBeNull();
    const weighted = { ...row, decals: [{ material: 'decals/concrete/concrete1_subrect', weight: 3 },
      { material: 'decals/concrete/concrete2_subrect', weight: 1 }] };
    let second = 0;
    for (let step = 0; step < 400; step++) if (sourceImpactDecalPick(weighted, step / 400) === weighted.decals[1].material) second++;
    expect(second).toBe(100);
  });

  it('derives one shot\'s draws from that shot alone', () => {
    const first = sourceImpactDraws('shooter-a', 12);
    expect(sourceImpactDraws('shooter-a', 12)).toEqual(first);
    expect(sourceImpactDraws('shooter-a', 13)).not.toEqual(first);
    expect(sourceImpactDraws('shooter-b', 12)).not.toEqual(first);
    for (const draw of Object.values(first)) expect(draw).toBeGreaterThanOrEqual(0);
    expect(first.decal).toBeLessThan(1);
    expect(first.scale).toBeLessThan(1);
    expect(first.roll).toBeGreaterThanOrEqual(0);
    expect(first.roll).toBeLessThan(Math.PI * 2);
  });
});

describe('staged original assets', () => {
  it('ships the atlas bytes the export measured', () => {
    for (const [name, sheet] of Object.entries(table.atlases)) {
      const bytes = read(`public/source/csgo-12426148/impact/${sheet.url}`);
      expect(bytes.byteLength, name).toBe(sheet.bytes);
      expect(digest(bytes), name).toBe(sheet.sha256);
    }
    expect(Object.keys(table.atlases)).toEqual(['decals/decals_mod2x', 'decals/decals_bulletsheet']);
  });

  it('ships every original impact wave with its receipt, and only those', () => {
    const everyWave = Object.values(research.sounds).flatMap(row => row.waves);
    expect(sounds.length).toBe(everyWave.length);
    expect(new Set(sounds.map(row => row.event)).size).toBe(Object.keys(research.sounds).length);
    for (const row of sounds) {
      const bytes = read(`public/source/csgo-12426148/impact/sounds/${row.source.replace(/^sound\//, '')}`);
      expect(bytes.byteLength, row.key).toBe(row.bytes);
      expect(digest(bytes), row.key).toBe(row.sha256);
      expect(row.url).toBe(`/source/csgo-12426148/impact/sounds/${row.source.replace(/^sound\//, '')}`);
      expect(row.volume).toHaveLength(2);
      expect(row.pitch).toHaveLength(2);
      expect(row.source.startsWith('sound/')).toBe(true);
      expect(existsSync(resolve('public/source/csgo-12426148/impact/sounds', row.source.replace(/^sound\//, '')))).toBe(true);
    }
    // Every surface that names a sound has its waves, and every wave belongs to a surface
    // the table can actually select.
    const named = new Set(Object.values(table.impact).map(row => row.bulletImpact).filter(Boolean));
    expect(new Set(sounds.map(row => row.event))).toEqual(named);
    const concrete = sounds.filter(row => row.event === 'Concrete.BulletImpact');
    expect(concrete).toHaveLength(4);
    expect(concrete.map(row => row.source)).toContain('sound/physics/concrete/concrete_impact_bullet1.wav');
  });

  it('keeps the staged provenance tied to the runtime table and the shipped map', () => {
    const provenance = JSON.parse(read('public/source/csgo-12426148/impact/provenance.json').toString()) as {
      export: { bytes: number; sha256: string }; sourceBspSha256: string; files: { path: string; bytes: number; sha256: string }[];
      limitations: string[]; surfaceProps: string[];
    };
    expect(provenance.sourceBspSha256).toBe(level.sourceBspSha256);
    expect(provenance.surfaceProps).toEqual(Object.keys(table.impact).sort());
    for (const row of provenance.files) {
      const bytes = read(`public/source/csgo-12426148/impact/${row.path}`);
      expect(bytes.byteLength, row.path).toBe(row.bytes);
      expect(digest(bytes), row.path).toBe(row.sha256);
    }
    expect(provenance.limitations.join(' ')).toMatch(/no \$surfaceprop/);
    expect(provenance.limitations.join(' ')).toMatch(/Subrect shader/);
  });

  it('exposes the table the runtime reads as the staged one', () => {
    expect(Object.keys(staged.impact).sort()).toEqual(Object.keys(table.impact).sort());
    expect(staged.sourceBspSha256).toBe(level.sourceBspSha256);
    expect(staged.atlasBaseUrl).toBe('/source/csgo-12426148/impact/');
    for (const sheet of Object.values(staged.atlases)) expect(sheet.url).toMatch(/^atlas\/[A-Za-z0-9_.-]+\.png$/);
    expect(staged.limitations).toEqual(table.limitations);
  });

  it('ships one table to both the browser bundle and the Node server', () => {
    // The browser imports the bundled copy and the server reads the web-root copy; they have
    // to be the same bytes or the two ends would resolve different surfaces for one shot.
    expect(digest(read('game/source-impact-table.json')))
      .toBe(digest(read('public/source/csgo-12426148/impact/surface-props.json')));
    expect(SOURCE_IMPACT_TABLE).toEqual(JSON.parse(read('game/source-impact-table.json').toString()));
    expect(table.surfaces).toEqual(staged.surfaces);
    expect(table.impact).toEqual(staged.impact);
  });
});

describe('fail-closed table validation', () => {
  const mutate = (change: (copy: Record<string, unknown>) => void) => {
    const copy = JSON.parse(JSON.stringify(SOURCE_IMPACT_TABLE)) as Record<string, unknown>;
    change(copy);
    return () => loadSourceImpactTable(copy, expected);
  };

  it('refuses a decal that points at an atlas that was not staged', () => {
    expect(mutate(copy => {
      (copy.decalMaterials as Record<string, { atlas: string }>)['decals/concrete/concrete1_subrect'].atlas = 'decals/Decals_Other';
    })).toThrow(/not staged/);
  });

  it('refuses a rectangle that leaves its atlas', () => {
    expect(mutate(copy => {
      (copy.decalMaterials as Record<string, { pos: number[] }>)['decals/concrete/concrete1_subrect'].pos = [250, 128];
    })).toThrow(/outside its atlas/);
    expect(mutate(copy => {
      (copy.decalMaterials as Record<string, { size: number[] }>)['decals/concrete/concrete1_subrect'].size = [64, 0];
    })).toThrow(/outside its atlas/);
  });

  it('refuses a surface that names a decal the table cannot draw', () => {
    expect(mutate(copy => {
      (copy.impact as Record<string, { decals: { material: string }[] }>).concrete.decals[0].material = 'decals/nope';
    })).toThrow(/unstage decal/);
    expect(mutate(copy => {
      (copy.impact as Record<string, { decals: { weight: number }[] }>).concrete.decals[0].weight = 0;
    })).toThrow(/no weight/);
  });

  it('refuses a face whose surface has no impact row', () => {
    expect(mutate(copy => {
      (copy.surfaces as { brushes: Record<string, string> }).brushes['0'] = 'not-a-surface';
    })).toThrow(/no impact row/);
  });

  it('refuses a table without a usable sheet or surface source', () => {
    expect(mutate(copy => { copy.atlases = {}; })).toThrow(/no atlas/);
    expect(mutate(copy => {
      (copy.surfaces as { props: Record<string, string> }).props = {};
    })).toThrow(/surface sources/);
  });
});
