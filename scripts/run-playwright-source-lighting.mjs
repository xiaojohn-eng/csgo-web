#!/usr/bin/env node
// Dust2 lights itself from the sun the map states.
//
// `light_environment` states the sun as a Source yaw/pitch pair, a colour and an ambient colour
// (scripts/probe-source-environment.py); the port carries that direction into its own world frame
// and gives it to every lit scene, so the world, the characters and the viewmodel agree about
// where the light is.
//
// This run proves the browser is using it:
//   * the live key light's direction is the map's own, to float precision, and its colours are the
//     map's own bytes; the light sits at the distance its own shadow camera was set for;
//   * the target follows the camera, and the viewmodel's light is that same sun brought into view
//     space rather than a fixed studio light;
//   * and the sun casts no shadow at all on this map, because the map declares no cascade light:
//     every actor's shadow is the map's own projected one, measured by
//     scripts/run-playwright-source-projected-shadows.mjs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SOURCE_SKY_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const errors = [];
const staged = JSON.parse(readFileSync(resolve(root, 'public/source/csgo-12426148/dust2/environment.json'), 'utf8'));
const expectedSun = [staged.light.sunSourceDirection[0], staged.light.sunSourceDirection[2],
  -staged.light.sunSourceDirection[1]];
const hex = (color) => '#' + color.map((c) => c.toString(16).padStart(2, '0')).join('');
/** The distance the port's light used to sit from its target; the shadow camera was set for it. */
const SUN_DISTANCE = Math.hypot(30, 48, 15);

const AUDIT = `(() => {
  const game = window.__BREACHLINE__.runtime();
  const art = game && game.art;
  if (!art) return { error: 'the game has no scene' };
  const audit = art.sourceEnvironmentAudit;
  const Vector = art.camera.position.constructor;
  const sunDirection = new Vector().copy(art.sun.position).sub(art.sun.target.position).normalize();
  const weaponDirection = new Vector().copy(art.weaponSun.position).sub(art.weaponSun.target.position).normalize();
  // The viewmodel's light is the world's sun brought into view space; it is not a fixed studio light.
  const viewSpace = sunDirection.clone().applyQuaternion(art.camera.quaternion.clone().invert());
  return {audit, sunDirection: sunDirection.toArray(),
    sunDistance: art.sun.position.distanceTo(art.sun.target.position),
    shadowMap: {enabled: art.renderer.shadowMap.enabled, type: art.renderer.shadowMap.type,
      needsUpdate: art.renderer.shadowMap.needsUpdate},
    weaponSun: {direction: weaponDirection.toArray(), viewSpaceSun: viewSpace.toArray(),
      angle: weaponDirection.angleTo(viewSpace) * 180 / Math.PI,
      color: '#' + art.weaponSun.color.getHexString()},
    ambient: {color: '#' + art.ambient.color.getHexString(), ground: '#' + art.ambient.groundColor.getHexString(),
      intensity: art.ambient.intensity, viewmodel: '#' + art.gunAmbient.color.getHexString()},
    camera: art.camera.position.toArray(), sunTarget: art.sun.target.position.toArray(),
    // Every light that casts into the main scene, so a probe's shadow can be attributed.
    lights: (() => {
      const found = [];
      art.scene.traverse((object) => {
        if (!object.isLight) return;
        found.push({type: object.type, name: object.name, castShadow: object.castShadow,
          intensity: object.intensity, color: '#' + object.color.getHexString(),
          position: object.position.toArray(),
          target: object.target ? object.target.position.toArray() : null});
      });
      return found;
    })()};
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
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('MapLight');
  await start.click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.waitForFunction(() => {
    const game = window.__BREACHLINE__?.runtime?.();
    return !!(game && game.art && game.art.sourceMap && game.art.sourceEnvironmentAudit.applied.lightScale !== undefined);
  }, null, { timeout: 180000 });
  // Let a frame run so the per-frame follow has happened.
  await page.waitForTimeout(400);

  const audit = await page.evaluate(AUDIT);
  if (audit.error) throw Error(audit.error);
  const live = audit.audit.applied;
  const close = (a, b, tolerance) => Math.max(...a.map((value, axis) => Math.abs(value - b[axis]))) <= tolerance;
  if (!close(audit.sunDirection, expectedSun, 1e-6)) {
    throw Error(`The live sun is ${JSON.stringify(audit.sunDirection)}, not the map's own ${JSON.stringify(expectedSun)}`);
  }
  if (!close(live.sunDirection, live.expectedSunDirection, 1e-6)) {
    throw Error(`The audit and the live light disagree about the sun: ${JSON.stringify(live.sunDirection)}`);
  }
  if (Math.abs(audit.sunDistance - SUN_DISTANCE) > 1e-6) {
    throw Error(`The light sits ${audit.sunDistance} from its target, not the ${SUN_DISTANCE} the shadow camera was set for`);
  }
  if (live.sunColor !== hex(staged.light.sunColor) || live.ambientColor !== hex(staged.light.ambientColor)) {
    throw Error(`The live colours are ${live.sunColor}/${live.ambientColor}, not the map's `
      + `${hex(staged.light.sunColor)}/${hex(staged.light.ambientColor)}`);
  }
  if (audit.weaponSun.color !== live.sunColor) {
    throw Error(`The viewmodel's sun is ${audit.weaponSun.color}, not the world's ${live.sunColor}`);
  }
  if (audit.ambient.color !== live.ambientColor || audit.ambient.viewmodel !== live.ambientColor) {
    throw Error(`The ambient is ${audit.ambient.color}/${audit.ambient.viewmodel}, not the map's ${live.ambientColor}`);
  }
  if (audit.weaponSun.angle > 1e-4) {
    throw Error(`The viewmodel's light is ${audit.weaponSun.angle} degrees from the world sun in view space`);
  }
  if (!close(audit.sunTarget, audit.camera, 1e-6)) {
    throw Error(`The shadow volume does not follow the view: target ${JSON.stringify(audit.sunTarget)} `
      + `vs camera ${JSON.stringify(audit.camera)}`);
  }
  // The sun's own shadow map is off for this map: this map declares no cascade light, and every
  // actor's shadow is the map's own projected one.
  if (live.shadow.castShadow) {
    throw Error('The sun casts a shadow map, which this map declares no cascade light for');
  }
  const projected = await page.evaluate(() => {
    const art = window.__BREACHLINE__?.runtime?.()?.art;
    const audit = art?.sourceProjectedShadowAudit?.();
    return audit ? {enabled: audit.enabled, color: audit.color, reachMetres: audit.maxDistanceMetres} : null;
  });
  if (!projected || !projected.enabled) throw Error('The map\'s own projected shadows are not loaded');

  await page.screenshot({ path: resolve(outputDir, 'source-lighting-ingame.png') });
  const evidence = {scope: 'Live Dust2 key light: the map\'s own sun direction, colours and reach',
    staged: {light: staged.light, declaredButUnapplied: staged.declaredButUnapplied},
    audit: {...audit.audit.applied, viewmodel: audit.weaponSun, ambient: audit.ambient,
      camera: audit.camera, shadowMap: audit.shadowMap},
    projectedShadows: projected, errors};
  if (errors.length) throw Error(errors.join('\n'));
  writeFileSync(resolve(outputDir, 'source-lighting-ingame.json'), JSON.stringify(evidence, null, 1) + '\n');
  console.log(JSON.stringify({status: 'passed', sunDirection: audit.sunDirection, expectedSun,
    colours: {sun: live.sunColor, ambient: live.ambientColor},
    sunDistance: audit.sunDistance, targetFollowsCamera: true,
    viewmodelSunAngle: audit.weaponSun.angle, sunCastsShadow: live.shadow.castShadow,
    projectedShadows: projected,
    screenshots: {ingame: 'output/playwright/source-lighting-ingame.png'}}, null, 1));
} finally {
  await browser.close();
}
