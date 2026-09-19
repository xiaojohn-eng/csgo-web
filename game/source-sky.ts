/** Original Source 3D-sky camera/area contract. Pure CPU; no scene ownership. */
import { findSourceLeaf, prepareSourceVisibility, type SourceVisibilityData, type SourceVisibilityIndex,
  type SourceVisibilityPoint } from './source-visibility';
import { sourceTextureScrollBlocks, type SourceTextureScrollBlock } from './source-texture-scroll';

type Triple = [number, number, number];
/** The second texture a two-texture sky material draws, and where its own lossless copy came
 * from: the file the loader's manifest serves, its byte count and hash, the original VTF's
 * hash, the decoded size, and the original's own clamp flags (which decide the wrap mode). */
export type SourceSkySecondTexture = { texture: string; file: string; bytes: number; sha256: string;
  width: number; height: number; clampS: boolean; clampT: boolean; sourceSha256: string };
/** The shipped branch a two-texture material's own flags select, as measured in
 * scripts/probe-source-cloud-layer-branch.py: the static/dynamic combo and what its program
 * computes. A regenerated descriptor that changes either fails at load rather than drawing a
 * different branch. */
export type SourceSkyUnlitProgram = { static: string; dynamic: number; rgb: string; alpha: string;
  unapplied: string[] };
export type SourceSkyData = {
  format: 'source-sky-v1'; sourceBspSha256: string; metersPerSourceUnit: number; skyName: string;
  camera: { hammerId: string; sourceOrigin: Triple; scale: number; leaf: number; cluster: number; area: number;
    fog: { enabled: boolean; blend: boolean; sourceDirection: Triple; color: Triple; color2: Triple;
      sourceStart: number; sourceEnd: number; maxDensity: number; radial: boolean; hdrColorScale: number } };
  leafFlags: number[]; skyLeafIds: number[]; pvsClusterIds: number[];
  worldFaceIds: number[]; staticPropIds: number[]; skyPortalFaceIds: number[];
  counts: { worldFaces: number; staticProps: number; leaves: number };
  unlitMaterials: { source: string; shader: 'unlitgeneric' | 'unlittwotexture'; noFog: boolean; alpha: number;
    rawVmtSha256: string; scrolls: SourceTextureScrollBlock[]; second: SourceSkySecondTexture | null;
    translucent: boolean; program: SourceSkyUnlitProgram | null; limitations: string[] }[];
  clipSourceUnits: { near: number; far: number };
  contract: { pvsOrigin: 'sky_camera-origin'; areaMask: 'camera-area-only'; orientation: 'inherit-main-view';
    clear: 'sky-color-depth-then-main-depth'; coordinateRule: string };
};
export type PreparedSourceSky = { readonly data: SourceSkyData; readonly visibility: SourceVisibilityIndex };
export type SourceSkyView = {
  enabled: boolean; reason: string; mainLeaf: number; mainCluster: number;
  position: SourceVisibilityPoint; visibilityOrigin: SourceVisibilityPoint; near: number; far: number;
  fog: { start: number; end: number; maxDensity: number; enabled: boolean };
};

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const triple = (v: unknown): v is Triple => Array.isArray(v) && v.length === 3 && v.every(finite);
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i]);
const hex64 = (v: unknown): boolean => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const positiveInteger = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 1;
/** The staged second texture of a two-texture sky material, or `null` for a one-texture one. A
 * staged copy missing its size, hash or decoded size cannot be verified before it is drawn. */
function secondTexture(value: unknown): value is SourceSkySecondTexture | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return typeof t.texture === 'string' && t.texture.length > 0 && typeof t.file === 'string' &&
    /^[\w.-]+\.png$/.test(t.file) && positiveInteger(t.bytes) && hex64(t.sha256) && hex64(t.sourceSha256) &&
    positiveInteger(t.width) && positiveInteger(t.height) &&
    typeof t.clampS === 'boolean' && typeof t.clampT === 'boolean';
}
/** The branch a material declaring only `$translucent 1` lands on: the static combo measured
 * in scripts/probe-source-cloud-layer-branch.py and the terms its program multiplies. A
 * descriptor naming a different combo or different terms is a different branch, so it is
 * refused here rather than drawn as if it were this one. */
function unlitProgram(value: unknown): value is SourceSkyUnlitProgram | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return p.static === '0x1' && p.dynamic === 1 &&
    p.rgb === 'texture0.rgb * texture1.rgb * c1.rgb' && p.alpha === 'texture0.a * texture1.a * c1.a' &&
    Array.isArray(p.unapplied) && p.unapplied.length > 0 &&
    p.unapplied.every(term => typeof term === 'string' && term.length > 0);
}
function ids(value: unknown, upper: number, label: string): asserts value is number[] {
  if (!Array.isArray(value) || value.some((n, i) => !Number.isInteger(n) || n < 0 || n >= upper || (i > 0 && n <= value[i - 1])))
    throw Error(`Source sky ${label} must contain sorted unique in-range IDs`);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

/** Caller hash-verifies sky.json like the other original-map data layers.
 * Re-check the BSP identity, original leaf/PVS area, and complete sprp set here.
 * Face selection is the extractor's original leaffaces + displacement receipt;
 * the visibility layer's conservative ancestor associations are not a new
 * authority for splitting faces between sky and gameplay regions.
 */
export function prepareSourceSky(input: unknown, visibilityData: SourceVisibilityData): PreparedSourceSky {
  const data = structuredClone(input) as SourceSkyData;
  if (!data || data.format !== 'source-sky-v1' || data.sourceBspSha256 !== visibilityData.sourceBspSha256 ||
    data.metersPerSourceUnit !== visibilityData.metersPerSourceUnit) throw Error('Source sky BSP/scale identity differs');
  const visibility = prepareSourceVisibility(visibilityData);
  if (!visibility.valid) throw Error('Source sky needs valid original visibility: ' + visibility.reason);
  const c = data.camera, fog = c?.fog;
  if (!c || !triple(c.sourceOrigin) || !finite(c.scale) || c.scale <= 0 || !Number.isInteger(c.area) || c.area < 0 || c.area >= 255 ||
    !Number.isInteger(c.leaf) || c.leaf < 0 || c.leaf >= visibilityData.leaves.length ||
    !Number.isInteger(c.cluster) || c.cluster < 0 || c.cluster >= visibility.clusterCount) throw Error('Invalid Source sky camera/area');
  if (!fog || !triple(fog.color) || !triple(fog.color2) || !triple(fog.sourceDirection) ||
    ![fog.sourceStart, fog.sourceEnd, fog.maxDensity, fog.hdrColorScale].every(finite) || fog.sourceEnd <= fog.sourceStart ||
    fog.maxDensity < 0 || fog.maxDensity > 1 || ['enabled', 'blend', 'radial'].some(k => typeof fog[k as keyof typeof fog] !== 'boolean'))
    throw Error('Invalid original Source sky fog');
  const m = data.metersPerSourceUnit, origin = { x: c.sourceOrigin[0] * m, y: c.sourceOrigin[2] * m, z: -c.sourceOrigin[1] * m };
  const found = findSourceLeaf(visibility, origin);
  if (found.leaf !== c.leaf || found.cluster !== c.cluster || visibilityData.leaves[c.leaf].area !== c.area)
    throw Error('Source sky camera leaf/cluster/area differs');
  if (data.counts?.worldFaces !== visibilityData.worldFaceCount || data.counts?.staticProps !== visibilityData.staticProps.length ||
    data.counts?.leaves !== visibilityData.leaves.length) throw Error('Source sky original counts differ');
  if (!Array.isArray(data.leafFlags) || data.leafFlags.length !== data.counts.leaves ||
    data.leafFlags.some(n => !Number.isInteger(n) || n < 0 || n > 127)) throw Error('Invalid original Source leaf flags');
  ids(data.skyLeafIds, data.counts.leaves, 'leaf membership'); ids(data.pvsClusterIds, visibility.clusterCount, 'PVS membership');
  ids(data.staticPropIds, data.counts.staticProps, 'prop membership');
  ids(data.worldFaceIds, visibilityData.faceCount, 'face membership'); ids(data.skyPortalFaceIds, visibilityData.faceCount, 'portal membership');
  const row = visibility.rows[c.cluster], clusters = [];
  if (!row) throw Error('Source sky original PVS row is missing');
  for (let i = 0; i < visibility.clusterCount; i++) if (row[i >> 3] & (1 << (i & 7))) clusters.push(i);
  const clusterSet = new Set(clusters), leaves = visibilityData.leaves.flatMap((l, i) => l.area === c.area && clusterSet.has(l.cluster) ? [i] : []);
  if (!same(clusters, data.pvsClusterIds) || !same(leaves, data.skyLeafIds)) throw Error('Source sky area/PVS membership differs');
  const leafSet = new Set(leaves), props = visibilityData.staticProps.filter(p => p.leafIds.some(i => leafSet.has(i))).map(p => p.id);
  if (!same(props, data.staticPropIds)) throw Error('Source sky original prop membership differs');
  const portalSet = new Set(data.skyPortalFaceIds);
  if (data.worldFaceIds.some(f => f < visibilityData.worldFirstFace || f >= visibilityData.worldFirstFace + visibilityData.worldFaceCount ||
    portalSet.has(f) || !visibilityData.faceClusters[f - visibilityData.worldFirstFace].some(c => clusterSet.has(c))))
    throw Error('Source sky world face membership differs');
  if (data.clipSourceUnits?.near !== 2 || data.clipSourceUnits?.far !== 1.732050807569 * 32768 ||
    data.contract?.pvsOrigin !== 'sky_camera-origin' || data.contract.areaMask !== 'camera-area-only' ||
    data.contract.orientation !== 'inherit-main-view' || data.contract.clear !== 'sky-color-depth-then-main-depth')
    throw Error('Unsupported Source sky render contract');
  if (!Array.isArray(data.unlitMaterials) || data.unlitMaterials.some(m => !m || typeof m.source !== 'string' ||
    !['unlitgeneric', 'unlittwotexture'].includes(m.shader) || typeof m.noFog !== 'boolean' || !finite(m.alpha) ||
    m.alpha < 0 || m.alpha > 1 || !/^[0-9a-f]{64}$/.test(m.rawVmtSha256) || !Array.isArray(m.limitations) ||
    typeof m.translucent !== 'boolean' || !secondTexture(m.second) || !unlitProgram(m.program) ||
    // The branch and the fog dynamic combo come from the same measurement, so they have to
    // agree: the shipped combo with no fog arithmetic is the one a `$nofog 1` material gets.
    (m.program !== null && m.noFog !== (m.program.dynamic === 1)) ||
    // The material's own scroll blocks are checked where they are turned into numbers, so a
    // regenerated file that drops or misspells one fails here rather than scrolling wrongly.
    !Array.isArray(m.scrolls)))
    throw Error('Invalid original Source sky unlit material contract');
  // A one-texture material has neither a second texture nor a branch; a two-texture one has
  // both, and the branch it has is the translucent one its own VMT declares.
  for (const m of data.unlitMaterials) {
    const two = m.shader === 'unlittwotexture';
    if (two !== (m.second !== null) || two !== (m.program !== null) || two !== m.translucent)
      throw Error('Original Source sky unlit material branch contract differs');
  }
  // The staged blocks carry the material file's own key names; they are turned into numbers
  // here, so everything downstream reads one shape and a regenerated file that drops or
  // misspells a key fails at load instead of scrolling wrongly.
  const unlitMaterials = data.unlitMaterials.map((material) => ({
    ...material, scrolls: sourceTextureScrollBlocks(material.scrolls) }));
  return Object.freeze({ data: freeze({ ...data, unlitMaterials }), visibility });
}

/** SDK CSkyboxView: inherit main view rotation/FOV, use origin/scale+sky origin,
 * fixed sky-camera PVS, near=2u, far=MAX_TRACE_LENGTH. LEAF_FLAGS_SKY determines
 * main-view eligibility. An unresolved BSP boundary conservatively draws sky.
 * Clear depth between sky and main passes; this function does not issue draws.
 */
export function querySourceSkyView(sky: PreparedSourceSky, mainPosition: SourceVisibilityPoint): SourceSkyView {
  if (![mainPosition.x, mainPosition.y, mainPosition.z].every(finite)) throw Error('Source sky main view must be finite');
  const { data, visibility } = sky, c = data.camera, m = data.metersPerSourceUnit;
  const found = findSourceLeaf(visibility, mainPosition), uncertain = found.leaf < 0 || found.cluster < 0 || found.boundary;
  const visibilityOrigin = { x: c.sourceOrigin[0] * m, y: c.sourceOrigin[2] * m, z: -c.sourceOrigin[1] * m };
  const enabled = uncertain || (data.leafFlags[found.leaf] & 1) !== 0;
  return { enabled, reason: uncertain ? 'conservative-' + found.reason : enabled ? 'original-leaf-3d-sky' : 'original-leaf-no-3d-sky',
    mainLeaf: found.leaf, mainCluster: found.cluster,
    position: { x: visibilityOrigin.x + mainPosition.x / c.scale, y: visibilityOrigin.y + mainPosition.y / c.scale,
      z: visibilityOrigin.z + mainPosition.z / c.scale }, visibilityOrigin,
    near: data.clipSourceUnits.near * m, far: data.clipSourceUnits.far * m,
    fog: { enabled: c.fog.enabled, start: c.fog.sourceStart / c.scale * m, end: c.fog.sourceEnd / c.scale * m, maxDensity: c.fog.maxDensity } };
}
