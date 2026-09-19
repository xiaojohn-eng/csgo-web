async(page)=>{
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:27018/');
  await page.waitForFunction(()=>window.__CSGO_ASSET_AUDIT__);
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.unload());await page.waitForTimeout(200);
  const before=await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.memory());
  let started=false;
  await page.route('**/dust2-runtime/manifest.json',async route=>{
    started=true;await page.waitForTimeout(900);
    try{await route.continue();}catch{}
  });
  await page.evaluate(()=>{window.__pendingOriginalMap=window.__CSGO_ASSET_PREVIEW__.loadIntegratedDust2();});
  while(!started)await page.waitForTimeout(30);
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.loadSourceCharacter());
  await page.evaluate(()=>window.__pendingOriginalMap);
  await page.waitForTimeout(1000);await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.report());
  const state=await page.evaluate(()=>({asset:window.__CSGO_ASSET_AUDIT__,map:window.__CSGO_SOURCE_MAP_LOADER_AUDIT__,character:window.__CSGO_SOURCE_CHARACTER_AUDIT__}));
  if(state.asset.bones!==165||state.asset.layers!==0||state.map!==null||state.character.materialCount!==4)
    throw Error('Late map load replaced newer character choice');
  await page.unroute('**/dust2-runtime/manifest.json');
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.unload());await page.waitForTimeout(300);
  const after=await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.memory());
  const evidence={before,after,state,errors};await page.evaluate(e=>window.__CSGO_SOURCE_RACE_EVIDENCE__=e,evidence);
  if(before.geometries!==after.geometries||before.textures!==after.textures||before.programs!==after.programs||errors.length)
    throw Error('Cancelled Source loader did not return to clean baseline');
}
