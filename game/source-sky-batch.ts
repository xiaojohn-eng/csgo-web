import * as T from 'three';
import type {SourcePropLightingBinding} from './source-prop-lighting';
import type {SourceOliveBinding} from './source-olive-lighting';
import {SOURCE_OLIVE_TREESWAY_GLSL} from './source-olive-treesway-glsl';

/** Merges the separate 3D-sky backdrop pass (Source_Original_3D_Sky) into one
 * draw call per original material state, mirroring the world/prop batching
 * methodology: group by render state (not material instance), bake every
 * per-mesh shader input into vertex attributes, keep original triangle order,
 * UVs and lighting payloads, and leave transparent/singleton meshes on the old
 * path. Three merge categories exist because the sky scene borrows three
 * kinds of materials:
 *
 * - vhvPlain: VHV plain-unbumped prop replacements whose shader resolves VHV
 *   lighting via gl_VertexID; the merged mesh bakes the resolved lighting
 *   PIXEL COORDINATE per vertex (same contract as source-prop-batch r2).
 * - olive: olive treesway leaves whose shader also displaces vertices with
 *   per-mesh model rows and a shared animated wind vector; the merged mesh
 *   additionally bakes the original local position, the model rows and the
 *   world rotation columns so the wind delta rotates exactly as the
 *   per-instance matrix did.
 * - plain: default-shader glTF materials (MeshStandardMaterial/basic) with
 *   no shader owner; merged as clones with baked world transforms.
 *
 * The sky pass has no PVS (the whole backdrop draws every frame), so unlike
 * the world/prop batches no GPU visibility lookup is injected. */

export interface SourceSkyBatchVhvInput {
  bindings: SourcePropLightingBinding[];
  remap: Uint32Array;
  lookup?: { lighting: T.DataTexture; width: number };
}
export interface SourceSkyBatchOliveInput {
  bindings: SourceOliveBinding[];
  remap: Uint32Array;
  lookup: { lighting: T.DataTexture; width: number };
  /** Shared animated wind vector; the merged material reads this instance. */
  timeWind: T.Vector4;
}
export interface SourceSkyBatchAudit {
  groups: number; mergedMeshes: number; sourceMeshes: number; keptMeshes: number;
  mergedTriangles: number; keptTriangles: number; mergedVertices: number;
  vertexBytes: number; indexBytes: number;
  categories: { vhvPlain: number; olive: number; plain: number };
  skipped: { mesh: string; reason: string }[];
}
export interface SourceSkyBatchHandle {
  audit: SourceSkyBatchAudit;
  dispose(): void;
}

type Category = 'vhvPlain' | 'olive' | 'plain';
type BatchedMaterial = T.Material & {
  isMeshBasicMaterial?: boolean; isMeshStandardMaterial?: boolean;
  map?: T.Texture | null; color?: T.Color; side?: T.Side;
  alphaTest?: number; opacity?: number; transparent?: boolean;
  alphaToCoverage?: boolean; depthWrite?: boolean; depthTest?: boolean;
  toneMapped?: boolean; fog?: boolean; vertexColors?: boolean; blending?: T.Blending;
};

interface Candidate {
  mesh: T.Mesh; origin: T.Object3D; category: Category;
  vhv?: SourcePropLightingBinding; olive?: SourceOliveBinding;
  signature: string; vertices: number; indices: number;
}

/** The maximum lighting pixel address exceeds float32's exact integer range,
 * so addresses are baked as (x, y) texture pixels (same as source-prop-batch). */
function lightingPixel(address: number, width: number): [number, number] {
  const x = address % width; return [x, (address - x) / width];
}

function materialState(material: BatchedMaterial): string {
  return [material.type, material.map?.uuid ?? 'none',
    '#' + (material.color?.getHexString() ?? '-'), material.side,
    material.transparent ? '1' : '0', material.opacity, material.alphaTest,
    material.alphaToCoverage ? '1' : '0', material.depthWrite ? '1' : '0',
    material.depthTest ? '1' : '0', material.toneMapped ? '1' : '0',
    material.vertexColors ? '1' : '0', material.blending,
    ('fog' in material ? String(material.fog) : '?')].join('|');
}

function attributeSignature(geometry: T.BufferGeometry): string | null {
  const entries = Object.entries(geometry.attributes);
  if (!entries.length) return null;
  return entries.map(([name, attribute]) => {
    const itemSize = attribute.itemSize;
    if (!Number.isInteger(itemSize) || itemSize < 1) return null;
    const array = (attribute as T.BufferAttribute).array;
    if (!(array instanceof Float32Array || array instanceof Int8Array || array instanceof Uint8Array ||
      array instanceof Int16Array || array instanceof Uint16Array || array instanceof Int32Array || array instanceof Uint32Array)) return null;
    return name + ':' + itemSize + ':' + array.constructor.name + ':' + (attribute as T.BufferAttribute).normalized;
  }).join('|');
}

/** Same default-cache-key contract as the plain prop batch: fresh materials
 * return the default key, every shader owner replaces it. */
function defaultCacheKeys(): Set<string> {
  return new Set([new T.MeshStandardMaterial().customProgramCacheKey(), new T.MeshBasicMaterial().customProgramCacheKey()]);
}

function basicState(material: BatchedMaterial): material is T.MeshBasicMaterial {
  return !!material.isMeshBasicMaterial;
}

const leafDecode = `
uniform highp sampler2D sourceVhvLighting;
attribute vec2 sourceLightCoord;
varying vec3 vSourceLight0;
vec3 sourceDecode(ivec2 p){
  vec4 encoded=texelFetch(sourceVhvLighting,p,0);
  return pow(encoded.bgr*2.0,vec3(2.200000047683716));
}
`;
const leafBody = `
vSourceLight0=sourceDecode(ivec2(int(sourceLightCoord.x),int(sourceLightCoord.y)));
`;
const leafFragment = `
varying vec3 vSourceLight0;
`;
const leafFragmentBody = `
diffuseColor.rgb*=vSourceLight0;
`;
const oliveDeclarations = `
uniform highp sampler2D sourceLeafLighting;
attribute vec2 sourceLeafCoord;
attribute vec3 sourceOliveRest;
attribute vec4 sourceOliveRow0,sourceOliveRow1,sourceOliveRow2;
attribute vec3 sourceOliveWorldCol0,sourceOliveWorldCol1,sourceOliveWorldCol2;
varying vec3 vSourceLeafLight;
` + SOURCE_OLIVE_TREESWAY_GLSL;
const oliveBody = `
vec3 sourceLeafEncoded=texelFetch(sourceLeafLighting,ivec2(int(sourceLeafCoord.x),int(sourceLeafCoord.y)),0).bgr;
vSourceLeafLight=pow(sourceLeafEncoded*2.0,vec3(2.200000047683716));
vec3 sourceTreeRest=vec3(sourceOliveRest.x,-sourceOliveRest.z,sourceOliveRest.y);
vec3 sourceTreeDelta=sourceOlivePosition(sourceTreeRest,sourceTreeTimeWind,sourceOliveRow0,sourceOliveRow1,sourceOliveRow2)-sourceTreeRest;
vec3 sourceTreeLocal=vec3(sourceTreeDelta.x,sourceTreeDelta.z,-sourceTreeDelta.y);
transformed+=sourceOliveWorldCol0*sourceTreeLocal.x+sourceOliveWorldCol1*sourceTreeLocal.y+sourceOliveWorldCol2*sourceTreeLocal.z;
`;
const oliveUniformDeclarations = `
uniform vec4 sourceTreeTimeWind;
`;
const oliveFragment = `
varying vec3 vSourceLeafLight;
`;
const oliveFragmentBody = `
diffuseColor.rgb*=vSourceLeafLight;
`;

/** Caller owns the sky renderer handle; this adapter must be disposed before
 * it. Skipped meshes keep their borrowed materials and per-update transform
 * sync on the original sky path. */
export function createSourceSkyBatch(options: {
  scene: T.Object3D;
  /** copy -> original source mapping exposed by the sky renderer. */
  sourceMeshes: ReadonlyMap<T.Object3D, T.Object3D>;
  vhv?: SourceSkyBatchVhvInput | null;
  olive?: SourceSkyBatchOliveInput | null;
}): SourceSkyBatchHandle {
  const vhvBindings = new Map<T.Object3D, SourcePropLightingBinding>(
    (options.vhv?.bindings ?? []).map(binding => [binding.mesh, binding]));
  const oliveBindings = new Map<T.Object3D, SourceOliveBinding>(
    (options.olive?.bindings ?? []).map(binding => [binding.mesh, binding]));
  const defaults = defaultCacheKeys();
  const skipped: { mesh: string; reason: string }[] = [];
  const candidates: Candidate[] = [];
  let sceneTriangles = 0;
  options.scene.traverse(object => {
    const mesh = object as T.Mesh;
    if (!mesh.isMesh || (mesh as T.Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh ||
      (mesh as T.Mesh & { isInstancedMesh?: boolean }).isInstancedMesh) return;
    const geometry = mesh.geometry;
    // Every mesh of the scene counts towards the audit total, including the
    // ones skipped below, so keptTriangles is exactly total minus merged.
    sceneTriangles += (geometry.index?.count ?? geometry.attributes.position?.count ?? 0) / 3;
    const name = mesh.name || mesh.parent?.name || '?';
    const origin = options.sourceMeshes.get(mesh);
    if (!origin) { skipped.push({ mesh: name, reason: 'no source origin' }); return; }
    const material = mesh.material as BatchedMaterial;
    if (Array.isArray(mesh.material)) { skipped.push({ mesh: name, reason: 'material array' }); return; }
    if (material.transparent || (material.opacity !== undefined && material.opacity < 1)) {
      skipped.push({ mesh: name, reason: 'transparent material keeps per-object sort' }); return;
    }
    if (!geometry.index || !geometry.attributes.position) { skipped.push({ mesh: name, reason: 'unindexed geometry' }); return; }
    if (Object.keys(geometry.morphAttributes).length || mesh.morphTargetInfluences?.length) {
      skipped.push({ mesh: name, reason: 'morph targets' }); return;
    }
    const drawRange = geometry.drawRange;
    if (drawRange.start !== 0 || (drawRange.count !== Infinity && drawRange.count < geometry.index.count)) {
      skipped.push({ mesh: name, reason: 'partial draw range' }); return;
    }
    if ((geometry.groups ?? []).length) { skipped.push({ mesh: name, reason: 'geometry groups' }); return; }
    const signature = attributeSignature(geometry);
    if (!signature) { skipped.push({ mesh: name, reason: 'unsupported attribute set' }); return; }
    const vertices = geometry.attributes.position.count, indices = geometry.index.count;
    const olive = oliveBindings.get(origin);
    if (olive) {
      if (!basicState(material) || !material.map || !options.olive) {
        skipped.push({ mesh: name, reason: 'olive material contract differs' }); return;
      }
      if (vertices !== olive.vertexCount || indices !== olive.indexCount) {
        skipped.push({ mesh: name, reason: 'olive geometry contract differs' }); return;
      }
      candidates.push({ mesh, origin, category: 'olive', olive, signature, vertices, indices });
      return;
    }
    const vhv = vhvBindings.get(origin);
    if (vhv) {
      const parameters = vhv.source.parameters;
      if (!basicState(material) || !material.map) { skipped.push({ mesh: name, reason: 'VHV material contract differs' }); return; }
      if (parameters.$bumpmap) { skipped.push({ mesh: name, reason: 'VHV bump branch keeps original path' }); return; }
      if (parameters.$decaltexture || parameters.$tintmasktexture) {
        skipped.push({ mesh: name, reason: 'VHV decal/tint branch keeps original path' }); return;
      }
      if (!options.vhv?.lookup) { skipped.push({ mesh: name, reason: 'VHV lookup unavailable' }); return; }
      if (vertices !== vhv.vertexCount || indices !== vhv.indexCount) {
        skipped.push({ mesh: name, reason: 'VHV geometry contract differs' }); return;
      }
      candidates.push({ mesh, origin, category: 'vhvPlain', vhv, signature, vertices, indices });
      return;
    }
    if (!defaults.has(material.customProgramCacheKey())) {
      skipped.push({ mesh: name, reason: 'material owned by another shader owner' }); return;
    }
    candidates.push({ mesh, origin, category: 'plain', signature, vertices, indices });
  });
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const material = candidate.mesh.material as BatchedMaterial;
    const key = candidate.category + '|' + materialState(material) + '|' +
      (candidate.category === 'plain' ? material.uuid : '') + '|' + candidate.signature;
    const list = groups.get(key) ?? []; list.push(candidate); groups.set(key, list);
  }
  const host = new T.Group(); host.name = 'source_sky_batch';
  const restored: { mesh: T.Mesh; parent: T.Object3D }[] = [];
  const merged: { mesh: T.Mesh; material: T.Material }[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true;
    for (const item of merged) { item.mesh.removeFromParent(); item.mesh.geometry.dispose(); item.material.dispose(); }
    for (const item of restored) item.parent.add(item.mesh);
    host.removeFromParent();
  };
  let vertexBytes = 0, indexBytes = 0, mergedVertices = 0, mergedTriangles = 0;
  const categories = { vhvPlain: 0, olive: 0, plain: 0 };
  try {
    const position = new T.Vector3(), normal = new T.Vector3(), tangent = new T.Vector3();
    const worldMatrix = new T.Matrix4(), normalMatrix = new T.Matrix3(), tangentMatrix = new T.Matrix3();
    for (const list of groups.values()) {
      if (list.length < 2) {
        const material = list[0].mesh.material as BatchedMaterial;
        skipped.push({ mesh: list[0].mesh.name || '?', reason: 'single-mesh group keeps original path' });
        continue;
      }
      const first = list[0], firstGeometry = first.mesh.geometry;
      const category = first.category;
      const attributeNames = Object.keys(firstGeometry.attributes);
      const totalVertices = list.reduce((n, candidate) => n + candidate.vertices, 0);
      const totalIndices = list.reduce((n, candidate) => n + candidate.indices, 0);
      const buffers = new Map<string, T.TypedArray>();
      for (const name of attributeNames) {
        const source = firstGeometry.attributes[name] as T.BufferAttribute;
        const Constructor = source.array.constructor as new (length: number) => T.TypedArray;
        buffers.set(name, new Constructor(totalVertices * source.itemSize));
      }
      const leafCoords = (category === 'vhvPlain' || category === 'olive') ? new Float32Array(totalVertices * 2) : undefined;
      const oliveRest = category === 'olive' ? new Float32Array(totalVertices * 3) : undefined;
      const oliveRows = category === 'olive' ? [0, 1, 2].map(() => new Float32Array(totalVertices * 4)) as [Float32Array, Float32Array, Float32Array] : undefined;
      const oliveCols = category === 'olive' ? [0, 1, 2].map(() => new Float32Array(totalVertices * 3)) as [Float32Array, Float32Array, Float32Array] : undefined;
      const IndexType = totalVertices > 65535 ? Uint32Array : Uint16Array;
      const indices = new IndexType(totalIndices);
      let vertexBase = 0, indexBase = 0;
      for (const candidate of list) {
        const geometry = candidate.mesh.geometry;
        candidate.mesh.updateWorldMatrix(true, false);
        worldMatrix.copy(candidate.mesh.matrixWorld);
        normalMatrix.getNormalMatrix(worldMatrix);
        for (const name of attributeNames) {
          const attribute = geometry.attributes[name] as T.BufferAttribute;
          const target = buffers.get(name)!;
          const itemSize = attribute.itemSize;
          if (name === 'position') {
            for (let i = 0; i < candidate.vertices; i++) {
              position.fromBufferAttribute(attribute, i).applyMatrix4(worldMatrix);
              target[(vertexBase + i) * itemSize] = position.x;
              target[(vertexBase + i) * itemSize + 1] = position.y;
              target[(vertexBase + i) * itemSize + 2] = position.z;
            }
          } else if (name === 'normal') {
            for (let i = 0; i < candidate.vertices; i++) {
              normal.fromBufferAttribute(attribute, i).applyMatrix3(normalMatrix);
              target[(vertexBase + i) * itemSize] = normal.x;
              target[(vertexBase + i) * itemSize + 1] = normal.y;
              target[(vertexBase + i) * itemSize + 2] = normal.z;
            }
          } else if (name === 'tangent') {
            // glTF tangents carry a handedness w component; only xyz takes the
            // world rotation (three's defaultnormal_vertex does the same).
            for (let i = 0; i < candidate.vertices; i++) {
              tangent.set(attribute.getComponent(i, 0), attribute.getComponent(i, 1), attribute.getComponent(i, 2)).applyMatrix3(tangentMatrix);
              target[(vertexBase + i) * itemSize] = tangent.x;
              target[(vertexBase + i) * itemSize + 1] = tangent.y;
              target[(vertexBase + i) * itemSize + 2] = tangent.z;
              if (itemSize > 3) target[(vertexBase + i) * itemSize + 3] = attribute.getComponent(i, 3);
            }
          } else {
            (target as T.TypedArray).set(attribute.array as never, vertexBase * itemSize);
          }
        }
        if (category === 'vhvPlain' && leafCoords && candidate.vhv && options.vhv?.lookup && options.vhv.remap) {
          const binding = candidate.vhv, width = options.vhv.lookup.width;
          for (let i = 0; i < candidate.vertices; i++) {
            const address = (binding.lightingVertexOffset + options.vhv.remap[binding.mappingOffset + i]) * 3;
            const [x, y] = lightingPixel(address, width);
            leafCoords[(vertexBase + i) * 2] = x; leafCoords[(vertexBase + i) * 2 + 1] = y;
          }
        }
        if (category === 'olive' && leafCoords && oliveRest && oliveRows && oliveCols && candidate.olive && options.olive) {
          const binding = candidate.olive, width = options.olive.lookup.width, remap = options.olive.remap;
          const local = geometry.attributes.position as T.BufferAttribute;
          const elements = worldMatrix.elements;
          for (let i = 0; i < candidate.vertices; i++) {
            const address = (binding.lightingVertexOffset + remap[binding.mappingOffset + i]) * 3;
            const [x, y] = lightingPixel(address, width);
            leafCoords[(vertexBase + i) * 2] = x; leafCoords[(vertexBase + i) * 2 + 1] = y;
            oliveRest[(vertexBase + i) * 3] = local.getX(i);
            oliveRest[(vertexBase + i) * 3 + 1] = local.getY(i);
            oliveRest[(vertexBase + i) * 3 + 2] = local.getZ(i);
            for (let r = 0; r < 3; r++) {
              const rows = binding.sourceModelRows[r];
              const target = oliveRows[r];
              target[(vertexBase + i) * 4] = rows[0]; target[(vertexBase + i) * 4 + 1] = rows[1];
              target[(vertexBase + i) * 4 + 2] = rows[2]; target[(vertexBase + i) * 4 + 3] = rows[3];
            }
            for (let c = 0; c < 3; c++) {
              const target = oliveCols[c];
              target[(vertexBase + i) * 3] = elements[c * 4];
              target[(vertexBase + i) * 3 + 1] = elements[c * 4 + 1];
              target[(vertexBase + i) * 3 + 2] = elements[c * 4 + 2];
            }
          }
        }
        const index = geometry.index!;
        for (let i = 0; i < candidate.indices; i++) indices[indexBase + i] = index.getX(i) + vertexBase;
        vertexBase += candidate.vertices; indexBase += candidate.indices;
      }
      const geometry = new T.BufferGeometry();
      for (const name of attributeNames) {
        const source = firstGeometry.attributes[name] as T.BufferAttribute;
        geometry.setAttribute(name, new T.BufferAttribute(buffers.get(name)!, source.itemSize, source.normalized));
      }
      const sourceMaterial = first.mesh.material as BatchedMaterial;
      let material: T.Material;
      if (category === 'olive' && options.olive) {
        geometry.setAttribute('sourceLeafCoord', new T.BufferAttribute(leafCoords!, 2));
        geometry.setAttribute('sourceOliveRest', new T.BufferAttribute(oliveRest!, 3));
        geometry.setAttribute('sourceOliveRow0', new T.BufferAttribute(oliveRows![0], 4));
        geometry.setAttribute('sourceOliveRow1', new T.BufferAttribute(oliveRows![1], 4));
        geometry.setAttribute('sourceOliveRow2', new T.BufferAttribute(oliveRows![2], 4));
        geometry.setAttribute('sourceOliveWorldCol0', new T.BufferAttribute(oliveCols![0], 3));
        geometry.setAttribute('sourceOliveWorldCol1', new T.BufferAttribute(oliveCols![1], 3));
        geometry.setAttribute('sourceOliveWorldCol2', new T.BufferAttribute(oliveCols![2], 3));
        const basic = sourceMaterial as T.MeshBasicMaterial;
        const mergedMaterial = new T.MeshBasicMaterial({ map: basic.map, color: basic.color.clone(), side: basic.side,
          alphaTest: basic.alphaTest, opacity: basic.opacity, transparent: basic.transparent,
          alphaToCoverage: basic.alphaToCoverage, depthWrite: basic.depthWrite, depthTest: basic.depthTest,
          toneMapped: basic.toneMapped, fog: basic.fog, blending: basic.blending });
        mergedMaterial.name = (basic.name || 'sky olive') + ' / original sky batched';
        mergedMaterial.onBeforeCompile = shader => {
          const vc = '#include <common>', vb = '#include <begin_vertex>', fc = '#include <common>', fm = '#include <map_fragment>';
          if (!shader.vertexShader.includes(vc) || !shader.vertexShader.includes(vb) ||
            !shader.fragmentShader.includes(fc) || !shader.fragmentShader.includes(fm))
            throw Error('Three sky olive batch shader contract changed');
          Object.assign(shader.uniforms, {
            sourceLeafLighting: { value: options.olive!.lookup.lighting },
            sourceTreeTimeWind: { value: options.olive!.timeWind },
            sourceOliveRoundMask: { value: 0 },
          });
          shader.vertexShader = shader.vertexShader
            .replace(vc, vc + oliveDeclarations + oliveUniformDeclarations)
            .replace(vb, vb + oliveBody);
          shader.fragmentShader = shader.fragmentShader
            .replace(fc, fc + oliveFragment)
            .replace(fm, fm + oliveFragmentBody);
        };
        mergedMaterial.customProgramCacheKey = () => 'source-sky-batch-olive-r1';
        material = mergedMaterial;
      } else if (category === 'vhvPlain' && options.vhv?.lookup) {
        geometry.setAttribute('sourceLightCoord', new T.BufferAttribute(leafCoords!, 2));
        const basic = sourceMaterial as T.MeshBasicMaterial;
        const mergedMaterial = new T.MeshBasicMaterial({ map: basic.map, color: basic.color.clone(), side: basic.side,
          alphaTest: basic.alphaTest, opacity: basic.opacity, transparent: basic.transparent,
          alphaToCoverage: basic.alphaToCoverage, depthWrite: basic.depthWrite, depthTest: basic.depthTest,
          toneMapped: basic.toneMapped, fog: basic.fog, blending: basic.blending });
        mergedMaterial.name = (basic.name || 'sky VHV') + ' / original sky batched';
        mergedMaterial.onBeforeCompile = shader => {
          const vc = '#include <common>', vb = '#include <begin_vertex>', fc = '#include <common>', fm = '#include <map_fragment>';
          if (!shader.vertexShader.includes(vc) || !shader.vertexShader.includes(vb) ||
            !shader.fragmentShader.includes(fc) || !shader.fragmentShader.includes(fm))
            throw Error('Three sky VHV batch shader contract changed');
          Object.assign(shader.uniforms, { sourceVhvLighting: { value: options.vhv!.lookup!.lighting } });
          shader.vertexShader = shader.vertexShader
            .replace(vc, vc + leafDecode)
            .replace(vb, vb + leafBody);
          shader.fragmentShader = shader.fragmentShader
            .replace(fc, fc + leafFragment)
            .replace(fm, fm + leafFragmentBody);
        };
        mergedMaterial.customProgramCacheKey = () => 'source-sky-batch-vhv-plain-r1';
        material = mergedMaterial;
      } else {
        material = sourceMaterial.clone();
        material.name = (sourceMaterial.name || 'sky material') + ' / original sky batched';
        // Three's Material.copy does not carry the shader callback or its cache key, and a sky
        // material's own injection (the two-texture layer's product) lives in exactly those.
        // The merged material samples the same maps, so it has to keep drawing the same branch.
        material.onBeforeCompile = sourceMaterial.onBeforeCompile;
        material.customProgramCacheKey = sourceMaterial.customProgramCacheKey;
      }
      geometry.setIndex(new T.BufferAttribute(indices, 1));
      geometry.computeBoundingSphere();
      const mesh = new T.Mesh(geometry, material);
      mesh.name = 'source_sky_batch_' + category;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.userData.sourceSkyBatch = true;
      // The olive owner disables frustum culling because wind displaces beyond
      // the static bounds; keep that contract for the merged leaves.
      mesh.frustumCulled = category !== 'olive';
      host.add(mesh);
      merged.push({ mesh, material });
      for (const candidate of list) {
        restored.push({ mesh: candidate.mesh, parent: candidate.mesh.parent! });
        candidate.mesh.removeFromParent();
      }
      categories[category]++;
      mergedVertices += totalVertices; mergedTriangles += totalIndices / 3;
      vertexBytes += totalVertices * (attributeNames.reduce((n, name) => n + firstGeometry.attributes[name].itemSize * (firstGeometry.attributes[name] as T.BufferAttribute).array.BYTES_PER_ELEMENT, 0) +
        // olive: leaf coord (8) + rest (12) + rows (12) + world columns (9).
        (category === 'olive' ? 41 : category === 'vhvPlain' ? 8 : 0));
      indexBytes += totalIndices * (totalVertices > 65535 ? 4 : 2);
    }
    if (merged.length) options.scene.add(host);
    const keptMeshes = skipped.length;
    // Every skipped mesh keeps its geometry and draw call; the merged meshes
    // carry exactly the triangles removed from the original scene copies.
    const keptTriangles = sceneTriangles - mergedTriangles;
    const audit: SourceSkyBatchAudit = {
      groups: merged.length, mergedMeshes: merged.length, sourceMeshes: restored.length,
      keptMeshes, keptTriangles, mergedTriangles, mergedVertices, vertexBytes, indexBytes,
      categories, skipped,
    };
    return { audit, dispose };
  } catch (error) { dispose(); throw error; }
}
