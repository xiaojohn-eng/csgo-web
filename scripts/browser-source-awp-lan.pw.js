async page=>{
 const errors=[],sockets=[],peer=await page.context().newPage(),name='原 AWP 双客户端验收';
 const evidence={errors,sockets,physicalDevices:1,browserClients:2};
 for(const p of [page,peer]){p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});p.on('websocket',w=>sockets.push(w.url()));}
 const read=p=>p.evaluate(()=>({snapshot:window.__BREACHLINE__.snapshot(),handling:window.__BREACHLINE__.handlingAudit(),audit:window.__BREACHLINE__.assetAudit(),audio:window.__BREACHLINE__.audioAudit()}));
 const own=r=>r.handling.authority.player;
 const save=()=>page.evaluate(e=>window.__SOURCE_AWP_LAN_EVIDENCE__=e,evidence);
 const pause=async p=>{await p.bringToFront();if(!await p.getByRole('button',{name:'返回主菜单',exact:true}).isVisible())await p.keyboard.press('Escape');await p.getByRole('button',{name:'返回主菜单',exact:true}).waitFor({state:'visible',timeout:60000});};
 const resume=async p=>{await p.bringToFront();await p.getByRole('button',{name:'继续行动',exact:true}).click({timeout:60000,force:true});await p.waitForFunction(()=>!!document.pointerLockElement,null,{timeout:60000}).catch(async()=>{await p.getByRole('button',{name:'继续行动',exact:true}).click({timeout:60000,force:true}).catch(()=>{});await p.waitForFunction(()=>!!document.pointerLockElement,null,{timeout:60000});});await p.getByRole('button',{name:'返回主菜单',exact:true}).waitFor({state:'hidden'});};
 const ready=()=>peer.waitForFunction(()=>{const p=window.__BREACHLINE__.handlingAudit().authority.player;return window.__BREACHLINE__.snapshot()?.phase==='live'&&p?.weapon==='awp'&&p.cooldown===0&&!p.sourceAWP.command.reloading;},null,{timeout:60000});
 try{
  for(const p of [page,peer]){await p.goto('http://192.168.1.100:27019/?map=de_dust2',{waitUntil:'domcontentloaded',timeout:60000});await p.getByRole('button',{name:/^开始人机训练/}).waitFor({state:'visible',timeout:240000});await p.waitForLoadState('networkidle',{timeout:60000}).catch(()=>{});await p.waitForTimeout(1500);}
  await page.getByRole('textbox',{name:'呼号',exact:true}).fill('AWP host',{timeout:60000,force:true});await page.getByRole('button',{name:'创建房间',exact:true}).click({timeout:60000,force:true});await page.getByLabel('房间名称',{exact:true}).fill(name,{timeout:60000,force:true});await page.getByRole('button',{name:'创建并进入房间',exact:true}).click({timeout:60000,force:true});await page.waitForFunction(()=>window.__BREACHLINE__.snapshot()?.players.some(p=>p.name==='AWP host'),null,{timeout:60000});await pause(page);
  await peer.bringToFront();await peer.waitForTimeout(500);await peer.getByRole('textbox',{name:'呼号',exact:true}).fill('AWP CT',{timeout:60000,force:true});await peer.getByRole('button',{name:'局域网房间',exact:true}).click({timeout:60000,force:true});await peer.getByRole('listitem').filter({hasText:name}).click({timeout:60000,force:true});await peer.getByRole('button',{name:'加入所选房间',exact:true}).click({timeout:60000,force:true});await peer.waitForFunction(()=>window.__BREACHLINE__.snapshot()?.players.filter(p=>!p.bot).length===2);await resume(peer);
  await peer.keyboard.press('KeyB');const shop=peer.getByRole('dialog').filter({hasText:'购买装备'});await shop.waitFor({state:'visible'});evidence.beforeBuy=await read(peer);
  await shop.getByRole('button',{name:/^AWP/}).click({timeout:60000,force:true});
  await peer.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player?.weapon==='awp'&&window.__BREACHLINE__.assetAudit().firstPerson?.detail?.weapon==='awp');
  evidence.draw=await read(peer);await save();await shop.getByRole('button',{name:'Close',exact:true}).click({timeout:60000,force:true});await peer.waitForFunction(()=>!!document.pointerLockElement);await peer.screenshot({path:'output/playwright/source-r4-awp-ct-draw-lan.png'});
  if(own(evidence.draw).team!=='blue'||own(evidence.draw).primary!=='awp'||own(evidence.draw).weapon!=='awp'||own(evidence.draw).ammo!==5||own(evidence.draw).reserve!==30)throw Error('Original CT AWP purchase failed');
  if(own(evidence.beforeBuy).money-own(evidence.draw).money!==4750)throw Error('AWP price mismatch');
  if(evidence.draw.audit.firstPerson.armsProfile!=='ct_arms_idf'||!evidence.draw.audit.firstPerson.hashVerified)throw Error('CT original AWP owner/arms missing');
  if(!evidence.draw.audit.originalAWP?.blue?.hashVerified)throw Error('AWP character audit unverified');
  await peer.waitForFunction(()=>window.__BREACHLINE__.snapshot().phase==='live',null,{timeout:30000});
  // Original two-stage scope: right click cycles zoom 1 then 2, FOV 90->40->10.
  await peer.mouse.down({button:'right'});await peer.mouse.up({button:'right'});
  await peer.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.sourceAWP.command.zoomLevel===1);
  await peer.waitForTimeout(120);evidence.zoom1=await read(peer);await peer.screenshot({path:'output/playwright/source-r4-awp-ct-zoom1-lan.png'});await save();
  if(own(evidence.zoom1).sourceAWP.command.fovTarget!==40||!own(evidence.zoom1).sourceAWP.command.scoped)throw Error('AWP zoom level 1 FOV/scoped failed');
  await peer.mouse.down({button:'right'});await peer.mouse.up({button:'right'});
  await peer.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.sourceAWP.command.zoomLevel===2);
  evidence.zoom2=await read(peer);if(own(evidence.zoom2).sourceAWP.command.fovTarget!==10)throw Error('AWP zoom level 2 FOV failed');
  // Scoped fire consumes one round and unzooms to default FOV with resume armed.
  await peer.mouse.down();await peer.waitForTimeout(500);await peer.mouse.up();
  evidence.shot=await read(peer);await save();
  if(own(evidence.shot).ammo!==4)throw Error('LAN AWP scoped shot did not consume one round');
  if(own(evidence.shot).sourceAWP.command.scoped)throw Error('AWP should unzoom immediately after firing');
  if(!evidence.shot.handling.shots.some(e=>e.sourceAWPShot?.weapon==='awp'))throw Error('LAN AWP authoritative bullet missing');
  if(!evidence.shot.audio.recentSourceEvents.some(e=>e.key==='source_awp_8'||e.key==='source_awp_9'))throw Error('LAN AWP original shot WAV missing');
  await peer.screenshot({path:'output/playwright/source-r4-awp-ct-shot-lan.png'});
  await ready();
  // Reload restores the magazine through the original command.
  await peer.keyboard.press('KeyR');await peer.waitForTimeout(500);evidence.reload=await read(peer);
  await peer.waitForFunction(()=>{const p=window.__BREACHLINE__.handlingAudit().authority.player;return p.sourceAWP.command.reloading;});await save();
  await peer.waitForFunction(()=>{const p=window.__BREACHLINE__.handlingAudit().authority.player;return p.ammo===5&&!p.sourceAWP.command.reloading;},{timeout:15000});
  evidence.reloaded=await read(peer);
  // Inspection drives the original lookat01 first-person sequence.
  await peer.keyboard.press('KeyF');await peer.waitForTimeout(700);evidence.inspect=await read(peer);await peer.screenshot({path:'output/playwright/source-r4-awp-ct-inspect-lan.png'});await save();
  if(evidence.inspect.audit.firstPerson.detail.sequence!=='lookat01')throw Error('LAN AWP original inspection failed');
  // Zoom sound event present after scoping again.
  await peer.keyboard.press('Escape');
  await resume(peer);await ready();
  await peer.mouse.down({button:'right'});await peer.mouse.up({button:'right'});
  await peer.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.sourceAWP.command.zoomLevel===1);
  evidence.rezoom=await read(peer);
  if(!evidence.rezoom.audio.recentSourceEvents.some(e=>e.key==='source_awp_14'))throw Error('LAN AWP original zoom WAV missing');
  await peer.mouse.down({button:'right'});await peer.mouse.up({button:'right'});await peer.mouse.down({button:'right'});await peer.mouse.up({button:'right'});
  await peer.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.sourceAWP.command.zoomLevel===0);
  await pause(peer);
  await resume(page);await page.keyboard.press('Digit1');await page.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.weapon==='vandal');await page.waitForTimeout(900);evidence.hostDraw=await read(page);await pause(page);
  evidence.both=await Promise.all([page,peer].map(read));await save();
  // Cross-client AWP state/pose/identity verification.
  for(const r of evidence.both){const ct=r.snapshot.players.find(p=>p.name==='AWP CT');if(!ct)throw Error('CT AWP player absent from remote snapshot');if(!ct.sourceAWP||!ct.sourceAWPPose)throw Error('Remote AWP state/pose missing');if(!ct.sourcePoseVersion.startsWith('csgo-ct-awp-12426148:'))throw Error('CT AWP pose version wrong');if(r.snapshot.simulationVersion!==r.audit.map.simulationVersion)throw Error('AWP client/server identity differs');}
  if(!evidence.both[0].snapshot.simulationVersion.includes('awp-v1')&&!evidence.both[0].snapshot.simulationVersion.includes('csgo-awp'))throw Error('AWP simulation identity not registered');
  if(!sockets.length||!sockets.every(s=>s.startsWith('ws://192.168.1.100:27019/')))throw Error('Clients bypassed LAN socket');
  if(errors.length)throw Error(errors.join('\n'));evidence.status='passed';
 }finally{
  try{evidence.peerFinal=await peer.evaluate(()=>({focused:document.hasFocus(),locked:!!document.pointerLockElement,visibility:document.visibilityState,hint:document.body.innerText.match(/请点击|同步|恢复|捕获|中断[^\n]*/g)?.slice(0,4)??[]}));}catch(e){evidence.peerFinal={dumpError:String(e)};}
  for(const p of [peer,page])if(!p.isClosed())try{if(await p.getByRole('button',{name:'返回主菜单',exact:true}).isVisible()||await p.evaluate(()=>!!window.__BREACHLINE__?.snapshot())){await pause(p);await p.getByRole('button',{name:'返回主菜单',exact:true}).click({timeout:60000,force:true});}}catch(e){errors.push('cleanup: '+String(e));}
  if(!peer.isClosed())await peer.close().catch(()=>{});try{evidence.cleanup=await page.evaluate(()=>fetch('/api/rooms').then(r=>r.json()));}catch(e){errors.push('cleanup-rooms: '+String(e));}evidence.scope='One physical Mac, two real LAN browsers: CT AWP purchase (4750), two-stage original scope FOV 40/10, scoped authoritative shot + original WAV, reload, lookat01 inspection, CT original arms, cross-client state/pose/identity, T default rifle regression.';try{await save();}catch(e){errors.push('save: '+String(e));}
 }
}
