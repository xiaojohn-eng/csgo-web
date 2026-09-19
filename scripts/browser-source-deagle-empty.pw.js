async page=>{
 const errors=[],evidence={errors,physicalDevices:1,browserClients:1};
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const read=()=>page.evaluate(()=>({handling:window.__BREACHLINE__.handlingAudit(),audio:window.__BREACHLINE__.audioAudit()}));
 const save=()=>page.evaluate(e=>window.__SOURCE_DEAGLE_EMPTY_EVIDENCE__=e,evidence);
 const ready=()=>page.waitForFunction(()=>{const p=window.__BREACHLINE__.handlingAudit().authority.player;return p?.weapon==='deagle'&&p.cooldown===0&&!p.sourceDeagle.command.reloading;});
 try{
  await page.goto('http://192.168.1.100:27019/?map=de_dust2');
  const start=page.getByRole('button',{name:/^开始人机训练/});await start.waitFor({state:'visible',timeout:120000});
  await page.getByRole('textbox',{name:'呼号',exact:true}).fill('Empty trigger proof');await start.click();await page.waitForFunction(()=>!!document.pointerLockElement);
  await page.keyboard.press('KeyB');const shop=page.getByRole('dialog').filter({hasText:'购买装备'});await shop.waitFor({state:'visible'});
  await shop.getByRole('button',{name:/^Desert Eagle/}).click();await page.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player?.weapon==='deagle');
  await shop.getByRole('button',{name:'Close',exact:true}).click();await page.waitForFunction(()=>!!document.pointerLockElement);
  evidence.before=await read();evidence.shots=[];
  for(let n=0;n<42;n++){
   await ready();const before=await page.evaluate(()=>window.__BREACHLINE__.handlingAudit().authority.player.ammo);
   await page.mouse.down();await page.waitForTimeout(60);await page.mouse.up();
   await page.waitForFunction(before=>window.__BREACHLINE__.handlingAudit().authority.player.ammo===before-1,before);
   const p=await page.evaluate(()=>window.__BREACHLINE__.handlingAudit().authority.player);evidence.shots.push({number:n+1,ammo:p.ammo,reserve:p.reserve,lastShot:p.sourceDeagle.command.lastShot});
  }
  await ready();evidence.exhausted=await read();
  await page.mouse.down();await page.waitForTimeout(60);await page.mouse.up();await page.waitForTimeout(400);evidence.empty=await read();
  await page.screenshot({path:'output/playwright/source-r4-deagle-empty-live.png'});
  const p=evidence.empty.handling.authority.player,events=evidence.empty.audio.recentSourceEvents.filter(e=>e.key==='source_pistol_command_empty');
  if(p.ammo!==0||p.reserve!==0||p.sourceDeagle.command.dryFireCount!==1||events.length!==1)throw Error('Empty trigger must produce exactly one original audio event after 42 normal shots');
  if(errors.length)throw Error(errors.join('\n'));evidence.status='passed';
 }finally{
  await page.mouse.up();
  if(await page.evaluate(()=>!!window.__BREACHLINE__?.snapshot())){
   if(!await page.getByRole('button',{name:'返回主菜单',exact:true}).isVisible())await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'返回主菜单',exact:true}).click();
  }
  evidence.cleanup=await page.evaluate(()=>fetch('/api/rooms').then(r=>r.json()));
  evidence.scope='Actual training UI purchase, 42 normal accepted shots and five auto-reloads, then one empty press; no ammunition/state injection.';await save();
 }
}
