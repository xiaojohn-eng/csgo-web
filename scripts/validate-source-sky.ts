/** Real current staged GLTF geometry/material readback, with image decoding
 * replaced by empty textures. This is explicitly CPU evidence, not GPU proof. */
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { prepareSourceSky } from '../game/source-sky';
import { createSourceSkyRender } from '../game/source-sky-render';
import { applySourceWorldLightmaps, type SourceLightmapDescriptor } from '../game/source-world-lightmaps';

const started = performance.now(), directory = 'public/source/csgo-12426148/dust2/';
const manifest = JSON.parse(readFileSync(directory + 'manifest.json', 'utf8'));
const receipts: Record<string, string> = {};
function binary(key: string): ArrayBuffer {
  const expected = manifest.files[key], bytes = readFileSync(directory + expected.url);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(bytes.byteLength, expected.bytes); assert.equal(hash, expected.sha256); receipts[key] = hash;
  return bytes.byteOffset === 0 && bytes.buffer.byteLength === bytes.byteLength ? bytes.buffer as ArrayBuffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
const json = (key: string) => JSON.parse(new TextDecoder().decode(binary(key)));
const loader = new GLTFLoader(); let placeholderTextures = 0;
loader.register(() => ({ name: 'SKY_CPU_NO_IMAGE_DECODE', loadTexture: async () => { placeholderTextures++; const texture = new T.Texture(); texture.flipY = false; return texture; } }));
const world = await loader.parseAsync(binary('world'), ''), props = await loader.parseAsync(binary('props'), '');
const hdr = applySourceWorldLightmaps(world.scene, json('lightmaps') as SourceLightmapDescriptor, binary('atlas'));
const rawSky = readFileSync('.reference-assets/source-exports/dust2/sky/sky.json'), descriptor = JSON.parse(rawSky.toString());
const sky = prepareSourceSky(descriptor, json('visibility'));
const meshes: { mesh: T.Mesh; geometry: T.BufferGeometry; material: T.Material | T.Material[]; parent: T.Object3D | null; visible: boolean; index: number[]; attrs: Record<string, T.BufferAttribute | T.InterleavedBufferAttribute> }[] = [];
const originalGeometries = new Set<T.BufferGeometry>(), originalMaterials = new Set<T.Material>(), originalTextures = new Set<T.Texture>();
for (const root of [world.scene, props.scene]) root.traverse(o => {
  const mesh = o as T.Mesh; if (!mesh.isMesh) return;
  meshes.push({ mesh, geometry: mesh.geometry, material: mesh.material, parent: mesh.parent, visible: mesh.visible,
    index: [...(mesh.geometry.index?.array ?? [])], attrs: { ...mesh.geometry.attributes } });
  originalGeometries.add(mesh.geometry);
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    originalMaterials.add(material); for (const value of Object.values(material)) if (value instanceof T.Texture) originalTextures.add(value);
  }
});
let disposedBorrowed = 0;
for (const value of [...originalGeometries, ...originalMaterials, ...originalTextures]) value.addEventListener('dispose', () => disposedBorrowed++);
const cycles = [];
for (let cycle = 0; cycle < 3; cycle++) {
  const createStart = performance.now(), owner = createSourceSkyRender({ world: world.scene, props: props.scene, sky });
  const createMs = performance.now() - createStart;
  const camera = new T.PerspectiveCamera(74, 1.6, .02, 1000); camera.position.set(12, -2, -15); camera.rotation.set(.15, .8, 0);
  const view = owner.update(camera); owner.scene.updateMatrixWorld(true);
  assert.equal(owner.stats.staticProps, 75); assert.equal(owner.stats.ownedMaterials, 2);
  let transformedMeshes = 0, sharedAttributes = 0, triangles = 0, actualDisposals = 0;
  const copiedGeometry = new Set<T.BufferGeometry>(), copiedMaterials = new Set<T.Material>();
  owner.scene.traverse(object => {
    const mesh = object as T.Mesh; if (!mesh.isMesh) return;
    triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
    copiedGeometry.add(mesh.geometry); for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) copiedMaterials.add(m);
    const source = props.scene.getObjectByName(mesh.name) ?? world.scene.getObjectByName(mesh.name);
    assert(source && (source as T.Mesh).isMesh, 'Every copied mesh maps to a real original mesh name');
    source.updateWorldMatrix(true, false);
    for (let i = 0; i < 16; i++) assert(Math.abs(source.matrixWorld.elements[i] - mesh.matrixWorld.elements[i]) < 1e-11);
    const original = (source as T.Mesh).geometry;
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) { assert.equal(attribute, original.attributes[name]); sharedAttributes++; }
    if (mesh.geometry !== original) {
      assert.equal(mesh.material, (source as T.Mesh).material);
      const face = original.getAttribute('uv2'), index = mesh.geometry.index!;
      for (let i = 0; i < index.count; i++) assert(sky.data.worldFaceIds.includes(face.getX(index.getX(i))));
    }
    transformedMeshes++;
  });
  for (const geometry of copiedGeometry) if (!originalGeometries.has(geometry)) geometry.addEventListener('dispose', event => {
    assert.equal(Object.keys((event.target as T.BufferGeometry).attributes).length, 0); actualDisposals++;
  });
  for (const material of copiedMaterials) if (!originalMaterials.has(material)) material.addEventListener('dispose', () => actualDisposals++);
  owner.dispose(); owner.dispose(); assert.equal(disposedBorrowed, 0);
  assert.equal(actualDisposals, owner.stats.ownedGeometries + owner.stats.ownedMaterials);
  for (const original of meshes) {
    assert.equal(original.mesh.geometry, original.geometry); assert.equal(original.mesh.material, original.material);
    assert.equal(original.mesh.parent, original.parent); assert.equal(original.mesh.visible, original.visible);
    assert.deepEqual([...(original.geometry.index?.array ?? [])], original.index);
    for (const [name, attribute] of Object.entries(original.attrs)) assert.equal(original.geometry.attributes[name], attribute);
  }
  cycles.push({ cycle, ...owner.stats, transformedMeshes, sharedAttributes, triangles, actualDisposals, disposedBorrowed, createMs, view });
}
const result = { status: 'actual_staged_GLTF_CPU_sky_ownership_passed', sourceBspSha256: sky.data.sourceBspSha256,
  descriptorSha256: createHash('sha256').update(rawSky).digest('hex'), files: receipts,
  originalMeshes: meshes.length, originalGeometries: originalGeometries.size, placeholderTextures,
  cycles, elapsedMs: performance.now() - started,
  limits: ['Image decode was stubbed; no browser, GPU, draw-order, fog or visual fidelity claim.',
    'World used the production HDR lightmap adapter; props use current original GLTF materials, without independently loading optional VHV.'] };
writeFileSync('output/tests/source-sky-verification.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
// The parent map owner is released only after every sky owner is gone.
hdr.dispose();
