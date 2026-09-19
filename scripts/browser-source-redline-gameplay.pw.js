async page=>{
 const errors=[],evidence={errors};page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const read=()=>page.evaluate(()=>{const a=window.__BREACHLINE__.assetAudit(),h=window.__BREACHLINE__.handlingAudit();return{skin:a.skin,finish:a.sourceWeaponFinish,firstPerson:a.firstPerson,actors:a.actors,metrics:window.__BREACHLINE__.metrics(),player:h.authority.player?{weapon:h.authority.player.weapon,ammo:h.authority.player.ammo,sourceWeaponFinish:h.authority.player.sourceWeaponFinish}:null};});
 const ready=(seed,wear)=>page.waitForFunction(({seed,wear})=>{const a=window.__BREACHLINE__.assetAudit(),m=a.sourceWeaponFinish?.materials?.[0];return a.sourceWeaponFinish?.status.status==='ready'&&m?.finish.seed===seed&&Math.abs(m.finish.wear-wear)<.000002;},{seed,wear},{timeout:120000});
 const save=()=>page.evaluate(e=>window.__SOURCE_REDLINE_GAMEPLAY_EVIDENCE__=e,evidence);
 try{
  await page.goto('http://192.168.1.100:27019/?map=de_dust2');await page.getByRole('button',{name:/^开始人机训练/}).waitFor({state:'visible',timeout:120000});await page.getByRole('button',{name:'武器库',exact:true}).click();
  await page.getByRole('button',{name:/^原版默认，/}).click();await page.waitForFunction(()=>window.__BREACHLINE__.assetAudit().sourceWeaponFinish.materials.length===0);evidence.factory=await read();
  await page.getByRole('button',{name:/^红线，/}).click();await ready(422,.4);evidence.redline=await read();await page.screenshot({path:'output/playwright/source-r4-redline-contract-menu-422.png'});await save();
  await page.getByRole('spinbutton',{name:'红线图案编号',exact:true}).fill('0');await ready(0,.4);evidence.seed0=await read();
  await page.getByRole('slider',{name:'红线磨损',exact:true}).focus();await page.keyboard.press('End');await ready(0,.7);evidence.worn=await read();await page.screenshot({path:'output/playwright/source-r4-redline-contract-menu-worn.png'});await save();
  const hash=r=>r.finish.materials[0].evidence.colorSHA256;if(new Set([hash(evidence.redline),hash(evidence.seed0),hash(evidence.worn)]).size!==3)throw Error('Seed and wear must change the composed original color map');
  const material=evidence.redline.finish.materials[0],proof=material.evidence;
  if(proof.sizes.color!==1024||proof.sizes.exponent!==256||evidence.redline.skin!=='source-ak-redline'||material.sourceParameters.boost!==2||material.sourceParameters.albedoBoost!==35||!material.sourceParameters.albedoTint)throw Error('Original color/exponent sizes and AK albedo controls not equipped');
  if(proof.colorSHA256!=='97547e3323ce6990d22a983c753e81f9fab68707440c3b128a3e8a4da2597cf0'||proof.exponentSHA256!=='5bdca58275ff55029874d89a43684cdca309fcf9f97e55e5b332428f49a168ed')throw Error('Native clone parameter composition differs from independently verified owner');
  await page.getByRole('button',{name:/^M4A4/}).click();await page.waitForFunction(()=>window.__BREACHLINE__.assetAudit().firstPerson.detail.weapon==='m4a4');evidence.otherWeapon=await read();if(evidence.otherWeapon.finish.materials.length)throw Error('AK finish painted the M4');
  await page.getByRole('button',{name:/^AK-47/}).click();await ready(0,.7);
  await page.getByRole('button',{name:'行动',exact:true}).click();await page.getByRole('button',{name:/^开始人机训练/}).click();await page.waitForFunction(()=>!!document.pointerLockElement);await ready(0,.7);
  await page.waitForFunction(()=>window.__BREACHLINE__.handlingAudit().authority.player.cooldown===0);
  await page.keyboard.press('KeyF');await page.waitForTimeout(900);evidence.training=await read();await page.screenshot({path:'output/playwright/source-r4-redline-contract-training-inspect.png'});await save();
  if(evidence.training.player.sourceWeaponFinish.seed!==0||Math.abs(evidence.training.player.sourceWeaponFinish.wear-.7)>.000002||hash(evidence.training)!==hash(evidence.worn))throw Error('Finish did not persist into actual training');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'返回主菜单',exact:true}).click();await page.getByRole('button',{name:'武器库',exact:true}).click();
  await page.getByRole('button',{name:/^原版默认，/}).click();await page.waitForFunction(()=>window.__BREACHLINE__.assetAudit().sourceWeaponFinish.materials.length===0);evidence.restored=await read();
  if(evidence.restored.skin!=='default')throw Error('Original factory material not restored');
  await page.reload();await page.getByRole('button',{name:/^开始人机训练/}).waitFor({state:'visible',timeout:120000});evidence.reloaded=await read();if(evidence.reloaded.finish.requested!==null||evidence.reloaded.finish.materials.length)throw Error('Cleared finish did not persist across reload');
  if(errors.length)throw Error(errors.join('\n'));evidence.status='passed';
 }finally{
  if(await page.evaluate(()=>!!window.__BREACHLINE__?.snapshot())){if(!await page.getByRole('button',{name:'返回主菜单',exact:true}).isVisible())await page.keyboard.press('Escape');await page.getByRole('button',{name:'返回主菜单',exact:true}).click();}
  evidence.cleanup=await page.evaluate(()=>fetch('/api/rooms').then(r=>r.json()));evidence.scope='Actual menu selection and parameter inputs, original pool color1024/exponent256, clone intensity and albedo parameters in T training, other-gun isolation, default restore and reload persistence. Final native DXT/mips/profile/D3D pixels/filtering remain outside this proof.';await save();
 }
}
