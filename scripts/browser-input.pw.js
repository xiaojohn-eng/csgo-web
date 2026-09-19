async (page) => {
  await page.goto('http://127.0.0.1:27015/');
  await page.bringToFront();
  const read = () => page.evaluate(() => {
    const snapshot = window.__BREACHLINE__?.snapshot();
    return { locked: !!document.pointerLockElement, tick: snapshot?.tick, phase: snapshot?.phase,
      me: snapshot?.players.find(p => p.id === 'local'), metrics: window.__BREACHLINE__?.metrics() };
  });
  await page.getByRole('button', { name: '开始人机训练 本地训练 · 即刻开玩' }).click();
  await page.waitForTimeout(250);
  if (await page.getByRole('button', { name: '继续行动', exact: true }).isVisible())
    await page.getByRole('button', { name: '继续行动', exact: true }).click();
  await page.waitForFunction(() => !!document.pointerLockElement, null, {timeout: 3000});
  const before = await read();
  await page.keyboard.down('a'); await page.waitForTimeout(500); await page.keyboard.up('a');
  const moved = await read();
  await page.mouse.down(); await page.waitForTimeout(330); await page.mouse.up();
  const fired = await read();
  await page.keyboard.press('r'); await page.waitForTimeout(140);
  const reloading = await read();
  await page.screenshot({ path: 'output/playwright/reloading.png' });
  await page.waitForTimeout(2500);
  const reloaded = await read();
  await page.keyboard.press('f'); await page.waitForTimeout(250);
  const inspected = {...await read(), audit: await page.evaluate(() => window.__BREACHLINE__.assetAudit())};
  await page.screenshot({path:'output/playwright/weapon-inspect.png'});
  await page.keyboard.down('Control'); await page.waitForTimeout(500);
  const crouched = await read();
  await page.screenshot({ path: 'output/playwright/crouch.png' });
  await page.keyboard.up('Control');
  await page.keyboard.press('Escape');
  const paused = await read();
  await page.evaluate(evidence => { window.__CSGO_INPUT_EVIDENCE__ = evidence; }, {before,moved,fired,reloading,reloaded,inspected,crouched,paused});
}
