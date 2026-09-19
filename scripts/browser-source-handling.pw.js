async page=>{
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://192.168.1.100:27019/?map=de_dust2');
 const start=page.getByRole('button',{name:/^开始人机训练/});await start.waitFor({state:'visible',timeout:120000});
 await page.getByRole('textbox',{name:'呼号',exact:true}).fill('Native Handling');await start.click();
 await page.waitForFunction(()=>!!document.pointerLockElement);await page.waitForTimeout(500);
 const before=await page.evaluate(()=>window.__BREACHLINE__.handlingAudit());
 await page.evaluate(()=>{
  window.__SOURCE_HANDLING_CAPTURE__={frames:[],shots:{},done:false};
  const sample=()=>{const out=window.__SOURCE_HANDLING_CAPTURE__;if(out.done)return;
   const a=window.__BREACHLINE__.handlingAudit(),p=a?.authority.player;
   if(a&&p){for(const e of a.shots??[])out.shots[e.id]=e;
    if(out.frames.length<900)out.frames.push({time:a.authority.time,yaw:a.yaw,pitch:a.pitch,grounded:p.grounded,crouch:p.crouch,
     velocity:[p.vx,p.vy,p.vz],fallVelocity:p.sourceFallVelocity,ammo:p.ammo,reload:p.reload,
     handling:p.sourceRifleHandling,cameraForward:a.cameraForward,view:a.view});}
   requestAnimationFrame(sample);
  };requestAnimationFrame(sample);
 });
 await page.mouse.down();await page.waitForTimeout(720);
 await page.screenshot({path:'output/playwright/source-r4-native-handling-spray.png'});
 await page.keyboard.press('Space');await page.waitForTimeout(460);await page.mouse.up();await page.waitForTimeout(700);
 await page.keyboard.down('ControlLeft');await page.mouse.down();await page.waitForTimeout(420);await page.mouse.up();await page.keyboard.up('ControlLeft');
 await page.keyboard.press('KeyR');await page.waitForTimeout(650);
 const reload=await page.evaluate(()=>window.__BREACHLINE__.handlingAudit());
 await page.screenshot({path:'output/playwright/source-r4-native-handling-reload.png'});
 await page.waitForTimeout(6500);
 const after=await page.evaluate(()=>window.__BREACHLINE__.handlingAudit());
 const capture=await page.evaluate(()=>{window.__SOURCE_HANDLING_CAPTURE__.done=true;return window.__SOURCE_HANDLING_CAPTURE__;});
 const audit=await page.evaluate(()=>window.__BREACHLINE__.assetAudit());
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'返回主菜单',exact:true}).waitFor({state:'visible'});await page.getByRole('button',{name:'返回主菜单',exact:true}).click();
 await page.evaluate(e=>window.__SOURCE_HANDLING_EVIDENCE__=e,{before,reload,after,capture,audit,errors,scope:'Actual HTTP LAN-hostname local training controls. Native rifle accuracy/punch/landing and authority-only bullet seeds; no synthetic game state. Browser physics uses the current Rapier movement contract, not a complete Source engine.'});
 const p=after.authority.player,shots=Object.values(capture.shots);
 if(shots.length<8||!capture.frames.some(f=>!f.grounded)||!capture.frames.some(f=>f.crouch))throw Error('Actual spray/jump/crouch actions incomplete');
 if(!(reload.authority.player.reload>0)||p.ammo!==30||p.reload!==0)throw Error('Native handling reload did not complete');
 if(p.sourceRifleHandling.weapons.ak47.recoilIndex>.02||p.sourceRifleHandling.punch.angle.some(v=>Math.abs(v)>.01))throw Error('Original punch/index did not recover');
 if(audit.map.propLighting.appliedMeshes!==2325)throw Error('R5 compound tint/decal is not enabled');
 if(!shots.every(e=>e.sourceRifleShot&&e.sourceRifleShot.seedByte===(e.sourceRifleShot.serverSeed&255)))throw Error('Missing authoritative native bullet record');
 if(errors.length)throw Error(errors.join('\n'));
}
