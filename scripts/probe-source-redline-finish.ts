import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createSourceRedlineFinishOwner, SOURCE_AK_FINISH_WEAPON } from "../game/source-redline-finish";
import { createSourceAkFinishResolver } from "../game/source-ak-finishes";
import { loadSourceTViewmodel } from "../game/source-t-viewmodel";
import { createSourceWorldAKMaterial } from "../game/source-character-materials";

/** Real WebGL owner integration review with original FP and world AK geometry.
 * Private probe only: neutral diagnostic lighting is not original client parity. */
export async function probeSourceRedlineFinish(
  inputBaseURL = "/assets/source-exports/ak47-redline-inputs/",
  assetBase = "/source/csgo-12426148/",
) {
  const owner = await createSourceRedlineFinishOwner({ inputBaseURL,
    patternBaseURL: assetBase + "ak-patterns/", weapon: SOURCE_AK_FINISH_WEAPON,
    resolve: createSourceAkFinishResolver({ catalogueBaseURL: assetBase + "skins/",
      patternBaseURL: assetBase + "ak-patterns/" }) });
  const loader = new GLTFLoader(), textures = new T.TextureLoader();
  const [fpOwner, worldGLTF, base, exponent] = await Promise.all([
    loadSourceTViewmodel({ baseUrl: assetBase + "ak47-draw" }),
    loader.loadAsync(assetBase + "character-ak/tm_leet_ak47-sdk-poses-basecolor-reference.glb"),
    textures.loadAsync(assetBase + "ak47/textures/ak47-rgba.png"),
    textures.loadAsync(assetBase + "ak47/textures/ak47_exponent-rgba.png"),
  ]);
  base.colorSpace = T.SRGBColorSpace; base.flipY = false;
  exponent.colorSpace = T.NoColorSpace; exponent.flipY = false;
  const fp = fpOwner.createViewmodel();
  const world = worldGLTF.scene, worldMaterial = createSourceWorldAKMaterial({ base, exponent });
  world.traverse((object) => {
    if (object instanceof T.Mesh) {
      const replace = (material: T.Material) => material.name === "ak47" ? worldMaterial.material : material;
      object.material = Array.isArray(object.material) ? object.material.map(replace) : replace(object.material);
    }
  });
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1000, 360); renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.setClearColor(0x222832);
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(35, 1000 / 360, .001, 10000);
  scene.add(new T.HemisphereLight(0xffffff, 0x485164, 2));
  const key = new T.DirectionalLight(0xffffff, 2.5); scene.add(key);
  const defaults = new Map<T.Mesh, T.Material | T.Material[]>();
  for (const root of [fp, world]) root.traverse((object) => {
    if (object instanceof T.Mesh) defaults.set(object, object.material);
  });
  const ak = (root: T.Object3D) => {
    const matches: T.Mesh[] = [];
    root.traverse((object) => {
      if (object instanceof T.Mesh && (Array.isArray(object.material) ? object.material : [object.material])
        .some((m) => m.name === "Source_AK47_VertexLitGeneric")) matches.push(object);
    });
    if (!matches.length) throw Error("Probe original AK identity missing: " + root.name);
    return matches;
  };
  const material = (root: T.Object3D) => {
    const m = ak(root)[0].material;
    return (Array.isArray(m) ? m : [m]).find((m) => m.name === "Source_AK47_VertexLitGeneric")!;
  };
  const defaultFP = material(fp), defaultWorld = material(world);
  document.body.replaceChildren();
  document.body.style.cssText = "margin:0;padding:20px;background:#161a22;color:#edf2fc;font:16px sans-serif";
  const title = document.createElement("h1"); title.textContent = "Redline 候选 · 颜色 1024 / 指数 256 · FP / world";
  const note = document.createElement("p");
  note.textContent = "原 style7 + 原 seed 参数链候选；直 RGBA 颜色/指数；有界 Source Phong，中性诊断光。尚未完成原客户端最终画面对照。";
  document.body.appendChild(title); document.body.appendChild(note);
  const shots: string[] = [];
  function show(root: T.Object3D, label: string) {
    scene.add(root); root.updateMatrixWorld(true);
    const bounds = new T.Box3(); for (const mesh of ak(root)) bounds.union(new T.Box3().setFromObject(mesh));
    const center = bounds.getCenter(new T.Vector3()), size = bounds.getSize(new T.Vector3());
    const extent = Math.max(size.x, size.y, size.z);
    // Side inspection of the sampled original poses, including their root yaw.
    const direction = new T.Vector3(1.25, .3, .05);
    camera.position.copy(center).addScaledVector(direction, extent);
    camera.lookAt(center); key.position.copy(camera.position); key.target.position.copy(center);
    scene.add(key.target); renderer.render(scene, camera);
    const heading = document.createElement("h2"); heading.textContent = label;
    const image = document.createElement("img"); image.width = 1000; image.height = 360;
    image.style.maxWidth = "100%"; image.src = renderer.domElement.toDataURL("image/png");
    document.body.appendChild(heading); document.body.appendChild(image); shots.push(label); scene.remove(root);
  }
  try {
    show(fp, "默认 · 第一人称原 AK / 手臂");
    show(world, "默认 · 世界 AK / 人物");
    const beforeTextures = renderer.info.memory.textures;
    const started = performance.now();
    const selection = { weapon: "vandal", paintKitId: 282, seed: 422, wear: .4 } as const;
    await Promise.all([owner.apply(fp, selection), owner.apply(world, selection)]);
    const composeMilliseconds = performance.now() - started;
    if (material(fp) !== material(world)) throw Error("FP/world did not share material");
    const evidence = material(fp).userData.sourceFinishEvidence;
    const unchanged = [...defaults].filter(([, value]) => (Array.isArray(value) ? value : [value])
      .every((m) => m.name !== "Source_AK47_VertexLitGeneric"));
    if (unchanged.some(([mesh, value]) => mesh.material !== value)) throw Error("Owner changed non-AK materials");
    show(fp, "Redline · seed 422 · wear 0.4 · 第一人称");
    show(world, "Redline · seed 422 · wear 0.4 · 世界枪");
    const activeTextures = renderer.info.memory.textures;
    const stale = owner.apply(fp, { ...selection, seed: 0 });
    await owner.apply(fp, null); await stale;
    if (material(fp) !== defaultFP || material(world) === defaultWorld) throw Error("Per-root restore failed");
    owner.releaseRoot(world); show(world, "恢复默认 · 世界 AK");
    if (material(world) !== defaultWorld) throw Error("World restore failed");
    const releasedTextures = renderer.info.memory.textures;
    return { status: "original_redline_finish_owner_gpu_verified_candidate", evidence,
      composeMilliseconds, sharedFPWorld: true, nonAKMaterialsUnchanged: unchanged.length,
      restoredDefaultFP: true, restoredDefaultWorld: true, staleRequestSuppressed: true,
      textures: { beforeTextures, activeTextures, releasedTextures }, shots,
      render: "bounded createSourceAKMaterial Phong, neutral diagnostic lights" };
  } finally {
    owner.dispose(); fpOwner.dispose(); worldMaterial.dispose();
    base.dispose(); exponent.dispose(); renderer.dispose(); renderer.forceContextLoss();
    // Probe-local GLTF objects can now release their otherwise borrowed defaults.
    const originalMaterials = new Set<T.Material>();
    world.traverse((object) => { if (object instanceof T.Mesh)
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) originalMaterials.add(m); });
    originalMaterials.delete(defaultWorld);
    for (const m of originalMaterials) m.dispose();
    world.traverse((object) => {
      if (object instanceof T.Mesh) object.geometry.dispose();
    });
  }
}
