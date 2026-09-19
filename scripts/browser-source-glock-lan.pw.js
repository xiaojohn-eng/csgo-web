async page=>{
 const errors=[],sockets=[],peer=await page.context().newPage(),name='原 Glock 双客户端验收';
 const evidence={errors,sockets,physicalDevices:1,browserClients:2};
 for(const p of [page,peer]){p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});p.on('websocket',w=>sockets.push(w.url()));}
 const read=p=>p.evaluate(()=>({snapshot:window.__BREACHLINE__.snapshot(),handling:window.__BREACHLINE__.handlingAudit(),audit:window.__BREACHLINE__.assetAudit(),audio:window.__BREACHLINE__.audioAudit(),secureContext:isSecureContext}));
 const own=r=>r.handling.authority.player;
 const save=()=>page.evaluate(e=>window.__SOURCE_GLOCK_LAN_EVIDENCE__=e,evidence);
 const pause=async p=>{await p.bringToFront();if(!await p.getByRole('button',{name:'返回主菜单',exact:true}).isVisible())await p.keyboard.press('Escape');await p.getByRole('button',{name:'返回主菜单',exact:true}).waitFor({state:'visible'});};
 const resume=async p=>{await p.bringToFront();await p.getByRole('button',{name:'继续行动',exact:true}).click();await p.waitForFunction(()=>!!document.pointerLockElement);await p.getByRole('button',{name:'返回主菜单',exact:true}).waitFor({state:'hidden'});};
 // Load both original asset sets before the timed server buy phase starts.
 for(const p of [page,peer]){await p.goto('http://192.168.1.100:27019/?map=de_dust2');await p.getByRole('button',{name:/^开始人机训练/}).waitFor({state:'visible',timeout:120000});}
 await page.getByRole('textbox',{name:'呼号',exact:true}).fill('Glock T');await page.getByRole('button',{name:'创建房间',exact:true}).click();await page.getByLabel('房间名称',{exact:true}).fill(name);await page.getByRole('button',{name:'创建并进入房间',exact:true}).click();
 await page.waitForFunction(()=>window.__BREACHLINE__.snapshot()?.players.some(p=>p.name==='Glock T'));await pause(page);
 await peer.getByRole('textbox',{name:'呼号',exact:true}).fill('Glock CT');await peer.getByRole('button',{name:'局域网房间',exact:true}).click();await peer.getByRole('listitem').filter({hasText:name}).click();await peer.getByRole('button',{name:'加入所选房间',exact:true}).click();await peer.waitForFunction(()=>window.__BREACHLINE__.snapshot()?.players.filter(p=>!p.bot).length===2);
 await resume(peer);await peer.keyboard.press('KeyB');const shop=peer.getByRole('dialog').filter({hasText:'购买装备'});await shop.waitFor({state:'visible'});evidence.beforeBuy=await read(peer);
 await shop.getByRole('button',{name:/^Glock-18/}).click();await peer.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player?.weapon==='glock');
 evidence.draw=await read(peer);await save();await shop.getByRole('button',{name:'Close',exact:true}).click();await peer.waitForFunction(()=>!!document.pointerLockElement);await peer.getByRole('button',{name:'返回主菜单',exact:true}).waitFor({state:'hidden'});await peer.screenshot({path:'output/playwright/source-r4-glock-ct-draw-lan.png'});
 if(own(evidence.draw).team!=='blue'||own(evidence.draw).money!==own(evidence.beforeBuy).money-200||evidence.draw.audit.firstPerson.armsProfile!=='ct_arms_idf'||!evidence.draw.audit.firstPerson.hashVerified)throw Error('CT original Glock purchase / arms failed');
 await peer.waitForTimeout(1200);evidence.equipped=await read(peer);if(own(evidence.equipped).weapon!=='glock'||own(evidence.equipped).slot!==1)throw Error('Purchased Glock was lost to a stale input slot');
 await peer.waitForFunction(()=>window.__BREACHLINE__.snapshot().phase==='live',null,{timeout:30000});
 await peer.mouse.down();await peer.waitForTimeout(500);await peer.mouse.up();evidence.semi=await read(peer);await save();if(own(evidence.semi).ammo!==19)throw Error('LAN semi-auto held input did not consume one round');
 await peer.mouse.down({button:'right'});await peer.waitForTimeout(80);await peer.mouse.up({button:'right'});await peer.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.sourceGlock.command.burstMode);await peer.waitForTimeout(350);
 await peer.mouse.down();await peer.waitForTimeout(650);await peer.mouse.up();evidence.burst=await read(peer);await save();if(own(evidence.burst).ammo!==16)throw Error('LAN burst did not consume exactly three rounds');
 await peer.keyboard.press('KeyR');await peer.waitForTimeout(550);evidence.reload=await read(peer);await peer.screenshot({path:'output/playwright/source-r4-glock-ct-reload-lan.png'});
 await peer.waitForFunction(()=>{const p=window.__BREACHLINE__.handlingAudit().authority.player;return p.ammo===20&&p.sourceGlock.command.reloading;});evidence.earlyReload=await read(peer);await save();
 await peer.waitForFunction(()=>{const h=window.__BREACHLINE__.handlingAudit(),p=h.authority.player;return !p.sourceGlock.command.reloading&&Math.fround(h.authority.time)>=p.sourceGlock.command.ownerNextAttack;});
 await peer.keyboard.press('KeyF');await peer.waitForTimeout(600);evidence.inspect=await read(peer);await peer.screenshot({path:'output/playwright/source-r4-glock-ct-inspect-lan.png'});await save();
 if(evidence.inspect.audit.firstPerson.detail.sequence!=='lookat01')throw Error('LAN original CT Glock inspection failed');
 await peer.keyboard.down('ShiftLeft');await peer.keyboard.down('KeyW');await peer.waitForTimeout(1000);evidence.walk=await read(peer);await peer.keyboard.up('KeyW');await peer.keyboard.down('ControlLeft');await peer.waitForTimeout(350);evidence.crouch=await read(peer);await peer.keyboard.up('ControlLeft');await peer.waitForTimeout(400);evidence.stand=await read(peer);await peer.keyboard.up('ShiftLeft');
 await peer.keyboard.press('Digit1');await peer.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.weapon==='m4a4');evidence.primary=await read(peer);await peer.keyboard.press('Digit2');await peer.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.weapon==='glock');await peer.waitForTimeout(1200);evidence.redraw=await read(peer);await pause(peer);
 await resume(page);await page.keyboard.press('Digit2');await page.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.weapon==='glock');await page.waitForTimeout(1200);evidence.hostDraw=await read(page);await page.mouse.down();await page.waitForTimeout(500);await page.mouse.up();evidence.hostShot=await read(page);await page.screenshot({path:'output/playwright/source-r4-glock-t-lan.png'});await pause(page);
 evidence.both=await Promise.all([page,peer].map(read));await save();
 if(own(evidence.hostShot).team!=='amber'||own(evidence.hostShot).ammo!==19||evidence.hostDraw.audit.firstPerson.armsProfile!=='t_arms')throw Error('LAN T default Glock failed');
 if(own(evidence.primary).ammo!==30||own(evidence.redraw).ammo!==20||own(evidence.redraw).reserve!==116)throw Error('LAN primary / secondary ammo was mixed');
 if(!own(evidence.walk).sourceWalking||!evidence.walk.handling.prediction.player.sourceWalking||!own(evidence.crouch).crouch||own(evidence.stand).crouch)throw Error('LAN Glock movement / prediction mismatch');
 if(own(evidence.earlyReload).reserve!==116||!(own(evidence.earlyReload).reload>0)||!own(evidence.earlyReload).sourceGlock.command.reloadVisComplete)throw Error('LAN AE54 did not refill before the attack gate opened');
 for(const r of [evidence.semi,evidence.burst,evidence.hostShot])if(!r.handling.shots.some(e=>e.sourcePistolShot?.weapon==='glock18'))throw Error('Authoritative original Glock shot records missing');
 for(const r of evidence.both){
  if(r.secureContext||r.snapshot.simulationVersion!==r.audit.map.simulationVersion||!r.snapshot.simulationVersion.includes('app740-12426148-glock-animation-clock-v1'))throw Error('LAN original simulation identity / insecure HTTP SHA path failed');
  if(r.audit.map.olive?.meshes!==64||r.audit.map.olive.csm!==false||!r.audit.map.olive.verification.hashVerified)throw Error('LAN original no-CSM olive coverage missing');
  if(r.audit.map.propLighting.totalAppliedMeshes!==2459||!r.audit.map.wind.thinkCalls)throw Error('LAN native foliage / wind missing');
  if(Object.keys(r.audio.verifiedSourcePistolSounds).length!==34||Object.keys(r.audio.verifiedSourcePistolCommandSounds).length!==2)throw Error('LAN original pistol audio SHA incomplete');
  for(const human of r.snapshot.players.filter(p=>!p.bot)){if(!human.sourcePoseVersion.startsWith('csgo-'+(human.team==='amber'?'t':'ct')+'-glock-12426148')||!human.sourcePistolPose||!human.sourceViewmodelTime)throw Error('Original per-team full pistol pose / shared VM clock missing');}
 }
 if(!evidence.both[1].audio.recentSourceEvents.some(e=>e.key==='source_pistol_command_mode'))throw Error('Authoritative burst-mode sound was not played');
 if(!sockets.length||!sockets.every(s=>s.startsWith('ws://192.168.1.100:27019/')))throw Error('Socket did not use LAN endpoint');
 await pause(peer);await peer.getByRole('button',{name:'返回主菜单',exact:true}).click();await page.waitForFunction(()=>window.__BREACHLINE__.snapshot().players.filter(p=>!p.bot).length===1);await pause(page);await page.getByRole('button',{name:'返回主菜单',exact:true}).click();await page.waitForFunction(()=>fetch('/api/rooms').then(r=>r.json()).then(r=>r.rooms.every(x=>x.name!=='原 Glock 双客户端验收')));
 evidence.cleanup=await page.evaluate(()=>fetch('/api/rooms').then(r=>r.json()));await peer.close();evidence.scope='Two real browser clients on one physical Mac over HTTP LAN: T default Glock, CT purchase, native semi/burst/early reload, original arms/actions/audio, input prediction, independent slots and wind. No claim of two physical machines or complete AnimState/FX.';evidence.status='passed';await save();if(errors.length)throw Error(errors.join('\n'));
}
