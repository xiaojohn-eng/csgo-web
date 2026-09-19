async(page)=>{
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:27018/');await page.waitForFunction(()=>window.__CSGO_ASSET_AUDIT__);
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.unload());await page.waitForTimeout(200);
  const baseline=await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.memory());
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.loadIntegratedDust2());
  await page.addStyleTag({content:'aside{visibility:hidden}'});
  const frames=[];
  for(const enabled of [false,true]){
    await page.evaluate(value=>window.__CSGO_ASSET_PREVIEW__.enablePropLighting(value),enabled);
    for(const team of ['ct','t']){
      await page.evaluate(value=>window.__CSGO_ASSET_PREVIEW__.spawnView(value),team);
      await page.waitForTimeout(600);await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.report());
      await page.screenshot({path:`output/playwright/source-vhv-${team}-${enabled?'on':'off'}.png`});
      frames.push({enabled,team,state:await page.evaluate(()=>({asset:window.__CSGO_ASSET_AUDIT__,pvs:window.__CSGO_PVS_AUDIT__,lighting:window.__CSGO_PROP_LIGHTING_AUDIT__}))});
    }
  }
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.unload());await page.waitForTimeout(300);
  const released=await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.memory());
  await page.evaluate(e=>window.__CSGO_SOURCE_VHV_EVIDENCE__=e,{baseline,released,frames,errors});
  if(errors.length)throw Error(errors.join('\n'));
  if(baseline.geometries!==released.geometries||baseline.textures!==released.textures||baseline.programs!==released.programs)
    throw Error('VHV layer did not release owned GPU resources');
  if(!frames[2].state.lighting)throw Error('Original VHV layer not applied');
}
