async page=>{
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const evidence={errors},read=()=>page.evaluate(()=>({handling:window.__BREACHLINE__.handlingAudit(),audit:window.__BREACHLINE__.assetAudit(),audio:window.__BREACHLINE__.audioAudit()}));
 const save=()=>page.evaluate(e=>window.__SOURCE_AWP_GAMEPLAY_EVIDENCE__=e,evidence),own=r=>r.handling.authority.player;
 const ready=()=>page.waitForFunction(()=>{const p=window.__BREACHLINE__.handlingAudit().authority.player;return p?.weapon==='awp'&&p.cooldown===0&&!p.sourceAWP.command.reloading;},null,{timeout:60000});
 await page.goto('http://127.0.0.1:27019/?map=de_dust2');const start=page.getByRole('button',{name:/^开始人机训练/});await start.waitFor({state:'visible',timeout:240000});await page.getByRole('textbox',{name:'呼号',exact:true}).fill('AWP Proof',{timeout:60000,force:true});await start.click({timeout:60000,force:true});await page.waitForFunction(()=>!!document.pointerLockElement,null,{timeout:60000});
 await page.keyboard.press('KeyB');const shop=page.getByRole('dialog').filter({hasText:'购买装备'});await shop.waitFor({state:'visible'});evidence.beforeBuy=await read();
 await shop.getByRole('button',{name:/^AWP/}).click({timeout:60000,force:true});
 await page.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player?.weapon==='awp'&&window.__BREACHLINE__.assetAudit().firstPerson?.detail?.weapon==='awp');
 evidence.draw=await read();await save();
 if(own(evidence.draw).team!=='amber'||own(evidence.draw).primary!=='awp'||own(evidence.draw).weapon!=='awp'||own(evidence.draw).ammo!==5||own(evidence.draw).reserve!==30)throw Error('Original T AWP purchase failed');
 if(own(evidence.beforeBuy).money-own(evidence.draw).money!==4750)throw Error('AWP price mismatch');
 if(evidence.draw.audit.firstPerson.armsProfile!=='t_arms'||!evidence.draw.audit.firstPerson.hashVerified)throw Error('T original AWP owner/arms missing');
 if(own(evidence.draw).secondary!=='glock')throw Error('T secondary glock lost after AWP purchase');
 await shop.getByRole('button',{name:'Close',exact:true}).click({timeout:60000,force:true});await page.waitForFunction(()=>!!document.pointerLockElement,null,{timeout:60000});await ready();
 await page.screenshot({path:'output/playwright/source-r4-awp-t-draw-live.png'});
 // Original two-stage scope: right click cycles zoom 1 then 2, FOV 90->40->10.
 await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});
 await page.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.sourceAWP.command.zoomLevel===1);
 await page.waitForTimeout(120);evidence.zoom1=await read();await page.screenshot({path:'output/playwright/source-r4-awp-t-zoom1-live.png'});await save();
 if(own(evidence.zoom1).sourceAWP.command.fovTarget!==40||!own(evidence.zoom1).sourceAWP.command.scoped)throw Error('AWP zoom level 1 FOV/scoped failed');
 if(!evidence.zoom1.audio.recentSourceEvents.some(e=>e.key==='source_awp_14'))throw Error('AWP original zoom WAV missing');
 await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});
 await page.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.sourceAWP.command.zoomLevel===2);
 evidence.zoom2=await read();if(own(evidence.zoom2).sourceAWP.command.fovTarget!==10)throw Error('AWP zoom level 2 FOV failed');
 // Scoped fire consumes one round and unzooms to default FOV.
 await page.mouse.down();await page.waitForTimeout(500);await page.mouse.up();
 evidence.shot=await read();await save();
 if(own(evidence.shot).ammo!==4)throw Error('AWP scoped shot did not consume one round');
 if(own(evidence.shot).sourceAWP.command.scoped)throw Error('AWP should unzoom after firing');
 if(!evidence.shot.handling.shots.some(e=>e.sourceAWPShot?.weapon==='awp'))throw Error('AWP authoritative bullet missing');
 if(!evidence.shot.audio.recentSourceEvents.some(e=>e.key==='source_awp_8'||e.key==='source_awp_9'))throw Error('AWP original shot WAV missing');
 await page.screenshot({path:'output/playwright/source-r4-awp-t-shot-live.png'});
 await ready();
 // Reload restores the magazine through the original command.
 await page.keyboard.press('KeyR');await page.waitForTimeout(300);evidence.reload=await read();await page.screenshot({path:'output/playwright/source-r4-awp-t-reload-live.png'});
 await page.waitForFunction(()=>{const p=window.__BREACHLINE__.handlingAudit().authority.player;return p.sourceAWP.command.reloading;});
 if(evidence.reload.audit.firstPerson.detail.sequence!=='reload')throw Error('AWP original reload sequence not sampled');
 await page.waitForFunction(()=>{const p=window.__BREACHLINE__.handlingAudit().authority.player;return p.ammo===5&&!p.sourceAWP.command.reloading;},null,{timeout:30000});
 evidence.reloaded=await read();
 // Inspection drives the original lookat01 first-person sequence.
 await ready();await page.keyboard.press('KeyF');await page.waitForTimeout(700);evidence.inspect=await read();await page.screenshot({path:'output/playwright/source-r4-awp-t-inspect-live.png'});await save();
 if(evidence.inspect.audit.firstPerson.detail.sequence!=='lookat01')throw Error('AWP original inspection failed');
 // Slow walk and crouch keep working while carrying the AWP.
 await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW');await page.waitForTimeout(600);evidence.walk=await read();await page.keyboard.up('KeyW');await page.keyboard.down('ControlLeft');await page.waitForTimeout(300);evidence.crouch=await read();await page.keyboard.up('ControlLeft');await page.keyboard.up('ShiftLeft');await save();
 if(!own(evidence.walk).sourceWalking||!own(evidence.crouch).crouch)throw Error('AWP movement failed');
 if(evidence.inspect.audit.map.propLighting.totalAppliedMeshes!==2640)throw Error('Original map regression while AWP active');
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'返回主菜单',exact:true}).waitFor({state:'visible',timeout:60000});await page.getByRole('button',{name:'返回主菜单',exact:true}).click({timeout:60000,force:true});evidence.cleanup=await page.evaluate(()=>fetch('/api/rooms').then(r=>r.json()));evidence.status='passed';evidence.scope='Actual T training UI AWP purchase (4750, 5+30, t_arms), two-stage original scope FOV 40/10 with zoom WAV, scoped authoritative shot + original shot WAV, original reload command, lookat01 inspection, slow walk/crouch and secondary glock inventory.';await save();if(errors.length)throw Error(errors.join('\n'));
}
