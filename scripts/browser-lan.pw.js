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
  await page.goto('http://192.168.1.100:27015/');
  await page.getByRole('textbox',{name:'呼号',exact:true}).fill('LAN Host');
  await page.getByRole('button',{name:'创建房间',exact:true}).click();
  await page.getByLabel('房间名称',{exact:true}).fill('CSGO WEB 双客户端验收');
  await page.getByRole('button',{name:'创建并进入房间',exact:true}).click();
  await page.waitForFunction(()=>window.__BREACHLINE__?.snapshot()?.players.some(p=>p.name==='LAN Host'));
  await pause(page);
  const hostInitial=await page.evaluate(()=>window.__BREACHLINE__.snapshot());
  const rooms=await page.evaluate(()=>fetch('/api/rooms').then(r=>r.json()));
  const peer=await page.context().newPage(); observe(peer);
  await peer.goto('http://192.168.1.100:27015/');
  await peer.getByRole('textbox',{name:'呼号',exact:true}).fill('LAN Peer');
  await peer.getByRole('button',{name:'局域网房间',exact:true}).click();
  await peer.getByRole('listitem').filter({hasText:'CSGO WEB 双客户端验收'}).click();
  await peer.getByRole('button',{name:'加入所选房间',exact:true}).click();
  await peer.waitForFunction(()=>window.__BREACHLINE__?.snapshot()?.players.filter(p=>!p.bot).length===2);
  await pause(peer);
  const joined=await peer.evaluate(()=>window.__BREACHLINE__.snapshot());
  await peer.screenshot({path:'output/playwright/lan-peer-joined.png'});
  const hostJoined=await page.evaluate(()=>window.__BREACHLINE__.snapshot());
  await page.screenshot({path:'output/playwright/lan-host-joined.png'});
  await pause(peer);
  await peer.getByRole('button',{name:'返回主菜单',exact:true}).click();
  await page.waitForFunction(()=>window.__BREACHLINE__.snapshot().players.filter(p=>!p.bot).length===1);
  const peerLeft=await page.evaluate(()=>window.__BREACHLINE__.snapshot());
  await pause(page);
  await page.getByRole('button',{name:'返回主菜单',exact:true}).click();
  await page.waitForFunction(()=>fetch('/api/rooms').then(r=>r.json()).then(r=>r.rooms.every(x=>x.name!=='CSGO WEB 双客户端验收')));
  const cleanup=await page.evaluate(()=>fetch('/api/rooms').then(r=>r.json()));
  await peer.close();
  await page.evaluate(e=>{window.__CSGO_LAN_EVIDENCE__=e;},{hostInitial,rooms,joined,hostJoined,peerLeft,cleanup,sockets,errors,physicalDevices:1,browserClients:2});
}
