async (page) => {
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:27015/');
  await page.bringToFront();
  await page.getByRole('button',{name:'开始人机训练 本地训练 · 即刻开玩'}).click();
  if(await page.getByRole('button',{name:'继续行动',exact:true}).isVisible())
    await page.getByRole('button',{name:'继续行动',exact:true}).click();
  await page.waitForFunction(()=>!!document.pointerLockElement);
  const read=()=>page.evaluate(()=>({locked:!!document.pointerLockElement,
    me:window.__BREACHLINE__.snapshot().players.find(p=>p.id==='local'),
    asset:window.__BREACHLINE__.assetAudit(),metrics:window.__BREACHLINE__.metrics()}));
  await page.waitForTimeout(300);
  const idle=await read();
  await page.screenshot({path:'output/playwright/source-ak-idle-r3.png'});
  await page.mouse.down();await page.waitForTimeout(220);await page.mouse.up();
  const fired=await read();
  await page.keyboard.press('r');await page.waitForTimeout(800);
  const reload=await read();
  await page.screenshot({path:'output/playwright/source-ak-reload-mid-r3.png'});
  await page.waitForTimeout(1700);
  const reloaded=await read();
  await page.keyboard.press('f');await page.waitForTimeout(1800);
  const inspect=await read();
  await page.screenshot({path:'output/playwright/source-ak-inspect-mid-r3.png'});
  await page.mouse.down({button:'right'});await page.waitForTimeout(30);
  const interrupted=await read();await page.mouse.up({button:'right'});
  await page.keyboard.press('Escape');
  const paused=await read();
  if(idle.asset.firstPerson.detail.pose!=='idle')throw Error('Original idle not active');
  const surfaces=idle.asset.firstPerson.detail.surfaces;
  if(surfaces.length!==3||surfaces.some(m=>m.type!=='MeshPhongMaterial'||!m.name.startsWith('Source_')))
    throw Error('Original AK and both arm materials did not receive their Source shader');
  if(!(fired.me.ammo<idle.me.ammo))throw Error('Weapon did not fire');
  if(reload.asset.firstPerson.detail.pose!=='reload')throw Error('Original reload not active');
  if(reloaded.me.ammo!==30)throw Error('Reload did not complete');
  if(inspect.asset.firstPerson.detail.pose!=='inspect')throw Error('Original inspection not active');
  if(interrupted.asset.firstPerson.detail.pose==='inspect')throw Error('Aim failed to interrupt inspection');
  if(paused.locked)throw Error('Escape failed to release pointer lock');
  if(errors.length)throw Error(errors.join('\n'));
  await page.evaluate(e=>window.__CSGO_SOURCE_WEAPON_EVIDENCE__=e,
    {idle,fired,reload,reloaded,inspect,interrupted,paused,errors});
}
