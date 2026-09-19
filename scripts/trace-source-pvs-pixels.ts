import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Mesh, PerspectiveCamera, Raycaster, Vector2, Vector3, type Intersection, type Object3D } from 'three';
import { readScene } from './validate-preview-source-visibility';
import { createSourceVisibilityPreview } from './preview-source-visibility';
import { browserToSourcePoint, findSourceLeaf, prepareSourceVisibility } from '../game/source-visibility';

const base = resolve('.reference-assets/source-exports/dust2'), read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const metadata = read(resolve(base, 'map-metadata.json')), data = read(resolve(base, 'visibility/visibility.json'));
const index = prepareSourceVisibility(data), entities = read(resolve('output/source1/de_dust2/entities.json'));
const spawn = metadata.spawns.find((s: any) => s.classname === 'info_player_terrorist');
const world = readScene(resolve('.reference-assets/source-exports/dust2-lightmapped/world.glb')), props = readScene(resolve(base, 'props.glb'));
const camera = new PerspectiveCamera(75, 1280 / 720, .02, 2000);
camera.position.fromArray(spawn.browserMetresPosition); camera.position.y += 64 * .0254;
camera.lookAt(camera.position.clone().add(new Vector3().fromArray(spawn.browserForward))); camera.updateMatrixWorld(true);
const controller = createSourceVisibilityPreview({ world: world.scene, props: props.scene, data });
const location = findSourceLeaf(index, camera.position), row = index.rows[location.cluster]!;
function clusterVisible(c: number) { return c < 0 ? null : !!(row[c >> 3] & 1 << (c & 7)); }
const warmup = entities.filter((e: any) => e.origin && /warmup|arena/i.test(JSON.stringify(e))).map((e: any) => {
  const p = e.origin.trim().split(/\s+/).map(Number);
  const leaf = findSourceLeaf(index, { x: p[0] * .0254, y: p[2] * .0254, z: -p[1] * .0254 });
  return { classname: e.classname, hammerid: e.hammerid, targetname: e.targetname, vscripts: e.vscripts, sourceOrigin: p,
    leaf: leaf.leaf, cluster: leaf.cluster, visibleInCameraPvs: clusterVisible(leaf.cluster) };
});
function hitRecord(hit: Intersection) {
  const mesh = hit.object as Mesh, source = browserToSourcePoint(hit.point), sourcePoint = [source.x, source.y, source.z];
  const face = mesh.geometry.getAttribute('uv2'), triangle = hit.face;
  let anchor: Object3D | null = mesh; while (anchor && !/^static_prop_\d+$/.test(anchor.name)) anchor = anchor.parent;
  const propId = anchor ? Number(anchor.name.slice(12)) : null;
  const faceId = face && triangle ? face.getX(triangle.a) : null;
  const clusters = propId !== null ? data.staticProps[propId].leafIds.map((l: number) => data.leaves[l].cluster) : faceId !== null ? data.faceClusters[faceId] : [];
  const material = Array.isArray(mesh.material) ? mesh.material[triangle?.materialIndex ?? 0] : mesh.material;
  return { distanceMetres: hit.distance, meshName: mesh.name, geometryName: mesh.geometry.name, material: material.name,
    materialAlphaMode: material.userData.alphaMode ?? 'OPAQUE', sourcePoint, browserPoint: hit.point.toArray(), sourceFaceId: faceId,
    sourcePropId: propId, sourceModel: anchor?.userData.sourceModel ?? null,
    originalEntityOwnership: propId !== null ? 'sprp record (not a normal entity)' : 'worldspawn model 0',
    clusters: [...new Set<number>(clusters)].map(c => ({ id: c, visibleInCameraPvs: clusterVisible(c) })),
    nearestWarmupEntities: warmup.map((e: any) => ({ ...e, distanceSourceUnits: Math.hypot(...e.sourceOrigin.map((v: number, i: number) => v - sourcePoint[i])) }))
      .sort((a: any, b: any) => a.distanceSourceUnits - b.distanceSourceUnits).slice(0, 4) };
}
const pixels = [[100, 145], [290, 200], [70, 155], [145, 152], [320, 201], [640, 360]];
const output = [];
for (const enabled of [false, true]) {
  const stats = controller.update(camera.position, enabled), meshes: Object3D[] = [];
  for (const scene of [world.scene, props.scene]) scene.traverseVisible(o => { if ((o as Mesh).isMesh) meshes.push(o); });
  for (const [x, y] of pixels) {
    const ray = new Raycaster(); ray.near = camera.near; ray.far = camera.far;
    ray.setFromCamera(new Vector2((x + .5) / 1280 * 2 - 1, 1 - (y + .5) / 720 * 2), camera);
    const hits = ray.intersectObjects(meshes, false);
    output.push({ enabled, pixelTopLeft: [x, y], cluster: stats.cluster, hits: hits.slice(0, 3).map(hitRecord) });
  }
}
controller.dispose();
const receipt = { worldSha256: world.sha256, propsSha256: props.sha256, originalSpawn: spawn,
  camera: { browserPosition: camera.position.toArray(), forward: spawn.browserForward, fov: camera.fov, aspect: camera.aspect, ...location },
  boundary: 'CPU geometry raycast uses original glTF doubleSided flag; ignores alpha-test texture pixels. Nearest named warmup entities are spatial evidence, not a reassignment of worldspawn/sprp ownership.', output };
writeFileSync(resolve(base, 'visibility/pixel-raycast.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
