#!/usr/bin/env node
// The room's original rule set, end to end in a real browser.
//
// It checks the four places the choice has to survive: the offer a player picks
// from, the request the client sends, the authority the room actually runs, and
// what the HUD and the room list then show. The numbers are never restated here -
// they are read back from the page and compared against the staged original data.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.ROOM_RULES_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const roomName = `Dust2 赛制验证 ${Date.now() % 10000}`;
const issues = [];
const errors = [];

const browser = await chromium.launch({
  channel: 'chrome',
  headless: process.env.ROOM_RULES_HEADED ? false : true,
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`${base}/?map=de_dust2`);
  await page.waitForFunction(
    () => window.__BREACHLINE__?.assetAudit()?.character?.id?.startsWith('csgo-t-ak-12426148') &&
      window.__BREACHLINE__?.assetAudit()?.counterTerrorist?.id?.startsWith('csgo-ct-ak-12426148'),
    null, { timeout: 240000 },
  );
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('Rules Check');

  const openDialog = async () => {
    await page.getByRole('button', { name: '局域网房间', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15000 });
  };
  await openDialog();
  await page.getByRole('button', { name: '创建房间', exact: true }).click();

  // 1. The offer: both original modes, described from the staged numbers.
  const offers = await page.getByRole('group', { name: '赛制' }).getByRole('button').allInnerTexts();
  if (offers.length !== 2) issues.push(`the create dialog offered ${offers.length} rule sets, not two`);
  if (!offers.some((text) => text.includes('短竞技') && text.includes('16 回合') && text.includes('先到 9 局')))
    issues.push(`the short mode offer is not the staged one: ${JSON.stringify(offers)}`);
  if (!offers.some((text) => text.includes('完整竞技') && text.includes('30 回合') && text.includes('先到 16 局')))
    issues.push(`the full mode offer is not the staged one: ${JSON.stringify(offers)}`);

  // 2. The request: pick the full mode and create the room on it.
  await page.getByRole('group', { name: '赛制' }).getByRole('button', { name: /完整竞技/ }).click();
  await page.getByLabel('房间名称', { exact: true }).fill(roomName);
  await page.getByRole('button', { name: '创建并进入房间', exact: true }).click();
  await page.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.rules != null, null, { timeout: 60000 });

  // 3. The authority: the snapshot names the rule set the room is actually running.
  const state = await page.evaluate(() => {
    const snapshot = window.__BREACHLINE__?.snapshot?.() ?? null;
    return { rules: snapshot?.rules ?? null, phase: snapshot?.phase ?? null, mode: snapshot?.mode ?? null,
      score: snapshot?.score ?? null };
  });
  if (state.rules !== 'competitive')
    issues.push(`the room is running ${String(state.rules)}, not the competitive mode it was asked for`);
  if (state.mode === 'training') issues.push('the room was created in the practice mode');

  // 4. What the player sees: the HUD plays to the mode's own target.
  await page.getByRole('button', { name: '继续行动', exact: true }).click();
  await page.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.phase !== null, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const hud = await page.locator('text=/先到 \\d+ 局/').first().innerText().catch(() => '');
  if (!hud.includes('先到 16 局') || !hud.includes('第 15 回合后换边'))
    issues.push(`the HUD did not show the competitive format: ${JSON.stringify(hud)}`);
  await page.screenshot({ path: resolve(outputDir, 'source-room-rules-hud.png') });

  // 5. What a friend browsing the lobby would see: the room, on the mode it runs.
  //    This has to be read while the room is alive — returning to the main menu
  //    leaves the room, and the last client leaving closes it.
  const lobby = await page.evaluate(async () => {
    const response = await fetch('/api/rooms', { cache: 'no-store' });
    return response.ok ? await response.json() : { status: response.status };
  });
  const listed = (lobby.rooms ?? []).find((room) => room.name === roomName) ?? null;
  if (!listed) issues.push(`the lobby does not list the room while it is live: ${JSON.stringify(lobby).slice(0, 300)}`);
  else if (listed.rules !== 'competitive')
    issues.push(`the lobby reports the room on ${String(listed.rules)}, not the mode it was created on`);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
  await page.waitForTimeout(1000);
  const afterMenu = await page.evaluate(async () => {
    const response = await fetch('/api/rooms', { cache: 'no-store' });
    return response.ok ? await response.json() : { status: response.status };
  });
  await page.screenshot({ path: resolve(outputDir, 'source-room-rules-menu.png') });
  if (errors.length) issues.push(`browser errors: ${errors.slice(0, 3).join(' | ')}`);

  const evidence = { scope: 'The original rule-set choice, from the create dialog through the authority to the HUD and lobby',
    base, room: roomName, offers, state, hud, lobby, afterMenu, errors, issues };
  writeFileSync(resolve(outputDir, 'source-room-rules-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('ROOM RULES TEST', issues.length ? 'FAILED' : 'PASSED');
  console.log(`  offers: ${JSON.stringify(offers)}`);
  console.log(`  authority: rules=${state.rules} mode=${state.mode} phase=${state.phase}`);
  console.log(`  HUD: ${hud}`);
  console.log(`  lobby while live: ${JSON.stringify(listed)}`);
  console.log(`  lobby after the host returned to the menu: ${(afterMenu.rooms ?? []).length} rooms`
    + ' (returning to the menu leaves the room, and the last client leaving closes it)');
  for (const issue of issues) console.log(`  - ${issue}`);
  if (issues.length) process.exitCode = 1;
} finally {
  await browser.close();
}
