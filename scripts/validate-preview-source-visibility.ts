/** CPU readback from original GLB accessors. This avoids image decoding and
 * browser rendering; the parent separately validates the actual WebGL preview.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { BufferAttribute, BufferGeometry, DoubleSide, FrontSide, Group, Mesh, MeshBasicMaterial, Object3D } from 'three';
import { createSourceVisibilityPreview } from './preview-source-visibility';

const sha = (bytes: ArrayBufferView) => createHash('sha256').update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest('hex');
const root = resolve('.reference-assets/source-exports'), directory = resolve(root, 'dust2/visibility');
type Json = Record<string, any>;
export function readScene(path: string) {
  const raw = readFileSync(path), view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67); assert.equal(view.getUint32(8, true), raw.byteLength);
  const jsonBytes = view.getUint32(12, true), json: Json = JSON.parse(raw.subarray(20, 20 + jsonBytes).toString());
  const bin = raw.subarray(28 + jsonBytes), accessors = new Map<number, BufferAttribute>();
  const constructor: Record<number, any> = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const components: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const attributes: Record<string, string> = { POSITION: 'position', NORMAL: 'normal', TANGENT: 'tangent', TEXCOORD_0: 'uv', TEXCOORD_1: 'uv1', TEXCOORD_2: 'uv2', COLOR_0: 'color' };
  const attribute = (id: number) => {
    if (accessors.has(id)) return accessors.get(id)!;
    const a = json.accessors[id], b = json.bufferViews[a.bufferView], C = constructor[a.componentType], size = components[a.type];
    assert(!a.sparse && C && size && b.buffer === 0);
    const width = C.BYTES_PER_ELEMENT * size, stride = b.byteStride ?? width, offset = (b.byteOffset ?? 0) + (a.byteOffset ?? 0);
    assert(stride >= width && offset + (a.count - 1) * stride + width <= bin.byteLength);
    const tight = new Uint8Array(width * a.count);
    for (let i = 0; i < a.count; i++) tight.set(bin.subarray(offset + i * stride, offset + i * stride + width), i * width);
    const result = new BufferAttribute(new C(tight.buffer), size, a.normalized ?? false); accessors.set(id, result); return result;
  };
  const materials = (json.materials ?? []).map((m: Json) => { const material = new MeshBasicMaterial({ side: m.doubleSided ? DoubleSide : FrontSide }); material.name = m.name ?? ''; material.userData = m; return material; });
  const geometryRecords: BufferGeometry[] = [];
  const primitives = json.meshes.map((m: Json) => m.primitives.map((p: Json) => {
    assert((p.mode ?? 4) === 4 && p.indices !== undefined);
    const geometry = new BufferGeometry(); geometry.name = m.name ?? '';
    for (const [semantic, id] of Object.entries(p.attributes)) { assert(attributes[semantic], semantic); geometry.setAttribute(attributes[semantic], attribute(id as number)); }
    geometry.setIndex(attribute(p.indices)); geometry.userData = m.extras ?? {}; geometryRecords.push(geometry);
    return { geometry, material: materials[p.material] };
  }));
  const nodes: Object3D[] = json.nodes.map((n: Json) => {
    const node = new Group(); node.name = n.name ?? ''; node.userData = n.extras ?? {};
    if (n.matrix) { node.matrix.fromArray(n.matrix); node.matrixAutoUpdate = false; }
    else { if (n.translation) node.position.fromArray(n.translation); if (n.rotation) node.quaternion.fromArray(n.rotation); if (n.scale) node.scale.fromArray(n.scale); node.updateMatrix(); }
    if (n.mesh !== undefined) for (const p of primitives[n.mesh]) node.add(new Mesh(p.geometry, p.material));
    return node;
  });
  json.nodes.forEach((n: Json, i: number) => { for (const child of n.children ?? []) nodes[i].add(nodes[child]); });
  const scene = new Group(); for (const node of json.scenes[json.scene ?? 0].nodes) scene.add(nodes[node]); scene.updateMatrixWorld(true);
  const immutable = () => JSON.stringify({ node: nodes.map(n => [n.name, n.userData, n.matrix.toArray()]),
    material: materials.map((m: MeshBasicMaterial) => m.userData), attributes: [...accessors.entries()].map(([id, a]) => [id, sha(a.array)]),
    geometry: geometryRecords.map(g => [g.userData, g.index?.array.length, Object.keys(g.attributes)]) });
  return { scene, nodes, geometryRecords, immutable, sha256: sha(raw), bytes: raw.byteLength, path };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
const world = readScene(resolve(root, 'dust2-lightmapped/world.glb')), props = readScene(resolve(root, 'dust2/props.glb'));
const worldBefore = world.immutable(), propsBefore = props.immutable(), meshes: { mesh: Mesh; original: BufferGeometry; material: Mesh['material'] }[] = [];
world.scene.traverse(o => { const m = o as Mesh; if (m.isMesh) meshes.push({ mesh: m, original: m.geometry, material: m.material }); });
const data = JSON.parse(readFileSync(resolve(directory, 'visibility.json'), 'utf8'));
const fixtures = JSON.parse(readFileSync(resolve(directory, 'spawn-fixtures.json'), 'utf8'));
const created = performance.now(), controller = createSourceVisibilityPreview({ world: world.scene, props: props.scene, data });
const prepareMs = performance.now() - created, samples: Json[] = [];
let checkedTriangles = 0, checkedIndices = 0;
for (const spawn of fixtures) for (const eye64 of [false, true]) {
  const point = eye64 ? spawn.browserEye64 : spawn.browserOrigin, expected = eye64 ? spawn.eyeExpected : spawn.originExpected;
  const stats = controller.update({ x: point[0], y: point[1], z: point[2] });
  const visible = new Set<number>(expected.faces), visibleProps = new Set<number>(expected.props);
  assert.equal(stats.allVisible, expected.allVisible); assert.equal(stats.cluster, expected.cluster);
  assert.equal(stats.worldAlwaysMeshes, 0); assert.equal(stats.mappedProps, 3158); assert.equal(stats.unknownPropAnchors, 0);
  let triangles = 0;
  for (const { mesh, original, material } of meshes) {
    const before = original.index!.array, after = mesh.geometry.index!.array, face = original.getAttribute('uv2'); let at = 0;
    assert.equal(mesh.material, material);
    for (const name of Object.keys(original.attributes)) assert.equal(mesh.geometry.getAttribute(name), original.getAttribute(name));
    for (let i = 0; i < before.length; i += 3) {
      const id = face.getX(before[i]); assert(Number.isSafeInteger(id) && id >= 0);
      assert.equal(face.getX(before[i + 1]), id); assert.equal(face.getX(before[i + 2]), id);
      const keep = expected.allVisible || id < data.worldFirstFace || id >= data.worldFirstFace + data.worldFaceCount || visible.has(id);
      checkedTriangles++;
      if (!keep) continue;
      assert.equal(after[at++], before[i]); assert.equal(after[at++], before[i + 1]); assert.equal(after[at++], before[i + 2]); checkedIndices += 3;
    }
    const drawn = Math.min(after.length, mesh.geometry.drawRange.count);
    assert.equal(at, drawn); assert.equal(mesh.visible, drawn > 0); triangles += drawn / 3;
  }
  for (const node of props.nodes) {
    const match = /^static_prop_(\d+)$/.exec(node.name);
    if (match) assert.equal(node.visible, expected.allVisible || visibleProps.has(Number(match[1])));
  }
  assert.equal(triangles, stats.worldVisibleTriangles);
  samples.push({ hammerid: spawn.hammerid, team: spawn.team, eye64, ...stats });
}
// Camera outside the tree, then disabling PVS, both restore original references.
for (const [camera, enabled] of [[{ x: 1e9, y: 1e9, z: 1e9 }, true], [{ x: 0, y: 0, z: 0 }, false]] as const) {
  assert.equal(controller.update(camera, enabled).allVisible, true);
  for (const record of meshes) assert.equal(record.mesh.geometry, record.original);
  for (const node of props.nodes) assert.equal(node.visible, true);
}
controller.dispose();
assert.equal(world.immutable(), worldBefore); assert.equal(props.immutable(), propsBefore);
const receipt = { status: 'passed', world: { path: world.path, sha256: world.sha256, bytes: world.bytes },
  props: { path: props.path, sha256: props.sha256, bytes: props.bytes },
  dataSha256: sha(readFileSync(resolve(directory, 'visibility.json'))), adapterSha256: sha(readFileSync(resolve('scripts/preview-source-visibility.ts'))),
  prepareMs, originalWorldTriangles: meshes.reduce((n, r) => n + r.original.index!.count / 3, 0),
  samples: samples.length, checkedTriangles, checkedRetainedIndexValues: checkedIndices,
  checks: ['all raw world accessor attributes shared exactly', 'each retained triangle index equals original raw accessor in original order',
    'all 3158 prop anchor visibility matches independent Python fixture IDs', 'all prop accessor bytes unchanged',
    'all material JSON/extras and node transforms unchanged', 'unknown/disabled restore original geometry references'],
  boundary: 'CPU Three object/accessor readback; no browser/WebGL frustum, image or visual acceptance. Images are neither decoded nor modified.', details: samples };
writeFileSync(resolve(directory, 'preview-verification.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ ...receipt, details: undefined }));
}
