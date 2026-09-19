async page=>{
 const peer=await page.context().newPage(),observer=await page.context().newPage(),pages=[page,peer,observer],errors=[],sockets=[],room='红线三客户端验收',evidence={errors,sockets,physicalDevices:1,browserClients:3};
 for(const p of pages){p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});p.on('websocket',w=>sockets.push(w.url()));}
 const read=p=>p.evaluate(()=>({snapshot:window.__BREACHLINE__.snapshot(),audit:window.__BREACHLINE__.assetAudit(),own:window.__BREACHLINE__.handlingAudit().authority.player}));
 const save=()=>page.evaluate(e=>window.__SOURCE_REDLINE_LAN_EVIDENCE__=e,evidence);
 const pause=async p=>{await p.bringToFront();if(!await p.getByRole('button',{name:'返回主菜单',exact:true}).isVisible())await p.keyboard.press('Escape');await p.getByRole('button',{name:'返回主菜单',exact:true}).waitFor({state:'visible'});};
 const resume=async p=>{await p.bringToFront();if(await p.getByRole('button',{name:'继续行动',exact:true}).isVisible())await p.getByRole('button',{name:'继续行动',exact:true}).click();await p.waitForFunction(()=>!!document.pointerLockElement);};
 const join=async(p,name)=>{await p.getByRole('textbox',{name:'呼号',exact:true}).fill(name);await p.getByRole('button',{name:'局域网房间',exact:true}).click();await p.getByRole('listitem').filter({hasText:room}).click();await p.getByRole('button',{name:'加入所选房间',exact:true}).click();await p.waitForFunction(name=>window.__BREACHLINE__.snapshot()?.players.some(p=>p.name===name),name);};
 try{
  await Promise.all(pages.map(async p=>{await p.goto('http://192.168.1.100:27019/?map=de_dust2');await p.getByRole('button',{name:/^开始人机训练/}).waitFor({state:'visible',timeout:120000});}));
  for(const p of pages){await p.getByRole('button',{name:'武器库',exact:true}).click();await p.getByRole('button',{name:/^AK-47/}).click();await p.getByRole('button',{name:/^原版默认，/}).click();await p.waitForFunction(()=>window.__BREACHLINE__.assetAudit().sourceWeaponFinish.requested===null);await p.getByRole('button',{name:'行动',exact:true}).click();}
  await page.getByRole('button',{name:'武器库',exact:true}).click();await page.getByRole('button',{name:/^红线，/}).click();await page.waitForFunction(()=>window.__BREACHLINE__.assetAudit().sourceWeaponFinish.status.status==='ready');evidence.menu=await read(page);await page.getByRole('button',{name:'行动',exact:true}).click();
  await page.getByRole('textbox',{name:'呼号',exact:true}).fill('Redline host');await page.getByRole('button',{name:'创建房间',exact:true}).click();await page.getByLabel('房间名称',{exact:true}).fill(room);await page.getByRole('button',{name:'创建并进入房间',exact:true}).click();await page.waitForFunction(()=>!!window.__BREACHLINE__.handlingAudit().authority.player);await pause(page);
  await join(peer,'Redline CT');await pause(peer);await join(observer,'Redline observer');await resume(observer);
  await observer.waitForFunction(()=>{const s=window.__BREACHLINE__.snapshot(),host=s?.players.find(p=>p.name==='Redline host'),a=window.__BREACHLINE__.assetAudit().actors.find(a=>a.id===host?.id);return host?.sourceWeaponFinish?.seed===422&&a?.visible&&a.sourceWeaponFinish.length>0;},{},{timeout:120000});
  evidence.equipped=await Promise.all(pages.map(read));await save();
  const host=evidence.equipped[0].own,obs=evidence.equipped[2];
  if(host.team!=='amber'||obs.own.team!=='amber'||evidence.equipped[1].own.team!=='blue')throw Error('Three real clients did not occupy T/CT/T seats');
  const remote=obs.audit.actors.find(a=>a.id===host.id);if(remote.sourceWeapon!=='vandal'||remote.sourceWeaponFinish[0].evidence.colorSHA256!==evidence.equipped[0].audit.sourceWeaponFinish.materials[0].evidence.colorSHA256)throw Error('Remote original AK world finish differs');
  for(const r of evidence.equipped){const h=r.snapshot.players.find(p=>p.name==='Redline host');if(!h?.sourceWeaponFinish||h.sourceWeaponFinish.seed!==422||Math.abs(h.sourceWeaponFinish.wear-.4)>.000002)throw Error('Finish parameter snapshot failed');}
  for(const r of evidence.equipped.slice(1))if(r.own.sourceWeaponFinish||r.audit.sourceWeaponFinish.materials.length)throw Error('A player finish affected another player');
  // Aim through ordinary pointer movement at the nearby teammate; the game state is read only.
  let mx=640;await observer.mouse.move(mx,360);for(let i=0;i<4;i++){const r=await read(observer),h=r.snapshot.players.find(p=>p.name==='Redline host'),o=r.own,want=Math.atan2(o.x-h.x,o.z-h.z),delta=Math.atan2(Math.sin(want-o.yaw),Math.cos(want-o.yaw));mx-=delta/.0018;await observer.mouse.move(mx,360,{steps:8});await observer.waitForTimeout(100);}
  await observer.keyboard.press('Digit2');await observer.waitForFunction(()=>{const p=window.__BREACHLINE__.handlingAudit().authority.player;return p.weapon==='glock'&&p.cooldown===0;});
  await observer.mouse.move(mx,405,{steps:5});await observer.waitForTimeout(150);
  await observer.screenshot({path:'output/playwright/source-r4-redline-contract-world-lan.png'});evidence.worldView=await read(observer);await pause(observer);
  await page.getByRole('button',{name:'返回主菜单',exact:true}).click();await page.getByRole('button',{name:'武器库',exact:true}).click();await page.getByRole('button',{name:/^原版默认，/}).click();await page.waitForFunction(()=>window.__BREACHLINE__.assetAudit().sourceWeaponFinish.materials.length===0);await page.getByRole('button',{name:'行动',exact:true}).click();await join(page,'Redline cleared');await pause(page);
  await observer.bringToFront();await observer.waitForFunction(()=>{const s=window.__BREACHLINE__.snapshot(),h=s?.players.find(p=>p.name==='Redline cleared'),a=window.__BREACHLINE__.assetAudit().actors.find(a=>a.id===h?.id);return h&&!h.sourceWeaponFinish&&a?.sourceWeapon==='vandal'&&!a.sourceWeaponFinish.length;},{},{timeout:120000});
  evidence.restored=await Promise.all(pages.map(read));for(const r of evidence.restored){const h=r.snapshot.players.find(p=>p.name==='Redline cleared');if(!h||h.sourceWeaponFinish)throw Error('Default finish failed to synchronize after rejoin');}
  if(!sockets.length||!sockets.every(s=>s.startsWith('ws://192.168.1.100:27019/')))throw Error('Browsers bypassed LAN websocket');if(errors.length)throw Error(errors.join('\n'));evidence.status='passed';
 }finally{
  for(const p of [observer,peer,page])if(!p.isClosed())try{if(await p.evaluate(()=>!!window.__BREACHLINE__?.snapshot())){await pause(p);await p.getByRole('button',{name:'返回主菜单',exact:true}).click();}}catch(e){errors.push('cleanup: '+String(e));}
  for(const p of [observer,peer])if(!p.isClosed())await p.close();evidence.cleanup=await page.evaluate(()=>fetch('/api/rooms').then(r=>r.json()));evidence.scope='One physical Mac, three real LAN browsers, real UI selection, T/CT/T seats, original AK world-material parameters and current compositor SHA, own-player isolation, default restore and rejoin. This is not a cross-device or final native D3D pixel claim.';await save();
 }
}
