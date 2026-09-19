import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createSourcePhongMaterial } from './source-materials';
import { sourceSha256 } from './source-sha256';
import contract from './source-grenade-contract.json';
import type { Utility } from './types';

type File = {path: string; bytes: number; sha256: string};
type MaterialInput = {source: string; sourceSha256: string; shader: string;
  parameters: Record<string, string>; textures: Record<string, string>};
type Model = {source: string; glb: File; materialBindings: Record<string, string>;
  collider: {centreMetres: number[]; spanMetres: number[]}; geometry: {vertices: number; polygons: number}[]};
type Manifest = {format: string; build: number; metersPerSourceUnit: number; models: Record<Utility, Model>;
  materials: Record<string, MaterialInput>; files: File[]};

/** A single resource owner; disappearing projectiles release instances only. */
export type SourceGrenadeModels = {
  create(kind: Utility, state?: 'projectile' | 'intact'): T.Group;
  release(instance: T.Group): void;
  audit(): {build: number; verified: boolean; live: number; models: Record<Utility, Model>};
  dispose(): void;
};

function vector(text: string | undefined, fallback: [number,number,number]): [number,number,number] {
  if (text === undefined) return fallback;
  const values = text.replace(/[\[\]{}]/g, '').trim().split(/\s+/).map(Number);
  if (values.length !== 3 || values.some(v => !Number.isFinite(v))) throw Error('Invalid original grenade vector');
  return values as [number,number,number];
}

export async function loadSourceGrenadeModels(options: {signal?: AbortSignal; baseUrl?: string} = {}): Promise<SourceGrenadeModels> {
  const {signal} = options;
  const baseUrl = options.baseUrl ?? '/source/csgo-12426148/grenade-models/';
  const owned: (() => void)[] = [];
  const instances = new Set<T.Group>();
  let disposed = false;
  async function bytes(path: string, expected?: File) {
    const response = await fetch(baseUrl + path, {signal});
    if (!response.ok) throw Error(`Original grenade asset HTTP ${response.status}: ${path}`);
    const raw = new Uint8Array(await response.arrayBuffer());
    if (expected && (raw.byteLength !== expected.bytes || await sourceSha256(raw,signal) !== expected.sha256))
      throw Error('Original grenade asset receipt mismatch: ' + path);
    return raw;
  }
  const manifestBytes = await bytes('manifest.json');
  if (await sourceSha256(manifestBytes,signal) !== contract.manifestSha256) throw Error('Original grenade manifest mismatch');
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest;
  if (manifest.format !== 'source-grenade-models-v1' || manifest.build !== contract.build || manifest.metersPerSourceUnit !== .0254)
    throw Error('Original grenade identity mismatch');
  const receipts = new Map(manifest.files.map(row => [row.path, row]));
  const textures = new Map<string,T.Texture>();
  const templates = new Map<Utility,T.Group>();
  async function texture(path: string | undefined, color = false) {
    if (!path) return null;
    const key = path + ':' + color;
    if (textures.has(key)) return textures.get(key)!;
    const row = receipts.get(path);
    if (!row) throw Error('Unverified original grenade texture: ' + path);
    const raw = await bytes(path,row);
    const url = URL.createObjectURL(new Blob([raw as Uint8Array<ArrayBuffer>], {type:'image/png'}));
    try {
      const result = await new T.TextureLoader().loadAsync(url);
      owned.push(() => result.dispose());
      result.flipY = false;
      result.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
      result.wrapS = result.wrapT = T.RepeatWrapping;
      result.anisotropy = 8;
      result.needsUpdate = true;
      textures.set(key,result);
      signal?.throwIfAborted();
      return result;
    } finally {URL.revokeObjectURL(url);}
  }
  try {
    const materials = new Map<string,T.Material>();
    for (const [path,input] of Object.entries(manifest.materials)) {
      if (input.shader.toLowerCase() !== 'vertexlitgeneric') throw Error('Unsupported original grenade shader: ' + input.shader);
      const p = input.parameters;
      const base = await texture(input.textures.$basetexture,true);
      if (!base) throw Error('Original grenade has no base texture');
      const exponent = await texture(input.textures.$phongexponenttexture);
      const normal = await texture(input.textures.$bumpmap);
      const owner = createSourcePhongMaterial(base,exponent,{
        name:'Source_Grenade_' + path, boost:Number(p.$phongboost ?? 1),
        fresnel:vector(p.$phongfresnelranges,[0,.5,1]), exponentConstant:Number(p.$phongexponent ?? 5),
        albedoBoost:Number(p.$phongalbedoboost ?? 1), albedoTint:p.$phongalbedotint === '1',
        normal:normal ?? undefined,
        ...(p.$envmap === 'env_cubemap' ? {envmap:{tint:vector(p.$envmaptint,[1,1,1]),
          fresnel:p.$envmapfresnel === '1', mask:'phongMask' as const}} : {}),
      });
      owner.material.userData.sourceMaterial = path;
      owner.material.userData.sourceMaterialSha256 = input.sourceSha256;
      materials.set(path,owner.material);
      owned.push(owner.dispose);
    }
    const loader = new GLTFLoader();
    const geometries = new Set<T.BufferGeometry>(), replaced = new Set<T.Material>();
    for (const kind of ['he','smoke','flash'] as const) {
      const model = manifest.models[kind];
      const raw = await bytes(model.glb.path,model.glb);
      const gltf = await loader.parseAsync(raw.buffer as ArrayBuffer,'');
      const root = new T.Group();
      root.name = 'SourceGrenade_' + kind;
      root.add(gltf.scene);
      gltf.scene.scale.setScalar(manifest.metersPerSourceUnit);
      gltf.scene.position.fromArray(model.collider.centreMetres).negate();
      gltf.scene.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        geometries.add(object.geometry);
        const bind = (old: T.Material) => {
          replaced.add(old);
          const input = model.materialBindings[old.name];
          const result = materials.get(input);
          if (!result) throw Error(`Original grenade material binding missing: ${kind}/${old.name}`);
          return result;
        };
        object.material = Array.isArray(object.material) ? object.material.map(bind) : bind(object.material);
        object.castShadow = object.receiveShadow = true;
        object.frustumCulled = false;
        object.userData.grenadeDetachable = /_pin$|_spoon$/.test(object.name);
      });
      root.userData.sourceGrenade = {kind,source:model.source,sha256:model.glb.sha256,verified:true};
      templates.set(kind,root);
    }
    for (const material of replaced) material.dispose();
    owned.push(() => {for (const geometry of geometries) geometry.dispose();});
    signal?.throwIfAborted();
  } catch (error) {owned.reverse().forEach(release => release()); throw error;}
  function release(instance:T.Group) {
    if (!instances.delete(instance)) return;
    instance.removeFromParent();
    instance.traverse(object => {if (object instanceof T.SkinnedMesh) object.skeleton.dispose();});
  }
  return {
    create(kind,state='projectile') {
      if (disposed) throw Error('Original grenade owner is disposed');
      const template = templates.get(kind);
      if (!template) throw Error('Original grenade kind is absent: '+kind);
      const instance = cloneSkeleton(template) as T.Group;
      instance.traverse(object => {if (object.userData.grenadeDetachable) object.visible = state === 'intact';});
      instances.add(instance);
      return instance;
    },
    release,
    audit:() => ({build:manifest.build,verified:true,live:instances.size,models:manifest.models}),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const instance of [...instances]) release(instance);
      owned.reverse().forEach(release => release());
      templates.clear(); textures.clear();
    },
  };
}
