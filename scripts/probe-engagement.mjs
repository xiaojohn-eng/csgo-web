#!/usr/bin/env node
// Engagement probe: one headless client joins a Dust2 room and records, every
// 500ms, the phase plus every player's team/alive/position as seen from this
// client. Reports: death timeline, closest opposing distance over time, how
// many enemies were position-visible (y > -50, not anti-ESP desensitized),
// and how many enemies the client could have aimed at. Use to diagnose why
// the ragdoll LAN validation's engagement window produces no corpses.
import { chromium } from 'playwright';

const base = process.env.PROBE_BASE || 'http://127.0.0.1:27019';
const roomName = `Dust2 交战探针 ${Date.now() % 10000}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`${base}/?map=de_dust2`);
  await page.waitForFunction(
    () => window.__BREACHLINE__?.assetAudit()?.character?.id?.startsWith('csgo-t-ak-12426148'),
    null, { timeout: 180000 },
  );
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('Probe Host');
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await page.getByLabel('房间名称', { exact: true }).fill(roomName);
  await page.getByRole('button', { name: '创建并进入房间', exact: true }).click();
  await page.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.players?.some((p) => p.name === 'Probe Host'));
  await page.bringToFront();
  await page.getByRole('button', { name: '继续行动', exact: true }).click();
  await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.phase === 'live', null, { timeout: 60000 });

  const samples = await page.evaluate(async () => {
    const out = [];
    const t0 = performance.now();
    for (let i = 0; i < 2400; i++) {
      const snap = window.__BREACHLINE__?.snapshot?.();
      if (snap) out.push({
        t: +((performance.now() - t0) / 1000).toFixed(2),
        phase: snap.phase ?? null,
        players: snap.players.map((p) => ({
          name: p.name, team: p.team, bot: !!p.bot, alive: p.alive,
          x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1),
          vx: +(p.vx ?? 0).toFixed(2), vy: +(p.vy ?? 0).toFixed(2), vz: +(p.vz ?? 0).toFixed(2),
          ragdoll: p.sourceRagdoll ? {
            positions: p.sourceRagdoll.positions.map((v) => +v.toFixed(2)),
            settled: !!p.sourceRagdoll.settled,
          } : null,
        })),
      });
      await new Promise((r) => setTimeout(r, 50));
    }
    return out;
  }, undefined, { timeout: 300000 });

  const { writeFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  writeFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'output', 'playwright', 'probe-engagement-raw.json'),
    JSON.stringify(samples),
  );

  const me = samples[0].players.find((p) => p.name === 'Probe Host');
  const myTeam = me.team;
  const deaths = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1], cur = samples[i];
    for (const p of cur.players) {
      const q = prev.players.find((r) => r.name === p.name);
      if (q && q.alive && !p.alive) deaths.push({ t: cur.t, name: p.name, team: p.team, bot: p.bot });
      if (q && !q.alive && p.alive) deaths.push({ t: cur.t, name: p.name, event: 'respawn' });
    }
  }
  const enemyVisible = samples.map((s) => ({
    t: s.t,
    visible: s.players.filter((p) => p.team !== myTeam && p.alive && p.y > -50).length,
    hidden: s.players.filter((p) => p.team !== myTeam && p.alive && p.y <= -50).length,
  }));
  const closest = samples.map((s) => {
    let best = Infinity, who = null;
    const mine = s.players.filter((p) => p.team === myTeam && p.alive);
    const foes = s.players.filter((p) => p.team !== myTeam && p.alive && p.y > -50);
    for (const a of mine) for (const b of foes) {
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < best) { best = d; who = `${a.name}↔${b.name}`; }
    }
    return { t: s.t, dist: +best.toFixed(1), who };
  }).filter((c) => Number.isFinite(c.dist));
  const phases = [...new Set(samples.map((s) => s.phase))];

  console.log(`duration: ${samples[samples.length - 1].t}s, phases seen: ${JSON.stringify(phases)}`);
  console.log(`deaths: ${deaths.length ? JSON.stringify(deaths) : 'NONE'}`);
  console.log(`enemy position-visible samples: ${enemyVisible.filter((e) => e.visible > 0).length}/${enemyVisible.length}`);
  const maxVisible = Math.max(...enemyVisible.map((e) => e.visible));
  console.log(`max simultaneous visible enemies: ${maxVisible}`);
  const everHidden = enemyVisible.some((e) => e.hidden > 0);
  console.log(`anti-ESP hidden enemies observed: ${everHidden}`);
  const under50 = closest.filter((c) => c.dist < 50);
  console.log(`samples with opposing forces < 50 units apart: ${under50.length}/${closest.length}`);
  if (under50.length) console.log(`  first close contact: ${JSON.stringify(under50[0])}, min dist ${Math.min(...closest.map((c) => c.dist))}`);
  if (errors.length) console.log(`errors: ${JSON.stringify(errors.slice(0, 5))}`);
} finally {
  await browser.close();
}
