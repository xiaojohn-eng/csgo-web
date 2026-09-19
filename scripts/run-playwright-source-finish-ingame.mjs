#!/usr/bin/env node
// Selects an original finish in the real game, on each weapon that has them, and composes it.
//
// The browser-level composition check proves the compositor is finish-driven; this proves
// the game itself is: a finish chosen in the menu reaches the scene, the scene resolves that
// finish's own numbers and its own artwork, and the material on the weapon is the one
// composed from them. It runs the AK-47 and the M4A1 in one page, because the same code now
// serves both and what differs is the weapon's own inputs, Phong values and material names.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SOURCE_FINISH_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const issues = [];
const errors = [];
// One finish per weapon, and the finish each weapon must not end up with.
const CHOSEN = { weapon: 'vandal', paintKitId: 302, name: '火神', card: /^火神，/,
  patternMaterial: 'rubber_ak47.vtf', measured: { boost: 2, albedoBoost: 35, fresnel: [.83, .83, 1] } };
// The AK-47's own spec, and the rest of the weapons this port can dress. Every one of them
// carries its own staged inputs and its own original Phong values, and those values differ:
// the AK-47's material has albedo boost 35 and Fresnel [.83 .83 1], the M4A1's 25 and the
// same stops, the AWP's 40 and [.8 .8 1], the Glock's 35 and [.83 .83 1] on a boost of 1,
// the USP-S's 80 and [.83 .83 1] on a boost of 8 (so a finish's intensity is divided by 8),
// and the Deagle's 40 and [.8 .8 1] on a boost of 1.
const VERIFIED = { weapon: 'vandal', paintKitId: 282, card: /^红线，/ };
const OTHERS = [
  { weapon: 'm4a4', label: 'M4A1', button: /^M4A4/, paintKitId: 309, name: '咆哮', card: /^咆哮，/,
    cards: 11, patternMaterial: 'howling_m4a1.vtf', measured: { boost: 2, albedoBoost: 25, fresnel: [.83, .83, 1] } },
  { weapon: 'awp', label: 'AWP', button: /^AWP/, paintKitId: 344, name: '巨龙传说', card: /^巨龙传说，/,
    cards: 12, patternMaterial: 'dragon_awp.vtf', measured: { boost: 2, albedoBoost: 40, fresnel: [.8, .8, 1] } },
  { weapon: 'glock', label: 'Glock-18', button: /^Glock-18/, paintKitId: 353, name: '水灵', card: /^水灵，/,
    cards: 10, patternMaterial: 'liquescent.vtf', measured: { boost: 1, albedoBoost: 35, fresnel: [.83, .83, 1] } },
  { weapon: 'usp', label: 'USP-S', button: /^USP-S/, paintKitId: 290, name: '守护者', card: /^守护者，/,
    cards: 15, patternMaterial: 'usp-s_ct_elegant_update.vtf', measured: { boost: 8, albedoBoost: 80, fresnel: [.83, .83, 1] } },
  { weapon: 'deagle', label: 'Desert Eagle', button: /^Desert Eagle/, paintKitId: 351, name: '阴谋者', card: /^阴谋者，/,
    cards: 4, patternMaterial: 'deagle_aureus.vtf', measured: { boost: 1, albedoBoost: 40, fresnel: [.8, .8, 1] } },
];
const COMPARED_WEAR = .2;

const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const audit = () => page.evaluate(() => {
    const a = window.__BREACHLINE__.assetAudit();
    return { status: a.sourceWeaponFinish?.status?.status, error: a.sourceWeaponFinish?.status?.error,
      requested: a.sourceWeaponFinish?.requested,
      materials: (a.sourceWeaponFinish?.materials ?? []).map((entry) => ({ finish: entry.finish,
        evidence: entry.evidence, sourceParameters: entry.sourceParameters })) };
  });
  const cards = () => page.locator('.skin-selector__card').count();
  /** The scene's own idea of the finish it is applying, so a weapon that ends up with no
   * composed material names the reason instead of looking like a silent no-op. */
  const status = () => page.evaluate(() => {
    const a = window.__BREACHLINE__.assetAudit(), s = a.sourceWeaponFinish;
    return { status: s?.status?.status ?? null, error: s?.status?.error ?? null,
      requested: s?.requested ?? null, held: a.firstPerson?.name ?? null,
      materials: (s?.materials ?? []).length };
  });
  /** Waits for a finish to be equipped and reports the state it settled in, so a
   * refusal names its own reason instead of only timing out. */
  const equip = async (expected, label) => {
    const deadline = Date.now() + 240000;
    let last = null;
    while (Date.now() < deadline) {
      last = await audit();
      const material = last.materials[0];
      if (material?.finish?.paintKitId === expected.paintKitId
        && material?.finish?.weapon === expected.weapon) return last;
      if (last.status === 'error') { issues.push(`${label} failed: ${last.error}`); return last; }
      await page.waitForTimeout(500);
    }
    issues.push(`${label} never equipped (status ${last?.status}, error ${last?.error}, `
      + `equipped ${last?.materials[0]?.finish?.paintKitId} on ${last?.materials[0]?.finish?.weapon})`);
    return last;
  };
  /** Sets the wear control and waits for the scene to be asked for that wear, so a
   * comparison between two finishes is made at the same wear. */
  const setWear = async (wear) => {
    await page.locator('input[aria-label="涂装磨损"]').fill(String(wear));
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      const state = await audit();
      if (Math.abs((state.requested?.wear ?? -1) - wear) < 1e-6) return state;
      if (state.status === 'error') { issues.push(`wear ${wear} failed: ${state.error}`); return state; }
      await page.waitForTimeout(500);
    }
    issues.push(`the scene was never asked for wear ${wear}`);
    return audit();
  };
  await page.goto(`${base}/?map=dev_dust2`.replace('dev', 'de'), { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^开始人机训练/ }).waitFor({ state: 'visible', timeout: 180000 });
  await page.getByRole('button', { name: '武器库', exact: true }).click();

  // The AK-47 first: the composition path that was verified against the Redline receipt.
  const akEntry = page.getByRole('button', { name: CHOSEN.card });
  await akEntry.waitFor({ state: 'visible', timeout: 60000 });
  // The menu lists one card per original finish this port can compose for the weapon in
  // hand, plus the factory state: 18 AK-47 finishes, not the M4A1's 10.
  if (await cards() !== 19) issues.push(`the AK-47 menu offered ${await cards()} cards, not 19`);
  await akEntry.click();
  const chosen = await setWear(COMPARED_WEAR);
  await page.screenshot({ path: resolve(outputDir, 'source-finish-ingame-ak-chosen.png') });
  await page.getByRole('button', { name: VERIFIED.card }).click();
  await equip(VERIFIED, '红线');
  const verified = await setWear(COMPARED_WEAR);
  await akEntry.click();
  await equip(CHOSEN, CHOSEN.name + '（再次）');
  const back = await setWear(COMPARED_WEAR);

  // The rest of the weapons, each with its own staged inputs and its own original Phong
  // values: the two rifles' boost is 2, the pistols' is 1 and the suppressed pistol's 8, and
  // the Deagle's Fresnel stops are the AWP's rather than the other pistols'.
  const others = {};
  for (const spec of OTHERS) {
    await page.getByRole('button', { name: spec.button }).click();
    const entry = page.getByRole('button', { name: spec.card });
    await entry.waitFor({ state: 'visible', timeout: 60000 });
    if (await cards() !== spec.cards)
      issues.push(`the ${spec.label} menu offered ${await cards()} cards, not ${spec.cards}`);
    await entry.click();
    // Wait for this weapon's own finish to reach it before touching the wear control: the
    // control still shows the previous weapon's finish, so its wear would read as already
    // set and the wait would return before anything was composed.
    await equip(spec, spec.label);
    others[spec.weapon] = await setWear(COMPARED_WEAR);
    // A weapon whose composition never reached the gun body says so here rather than
    // looking like a finish that simply did nothing.
    if (!others[spec.weapon].materials.length)
      issues.push(`the ${spec.label} composed nothing: ${JSON.stringify(await status())}`);
    await page.screenshot({ path: resolve(outputDir, `source-finish-ingame-${spec.weapon}.png`) });
  }

  // Back to the AK-47 without touching the menu: what each weapon was given has to be
  // remembered. Waiting for the finish itself rather than for the wear control, because the
  // wear control still shows another weapon's finish until the AK-47's own is sent.
  await page.getByRole('button', { name: /^AK-47/ }).click();
  await equip(CHOSEN, CHOSEN.name + '（切回 AK-47）');
  const remembered = await setWear(COMPARED_WEAR);
  await page.screenshot({ path: resolve(outputDir, 'source-finish-ingame.png') });

  const materialOf = (state) => state.materials[0] ?? { finish: {}, evidence: {} };
  const composed = (state) => ({ finish: materialOf(state).finish, evidence: materialOf(state).evidence,
    parameters: materialOf(state).sourceParameters });
  if (chosen.materials.length !== 1) issues.push(`the chosen finish equipped ${chosen.materials.length} materials, not one`);
  if (materialOf(chosen).finish.paintKitId !== CHOSEN.paintKitId)
    issues.push(`the game equipped finish ${materialOf(chosen).finish.paintKitId}, not ${CHOSEN.paintKitId}`);
  if (chosen.requested?.paintKitId !== CHOSEN.paintKitId)
    issues.push(`the scene was asked for ${chosen.requested?.paintKitId}, not ${CHOSEN.paintKitId}`);
  // The material has to be the one composed from this finish's own artwork.
  if (!String(materialOf(chosen).evidence?.patternSourceMaterial ?? '').endsWith(CHOSEN.patternMaterial))
    issues.push(`the chosen finish composed from ${materialOf(chosen).evidence?.patternSourceMaterial},`
      + ` not its own ${CHOSEN.patternMaterial}`);
  if (!/^[0-9a-f]{64}$/.test(materialOf(chosen).evidence?.patternSha256 ?? ''))
    issues.push('the chosen finish carries no composed-pattern digest');
  // The two finishes must produce different composed maps, or the selection was ignored.
  if (materialOf(chosen).evidence?.colorSHA256 === materialOf(verified).evidence?.colorSHA256)
    issues.push('the two finishes composed the same colour map');
  if (materialOf(verified).finish.paintKitId !== VERIFIED.paintKitId)
    issues.push(`the verified finish equipped ${materialOf(verified).finish.paintKitId}, not ${VERIFIED.paintKitId}`);
  if (materialOf(back).finish.paintKitId !== CHOSEN.paintKitId)
    issues.push('switching back did not re-equip the second finish');
  // Same finish, same wear: the composition must be identical, which is what says the
  // result is a function of the finish and its parameters rather than of the order they
  // were selected in.
  if (materialOf(back).evidence?.colorSHA256 !== materialOf(chosen).evidence?.colorSHA256)
    issues.push('the same finish at the same wear composed differently the second time');

  // Every other weapon's own composition: its finish, its artwork, and the weapon's own
  // Phong values.
  for (const expected of OTHERS) {
    const state = others[expected.weapon];
    if (!state) continue;
    if (materialOf(state).finish.weapon !== expected.weapon)
      issues.push(`the ${expected.label} finish reports weapon ${materialOf(state).finish.weapon}`);
    if (materialOf(state).finish.paintKitId !== expected.paintKitId)
      issues.push(`the ${expected.label} equipped finish ${materialOf(state).finish.paintKitId}, not ${expected.paintKitId}`);
    if (!String(materialOf(state).evidence?.patternSourceMaterial ?? '').endsWith(expected.patternMaterial))
      issues.push(`the ${expected.label} composed from ${materialOf(state).evidence?.patternSourceMaterial},`
        + ` not its own ${expected.patternMaterial}`);
    if (materialOf(state).evidence?.colorSHA256 === materialOf(chosen).evidence?.colorSHA256)
      issues.push(`the ${expected.label} and the AK-47 composed the same colour map`);
  }
  // The composed adapter carries each weapon's own original Phong values, and every one of
  // the three differs somewhere across these six weapons. That is precisely why they are read
  // per weapon rather than assumed.
  for (const expected of [{ ...CHOSEN, label: 'AK-47', state: chosen }, ...OTHERS.map((spec) => ({ ...spec, state: others[spec.weapon] }))]) {
    if (!expected.state) continue;
    const parameters = materialOf(expected.state).sourceParameters ?? {};
    if (parameters.albedoBoost !== expected.measured.albedoBoost || parameters.boost !== expected.measured.boost)
      issues.push(`${expected.label} composed with boost ${parameters.boost} / albedo ${parameters.albedoBoost},`
        + ` not ${expected.measured.boost} / ${expected.measured.albedoBoost}`);
    const fresnel = parameters.fresnel;
    if (!Array.isArray(fresnel) || fresnel.length !== 3
      || fresnel.some((value, index) => Math.abs(value - expected.measured.fresnel[index]) > 1e-6))
      issues.push(`${expected.label} composed with Fresnel ${JSON.stringify(fresnel)},`
        + ` not ${JSON.stringify(expected.measured.fresnel)}`);
  }
  // Each weapon keeps what it was given: switching back to the AK-47 without touching the
  // menu restores the AK-47's own finish, at the wear it was given.
  if (materialOf(remembered).finish.paintKitId !== CHOSEN.paintKitId)
    issues.push(`returning to the AK-47 equipped ${materialOf(remembered).finish.paintKitId}, not ${CHOSEN.paintKitId}`);
  if (materialOf(remembered).evidence?.colorSHA256 !== materialOf(chosen).evidence?.colorSHA256)
    issues.push('the AK-47 did not come back with its own composition after the M4A1');
  if (errors.length) issues.push(...errors.map((error) => 'browser: ' + error));

  const evidence = { status: issues.length ? 'FAILED' : 'ORIGINAL FINISHES IN-GAME PASSED', base,
    chosen: composed(chosen), verified: composed(verified), back: composed(back),
    others: Object.fromEntries(Object.entries(others).map(([weapon, state]) => [weapon, composed(state)])),
    remembered: composed(remembered), wear: COMPARED_WEAR, issues, errors };
  writeFileSync(resolve(outputDir, 'source-finish-ingame-evidence.json'), JSON.stringify(evidence, null, 1) + '\n');
  console.log(evidence.status);
  const reported = [[chosen, 'AK 火神'], [verified, 'AK 红线'],
    ...OTHERS.map((spec) => [others[spec.weapon], `${spec.label} ${spec.name}`]), [remembered, 'AK 火神（切回）']];
  for (const [state, label] of reported) {
    if (!state) continue;
    const material = materialOf(state), evidence_ = material.evidence ?? {};
    console.log(`  ${label} #${material.finish?.paintKitId ?? '?'} ${material.finish?.weapon ?? '?'} · `
      + `${String(evidence_.patternSourceMaterial ?? '').split('/').pop()} · `
      + `albedo ${material.sourceParameters?.albedoBoost ?? '?'} · `
      + `boost ${material.sourceParameters?.boost ?? '?'} · `
      + `fresnel ${JSON.stringify(material.sourceParameters?.fresnel ?? null)} · `
      + `color ${String(evidence_.colorSHA256 ?? '').slice(0, 12)}…`);
  }
  if (issues.length) { for (const issue of issues) console.log('  issue: ' + issue); process.exitCode = 1; }
} finally {
  await browser.close().catch(() => {});
}
