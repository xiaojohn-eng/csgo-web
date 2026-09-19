async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if(message.type() === 'error') errors.push(message.text()); });
  await page.getByRole('button', {name:'继续行动',exact:true}).click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.mouse.down(); await page.waitForTimeout(180);
  const casings = await page.evaluate(() => window.__BREACHLINE__.assetAudit().effects);
  await page.screenshot({path:'output/playwright/casing-gpu.png'});
  await page.mouse.up(); await page.waitForTimeout(650);
  await page.keyboard.press('g');
  await page.waitForFunction(() => window.__BREACHLINE__.assetAudit().effects.some(e=>e.kind==='flash' && e.count>0), null, {timeout:4000,polling:'raf'});
  const blast = await page.evaluate(() => ({effects:window.__BREACHLINE__.assetAudit().effects,snapshot:window.__BREACHLINE__.snapshot()}));
  await page.screenshot({path:'output/playwright/blast-gpu.png'});
  await page.waitForTimeout(350);
  await page.screenshot({path:'output/playwright/blast-smoke-gpu.png'});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'返回主菜单',exact:true}).click();
  const cleared = await page.evaluate(() => window.__BREACHLINE__.assetAudit().effects);
  await page.evaluate(evidence=>{window.__CSGO_EFFECTS_EVIDENCE__=evidence;},{casings,blast,cleared,errors});
}
