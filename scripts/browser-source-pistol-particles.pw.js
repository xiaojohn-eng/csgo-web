async page=>{
 const errors=[],evidence={errors,scope:'Actual training UI shots; pixels read immediately after real render frames. No clock, ammo, simulation or renderer mutation.'};
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const save=()=>page.evaluate(e=>window.__SOURCE_PISTOL_PARTICLES_EVIDENCE__=e,evidence);
 const read=()=>page.evaluate(()=>({audit:window.__BREACHLINE__.assetAudit(),handling:window.__BREACHLINE__.handlingAudit(),audio:window.__BREACHLINE__.audioAudit()}));
 const ready=()=>page.waitForFunction(()=>{const p=window.__BREACHLINE__.handlingAudit().authority.player;return p?.cooldown===0&&!p.reload;});
 const capture=async label=>{
  await ready();const before=await read();
  await page.evaluate(()=>{
   const start=window.__BREACHLINE__.assetAudit().sourcePistolParticles.bursts,frames=[];
   window.__PARTICLE_CAPTURE__={frames,done:false};let loops=0;
   const tick=()=>{
    const audit=window.__BREACHLINE__.assetAudit(),fx=audit.sourcePistolParticles;
    if(fx.bursts>start&&fx.current.counts.core>0){
     frames.push({fx:structuredClone(fx.current),attachment:structuredClone(audit.sourcePistolFx),image:document.querySelector('canvas').toDataURL('image/png')});
    }
    if(frames.length>=1||loops++>300){window.__PARTICLE_CAPTURE__.done=true;return;}requestAnimationFrame(tick);
   };requestAnimationFrame(tick);
  });
  await page.mouse.down();await page.waitForTimeout(60);await page.mouse.up();
  await page.waitForFunction(()=>window.__PARTICLE_CAPTURE__.done,{},{timeout:15000});
  const frames=await page.evaluate(()=>window.__PARTICLE_CAPTURE__.frames),after=await read();
  evidence[label]={before,after,frames};await save();
  if(after.audit.sourcePistolParticles.bursts!==before.audit.sourcePistolParticles.bursts+1||!frames.length)throw Error(label+' needs one accepted particle burst and live pixels');
  if(after.audit.sourcePistolParticles.placeholderVisible)throw Error(label+' showed the old cone');
 };
 try{
  await page.goto('http://192.168.1.100:27019/?map=de_dust2');const start=page.getByRole('button',{name:/^开始人机训练/});await start.waitFor({state:'visible',timeout:120000});
  evidence.loaded=await read();const hashes=evidence.loaded.audit.sourcePistolParticles.hashVerified;if(Object.keys(hashes).length!==5||Object.values(hashes).some(v=>v!==true))throw Error('Original particle resources not verified');
  await start.click();await page.waitForFunction(()=>!!document.pointerLockElement);await page.keyboard.press('Digit2');await page.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.weapon==='glock');await capture('glock');
  const buy=async name=>{await page.keyboard.press('KeyB');const shop=page.getByRole('dialog').filter({hasText:'购买装备'});await shop.getByRole('button',{name:new RegExp('^'+name)}).click();await shop.getByRole('button',{name:'Close',exact:true}).click();await page.waitForFunction(()=>!!document.pointerLockElement);};
  await buy('Desert Eagle');await page.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.weapon==='deagle');await capture('deagle');
  await buy('USP-S');await page.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.weapon==='usp');await ready();
  evidence.suppressedBefore=await read();await page.mouse.down();await page.waitForTimeout(60);await page.mouse.up();await page.waitForTimeout(100);evidence.suppressedAfter=await read();
  if(evidence.suppressedAfter.handling.authority.player.ammo!==11||evidence.suppressedAfter.audit.sourcePistolParticles.bursts!==evidence.suppressedBefore.audit.sourcePistolParticles.bursts||evidence.suppressedAfter.audit.sourcePistolParticles.placeholderVisible)throw Error('Suppressed USP incorrectly rendered normal flash');
  await ready();await page.mouse.down({button:'right'});await page.waitForTimeout(60);await page.mouse.up({button:'right'});await page.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.sourceUSP.command.silencerAttached===false);await capture('uspDetached');
  if(errors.length)throw Error(errors.join('\n'));evidence.status='passed';
 }finally{
  await page.mouse.up();await page.mouse.up({button:'right'});
  if(await page.evaluate(()=>!!window.__BREACHLINE__?.snapshot())){
   if(!await page.getByRole('button',{name:'返回主菜单',exact:true}).isVisible())await page.keyboard.press('Escape');await page.getByRole('button',{name:'返回主菜单',exact:true}).click();
  }
  evidence.cleanup=await page.evaluate(()=>fetch('/api/rooms').then(r=>r.json()));await save();
 }
}
