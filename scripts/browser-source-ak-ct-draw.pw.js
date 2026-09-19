async page=>{
 const errors=[],peer=await page.context().newPage();
 for(const p of [page,peer]){p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});}
 const read=p=>p.evaluate(()=>({snapshot:window.__BREACHLINE__.snapshot(),audit:window.__BREACHLINE__.assetAudit(),audio:window.__BREACHLINE__.audioAudit()}));
 const pause=async p=>{await p.bringToFront();if(!await p.getByRole('button',{name:'返回主菜单',exact:true}).isVisible())await p.keyboard.press('Escape');await p.getByRole('button',{name:'返回主菜单',exact:true}).waitFor({state:'visible'});};
 for(const p of [page,peer]){await p.goto('http://192.168.1.100:27019/?map=de_dust2');await p.getByRole('button',{name:/^开始人机训练/}).waitFor({state:'visible',timeout:120000});}
 await page.getByRole('textbox',{name:'呼号',exact:true}).fill('Draw Host');await page.getByRole('button',{name:'创建房间',exact:true}).click();await page.getByLabel('房间名称',{exact:true}).fill('原 CT AK 拔枪验收');await page.getByRole('button',{name:'创建并进入房间',exact:true}).click();await page.waitForFunction(()=>window.__BREACHLINE__.snapshot()?.players.some(p=>p.name==='Draw Host'));await pause(page);
 await peer.getByRole('textbox',{name:'呼号',exact:true}).fill('CT Draw');await peer.getByRole('button',{name:'局域网房间',exact:true}).click();await peer.getByRole('listitem').filter({hasText:'原 CT AK 拔枪验收'}).click();await peer.getByRole('button',{name:'加入所选房间',exact:true}).click();await peer.waitForFunction(()=>window.__BREACHLINE__.snapshot()?.players.filter(p=>!p.bot).length===2);
 await peer.bringToFront();await peer.getByRole('button',{name:'继续行动',exact:true}).click();await peer.waitForFunction(()=>!!document.pointerLockElement);
 await peer.keyboard.press('KeyB');const shop=peer.getByRole('dialog').filter({hasText:'购买装备'});await shop.waitFor({state:'visible'});const before=await read(peer);
 await shop.getByRole('button',{name:/^AK-47/}).click();await peer.waitForFunction(()=>window.__BREACHLINE__.assetAudit().firstPerson?.detail?.weapon==='ak47');
 const draw=await read(peer);
 await shop.getByRole('button',{name:'Close',exact:true}).click();await peer.waitForFunction(()=>!!document.pointerLockElement);await peer.getByRole('button',{name:'返回主菜单',exact:true}).waitFor({state:'hidden'});await peer.screenshot({path:'output/playwright/source-r4-ak-ct-draw-live.png'});await peer.waitForTimeout(1100);const complete=await read(peer);
 await peer.waitForFunction(()=>window.__BREACHLINE__.snapshot().phase==='live',null,{timeout:30000});
 await peer.keyboard.press('KeyF');await peer.waitForTimeout(200);await peer.mouse.down();await peer.waitForTimeout(150);await peer.mouse.up();await peer.waitForTimeout(70);const interrupted=await read(peer);
 await page.evaluate(e=>window.__SOURCE_AK_CT_DRAW_EVIDENCE__=e,{before,draw,complete,interrupted,errors,physicalDevices:1,browserClients:2});
 const own=r=>r.snapshot.players.find(p=>p.name==='CT Draw');
 if(own(before).team!=='blue'||own(draw).weapon!=='vandal'||own(draw).money!==own(before).money-2700)throw Error('Real CT AK purchase did not complete');
 if(draw.audit.firstPerson.armsProfile!=='ct_arms_idf'||draw.audit.firstPerson.detail.pose!=='draw'||!draw.audit.firstPerson.hashVerified)throw Error('Original CT AK draw/hash/arms mismatch');
 for(const key of ['source_ak47_draw','source_ak47_boltpull'])if(!complete.audio.recentSourceEvents.some(e=>e.key===key))throw Error('CT AK draw sound missing: '+key);
 if(own(interrupted).ammo>=30||interrupted.audit.firstPerson.detail.pose==='inspect')throw Error('Actual shot did not interrupt inspection');
 await pause(peer);await peer.getByRole('button',{name:'返回主菜单',exact:true}).click();await page.waitForFunction(()=>window.__BREACHLINE__.snapshot().players.filter(p=>!p.bot).length===1);await pause(page);await page.getByRole('button',{name:'返回主菜单',exact:true}).click();await page.waitForFunction(()=>fetch('/api/rooms').then(r=>r.json()).then(r=>r.rooms.every(x=>x.name!=='原 CT AK 拔枪验收')));const cleanup=await page.evaluate(()=>fetch('/api/rooms').then(r=>r.json()));await peer.close();
 await page.evaluate(e=>window.__SOURCE_AK_CT_DRAW_EVIDENCE__={...window.__SOURCE_AK_CT_DRAW_EVIDENCE__,cleanup:e},cleanup);
 if(errors.length)throw Error(errors.join('\n'));
}
