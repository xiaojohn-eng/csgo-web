async (page) => {
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:27018/');
  await page.getByRole('button',{name:'Dust2 原版烘焙光照',exact:true}).click();
  await page.waitForFunction(()=>window.__CSGO_PVS_AUDIT__?.mappedProps===3158,null,{timeout:120000});
  const evidence=[];
  for(const team of ['ct','t']){
    await page.evaluate(team=>window.__CSGO_ASSET_PREVIEW__.spawnView(team),team);
    await page.evaluate(()=>{document.querySelector('aside').style.visibility='hidden';window.__CSGO_ASSET_PREVIEW__.setPVS(false);});
    await page.waitForTimeout(1000);
    await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.report());
    const off=await page.evaluate(()=>({map:window.__CSGO_ASSET_AUDIT__,pvs:window.__CSGO_PVS_AUDIT__}));
    await page.screenshot({path:`output/playwright/dust2-${team}-pvs-off.png`});
    await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.setPVS(true));
    await page.waitForTimeout(1000);
    await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.report());
    const on=await page.evaluate(()=>({map:window.__CSGO_ASSET_AUDIT__,pvs:window.__CSGO_PVS_AUDIT__}));
    await page.screenshot({path:`output/playwright/dust2-${team}-pvs-on.png`});
    if(on.pvs.allVisible||on.pvs.worldVisibleTriangles>=302307||on.pvs.unknownPropAnchors!==0)throw Error('PVS did not map original world/props');
    if(on.map.render.triangles>off.map.render.triangles)throw Error('PVS increased rendered geometry');
    evidence.push({team,off,on});
  }
  // Restore normal inspection UI and rapidly revisit both source spawn views.
  await page.evaluate(()=>{for(const team of ['ct','t','ct','t'])window.__CSGO_ASSET_PREVIEW__.spawnView(team);document.querySelector('aside').style.visibility='';});
  if(errors.length)throw Error(errors.join('\n'));
  await page.evaluate(e=>window.__CSGO_PVS_EVIDENCE__=e,{evidence,errors});
}
