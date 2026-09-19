import {
  sourceRedlineSkinParameters,
  type SourceRedlineSkinInput,
} from "../game/source-redline-seed";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createSourceRedlineCompositor,
  type SourceRedlineTransform,
} from "../game/source-redline-compositor";
import {
  SOURCE_REDLINE_PHONG_MATERIAL_PARAMETERS,
  sourceRedlineWearMaterialValue,
} from "../game/source-redline-parameters";

/** Review harness: explicit identity UVs, no claimed inventory seed. */
export async function probeSourceRedlineComposite(
  base = "/assets/source-exports/",
  selections?: SourceRedlineSkinInput[],
) {
  const compositor = await createSourceRedlineCompositor({
    inputBaseURL: base + "ak47-redline-inputs/",
  });
  const identity: SourceRedlineTransform = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ],
    rows = [];
  document.body.replaceChildren();
  document.body.style.cssText =
    "margin:0;padding:24px;background:#171a21;color:#eef3fc;font:16px sans-serif";
  const title = document.createElement("h1");
  title.textContent = selections
    ? "原 style7 GPU 合成候选 · 固定 seed 对照"
    : "原 style7 GPU 合成候选 · 明确 UV 参数";
  title.style.fontSize = "24px";
  document.body.appendChild(title);
  const note = document.createElement("p");
  note.textContent =
    "三组 UV 均为显式单位矩阵；未宣称对应原随机种子。左侧为颜色 RGB，右侧为指数 RGB；alpha 是反光数据而非透明度。枪体采用无光照底色诊断显示。";
  document.body.appendChild(note);
  if (selections)
    note.textContent =
      "原 client 随机顺序与矩阵运算；文本转换和 sincosf 使用宿主 ABI，最终原客户端输出尚未对照。左为颜色RGB，右为指数RGB；枪体无光照显示。";
  const model = await new GLTFLoader().loadAsync(base + "ak47/v_rif_ak47-source-unit.glb");
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1200, 430);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x242934);
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(35, 1200 / 430, 0.01, 10000);
  const group = model.scene;
  scene.add(group);
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group),
    center = bounds.getCenter(new THREE.Vector3()),
    size = bounds.getSize(new THREE.Vector3()),
    extent = Math.max(size.x, size.y, size.z);
  camera.position.copy(center).add(new THREE.Vector3(extent * 0.9, extent * 0.3, extent * 0.05));
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  const created: THREE.Material[] = [],
    maps: THREE.Texture[] = [];
  try {
    for (const selection of selections ?? [0.1, 0.4, 0.7].map((wear) => ({ wear }))) {
      const wear = selection.wear,
        seed = "seed" in selection ? selection.seed : undefined;
      const params =
        seed !== undefined
          ? sourceRedlineSkinParameters(selection as SourceRedlineSkinInput)
          : {
              ...SOURCE_REDLINE_PHONG_MATERIAL_PARAMETERS,
              wear: sourceRedlineWearMaterialValue(wear),
              pattern: identity,
              wearTransform: identity,
              grunge: identity,
            };
      const out = await compositor.compose(params, 1024),
        repeat = await compositor.compose(params, 1024);
      if (
        out.color.sha256 !== repeat.color.sha256 ||
        out.exponent.sha256 !== repeat.exponent.sha256
      )
        throw Error("Repeated original style7 candidate differs");
      const section = document.createElement("section"),
        label = document.createElement("h2");
      label.textContent =
        (seed === undefined ? "显式磨损参数 " : "seed " + seed + " · wear ") + wear;
      section.appendChild(label);
      document.body.appendChild(section);
      const make = (rgba: Uint8Array, pass: string) => {
        const c = document.createElement("canvas");
        c.width = c.height = out.size;
        c.style.width = c.style.height = "340px";
        c.dataset.pass = pass;
        c.dataset.wear = String(wear);
        const display = new Uint8ClampedArray(rgba);
        for (let i = 3; i < display.length; i += 4) display[i] = 255;
        c.getContext("2d")!.putImageData(new ImageData(display, out.size, out.size), 0, 0);
        section.appendChild(c);
        return c;
      };
      make(out.color.rgba, "color");
      make(out.exponent.rgba, "exponent");
      for (const pass of ["color", "exponent"] as const) {
        const blob = new Blob([new Uint8Array(out[pass].rgba)], {
          type: "application/octet-stream",
        });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `redline-${seed === undefined ? "identity" : "seed-" + seed}-wear-${wear}-${pass}.rgba8`;
        link.textContent = `下载 ${pass} 原通道 RGBA8`;
        link.dataset.export = "true";
        link.style.cssText = "display:inline-block;margin:12px;color:#9ccdff";
        section.appendChild(link);
      }
      const map = new THREE.DataTexture(out.color.rgba, out.size, out.size, THREE.RGBAFormat);
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;
      map.needsUpdate = true;
      maps.push(map);
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          const material = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide });
          object.material = material;
          created.push(material);
        }
      });
      renderer.render(scene, camera);
      const view = document.createElement("img");
      view.width = 1200;
      view.height = 430;
      view.style.maxWidth = "100%";
      view.src = renderer.domElement.toDataURL("image/png");
      view.dataset.wear = String(wear);
      view.dataset.pass = "model";
      section.appendChild(view);
      rows.push({
        ...(seed === undefined
          ? {}
          : {
              seed,
              parameterEvidence: (params as ReturnType<typeof sourceRedlineSkinParameters>)
                .parameterEvidence,
            }),
        wear: out.parameters.wear,
        size: out.size,
        colorSha256: out.color.sha256,
        exponentSha256: out.exponent.sha256,
        repeatedEqual: true,
      });
    }
    if (
      new Set(rows.map((r) => r.colorSha256)).size !== (selections?.length ?? 3) ||
      new Set(rows.map((r) => r.exponentSha256)).size !== (selections?.length ?? 3)
    )
      throw Error("Original style7 wear does not affect both output passes");
    compositor.dispose();
    let disposedRejects = false;
    try {
      await compositor.compose(
        {
          ...SOURCE_REDLINE_PHONG_MATERIAL_PARAMETERS,
          wear: 0.2,
          pattern: identity,
          wearTransform: identity,
          grunge: identity,
        },
        1,
      );
    } catch {
      disposedRejects = true;
    }
    if (!disposedRejects) throw Error("Disposed compositor accepts draw");
    return {
      status: selections
        ? "deterministic_original_style7_seed_candidate_rendered"
        : "deterministic_original_style7_candidate_rendered",
      matrixPreset: selections
        ? "original seed fields and matrix arithmetic; host sincosf/text ABI"
        : "explicit identity for all three transforms, not a seed",
      rows,
      audit: compositor.audit,
      disposedRejects,
      modelBounds: { size: size.toArray(), center: center.toArray() },
      modelPreview:
        "Original AK geometry with unlit composite base color; not original lighting or final skin acceptance",
    };
  } finally {
    compositor.dispose();
    for (const t of maps) t.dispose();
    for (const m of created) m.dispose();
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
