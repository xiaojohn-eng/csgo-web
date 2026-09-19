async page=>{
 const errors=[],actions=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:27018/assets/source-exports/pistol-preview/index.html');
 await page.waitForFunction(()=>window.__SOURCE_PISTOL_PREVIEW__?.audit().loaded&&window.__SOURCE_PISTOL_PREVIEW__.audit().audio.ready,null,{timeout:120000});
 const ready=await page.evaluate(()=>window.__SOURCE_PISTOL_PREVIEW__.audit());
 if(ready.audio.decoded.length!==34||Object.values(ready.audio.hashes).some(v=>!v))throw Error('Original pistol sounds not decoded/verified before playback');
 const play=async(sequence,screenshot)=>{
  await page.locator('#clip').selectOption(sequence);const before=await page.evaluate(()=>window.__SOURCE_PISTOL_PREVIEW__.audit());
  await page.getByRole('button',{name:'播放动作与原音效',exact:true}).click();
  if(screenshot){await page.waitForTimeout(750);await page.screenshot({path:screenshot});}
  await page.waitForFunction(()=>!window.__SOURCE_PISTOL_PREVIEW__.audit().audio.playing,null,{timeout:15000});
  const after=await page.evaluate(()=>window.__SOURCE_PISTOL_PREVIEW__.audit());actions.push({sequence,before,after});
 };
 await play('glock_draw','output/playwright/source-pistol-glock-draw-audio.png');
 await play('glock_reload');await play('lookat01');
 await page.locator('#clip').selectOption('glock_reload');const cancelBefore=await page.evaluate(()=>window.__SOURCE_PISTOL_PREVIEW__.audit());
 await page.getByRole('button',{name:'播放动作与原音效',exact:true}).click();await page.waitForTimeout(120);await page.getByRole('button',{name:'中断动作',exact:true}).click();await page.waitForTimeout(800);const cancelled=await page.evaluate(()=>window.__SOURCE_PISTOL_PREVIEW__.audit());
 if(cancelled.audio.events.length!==cancelBefore.audio.events.length)throw Error('Cancelled reload emitted an un-crossed future sound');
 await page.locator('#weapon').selectOption('usp');await page.waitForFunction(()=>window.__SOURCE_PISTOL_PREVIEW__.audit().loaded&&window.__SOURCE_PISTOL_PREVIEW__.audit().weapon==='usp');
 await page.locator('#team').selectOption('ct');await page.waitForFunction(()=>window.__SOURCE_PISTOL_PREVIEW__.audit().loaded&&window.__SOURCE_PISTOL_PREVIEW__.audit().team==='ct');
 for(const sequence of ['draw','reload','attach','detach','draw_silenced','lookat01'])await play(sequence,sequence==='attach'?'output/playwright/source-pistol-usp-attach-audio.png':undefined);
 const after=await page.evaluate(()=>window.__SOURCE_PISTOL_PREVIEW__.audit());
 await page.getByRole('button',{name:'卸载资源',exact:true}).click();const unloaded=await page.evaluate(()=>window.__SOURCE_PISTOL_PREVIEW__.audit());
 const disposed=await page.evaluate(()=>window.__SOURCE_PISTOL_PREVIEW__.disposeAudio());
 await page.evaluate(e=>window.__SOURCE_PISTOL_AUDIO_EVIDENCE__=e,{ready,actions,cancelBefore,cancelled,after,unloaded,disposed,errors,scope:'Actual original Glock/USP viewmodel sequence playback and animation sounds through AudioEngine. All 34 aliases SHA verified and decoded first; original event/timing/ranges. This is an isolated preview, not pistol multiplayer acceptance.'});
 if(unloaded.loaded||unloaded.memory.geometries||unloaded.memory.textures||unloaded.memory.programs||disposed.audio.decoded.length)throw Error('Pistol preview did not release its owned GPU/audio buffers');
 if(errors.length)throw Error(errors.join('\n'));
}
