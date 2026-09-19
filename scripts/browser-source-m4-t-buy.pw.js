async(page)=>{
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://192.168.1.100:27019/?map=de_dust2');
  const start=page.getByRole('button',{name:/^开始人机训练/});
  await start.waitFor({state:'visible',timeout:120000});
  await page.waitForFunction(()=>window.__BREACHLINE__?.assetAudit()?.originalM4?.t?.hashVerified,null,{timeout:120000});
  await page.getByRole('textbox',{name:'呼号',exact:true}).fill('T M4 Buyer');
  const read=()=>page.evaluate(()=>({snapshot:window.__BREACHLINE__.snapshot(),audit:window.__BREACHLINE__.assetAudit(),audio:window.__BREACHLINE__.audioAudit(),locked:!!document.pointerLockElement}));
  const own=r=>r.snapshot.players.find(p=>p.name==='T M4 Buyer');
  const exit=async()=>{if(await page.getByRole('dialog').filter({hasText:'购买装备'}).isVisible()){
      await page.getByRole('dialog').filter({hasText:'购买装备'}).getByRole('button',{name:'Close',exact:true}).click();
      await page.waitForFunction(()=>!!document.pointerLockElement);
      await page.getByRole('dialog').filter({hasText:'购买装备'}).waitFor({state:'hidden'});
      await page.waitForTimeout(200);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.pointerLockElement);
    await page.getByRole('button',{name:'返回主菜单',exact:true}).waitFor({state:'visible'});await page.waitForTimeout(200);
    await page.getByRole('button',{name:'返回主菜单',exact:true}).click();await start.waitFor({state:'visible'});
    // Chromium temporarily rejects a fresh pointer-lock request immediately
    // after Escape. A real new start is a separate user gesture after that gap.
    await page.waitForTimeout(1500);
  };
  await start.click();await page.waitForFunction(()=>!!document.pointerLockElement);await page.keyboard.press('KeyB');
  const shop=page.getByRole('dialog').filter({hasText:'购买装备'});await shop.waitFor({state:'visible'});
  const noArmor=await read();await shop.getByRole('button',{name:/^防弹衣\s*补满/}).click();
  await page.waitForFunction(()=>window.__BREACHLINE__.snapshot().players.find(p=>p.name==='T M4 Buyer').armor===100);
  const body=await read();if(own(body).money!==own(noArmor).money-650||own(body).helmet)throw Error('Body armor purchase differs');
  await shop.getByRole('button',{name:/^头盔升级/}).click();
  await page.waitForFunction(()=>window.__BREACHLINE__.snapshot().players.find(p=>p.name==='T M4 Buyer').helmet===true);
  const helmet=await read();if(own(helmet).money!==own(body).money-350)throw Error('Helmet upgrade did not cost 350');
  if(!(await shop.getByRole('button',{name:/^头盔升级/}).isDisabled()))throw Error('Owned helmet still purchasable');
  await page.evaluate(e=>window.__CSGO_SOURCE_T_BUY_PARTIAL__=e,{body,helmet});
  await page.screenshot({path:'output/playwright/source-r4-armor-buy.png'});await exit();
  await start.click();await page.waitForFunction(()=>!!document.pointerLockElement);await page.keyboard.press('KeyB');
  await shop.waitFor({state:'visible'});await shop.getByRole('button',{name:/^防弹衣 \+ 头盔/}).click();
  await page.waitForFunction(()=>window.__BREACHLINE__.snapshot().players.find(p=>p.name==='T M4 Buyer').helmet===true);
  const fullArmor=await read();if(own(fullArmor).armor!==100||own(fullArmor).money!==2400)throw Error('Full armor purchase did not cost 1000');await exit();
  await start.click();await page.waitForFunction(()=>!!document.pointerLockElement);const ak=await read();
  await page.keyboard.press('KeyB');await shop.waitFor({state:'visible'});await shop.getByRole('button',{name:/^M4A4/}).click();
  await page.waitForFunction(()=>window.__BREACHLINE__.assetAudit().firstPerson?.detail?.weapon==='m4a4'&&window.__BREACHLINE__.assetAudit().firstPerson?.armsProfile==='t_arms');
  const purchase=await read();if(own(purchase).money!==own(ak).money-3100||!own(purchase).sourcePoseVersion.startsWith('csgo-t-m4-12426148:'))throw Error('M4 purchase pose or price differs');
  await shop.getByRole('button',{name:'Close',exact:true}).click();await page.waitForFunction(()=>!!document.pointerLockElement);await page.waitForTimeout(900);
  const ready=await read();await page.screenshot({path:'output/playwright/source-r4-m4-t-live.png'});
  await page.mouse.down();await page.waitForTimeout(180);await page.mouse.up();await page.keyboard.press('KeyR');await page.waitForTimeout(700);
  const reload=await read();if(!(own(reload).reload>0)||own(reload).ammo>=30)throw Error('T M4 firing/reload failed');
  await page.screenshot({path:'output/playwright/source-r4-m4-t-reload.png'});
  await page.waitForTimeout(3000);await page.keyboard.press('KeyF');await page.waitForTimeout(1100);const inspect=await read();
  await page.screenshot({path:'output/playwright/source-r4-m4-t-inspect.png'});
  if(inspect.audit.firstPerson.detail.pose!=='inspect'||!inspect.audit.firstPerson.hashVerified)throw Error('T original M4 inspection missing');
  await exit();if(errors.length)throw Error(errors.join('\n'));
  await page.evaluate(e=>window.__CSGO_SOURCE_T_BUY_EVIDENCE__=e,{noArmor,body,helmet,fullArmor,ak,purchase,ready,reload,inspect,errors,physicalDevices:1,scope:'Actual UI: original armor 650/350/1000 and original T first-person M4 buy, shoot, reload, inspect; no debug state mutation'});
}
