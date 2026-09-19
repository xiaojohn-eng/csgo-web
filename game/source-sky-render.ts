import * as T from 'three';
import { querySourceSkyView, type PreparedSourceSky, type SourceSkyUnlitProgram, type SourceSkyView } from './source-sky';
import { sourceTextureScrollFor, sourceTextureScrollOffsets, type SourceTextureScrollBlock } from './source-texture-scroll';

type IndexArray = Uint8Array | Uint16Array | Uint32Array;
type MaterialWithMap = T.Material & { map?: T.Texture | null; color?: T.Color };
/** One material whose own `texturescroll` block this build applies: the texture whose
 * transform it drives, the block itself and where it came from. */
type SourceSkyScroll = { source: string; block: SourceTextureScrollBlock; texture: T.Texture };
/** A staged second texture a two-texture sky material draws, matched to the material by the
 * file name its descriptor names. The caller owns the texture; this owner only samples it. */
export type SourceSkySecondTextureBinding = { file: string; texture: T.Texture };
/** What the sky backdrop's TextureScroll currently reads, for the audit: the clock it was
 * evaluated at as well, so the transform can be checked against the measured law rather
 * than only looked at. */
export type SourceSkyScrollState = { source: string; variable: string; u: number; v: number;
  repeat: number; timeSeconds: number };
export type SourceSkyRenderView = SourceSkyView & { scroll: SourceSkyScrollState[];
  twoTexture: readonly SourceSkyTwoTextureLayer[] };
/** One two-texture layer this owner draws the original's product for. */
export type SourceSkyTwoTextureLayer = { source: string; secondTexture: string; file: string;
  alpha: number; program: SourceSkyUnlitProgram; lightScale: number };

const SECOND_TEXTURE_SAMPLER = 'sourceSkySecondTexture';
const LIGHT_SCALE_UNIFORM = 'sourceSkyLightScale';

/** The shipped program of a two-texture material multiplies its two textures and the material's
 * own modulation: `texture0 * texture1 * c1`, where the engine uploads `c1` from the material's
 * colour and alpha, and then scales the result's rgb by `c30` (`cLightScale`, the map's own
 * `light_environment._lightscaleHDR`; scripts/probe-source-cloud-layer-branch.py and
 * scripts/probe-source-environment.py). Three's map chunk already multiplies the base texture
 * into `diffuseColor`, which starts as the material's colour and opacity - exactly the
 * modulation - so the second sample is multiplied in right after it, and the light scale after
 * that: the same product, in the same order, with the alpha left alone as the program leaves
 * it. The second texture keeps its own transform (the material's `$texture2transform` is the
 * identity), so it is sampled at the mesh's own UVs, not the base texture's scrolled ones.
 */
function drawSourceSkySecondTexture(material: T.MeshBasicMaterial, texture: T.Texture,
  program: SourceSkyUnlitProgram, lightScale: number) {
  if (program.rgb !== 'texture0.rgb * texture1.rgb * c1.rgb' || program.alpha !== 'texture0.a * texture1.a * c1.a')
    throw Error('Source sky two-texture program is not the measured product');
  if (!Number.isFinite(lightScale) || lightScale <= 0)
    throw Error(`Source sky light scale must be a positive finite number, read ${lightScale}`);
  material.onBeforeCompile = shader => {
    const vertexCommon = '#include <common>', vertexUv = '#include <uv_vertex>';
    const fragmentCommon = '#include <common>', fragmentMap = '#include <map_fragment>';
    if (!shader.vertexShader.includes(vertexCommon) || !shader.vertexShader.includes(vertexUv) ||
      !shader.fragmentShader.includes(fragmentCommon) || !shader.fragmentShader.includes(fragmentMap))
      throw Error('Three sky two-texture shader contract changed');
    shader.uniforms[SECOND_TEXTURE_SAMPLER] = { value: texture };
    shader.uniforms[LIGHT_SCALE_UNIFORM] = { value: lightScale };
    shader.vertexShader = shader.vertexShader
      .replace(vertexCommon, vertexCommon + '\nvarying vec2 vSourceSkySecondUv;')
      .replace(vertexUv, vertexUv + '\n\tvSourceSkySecondUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(fragmentCommon, fragmentCommon
        + `\nvarying vec2 vSourceSkySecondUv;\nuniform sampler2D ${SECOND_TEXTURE_SAMPLER};\nuniform float ${LIGHT_SCALE_UNIFORM};`)
      .replace(fragmentMap, fragmentMap
        + `\n\tdiffuseColor *= texture2D( ${SECOND_TEXTURE_SAMPLER}, vSourceSkySecondUv );`
        + `\n\tdiffuseColor.rgb *= ${LIGHT_SCALE_UNIFORM};`);
  };
  material.customProgramCacheKey = () => 'source-sky-two-texture-r2';
  material.userData.sourceSecondTexture = texture.name;
  material.userData.sourceLightScale = lightScale;
}


/** Borrow the already-lit, original GLTF objects BEFORE main PVS filtering.
 * No reparenting or original geometry/material/visibility writes. The separate
 * scene contains full-transform static-prop clones and original world vertices
 * with sky-only indices. Caller draws this backdrop then clears depth before
 * drawing the main world, and excludes the returned IDs from EVERY main PVS
 * mode, including all-visible fallback. Dispose before the source GLTF owners.
 */
export function createSourceSkyRender(options: { world: T.Object3D; props: T.Object3D; sky: PreparedSourceSky;
  secondTextures?: readonly SourceSkySecondTextureBinding[]; lightScale?: number }) {
  const { sky } = options, scene = new T.Scene(), camera = new T.PerspectiveCamera();
  scene.name = 'Source_Original_3D_Sky'; camera.name = 'Source_Original_3D_Sky_Camera';
  const geometryOwners: T.BufferGeometry[] = [], materialOwners = new Map<T.Material, T.MeshBasicMaterial>();
  /** The scrolled textures are private clones: the borrowed original texture keeps its own
   * transform for whatever else shares it. */
  const scrolls: SourceSkyScroll[] = [], clonedTextures: T.Texture[] = [];
  /** Every two-texture layer this owner draws the product for, for the audit and for the
   * runtime check that the layer it says it draws is the one the descriptor measured. */
  const twoTexture: SourceSkyTwoTextureLayer[] = [];
  const bindings: { source: T.Object3D; copy: T.Object3D }[] = [];
  /** Sky-copy mesh -> original GLTF mesh it borrowed geometry/material from.
   * Batching adapters resolve per-mesh VHV/olive bindings through this map. */
  const meshOrigins = new Map<T.Mesh, T.Mesh>();
  const foundFaces = new Set<number>(), wantedFaces = new Set(sky.data.worldFaceIds), wantedProps = new Set(sky.data.staticPropIds);
  const unlit = new Map(sky.data.unlitMaterials.map(m => [m.source, m]));
  const foundUnlit = new Set<string>();
  let disposed = false, worldTriangles = 0, propTriangles = 0, propMeshes = 0;
  const dispose = () => {
    if (disposed) return; disposed = true;
    scene.clear(); scene.removeFromParent();
    for (const geometry of geometryOwners) {
      // Three's geometry dispose handler removes attribute GPU buffers too.
      // Detach borrowed attributes first so only our private index is freed.
      for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name);
      geometry.morphAttributes = {};
      geometry.dispose();
    }
    for (const material of materialOwners.values()) material.dispose();
    for (const texture of clonedTextures) texture.dispose();
    clonedTextures.length = 0; scrolls.length = 0;
    bindings.length = 0;
  };
  const skyMaterial = (original: MaterialWithMap) => {
    const path = original.userData.full_path ?? original.name, rule = unlit.get(path);
    if (!rule) return original;
    foundUnlit.add(path);
    const cached = materialOwners.get(original); if (cached) return cached;
    if (!original.map) throw Error('Original sky unlit base texture is missing: ' + path);
    // The material's own `texturescroll` block, if it has one, drives the base texture's
    // transform: the measured proxy scales both axes by `scale` and translates by the two
    // wrapped offsets (game/source-texture-scroll.ts). The shipped cloud textures carry no
    // CLAMPS/CLAMPT flag (VTF flags 0x2000 / 0x0), so the original addresses them by
    // repeating, which is what makes a tiling scale and a wrapped offset meaningful.
    const block = sourceTextureScrollFor(rule.scrolls ?? [], '$basetexturetransform');
    let map = original.map;
    if (block) {
      map = original.map.clone();
      map.wrapS = map.wrapT = T.RepeatWrapping;
      map.repeat.set(block.scale, block.scale);
      map.needsUpdate = true;
      clonedTextures.push(map);
      scrolls.push({ source: path, block, texture: map });
    }
    const material = new T.MeshBasicMaterial({ map, color: original.color ?? 0xffffff,
      side: original.side, opacity: rule.alpha, transparent: original.transparent || rule.alpha < 1,
      alphaTest: original.alphaTest, depthWrite: original.depthWrite, depthTest: original.depthTest,
      fog: !rule.noFog, toneMapped: original.toneMapped, blending: original.blending });
    material.name = path + ' / original unlit sky';
    material.userData = { sourceShader: rule.shader, sourceVmtSha256: rule.rawVmtSha256, limitations: rule.limitations.slice() };
    // A two-texture material draws the product its own program states, which needs the staged
    // copy of its second texture: the caller loaded and verified it, so a material without one
    // is a missing binding rather than something to draw anyway.
    if (rule.second && rule.program) {
      const binding = options.secondTextures?.find(row => row.file === rule.second!.file);
      if (!binding) throw Error('Original sky two-texture material has no staged second texture: ' + path);
      // The map's own light scale is what the program's trailing `c30` multiplies the rgb by.
      // A caller that does not state one cannot be drawn: guessing 1 would be a claim.
      const lightScale = options.lightScale;
      if (lightScale === undefined) throw Error('Original sky two-texture material was given no light scale: ' + path);
      drawSourceSkySecondTexture(material, binding.texture, rule.program, lightScale);
      twoTexture.push({ source: path, secondTexture: rule.second.texture, file: rule.second.file,
        alpha: rule.alpha, program: rule.program, lightScale });
    }
    materialOwners.set(original, material); return material;
  };
  try {
    options.world.traverse(object => {
      const mesh = object as T.Mesh;
      if (!mesh.isMesh) return;
      const original = mesh.geometry, index = original.index, face = original.getAttribute('uv2');
      if (!index || !face || !(index.array instanceof Uint8Array || index.array instanceof Uint16Array || index.array instanceof Uint32Array) ||
        index.count % 3 || face.count !== original.getAttribute('position')?.count)
        throw Error('Original sky world needs indexed triangles with complete Source face UV IDs');
      const from = original.drawRange.start, end = Math.min(index.count, from + original.drawRange.count);
      const segments = Array.isArray(mesh.material) ? original.groups : [{ start: from, count: end - from, materialIndex: 0 }];
      const selected: number[] = [], groups: { start: number; count: number; materialIndex: number }[] = [];
      for (const group of segments) {
        if (group.start % 3 || group.count % 3 || group.start < 0 || group.count < 0 || group.start + group.count > index.count)
          throw Error('Invalid original sky world draw segment');
        const start = selected.length;
        for (let i = Math.max(group.start, from), stop = Math.min(group.start + group.count, end); i < stop; i += 3) {
          const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2), id = face.getX(a);
          if (!Number.isSafeInteger(id) || face.getX(b) !== id || face.getX(c) !== id)
            throw Error('Original sky world triangle has mixed or unknown face IDs');
          if (!wantedFaces.has(id)) continue;
          foundFaces.add(id); selected.push(a, b, c);
        }
        if (selected.length > start) groups.push({ start, count: selected.length - start, materialIndex: group.materialIndex ?? 0 });
      }
      if (!selected.length) return;
      const geometry = new T.BufferGeometry(); geometryOwners.push(geometry);
      geometry.name = original.name + ' / sky indices';
      for (const [name, attribute] of Object.entries(original.attributes)) geometry.setAttribute(name, attribute);
      const Constructor = index.array.constructor as typeof Uint32Array;
      geometry.setIndex(new T.BufferAttribute(new Constructor(selected) as IndexArray, 1));
      geometry.groups = groups; geometry.setDrawRange(0, selected.length);
      geometry.boundingBox = original.boundingBox; geometry.boundingSphere = original.boundingSphere;
      const copy = mesh.clone(false); copy.geometry = geometry; copy.matrixAutoUpdate = false;
      copy.onBeforeRender = mesh.onBeforeRender; copy.onAfterRender = mesh.onAfterRender;
      meshOrigins.set(copy, mesh);
      bindings.push({ source: mesh, copy }); scene.add(copy); worldTriangles += selected.length / 3;
    });
    if (foundFaces.size !== wantedFaces.size) throw Error('Original sky world face coverage is incomplete; create before PVS filtering');
    const props = new Map<number, T.Object3D>();
    options.props.traverse(object => {
      const match = /^static_prop_(\d+)$/.exec(object.name);
      if (!match || !wantedProps.has(Number(match[1]))) return;
      const id = Number(match[1]);
      if (props.has(id) || typeof object.userData.sourceModel !== 'string') throw Error('Original sky prop identity is duplicated or missing');
      props.set(id, object);
    });
    if (props.size !== wantedProps.size) throw Error('Original sky static prop coverage is incomplete');
    for (const id of sky.data.staticPropIds) {
      const source = props.get(id)!, copy = source.clone(true); copy.matrixAutoUpdate = false;
      let triangles = 0;
      const originals: T.Object3D[] = [], copies: T.Object3D[] = [];
      source.traverse(o => originals.push(o)); copy.traverse(o => copies.push(o));
      for (let i = 0; i < copies.length; i++) {
        const mesh = copies[i] as T.Mesh, original = originals[i] as T.Mesh;
        // Object3D.clone does not copy render callbacks. Preserve caller hooks
        // without cloning materials and losing their original VHV shader hooks.
        mesh.onBeforeRender = original.onBeforeRender; mesh.onAfterRender = original.onAfterRender;
        if (!mesh.isMesh) continue;
        if ((mesh as T.SkinnedMesh).isSkinnedMesh || (mesh as T.InstancedMesh).isInstancedMesh)
          throw Error('Original sky prop requires a static mesh');
        mesh.material = Array.isArray(original.material) ? original.material.map(skyMaterial) : skyMaterial(original.material);
        meshOrigins.set(mesh, original as T.Mesh);
        triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3; propMeshes++;
      }
      if (!triangles) throw Error('Original sky prop has no real geometry: ' + id);
      bindings.push({ source, copy }); scene.add(copy); propTriangles += triangles;
    }
    if (foundUnlit.size !== unlit.size) throw Error('Original sky unlit material identity is incomplete');
    const position = new T.Vector3(), quaternion = new T.Quaternion();
    const syncTransforms = () => {
      for (const binding of bindings) {
        binding.source.updateWorldMatrix(true, false);
        binding.copy.matrix.copy(binding.source.matrixWorld); binding.copy.matrixWorldNeedsUpdate = true;
      }
    };
    syncTransforms(); scene.updateMatrixWorld(true);
    // Every two-texture material the descriptor declares must be drawing its product, or this
    // owner did not reach the material it said it would.
    const declaredTwoTexture = sky.data.unlitMaterials.filter(rule => rule.second !== null).length;
    if (twoTexture.length !== declaredTwoTexture)
      throw Error('Original sky two-texture layer coverage is incomplete');
    const twoTextureAudit: SourceSkyTwoTextureLayer[] = twoTexture.slice();
    // `twoTexture` and `secondTextures` are what this owner draws with, for the audit and for
    // inspection: the layer it applies the measured product to, and the textures it samples.
    return {
      scene, camera, meshOrigins, excludedWorldFaceIds: sky.data.worldFaceIds, excludedStaticPropIds: sky.data.staticPropIds,
      twoTexture: twoTexture.slice(), secondTextures: options.secondTextures ?? [],
      stats: { worldMeshes: geometryOwners.length, worldTriangles, staticProps: props.size, propMeshes, propTriangles,
        ownedGeometries: geometryOwners.length, ownedMaterials: materialOwners.size, ownedTextures: 0,
        limitations: ['The sky materials carry the scene\'s own fog state; the map\'s `$nofog 1` domes stay '
            + 'out of it, which is what the original states for them.',
          'The two-texture layer draws its own program\'s product (texture0 * texture1 * the material '
            + 'modulation, then rgb * cLightScale from the map\'s own light_environment, '
            + 'scripts/probe-source-cloud-layer-branch.py and scripts/probe-source-environment.py) over its own '
            + 'base-texture TextureScroll transform.',
          'Other props retain the caller supplied materials and original VHV lighting coverage.'] },
      update(mainCamera: T.PerspectiveCamera, timeSeconds = 0): SourceSkyRenderView {
        if (disposed) throw Error('Source sky renderer was disposed');
        if (!Number.isFinite(timeSeconds)) throw Error('Source sky scroll clock must be finite');
        mainCamera.getWorldPosition(position); const view = querySourceSkyView(sky, position);
        camera.copy(mainCamera, false); camera.parent = null; camera.matrixAutoUpdate = true;
        camera.position.set(view.position.x, view.position.y, view.position.z);
        mainCamera.getWorldQuaternion(quaternion); camera.quaternion.copy(quaternion); camera.scale.set(1, 1, 1);
        camera.near = view.near; camera.far = view.far; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        // sky_camera has its own scaled range and .6 density cap. Reusing the
        // main scene's .4 cap loses atmospheric depth on the miniature scenery.
        // The two $nofog domes already opt out through their material flags.
        const skyFog=sky.data.camera.fog;
        if(view.fog.enabled){
          const direction=new T.Vector3(...skyFog.sourceDirection);
          direction.set(direction.x,direction.z,-direction.y).normalize();
          const facing=skyFog.blend?(camera.getWorldDirection(new T.Vector3()).dot(direction)+1)*.5:0;
          const color=new T.Color().setRGB(...skyFog.color.map((v,i)=>(v+(skyFog.color2[i]-v)*facing)/255) as [number,number,number],T.SRGBColorSpace);
          color.multiplyScalar(skyFog.hdrColorScale);
          // Negative fogstart is valid in the BSP (-9 units on Dust2).
          const fog=scene.fog instanceof T.Fog?scene.fog:new T.Fog(color,view.fog.start,view.fog.end);
          fog.color.copy(color);fog.near=view.fog.start;fog.far=view.fog.end;scene.fog=fog;
          scene.userData.sourceFogMaxDensity=view.fog.maxDensity;
        }else{scene.fog=null;delete scene.userData.sourceFogMaxDensity;}
        // The original proxy writes this transform when the material binds; advancing the same
        // measured formula from the game clock keeps both endpoints drifting identically
        // without sharing an absolute clock.
        const scroll: SourceSkyScrollState[] = [];
        for (const entry of scrolls) {
          const { u, v } = sourceTextureScrollOffsets(entry.block, timeSeconds);
          entry.texture.offset.set(u, v);
          scroll.push({ source: entry.source, variable: entry.block.variable, u, v,
            repeat: entry.block.scale, timeSeconds });
        }
        scene.visible = view.enabled; syncTransforms(); return { ...view, scroll, twoTexture: twoTextureAudit };
      }, dispose,
    };
  } catch (error) { dispose(); throw error; }
}
