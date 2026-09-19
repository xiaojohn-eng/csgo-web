async page=>{
 await page.goto('http://192.168.1.100:27019/?map=de_dust2');
 const start=page.getByRole('button',{name:/^开始人机训练/});await start.waitFor({state:'visible',timeout:120000});await start.click();
 await page.waitForFunction(()=>!!document.pointerLockElement);await page.keyboard.press('KeyB');const shop=page.getByRole('dialog').filter({hasText:'购买装备'});await shop.waitFor({state:'visible'});
 await page.evaluate(()=>{window.__PAUSE_TRACE__=[];const log=(kind,e)=>window.__PAUSE_TRACE__.push({kind,code:e?.code,time:performance.now(),locked:!!document.pointerLockElement,text:document.body.innerText.slice(-650)});
  document.addEventListener('keydown',e=>log('capture',e),true);document.addEventListener('keydown',e=>log('bubble',e));document.addEventListener('pointerlockchange',e=>log('pointer',e));});
 await shop.getByRole('button',{name:'Close',exact:true}).click();await page.waitForFunction(()=>!!document.pointerLockElement);
 await page.keyboard.press('Escape');await page.waitForTimeout(800);
 await page.evaluate(()=>window.__PAUSE_RESULT__={trace:window.__PAUSE_TRACE__,locked:!!document.pointerLockElement,text:document.body.innerText.slice(-1000)});
}
