async(page)=>{
  const errors=[];
  page.on('pageerror',e=>errors.push({kind:'pageerror',message:String(e)}));
  page.on('console',m=>{if(m.type()==='error')errors.push({kind:'console',message:m.text()});});
  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:27018/');
  await page.waitForFunction(()=>window.__CSGO_ASSET_AUDIT__);
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.unload());
  await page.waitForTimeout(300);
  const baseline=await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.memory());
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.loadIntegratedDust2());
  await page.addStyleTag({content:'aside{visibility:hidden}'});
  const frames=[];
  for(const mode of ['off','r1','r2']){
    await page.evaluate(value=>window.__CSGO_ASSET_PREVIEW__.enablePropLighting(value!=='off',{enablePlainUnbumped:value==='r2'}),mode);
    for(const team of ['ct','t']){
      await page.evaluate(value=>window.__CSGO_ASSET_PREVIEW__.spawnView(value),team);
      await page.waitForTimeout(700);
      await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.report());
      const screenshot=`output/playwright/source-vhv-r2-${team}-${mode}.png`;
      await page.screenshot({path:screenshot});
      const state=await page.evaluate(()=>{
        const lighting=window.__CSGO_PROP_LIGHTING_AUDIT__;
        const compact=lighting?Object.fromEntries(Object.entries(lighting).filter(([key])=>!['skipped','verification'].includes(key))):null;
        if(compact){
          compact.skippedMeshes=lighting.skipped.length;
          compact.verification=Object.fromEntries(Object.entries(lighting.verification).filter(([key])=>key!=='skipped'));
          compact.verification.skippedMeshes=lighting.verification.skipped.length;
        }
        return {asset:window.__CSGO_ASSET_AUDIT__,pvs:window.__CSGO_PVS_AUDIT__,lighting:compact};
      });
      frames.push({mode,team,screenshot,state});
    }
  }
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.unload());
  await page.waitForTimeout(400);
  const released=await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.memory());
  const evidence={session:'csgo-vhv-r2',headless:true,url:page.url(),viewport:page.viewportSize(),
    camera:'original first CT/T spawn, eye64 source units, fov75; same spawnView API for every mode',baseline,released,frames,errors};
  await page.evaluate(value=>window.__CSGO_VHV_R2_EVIDENCE__=value,evidence);
  if(errors.length)throw Error(JSON.stringify(errors));
  for(const key of ['geometries','textures','programs'])if(baseline[key]!==released[key])throw Error('GPU release mismatch: '+key);
  for(const team of ['ct','t']){
    const teamFrames=frames.filter(frame=>frame.team===team);
    const [off,r1,r2]=teamFrames;
    if(off.state.lighting!==null||r1.state.lighting?.appliedMeshes!==1300||r2.state.lighting?.appliedMeshes!==1968||r2.state.lighting?.plainUnbumpedMeshes!==668)
      throw Error('Unexpected VHV branch coverage');
    for(const next of teamFrames.slice(1))for(const key of ['calls','triangles'])if(off.state.asset.render[key]!==next.state.asset.render[key])
      throw Error('Camera/geometry submission differs for '+team+'/'+key);
  }
  return evidence;
}
