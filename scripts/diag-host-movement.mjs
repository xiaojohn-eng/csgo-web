#!/usr/bin/env node
// Quick diagnostic: does the pointer-locked host actually move with KeyW,
// do bots roam, and does the phase stay live? Prints a timeline.
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.DEATH_VALIDATION_BASE || 'http://127.0.0.1:27019';
const roomName = `Dust2 诊断 ${Date.now() % 10000}`;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await context.newPage();
  await host.goto(`${base}/?map=de_dust2`);
  await host.waitForFunction(
    () => window.__BREACHLINE__?.assetAudit()?.character?.id?.startsWith('csgo-t-ak-12426148'),
    null, { timeout: 180000 },
  );
  await host.getByRole('textbox', { name: '呼号', exact: true }).fill('Diag Host');
  await host.getByRole('button', { name: '创建房间', exact: true }).click();
  await host.getByLabel('房间名称', { exact: true }).fill(roomName);
  await host.getByRole('button', { name: '创建并进入房间', exact: true }).click();
  await host.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.players?.some((p) => p.name === 'Diag Host'));
  await host.keyboard.press('Escape');
  await host.getByRole('button', { name: '返回主菜单', exact: true }).waitFor({ state: 'visible', timeout: 15000 });

  await host.getByRole('button', { name: '继续行动', exact: true }).click();
  await host.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 15000 });
  await host.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.phase === 'live', null, { timeout: 25000 });
  await host.waitForTimeout(300);

  const probe = () => {
    const snap = window.__BREACHLINE__?.snapshot?.();
    const me = snap?.players?.find((p) => p.name === 'Diag Host');
    const bots = (snap?.players ?? []).filter((p) => p.bot).slice(0, 4)
      .map((p) => `${p.name}@(${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)})`);
    return {
      t: +(performance.now() / 1000).toFixed(2),
      phase: snap?.phase,
      locked: !!document.pointerLockElement,
      paused: window.__BREACHLINE__?.runtime?.()?.paused ?? null,
      me: me ? `(${me.x.toFixed(1)},${me.y.toFixed(1)},${me.z.toFixed(1)}) yaw=${me.yaw?.toFixed(2)}` : null,
      bots,
    };
  };

  const timeline = [];
  const push = async () => timeline.push(await host.evaluate(probe));

  await push();
  await host.keyboard.down('KeyW');
  for (let i = 0; i < 10; i++) { await host.waitForTimeout(250); await push(); }
  await host.keyboard.up('KeyW');
  await push();

  for (const row of timeline) {
    console.log(JSON.stringify(row));
  }
  const first = timeline[0], last = timeline[timeline.length - 2];
  const moved = first.me && last.me && first.me !== last.me;
  console.log(moved ? 'HOST_MOVED' : 'HOST_DID_NOT_MOVE');

  await host.keyboard.press('Escape');
  await host.getByRole('button', { name: '返回主菜单', exact: true }).click();
  await host.waitForFunction(() =>
    fetch('/api/rooms').then((r) => r.json()).then((r) => r.rooms.every((x) => x.name !== roomName)), null, { timeout: 15000 });
} finally {
  await browser.close();
}
