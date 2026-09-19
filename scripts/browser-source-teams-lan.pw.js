async (page) => {
  const errors=[], sockets=[];
  const observe = p => {
    p.on('pageerror', e=>errors.push(String(e)));
    p.on('console', m=>{if(m.type()==='error')errors.push(m.text());});
    p.on('websocket', ws=>sockets.push(ws.url()));
  };
  observe(page);
  const pause = async p => {
    await p.bringToFront();
    if (!(await p.getByRole('button',{name:'返回主菜单',exact:true}).isVisible())) await p.keyboard.press('Escape');
    await p.getByRole('button',{name:'返回主菜单',exact:true}).waitFor({state:'visible'});
  };
  await page.goto('http://192.168.1.100:27019/?map=de_dust2');
  await page.waitForFunction(()=>window.__BREACHLINE__?.assetAudit()?.counterTerrorist?.id?.startsWith('csgo-ct-ak-12426148')&&window.__BREACHLINE__?.assetAudit()?.map?.propLighting?.appliedMeshes===1300,null,{timeout:120000});
  await page.getByRole('textbox',{name:'呼号',exact:true}).fill('LAN Host');
  await page.getByRole('button',{name:'创建房间',exact:true}).click();
  await page.getByLabel('房间名称',{exact:true}).fill('Dust2 R4 双客户端验收');
  await page.getByRole('button',{name:'创建并进入房间',exact:true}).click();
  await page.waitForFunction(()=>window.__BREACHLINE__?.snapshot()?.players.some(p=>p.name==='LAN Host'));
  await pause(page);
  const hostInitial=await page.evaluate(()=>window.__BREACHLINE__.snapshot());
  const rooms=await page.evaluate(()=>fetch('/api/rooms').then(r=>r.json()));
  const peer=await page.context().newPage(); observe(peer);
  await peer.goto('http://192.168.1.100:27019/?map=de_dust2');
  await peer.waitForFunction(()=>window.__BREACHLINE__?.assetAudit()?.counterTerrorist?.id?.startsWith('csgo-ct-ak-12426148')&&window.__BREACHLINE__?.assetAudit()?.map?.propLighting?.appliedMeshes===1300,null,{timeout:120000});
  await peer.getByRole('textbox',{name:'呼号',exact:true}).fill('LAN Peer');
  await peer.getByRole('button',{name:'局域网房间',exact:true}).click();
  await peer.getByRole('listitem').filter({hasText:'Dust2 R4 双客户端验收'}).click();
  await peer.getByRole('button',{name:'加入所选房间',exact:true}).click();
  await peer.waitForFunction(()=>window.__BREACHLINE__?.snapshot()?.players.filter(p=>!p.bot).length===2);
  await pause(peer);
  const joined=await peer.evaluate(()=>window.__BREACHLINE__.snapshot());
  const audits=await Promise.all([page,peer].map(p=>p.evaluate(()=>({audit:window.__BREACHLINE__.assetAudit(),secureContext:isSecureContext,subtle:!!globalThis.crypto?.subtle}))));
  for(const value of audits){if(value.secureContext||value.subtle)throw Error('LAN did not exercise fallback SHA');
    for(const files of [value.audit.map.hashVerified,value.audit.character.hashVerified,value.audit.counterTerrorist.hashVerified])if(!Object.values(files).every(Boolean))throw Error('Original LAN files did not hash verify');
  }
  if(!audits[1].audit.actors.some(a=>a.visible&&a.asset?.startsWith('csgo-ct-ak-12426148')))throw Error('No original CT teammate is rendered');
  for(const p of joined.players)if(!p.sourcePoseVersion.startsWith(p.team==='blue'?'csgo-ct-ak-12426148':'csgo-t-ak-12426148'))throw Error('Team received wrong original pose');
  await peer.screenshot({path:'output/playwright/source-r4-teams-lan-peer.png'});
  const hostJoined=await page.evaluate(()=>window.__BREACHLINE__.snapshot());
  await page.screenshot({path:'output/playwright/source-r4-teams-lan-host.png'});
  await pause(peer);
  await peer.getByRole('button',{name:'返回主菜单',exact:true}).click();
  await page.waitForFunction(()=>window.__BREACHLINE__.snapshot().players.filter(p=>!p.bot).length===1);
  const peerLeft=await page.evaluate(()=>window.__BREACHLINE__.snapshot());
  await pause(page);
  await page.getByRole('button',{name:'返回主菜单',exact:true}).click();
  await page.waitForFunction(()=>fetch('/api/rooms').then(r=>r.json()).then(r=>r.rooms.every(x=>x.name!=='Dust2 R4 双客户端验收')));
  const cleanup=await page.evaluate(()=>fetch('/api/rooms').then(r=>r.json()));
  await peer.close();
  if(errors.length)throw Error(errors.join('\n'));
  for(const snapshot of [hostInitial,joined,hostJoined,peerLeft])if(snapshot.mapId!=='de_dust2-source-12426148'||snapshot.players.some(p=>!p.sourcePose||!p.sourcePoseVersion))throw Error('Authoritative Source map or pose missing');
  if(!sockets.every(url=>url.startsWith('ws://192.168.1.100:27019/')))throw Error('WebSocket did not use LAN endpoint');
  await page.evaluate(e=>{window.__CSGO_SOURCE_LAN_EVIDENCE__=e;},{hostInitial,rooms,joined,hostJoined,peerLeft,cleanup,sockets,errors,audits,physicalDevices:1,browserClients:2,scope:"Original Dust2, separate T/CT poses, VHV diffuse and mandatory SHA over HTTP LAN; combat separately tested"});
}
