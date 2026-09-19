async (page) => {
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:27018/');
  await page.getByRole('button',{name:'Dust2 原版烘焙光照',exact:true}).click();
  await page.waitForFunction(()=>window.__CSGO_ASSET_AUDIT__?.layers===1,null,{timeout:120000});
  await page.waitForTimeout(800);
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.report());
  const ct=await page.evaluate(()=>window.__CSGO_ASSET_AUDIT__);
  const lightmap=await page.evaluate(()=>window.__CSGO_LIGHTMAP_AUDIT__);
  if(!lightmap||lightmap.materials!==85)throw Error("Original HDR lightmap shader missing");
  await page.screenshot({path:'output/playwright/dust2-hdr-ctspawn.png'});
  await page.getByRole('button',{name:'T 出生点',exact:true}).click();
  await page.waitForTimeout(800);
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.report());
  const t=await page.evaluate(()=>window.__CSGO_ASSET_AUDIT__);
  await page.screenshot({path:'output/playwright/dust2-hdr-tspawn.png'});
  if(ct.triangles!==6572252)throw Error('Full source world/prop geometry differs');
  if(errors.length)throw Error(errors.join('\n'));
  await page.evaluate(e=>window.__CSGO_MAP_EVIDENCE__=e,{ct,t,lightmap,errors});
}
