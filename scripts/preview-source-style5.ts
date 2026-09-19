/** Real WebGL acceptance using the gameplay compositor, finish owner and original AWP loaders. */
import * as T from 'three';
import { createSourceRedlineCompositor, sourcePaletteRegisters, type SourceRedlineTransform } from '../game/source-redline-compositor';
import { createSourceRedlineFinishOwner } from '../game/source-redline-finish';
import { createSourceAkFinishResolver } from '../game/source-ak-finishes';
import { createSourceKitFinishResolver, sourceKitFinishWeapon } from '../game/source-kit-finishes';
import { sourceRedlineSkinParameters } from '../game/source-redline-seed';
import { SOURCE_REDLINE_PHONG_MATERIAL_PARAMETERS, sourceRedlineWearMaterialValue } from '../game/source-redline-parameters';
import { SOURCE_REDLINE_FINISH_SIZES } from '../game/source-redline-render-contract';
import { loadSourceAWPViewmodel } from '../game/source-awp-viewmodel';
import { loadSourceAWPWorld } from '../game/source-awp-world';
import { sourceSha256 } from '../game/source-sha256';
import type { SourceWeaponFinish } from '../game/source-weapon-finish';

const status = document.querySelector('#status') as HTMLElement;
const gallery = document.querySelector('#gallery') as HTMLElement;
const ownerGallery = document.querySelector('#owner') as HTMLElement;
const details = document.querySelector('#details') as HTMLElement;
const base = '/source/csgo-12426148/';
const errors: string[] = [];
const rows: Record<string, unknown>[] = [];
const ownerRows: Record<string, unknown>[] = [];
const proof: Record<string, unknown> = { format: 'source-style5-browser-proof-v1', status: 'running',
  startedAt: new Date().toISOString(), userAgent: navigator.userAgent, rows, ownerRows, errors,
  boundary: 'Original native parameter/program evidence plus real browser GPU composition and AWP FP/world material binding. No full original-client GPU, network or game-feel acceptance is implied.' };
const globals = window as unknown as { __STYLE5_PROOF__: typeof proof };
globals.__STYLE5_PROOF__ = proof;
window.addEventListener('error', event => errors.push(String(event.error ?? event.message)));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
const refresh = (message: string) => { status.textContent = message; details.textContent = JSON.stringify(proof, null, 2); };
type Compositor = Awaited<ReturnType<typeof createSourceRedlineCompositor>>;
type Composition = Awaited<ReturnType<Compositor['compose']>>;
type Native = { cases: { weapon: string; paintKitId: number;
  laterCompositeScalarArguments: Record<string, { hostParsedFloat32: number }>;
  materialAfterBranch: Record<string, string | number>;
  selectors: Record<'color' | 'exponent', { static: number }> }[] };

function stats(rgba: Uint8Array) {
  let alphaNonzero = 0, rgbNonzero = 0, alphaMin = 255, alphaMax = 0;
  const min = [255, 255, 255], max = [0, 0, 0];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 0) alphaNonzero++;
    if (rgba[i] || rgba[i + 1] || rgba[i + 2]) rgbNonzero++;
    alphaMin = Math.min(alphaMin, rgba[i + 3]); alphaMax = Math.max(alphaMax, rgba[i + 3]);
    for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], rgba[i + c]); max[c] = Math.max(max[c], rgba[i + c]); }
  }
  return { pixels: rgba.length / 4, rgbNonzero, alphaNonzero, alphaMin, alphaMax, min, max,
    nonUniform: max.some((value, i) => value !== min[i]) };
}
function drawMaps(title: string, output: Composition, label: unknown) {
  const card = document.createElement('article'), heading = document.createElement('h2');
  heading.textContent = title; card.appendChild(heading);
  const maps = document.createElement('div'); maps.className = 'maps';
  for (const pass of ['color', 'exponent'] as const) {
    const canvas = document.createElement('canvas'), { size, rgba } = output[pass];
    canvas.width = canvas.height = size; canvas.dataset.pass = pass;
    const ctx = canvas.getContext('2d')!;
    const data = ctx.createImageData(size, size); data.data.set(rgba);
    // Display alpha as opaque without changing the compositor's raw bytes or hashes.
    for (let i = 3; i < data.data.length; i += 4) data.data[i] = 255;
    ctx.putImageData(data, 0, 0); maps.appendChild(canvas);
  }
  const text = document.createElement('pre'); text.textContent = JSON.stringify(label, null, 1);
  card.appendChild(maps); card.appendChild(text); gallery.appendChild(card);
}

async function compositions(native: Native) {
  const staged = (weapon: string) => createSourceKitFinishResolver({ weapon,
    catalogueBaseURL: base + 'skins/', kitBaseURL: base + 'kit-inputs-fidelity-20260913/' });
  const plans = [{ weapon: 'weapon_m4a1', ids: [780] }, { weapon: 'weapon_awp', ids: [51, 395] },
    { weapon: 'weapon_glock', ids: [48, 1119, 1120, 1121, 1122, 1123] }, { weapon: 'weapon_deagle', ids: [425] }];
  for (const plan of plans) {
    const resolver = staged(plan.weapon), contexts = new Map<string, Compositor>();
    try {
      for (const paintKitId of plan.ids) {
        refresh(`正在实际 GPU 合成 ${plan.weapon} #${paintKitId}（${rows.length}/10）`);
        const finish = await resolver.resolve(paintKitId), kit = finish.kit;
        const parameters = sourceRedlineSkinParameters({ paintKitId, seed: 422,
          wear: (kit.wearMinimum + kit.wearMaximum) / 2 }, kit, finish.phong);
        const key = `${kit.style}:${parameters.phongAlbedoFactor < 1}`;
        let compositor = contexts.get(key);
        if (!compositor) {
          compositor = await createSourceRedlineCompositor({ inputBaseURL: base + `kit-inputs-fidelity-20260913/${plan.weapon}/`,
            patternBaseURL: base + `kit-inputs-fidelity-20260913/${plan.weapon}/`, weaponInputs: finish.inputs,
            style: kit.style, phongAlbedoFactor: parameters.phongAlbedoFactor });
          contexts.set(key, compositor);
        }
        if (sourcePaletteRegisters(kit.style, parameters.phongAlbedoFactor).length) compositor.setPalette(kit.colours);
        if (finish.pattern) await compositor.setPattern(finish.pattern);
        const out = await compositor.compose(parameters, SOURCE_REDLINE_FINISH_SIZES.color, SOURCE_REDLINE_FINISH_SIZES.exponent);
        const expected = native.cases.find(row => row.weapon === plan.weapon && row.paintKitId === paintKitId);
        check(expected, `Native case missing: ${plan.weapon}:${paintKitId}`);
        for (const field of ['phongExponent', 'phongIntensity', 'phongAlbedoFactor'] as const)
          check(parameters[field] === expected.laterCompositeScalarArguments[field].hostParsedFloat32, `Native scalar mismatch: ${field}`);
        const selection = compositor.audit.shaderSelection;
        check(selection.colorStatic === expected.selectors.color.static && selection.exponentStatic === expected.selectors.exponent.static,
          `Original shader selector mismatch: ${paintKitId}`);
        const color = stats(out.color.rgba), exponent = stats(out.exponent.rgba);
        check(color.rgbNonzero > 0 && color.nonUniform && exponent.rgbNonzero > 0 && exponent.nonUniform, 'Empty or uniform GPU map');
        const row = { weapon: plan.weapon, paintKitId, style: kit.style, seed: 422, wear: parameters.wear,
          shaderSelection: selection, phongIntensity: parameters.phongIntensity, phongAlbedoFactor: parameters.phongAlbedoFactor,
          materialPhong: parameters.materialPhong, colorHash: out.color.sha256, exponentHash: out.exponent.sha256,
          colorSize: out.color.size, exponentSize: out.exponent.size, color, exponent,
          originalPNGChecksumsVerified: compositor.audit.originalPNGChecksumsVerified,
          originalDecodedGPUChecksumsVerified: compositor.audit.originalDecodedGPUChecksumsVerified,
          patternSource: finish.pattern?.sourceMaterial, nativeParametersMatch: true };
        rows.push(row); drawMaps(`${plan.weapon.replace('weapon_', '')} #${paintKitId}`, out, row);
      }
    } finally { for (const compositor of contexts.values()) compositor.dispose(); }
  }
  check(rows.length === 10, 'Expected ten style-5 compositions');
  check(new Set(rows.map(row => row.colorHash)).size === 10, 'Different original finishes collided');
  proof.style5ColorMapsDistinct = true;

  const ak = createSourceAkFinishResolver({ catalogueBaseURL: base + 'skins/', patternBaseURL: base + 'ak-patterns/' });
  const finish = await ak.resolve(282);
  const compositor = await createSourceRedlineCompositor({ inputBaseURL: base + 'redline-inputs/',
    patternBaseURL: base + 'ak-patterns/', style: 7, phongAlbedoFactor: 35 });
  try {
    if (finish.pattern) await compositor.setPattern(finish.pattern);
    const parameters = sourceRedlineSkinParameters({ paintKitId: 282, seed: 422, wear: .4 }, finish.kit);
    const control = await fetch('/redline-control.json').then(response => response.json()) as {
      sourceSha256: string; matrices: Record<string, { nativeMatrix: number[] }> };
    const matrix = (name: string) => [control.matrices[name].nativeMatrix.slice(0, 4),
      control.matrices[name].nativeMatrix.slice(4, 8)] as unknown as SourceRedlineTransform;
    const reference = { ...SOURCE_REDLINE_PHONG_MATERIAL_PARAMETERS, wear: sourceRedlineWearMaterialValue(.4),
      pattern: matrix('pattern'), wearTransform: matrix('wear'), grunge: matrix('grunge') };
    const out = await compositor.compose(parameters, 1024, 256);
    const originalControl = await compositor.compose(reference, 1024, 256);
    check(out.color.sha256 === originalControl.color.sha256 && out.exponent.sha256 === originalControl.exponent.sha256,
      'Original style-7 identity changed');
    proof.style7Identity = { passed: true, seed: 422, wear: .4, nativeMatrixReceiptSHA256: control.sourceSha256,
      shaderSelection: compositor.audit.shaderSelection, colorHash: out.color.sha256, exponentHash: out.exponent.sha256,
      independentNativeMatrixControl: true, color: stats(out.color.rgba), exponent: stats(out.exponent.rgba) };
    drawMaps('AK-47 #282 · 原 style 7 对照', out, proof.style7Identity);
  } finally { compositor.dispose(); }
}

async function awpOwner() {
  refresh('正在加载原 AWP 第一人称与世界模型，检查同一对象换装…');
  const fpAssets = await loadSourceAWPViewmodel({ team: 'ct' });
  let worldAssets: Awaited<ReturnType<typeof loadSourceAWPWorld>> | undefined;
  let owner: Awaited<ReturnType<typeof createSourceRedlineFinishOwner>> | undefined;
  let renderer: T.WebGLRenderer | undefined;
  try {
    worldAssets = await loadSourceAWPWorld();
    const resolver = createSourceKitFinishResolver({ weapon: 'weapon_awp', catalogueBaseURL: base + 'skins/', kitBaseURL: base + 'kit-inputs-fidelity-20260913/' });
    const seed = await resolver.resolve(51), weapon = sourceKitFinishWeapon('awp', seed.phong);
    check(weapon, 'AWP gameplay finish spec missing');
    owner = await createSourceRedlineFinishOwner({ inputBaseURL: base + 'kit-inputs-fidelity-20260913/weapon_awp/',
      patternBaseURL: base + 'kit-inputs-fidelity-20260913/weapon_awp/', weaponInputs: seed.inputs, weapon, resolve: resolver });
    const fp = fpAssets.createViewmodel(), world = worldAssets.createWorldModel();
    const roots = [fp, world];
    const originals = roots.map(root => {
      const rows: { mesh: T.Mesh; material: T.Material | T.Material[] }[] = [];
      root.traverse(object => { if (object instanceof T.Mesh) rows.push({ mesh: object, material: object.material }); });
      return rows;
    });
    renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(840, 420); renderer.setPixelRatio(1); renderer.setClearColor(0x18242f);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.debug.onShaderError = (_gl, _program, vertex, fragment) => {
      errors.push(`Three shader failure: ${_gl.getShaderInfoLog(vertex)} ${_gl.getShaderInfoLog(fragment)}`);
    };
    const scene = new T.Scene(); scene.add(new T.HemisphereLight(0xdceeff, 0x554a3b, 2));
    const light = new T.DirectionalLight(0xfff3d6, 3); light.position.set(2, 4, 3); scene.add(light);
    const cameras = roots.map(root => {
      root.updateMatrixWorld(true);
      const bounds = new T.Box3().setFromObject(root), center = bounds.getCenter(new T.Vector3());
      const size = bounds.getSize(new T.Vector3()), extent = Math.max(size.x, size.y, size.z);
      check(extent > 0 && Number.isFinite(extent), 'Original AWP bounds invalid');
      const camera = new T.PerspectiveCamera(35, 2, .001, 100);
      camera.position.copy(center).add(new T.Vector3(extent * 1.1, extent * .3, extent * .75));
      camera.lookAt(center); camera.updateProjectionMatrix(); return camera;
    });
    const pixels = () => {
      const gl = renderer!.getContext(), data = new Uint8Array(840 * 420 * 4);
      gl.readPixels(0, 0, 840, 420, gl.RGBA, gl.UNSIGNED_BYTE, data);
      check(gl.getError() === gl.NO_ERROR, 'AWP framebuffer read failed'); return data;
    };
    renderer.render(scene, cameras[0]); const blankHash = await sourceSha256(pixels());
    const steps: { label: string; finish: SourceWeaponFinish | null }[] = [
      { label: '默认 · 前', finish: null },
      { label: '雷击 · factor = 1', finish: { weapon: 'awp', paintKitId: 51, seed: 422, wear: .04 } },
      { label: '无畏战神 · factor < 1', finish: { weapon: 'awp', paintKitId: 395, seed: 422, wear: .15 } },
      { label: '雷击 · 返回 factor = 1', finish: { weapon: 'awp', paintKitId: 51, seed: 422, wear: .04 } },
      { label: '默认 · 恢复', finish: null },
    ];
    for (const step of steps) {
      await Promise.all(roots.map(root => owner!.apply(root, step.finish)));
      const article = document.createElement('article'); article.className = 'owner-step';
      const title = document.createElement('h2'); title.textContent = step.label; article.appendChild(title);
      const views = document.createElement('div'); views.className = 'views'; article.appendChild(views); ownerGallery.appendChild(article);
      const captures = [];
      let sharedMaterial: T.Material | undefined;
      for (let index = 0; index < roots.length; index++) {
        const root = roots[index]; scene.add(root); renderer.render(scene, cameras[index]);
        const frameHash = await sourceSha256(pixels()); check(frameHash !== blankHash, 'Empty AWP render');
        const image = document.createElement('img'); image.src = renderer.domElement.toDataURL('image/png');
        image.alt = `${step.label} · ${index === 0 ? '第一人称原模型' : '原世界模型'}`;
        image.dataset.stage = String(ownerRows.length); image.dataset.model = index ? 'world' : 'fp'; views.appendChild(image);
        scene.remove(root);
        const eligible: T.Material[] = [];
        let unchangedOtherSlots = true;
        for (const saved of originals[index]) {
          const before = Array.isArray(saved.material) ? saved.material : [saved.material];
          const after = Array.isArray(saved.mesh.material) ? saved.mesh.material : [saved.mesh.material];
          check(before.length === after.length, 'Material slot layout changed');
          for (let i = 0; i < before.length; i++) {
            if (weapon.replaces.includes(before[i].name)) eligible.push(after[i]);
            else if (before[i] !== after[i]) unchangedOtherSlots = false;
          }
        }
        check(eligible.length > 0 && unchangedOtherSlots, 'AWP scope or arms were changed');
        const material = eligible[0];
        if (step.finish) {
          check(eligible.every(value => value === material), 'AWP body has inconsistent finish material');
          if (sharedMaterial) check(sharedMaterial === material, 'AWP FP/world did not share the owned finish');
          sharedMaterial = material;
          check(material.userData.sourceParameters.albedoBoost === (step.finish.paintKitId === 395 ? 60 : 40), 'AWP clone boost mismatch');
          const direct = rows.find(row => row.weapon === 'weapon_awp' && row.paintKitId === step.finish!.paintKitId);
          check(material.userData.sourceFinishEvidence.colorSHA256 === direct?.colorHash
            && material.userData.sourceFinishEvidence.exponentSHA256 === direct?.exponentHash,
          'AWP bound material differs from independently composed maps');
        } else check(originals[index].every(saved => saved.mesh.material === saved.material), 'Default material identity was not restored');
        captures.push({ model: index ? 'world' : 'fp', frameHash, renderCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles, eligibleSlots: eligible.length, unchangedOtherSlots,
          sourceParameters: material.userData.sourceParameters, finish: material.userData.sourceFinish ?? null,
          finishEvidence: material.userData.sourceFinishEvidence ?? null, defaultMaterialRestored: !step.finish });
      }
      ownerRows.push({ label: step.label, paintKitId: step.finish?.paintKitId ?? null, captures });
      refresh(`AWP 原模型换装已核对 ${ownerRows.length}/5`);
    }
    const capture = (row: number, model: number) => (ownerRows[row].captures as Record<string, unknown>[])[model];
    for (const model of [0, 1]) {
      check(capture(0, model).frameHash === capture(4, model).frameHash, 'Default AWP framebuffer changed after restore');
      check(capture(1, model).frameHash === capture(3, model).frameHash, 'Repeated AWP finish framebuffer changed');
      check(capture(1, model).frameHash !== capture(2, model).frameHash, 'AWP factor branches rendered identically');
    }
    proof.ownerTransitions = { passed: true, defaultRestored: true, repeatedLightningEqual: true,
      distinctLowFactorRendering: true, sameRootsThroughout: true, sameOwnerForFPAndWorld: true,
      originalFPHashVerified: fpAssets.hashVerified, originalWorldHashVerified: worldAssets.hashVerified };
  } finally {
    owner?.dispose(); fpAssets.dispose(); worldAssets?.dispose(); renderer?.dispose(); renderer?.forceContextLoss();
  }
}

async function main() {
  const response = await fetch('/native-evidence.json'); check(response.ok, 'Native evidence unavailable');
  const native = await response.json() as Native;
  await compositions(native); await awpOwner();
  check(errors.length === 0, 'Browser errors recorded');
  proof.status = 'passed'; proof.completedAt = new Date().toISOString();
  refresh('验收通过：10 张 Style 5、原 Style 7 对照、AWP 原模型换装与恢复。');
}
main().catch(error => {
  errors.push(String(error)); proof.status = 'failed'; refresh('验收失败：' + String(error));
}).finally(async () => {
  try {
    const response = await fetch('/evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proof) });
    check(response.ok, 'Evidence save failed'); proof.saved = (await response.json() as { saved: string }).saved;
  } catch (error) { proof.saveError = String(error); }
  details.textContent = JSON.stringify(proof, null, 2);
});
