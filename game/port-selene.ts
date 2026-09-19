import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MAP_SOURCE_SHA256 } from './map.js';

export const PORT_SELENE_URL = '/models/web-w02/map/port-selene-runtime.glb';
export const PORT_SELENE_LIGHTING = {
  exposure: 0.98, environmentIntensity: 0.65, fogDensity: 0.0035,
  sunPosition: [-30, 48, 15] as const, sunIntensity: 3.1,
  shadowExtent: 44, cameraFar: 450,
};
export interface PortSeleneOptions {
  url?: string;
  anisotropy?: number;
  signal?: AbortSignal;
}
export interface PortSeleneStats {
  bytes: number; sha256: string | null; hashVerified: boolean;
  meshes: number; triangles: number; materials: number; textures: number;
  bounds: {min: number[]; max: number[]}; loadMilliseconds: number;
}

/** Load the accepted, full source model. Throws on failure; there is no proxy fallback. */
export async function loadPortSeleneMap(options: PortSeleneOptions = {}): Promise<{
  root: T.Group; stats: PortSeleneStats; dispose: () => void;
}> {
  const started = performance.now();
  const url = options.url ?? PORT_SELENE_URL;
  const response = await fetch(url, {signal: options.signal});
  if (!response.ok) throw new Error(`塞勒涅港地图加载失败：HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== 80352620) throw new Error(`塞勒涅港地图文件不完整：${bytes.byteLength} bytes`);
  // WebCrypto requires a secure context. Local LAN HTTP still verifies exact geometry
  // counts; its deployment must retain the checked source digest in provenance.json.
  const sha256 = globalThis.crypto?.subtle
    ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('')
    : null;
  if (sha256 && sha256 !== MAP_SOURCE_SHA256) throw new Error('塞勒涅港地图哈希不匹配');
  const gltf = await new GLTFLoader().parseAsync(bytes, url.slice(0, url.lastIndexOf('/') + 1));
  const root = gltf.scene;
  root.name = 'PortSeleneM01';
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  let meshes = 0, triangles = 0, disposed = false;
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    meshes++;
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
    object.castShadow = true; object.receiveShadow = true;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
    }
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true; root.removeFromParent();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    const images = new Set<ImageBitmap>();
    for (const texture of textures) {
      texture.dispose();
      if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) images.add(texture.image);
    }
    for (const bitmap of images) bitmap.close();
  };
  if (meshes !== 227 || triangles !== 314644 || materials.size !== 29) {
    dispose(); throw new Error(`塞勒涅港高质量模型契约不符：${meshes} meshes / ${triangles} triangles / ${materials.size} materials`);
  }
  // Preserve authored root/node transforms, PBR factors, normal maps, UVs and texture bytes.
  for (const texture of textures) texture.anisotropy = Math.max(1, Math.min(8, options.anisotropy ?? 4));
  root.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(root);
  const stats: PortSeleneStats = {bytes: bytes.byteLength, sha256, hashVerified: sha256 === MAP_SOURCE_SHA256,
    meshes, triangles, materials: materials.size, textures: textures.size,
    bounds: {min: bounds.min.toArray(), max: bounds.max.toArray()}, loadMilliseconds: performance.now() - started};
  root.userData.webMap02 = stats;
  return {root, stats, dispose};
}
