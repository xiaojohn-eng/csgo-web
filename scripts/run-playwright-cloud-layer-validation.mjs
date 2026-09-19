#!/usr/bin/env node
// Dust2's cloud layer now draws the product its own shipped program states.
//
// The installed UnlitTwoTexture shader's translucent combo multiplies its two textures and the
// material's own modulation (`texture0 * texture1 * c1`, scripts/probe-source-cloud-layer-branch.py),
// and the port installs exactly that on the cloud dome. This run proves the *browser* computes it.
//
// In the live game, and on the cloud dome's own geometry, the same pixels are drawn four times:
// once with the material the dome is drawn with, once with each of its two textures alone, and
// once as a coverage probe. Every covered pixel of the dome's draw is then compared with the same
// product, that product being the two single-texture passes - which are the GPU's own samples of
// the two shipped textures - times the material's own colour and opacity. All four draws pin both
// samplers to nearest, use the linear output (no encode), and disable alpha test, culling and the
// depth test, so the comparison is a texel-for-texel one in the shader's own linear domain.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SOURCE_SKY_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const errors = [];
const sky = JSON.parse(readFileSync(resolve(root, 'public/source/csgo-12426148/dust2/sky.json'), 'utf8'));
const CLOUD = 'models/props/de_nuke/hr_nuke/nuke_skydome_001/nuke_clouds_002';
const staged = sky.unlitMaterials.find((m) => m.source === CLOUD);
if (!staged?.second || !staged.program) throw Error('The staged sky no longer carries the cloud layer\'s second texture');

/** Drawn in the live page against the cloud dome's own geometry and the material it is drawn with. */
const PASSES = `(async () => {
  const game = window.__BREACHLINE__ ? window.__BREACHLINE__.runtime() : null;
  const owner = game && game.art && game.art.sourceMap ? game.art.sourceMap.sky : null;
  if (!owner) return { error: 'the map has no sky owner' };
  const renderer = game.art.renderer, gl = renderer.getContext();
  let mesh = null, material = null;
  owner.scene.traverse((object) => {
    if (!object.isMesh) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const candidate of list)
      if (candidate && candidate.userData && candidate.userData.sourceSecondTexture) { mesh = object; material = candidate; }
  });
  if (!mesh || !material) return { error: 'the sky scene draws no two-texture material' };
  const binding = (owner.secondTextures || []).find((row) => row.texture) || null;
  if (!binding) return { error: 'the sky owner holds no second texture' };
  const second = binding.texture, base = material.map;
  // three's own enums: the live textures are linear-filtered to begin with, which is what makes
  // 1003 three's NearestFilter rather than an unrelated number.
  if (base.magFilter !== 1006 || base.minFilter !== 1008 || second.magFilter !== 1006) return { error: 'unexpected three filter enum' };
  if (base.colorSpace !== 'srgb' || second.colorSpace !== 'srgb') return { error: 'a cloud sampler is not read as sRGB' };
  const NEAREST = 1003;
  const clear = new (material.color.constructor)();
  renderer.getClearColor(clear);
  const viewport = game.art.camera.position.clone(), scissor = viewport.clone(), logical = viewport.clone();
  renderer.getViewport(viewport); renderer.getScissor(scissor); renderer.getSize(logical);
  const saved = {
    outputColorSpace: renderer.outputColorSpace, clear: clear.getHex(), clearAlpha: renderer.getClearAlpha(),
    transparent: material.transparent, depthWrite: material.depthWrite, depthTest: material.depthTest,
    toneMapped: material.toneMapped,
    side: material.side, alphaTest: material.alphaTest, opacity: material.opacity, color: material.color.getHex(),
    viewport: [viewport.x, viewport.y], scissor: [scissor.x, scissor.y], scissorTest: renderer.getScissorTest(),
    logical: [logical.x, logical.y],
    clippingPlanes: renderer.clippingPlanes ? renderer.clippingPlanes.slice() : null,
    base: { generateMipmaps: base.generateMipmaps, minFilter: base.minFilter, magFilter: base.magFilter,
      repeat: base.repeat.clone(), offset: base.offset.clone() },
    second: { generateMipmaps: second.generateMipmaps, minFilter: second.minFilter, magFilter: second.magFilter },
  };
  // The measurement quad wears the dome's own geometry, so the UVs it interpolates are the dome's
  // own and the samplers see the values the live dome's do. A sky dome is drawn from inside it, so
  // the copy is centred on the game's camera at the dome's own scale.
  const Mesh = mesh.constructor, Scene = owner.scene.constructor;
  const quad = new Mesh(mesh.geometry, material), scene = new Scene(); scene.add(quad);
  const camera = game.art.camera;
  if (!camera.isPerspectiveCamera || !camera.matrixWorld) return { error: 'the game camera is not usable' };
  camera.updateMatrixWorld(true);
  // The app drops each attribute's CPU array once it is uploaded, so the dome's own bounding
  // sphere - the one three computed for culling - is what is left to place the copy with.
  const sphere = mesh.geometry.boundingSphere;
  if (!sphere) return { error: 'the dome geometry has no bounding sphere' };
  const Vector = mesh.position.constructor;
  const centre = sphere.center, radius = sphere.radius;
  const placement = camera.matrixWorld.clone().multiply(camera.matrixWorld.clone().identity().compose(
    new Vector(-centre.x, -centre.y, -centre.z), new (camera.quaternion.constructor)(), new Vector(1, 1, 1)));
  quad.matrixAutoUpdate = false; quad.matrix.copy(placement);
  // An object whose matrix is set by hand keeps its stale world matrix until it is asked for one.
  quad.updateMatrixWorld(true);
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const signature = (bytes) => { let sum = 0, hash = 2166136261;
    for (let at = 0; at < bytes.length; at += 7) { sum += bytes[at]; hash = ((hash ^ bytes[at]) * 16777619) >>> 0; }
    return [sum, hash]; };
  const readback = () => { const bytes = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, bytes); return bytes; };
  const Plain = material.constructor;
  let comparison = null, baseOnly = null, secondOnly = null, probeMaterial = null;
  try {
    for (const texture of [base, second]) { texture.generateMipmaps = false; texture.minFilter = NEAREST; texture.magFilter = NEAREST; texture.needsUpdate = true; }
    // The material's own base-texture transform is not this comparison's subject: both passes
    // address the same UV, so the identity transform is what pairs them up.
    base.repeat.set(1, 1); base.offset.set(0, 0); base.needsUpdate = true;
    material.transparent = false; material.side = 2; material.alphaTest = 0;
    material.depthTest = false; material.depthWrite = false; material.needsUpdate = true;
    // The live renderer tone maps (ACES filmic), and the port keeps the material's own toneMapped
    // flag, so the installed material's output is a tone-mapped value while a reference pass drawn
    // without it is not. Comparing one against the other would compare two curves: this draw turns
    // tone mapping off for both sides, which is what makes the product the only difference.
    if (saved.toneMapping !== 0) material.toneMapped = false;
    if (saved.outputColorSpace !== 'srgb') return { error: 'unexpected output color space ' + saved.outputColorSpace };
    renderer.outputColorSpace = 'srgb-linear';
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, logical.x, logical.y);
    renderer.setScissor(0, 0, logical.x, logical.y);
    if (Array.isArray(renderer.clippingPlanes)) renderer.clippingPlanes = [];
    renderer.setClearColor(0x000000, 0);
    const Color = material.color.constructor;
    const common = { transparent: false, toneMapped: false, fog: false, side: 2, depthTest: false, depthWrite: false };
    baseOnly = new Plain({ ...common, map: base });
    secondOnly = new Plain({ ...common, map: second });
    probeMaterial = new Plain({ ...common, color: new Color(0xff0000) });
    const draw = (candidate) => {
      quad.material = candidate;
      renderer.resetState(); renderer.setRenderTarget(null);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      gl.finish();
      return readback();
    };
    // three only re-issues a texture binding it believes has changed, and this context has other
    // writers, so each pass is drawn once with the other texture bound to its units and then with
    // the real one: the measured draw is the one whose bindings were just issued.
    const drawPass = (candidate, realMap, otherMap) => {
      candidate.map = otherMap; draw(candidate);
      candidate.map = realMap; return draw(candidate);
    };
    const drawProduct = () => {
      const slot = (renderer.properties.get(material).uniforms || {}).sourceSkySecondTexture;
      if (!slot) return { error: 'the drawn material has no second sampler bound' };
      material.map = second; slot.value = base; draw(material);
      material.map = base; slot.value = second; return draw(material);
    };
    // three compiles programs asynchronously when the driver offers parallel compilation and skips
    // a draw until its program is ready: every material is drawn once, left to finish, then measured.
    for (const candidate of [material, baseOnly, secondOnly, probeMaterial]) draw(candidate);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const probe = draw(probeMaterial);
    const basePixels = drawPass(baseOnly, base, second);
    const secondPixels = drawPass(secondOnly, second, base);
    const drawn = drawProduct();
    if (drawn.error) return drawn;
    const modulation = [material.color.r, material.color.g, material.color.b, material.opacity];
    let covered = 0, samples = 0, edge = 0, exact = 0, within2 = 0, within3 = 0, worst = 0, worstAt = null, sum = 0;
    let alphaSum = 0, alphaWorst = 0;
    const rows = [];
    const lit = (at) => probe[at] || probe[at + 1] || probe[at + 2];
    for (let index = 0; index < probe.length; index += 4) {
      if (!lit(index)) continue;
      covered++;
      // The frame is antialiased, so a pixel on the dome's silhouette blends with the background:
      // only pixels whose four neighbours are inside the dome are compared.
      if (!lit(index - 4) || !lit(index + 4) || !lit(index - W * 4) || !lit(index + W * 4)) { edge++; continue; }
      // The two single-texture passes are the GPU's own samples of the two shipped textures, so
      // the expected value is their product with the material's colour and opacity - evaluated
      // here on the CPU, from those samples, in the same linear domain.
      const expected = [0, 1, 2].map((channel) =>
        modulation[channel] * (basePixels[index + channel] / 255) * (secondPixels[index + channel] / 255) * 255);
      const expectedAlpha = modulation[3] * (basePixels[index + 3] / 255) * (secondPixels[index + 3] / 255) * 255;
      // The colour channels are the comparison: this context's drawing buffer does not carry the
      // fragment's alpha (the probe, which is opaque, reads back as 255 too), so the alpha product
      // is not observable here and is reported rather than compared.
      const deviation = Math.max(...[0, 1, 2].map((channel) => Math.abs(drawn[index + channel] - expected[channel])));
      const alphaGap = Math.abs(drawn[index + 3] - expectedAlpha);
      samples++; sum += deviation; alphaSum += alphaGap;
      if (alphaGap > alphaWorst) alphaWorst = alphaGap;
      if (deviation === 0) exact++;
      if (deviation <= 2) within2++;
      if (deviation <= 3) within3++;
      if (deviation > worst) {
        worst = deviation;
        worstAt = { pixel: index / 4, x: (index / 4) % W, y: Math.floor(index / 4 / W),
          base: [...basePixels.slice(index, index + 4)], second: [...secondPixels.slice(index, index + 4)],
          drawn: [...drawn.slice(index, index + 4)],
          expected: [...expected.map((value) => +value.toFixed(2)), +expectedAlpha.toFixed(2)] };
      }
      if (rows.length < 3) rows.push({ x: (index / 4) % W, y: Math.floor(index / 4 / W),
        base: [...basePixels.slice(index, index + 4)], second: [...secondPixels.slice(index, index + 4)],
        expected: [...expected.map((value) => +value.toFixed(2)), +expectedAlpha.toFixed(2)],
        drawn: [...drawn.slice(index, index + 4)] });
    }
    comparison = { width: W, height: H, dome: { radius, centre: [centre.x, centre.y, centre.z],
      vertices: mesh.geometry.attributes.position.count, name: mesh.name },
      signatures: { probe: signature(probe), base: signature(basePixels), second: signature(secondPixels), drawn: signature(drawn) },
      modulation, coveredPixels: covered, silhouettePixels: edge, samples, exact, within2, within3, worst, worstAt,
      meanDeviation: samples ? sum / samples : null,
      alphaNotCompared: { worstGap: alphaWorst, meanGap: samples ? alphaSum / samples : null,
        reason: 'the drawing buffer does not carry the fragment alpha in this context' }, rows };
  } finally {
    for (const texture of [base, second]) {
      const key = texture === base ? saved.base : saved.second;
      texture.generateMipmaps = key.generateMipmaps; texture.minFilter = key.minFilter; texture.magFilter = key.magFilter;
      texture.needsUpdate = true;
    }
    base.repeat.copy(saved.base.repeat); base.offset.copy(saved.base.offset); base.needsUpdate = true;
    material.transparent = saved.transparent; material.side = saved.side; material.alphaTest = saved.alphaTest;
    material.opacity = saved.opacity; material.color.setHex(saved.color); material.toneMapped = saved.toneMapped;
    material.depthTest = saved.depthTest; material.depthWrite = saved.depthWrite; material.needsUpdate = true;
    renderer.outputColorSpace = saved.outputColorSpace; renderer.setRenderTarget(null);
    renderer.setScissorTest(saved.scissorTest);
    renderer.setViewport(saved.viewport[0], saved.viewport[1], saved.logical[0], saved.logical[1]);
    renderer.setScissor(saved.scissor[0], saved.scissor[1], saved.logical[0], saved.logical[1]);
    if (saved.clippingPlanes) renderer.clippingPlanes = saved.clippingPlanes;
    renderer.setClearColor(saved.clear, saved.clearAlpha);
    for (const candidate of [baseOnly, secondOnly, probeMaterial]) if (candidate) candidate.dispose();
    scene.clear();
  }
  return { material: material.name, secondTexture: material.userData.sourceSecondTexture,
    sampler: binding.file, layer: owner.twoTexture, comparison };
})()`;

const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base + '/?map=de_dust2');
  const start = page.getByRole('button', { name: /^开始人机训练/ });
  await start.waitFor({ state: 'visible', timeout: 120000 });
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('CloudLayer');
  await start.click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  // Aim at the sky, so the map's own 3D sky - and with it the cloud dome - is the drawn backdrop.
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove',
    { movementX: 0, movementY: -900, bubbles: true })));
  await page.waitForFunction(() => (window.__BREACHLINE__?.assetAudit?.()?.sourceSky?.twoTexture ?? []).length > 0,
    null, { timeout: 60000 });
  const audit = await page.evaluate(() => {
    const game = window.__BREACHLINE__.runtime();
    return { twoTexture: window.__BREACHLINE__.assetAudit().sourceSky.twoTexture,
      programs: (game.art.renderer.info.programs ?? []).map((program) => program.cacheKey ?? '') };
  });
  const layer = audit.twoTexture.find((row) => row.source === CLOUD);
  if (!layer) throw Error('The sky audit never carried the cloud layer\'s two-texture draw');
  if (layer.file !== staged.second.file || layer.alpha !== staged.alpha)
    throw Error('The staged second texture is not the one the sky draws');
  if (layer.program.static !== staged.program.static || layer.program.dynamic !== staged.program.dynamic)
    throw Error('The drawn branch is not the measured one');
  // The live frame compiled the port's two-texture program, so the dome is drawn by it.
  const compiled = audit.programs.filter((key) => key.includes('source-sky-two-texture-r1'));
  if (compiled.length !== 1) throw Error(`The live frame compiled ${compiled.length} two-texture programs, not one`);

  const report = await page.evaluate(PASSES);
  if (report.error) throw Error('The cloud layer product draw could not run: ' + report.error);
  const c = report.comparison;
  await page.screenshot({ path: resolve(outputDir, 'source-cloud-layer-ingame.png') });
  const matched = c.samples > 0 && c.within2 === c.samples;
  const evidence = {
    status: matched ? 'passed-original-cloud-layer-product-in-game' : 'failed-original-cloud-layer-product-in-game',
    scope: 'The local player in a real browser on the shipped de_dust2, looking at the map\'s own 3D sky: the cloud '
      + 'layer\'s dome is drawn by the port\'s own two-texture material, which carries the staged second texture and '
      + 'the branch its descriptor measured (static combo 0x1, dynamic 1, texture0 * texture1 * c1), and every '
      + 'compared pixel of that draw equals that product - the product of the same draw\'s two single-texture passes, '
      + 'which are the GPU\'s own samples of the two shipped textures, times the material\'s own colour and opacity.',
    url: base,
    layer: { source: layer.source, secondTexture: layer.secondTexture, file: layer.file, alpha: layer.alpha,
      program: layer.program, material: report.material, sampler: report.sampler, domeMesh: c.dome },
    staged: { translucent: staged.translucent, second: staged.second, program: staged.program, vmtSha256: staged.rawVmtSha256 },
    compiledTwoTexturePrograms: compiled.length,
    productMeasurement: { status: matched ? 'matched' : 'not-reproduced', comparison: c },
    errors,
    boundary: 'All four draws pin both samplers to nearest, use the linear output (no encode) and disable tone '
      + 'mapping, alpha test, culling and the depth test, so the comparison is texel-for-texel in one domain; the two '
      + 'single-texture passes are quantised to 8 bits, and silhouette pixels are excluded because the frame is '
      + 'antialiased. It does not measure the mip, anisotropy or blend state the original GPU selected, and it is not '
      + 'a comparison against a recording of the original client. The colour channels are what is compared: this '
      + 'context\'s drawing buffer does not carry the fragment alpha (the opaque probe reads back as 255 too), so the '
      + 'alpha product is verified by construction and by the loader/contract tests rather than here. The material\'s '
      + 'trailing cLightScale factor is still not applied (see the descriptor\'s own limitation).',
  };
  writeFileSync(resolve(outputDir, 'source-cloud-layer-ingame.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ status: evidence.status, layer: evidence.layer,
    productMeasurement: { status: evidence.productMeasurement.status,
      dome: c.dome, modulation: c.modulation, coveredPixels: c.coveredPixels, silhouettePixels: c.silhouettePixels,
      samples: c.samples, exact: c.exact, within2: c.within2, within3: c.within3, worst: c.worst,
      meanDeviation: c.meanDeviation, alphaNotCompared: c.alphaNotCompared, signatures: c.signatures,
      rows: c.rows, worstAt: c.worstAt },
    compiledTwoTexturePrograms: compiled.length, errors }, null, 2) + '\n');
  if (compiled.length !== 1) throw Error('The live frame did not draw the cloud layer with the port\'s two-texture program');
  if (!matched)
    throw Error(`${c.samples - c.within2} of ${c.samples} pixels differ from the product by more than 2/255; `
      + `worst ${c.worst} at ${JSON.stringify(c.worstAt)}`);
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser.close();
}
