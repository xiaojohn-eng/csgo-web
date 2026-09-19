async (page) => {
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:27018/');
  await page.getByRole('button',{name:'原版 T 持 AK',exact:true}).click();
  await page.waitForFunction(()=>window.__CSGO_SOURCE_CHARACTER_AUDIT__?.materialCount===4,null,{timeout:60000});
  const poses=[];
  await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.focus([140,65,150],[0,35,0]));
  for(const [clip,time] of [['idle',.3],['walk',.3],['crouch_idle',.3],['aim_fire',.15]]){
    await page.evaluate(({clip,time})=>window.__CSGO_ASSET_PREVIEW__.sample('sdk-3way__'+clip,time),{clip,time});
    await page.waitForTimeout(600);
    await page.evaluate(()=>window.__CSGO_ASSET_PREVIEW__.report());
    poses.push({clip,time,report:await page.evaluate(()=>window.__CSGO_ASSET_AUDIT__)});
    await page.screenshot({path:`output/playwright/source-t-ak-${clip}-phong.png`});
  }
  const material=await page.evaluate(()=>window.__CSGO_SOURCE_CHARACTER_AUDIT__);
  if(material.materialCount!==4||material.textureCount!==11||material.bonesModified)throw Error('Source character materials did not bind exactly');
  if(errors.length)throw Error(errors.join('\n'));
  await page.evaluate(e=>window.__CSGO_CHARACTER_AK_EVIDENCE__=e,{poses,material,errors});
}
