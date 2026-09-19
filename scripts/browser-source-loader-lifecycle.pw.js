async (page) => {
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:27018/');
  await page.waitForFunction(()=>window.__CSGO_ASSET_AUDIT__);
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.unload());
  await page.waitForTimeout(300);
  const baseline=await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.memory());
  const states=[],released=[];
  for(let pass=0;pass<2;pass++){
    await page.getByRole('button',{name:'Dust2 原版烘焙光照',exact:true}).click();
    await page.waitForFunction(()=>window.__CSGO_PVS_AUDIT__?.mappedProps===3158&&Object.keys(window.__CSGO_SOURCE_MAP_LOADER_AUDIT__?.hashVerified??{}).length===8,null,{timeout:120000});
    await page.waitForTimeout(600);await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.report());
    const state=await page.evaluate(()=>({asset:window.__CSGO_ASSET_AUDIT__,loader:window.__CSGO_SOURCE_MAP_LOADER_AUDIT__,pvs:window.__CSGO_PVS_AUDIT__}));
    if(!Object.values(state.loader.hashVerified).every(v=>v===true))throw Error('Original loader resource checksum not verified');
    states.push({pass,kind:'map',state});
    await page.getByRole('button',{name:'原版 T 持 AK',exact:true}).click();
    await page.waitForFunction(()=>window.__CSGO_SOURCE_CHARACTER_AUDIT__?.materialCount===4);
    await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.sample('sdk-3way__idle',.3));
    await page.waitForTimeout(600);await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.report());
    const character=await page.evaluate(()=>({asset:window.__CSGO_ASSET_AUDIT__,pvs:window.__CSGO_PVS_AUDIT__}));
    if(character.asset.layers!==0||character.pvs!==null)throw Error('Map owner did not detach on character transition');
    states.push({pass,kind:'character',state:character});
    await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.unload());
    await page.waitForTimeout(300);
    released.push(await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.memory()));
  }
  await page.evaluate(e=>window.__CSGO_SOURCE_LIFECYCLE_EVIDENCE__=e,{baseline,states,released,errors});
  // GPU uploads are lazy and depend on preceding camera poses. Compare the
  // actual empty-scene baseline, not two partly uploaded map views.
  if(released.some(m=>m.geometries!==baseline.geometries||m.textures!==baseline.textures||m.programs!==baseline.programs))throw Error('Source asset transitions retained GPU resources');
  if(errors.length)throw Error(errors.join('\n'));
}
