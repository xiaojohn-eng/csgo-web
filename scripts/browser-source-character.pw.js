async (page) => {
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:27018/');
  await page.getByLabel('已转换模型').selectOption('/assets/source-exports/character-t/tm_leet_varianta-source-unit.glb');
  await page.waitForFunction(()=>window.__CSGO_ASSET_AUDIT__?.source.endsWith('tm_leet_varianta-source-unit.glb'));
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.sample('testIdle',1));
  await page.screenshot({path:'output/playwright/source-t-character-idle.png'});
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.sample('testWalkN',.3));
  await page.screenshot({path:'output/playwright/source-t-character-walk.png'});
  const report=await page.evaluate(()=>window.__CSGO_ASSET_AUDIT__);
  if(report.bones!==71||report.triangles!==11320)throw Error('Character source geometry differs');
  if(errors.length)throw Error(errors.join('\n'));
  await page.evaluate(e=>window.__CSGO_CHARACTER_EVIDENCE__=e,{report,errors});
}
