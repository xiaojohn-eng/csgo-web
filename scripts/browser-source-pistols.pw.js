async(page)=>{
 for(const owned of page.context().pages())if(owned!==page&&owned.url()==='http://127.0.0.1:27018/assets/source-exports/pistol-preview/index.html')await owned.close();
 const errors=[],results=[];const p=await page.context().newPage();p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+m.location().url);});
 p.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
 await p.goto('http://127.0.0.1:27018/assets/source-exports/pistol-preview/index.html');
 await p.waitForFunction(()=>window.__SOURCE_PISTOL_PREVIEW__?.audit().loaded,null,{timeout:120000});
 for(const weapon of ['glock','usp'])for(const team of ['t','ct']){
  await p.evaluate(async({weapon,team})=>await window.__SOURCE_PISTOL_PREVIEW__.load(weapon,team),{weapon,team});
  const frames=[];const poses=weapon==='glock'?[['glock_idle',0],['glock_firesingle',.12],['glock_reload',.9],['lookat01',1.5]]:[['idle',0],['shoot1',.12],['reload',.9],['lookat01',1.5],['draw',0],['draw_silenced',0],['attach',4],['detach',4]];
  for(const [sequence,time]of poses){
   await p.evaluate(({sequence,time})=>window.__SOURCE_PISTOL_PREVIEW__.sample(sequence,time,true),{sequence,time});await p.waitForTimeout(80);
   const audit=await p.evaluate(()=>window.__SOURCE_PISTOL_PREVIEW__.audit());
   if(!audit.hashVerified||audit.weapon!==weapon||audit.team!==team||audit.draw.triangles<1000||audit.detail.sequence!==sequence)throw Error('Original pistol GPU identity/draw/sample missing');
   if(weapon==='usp'&&sequence==='draw'&&!audit.detail.silencerVisible)throw Error('Original USP draw activity should show silencer');
   if(weapon==='usp'&&sequence==='draw_silenced'&&audit.detail.silencerVisible)throw Error('Original USP unsilenced draw activity should hide silencer');
   const screenshot=`output/playwright/source-pistol-${weapon}-${team}-${sequence}.png`;await p.screenshot({path:screenshot});frames.push({audit,screenshot});
  }
  await p.evaluate(()=>window.__SOURCE_PISTOL_PREVIEW__.unload());await p.waitForTimeout(80);const empty=await p.evaluate(()=>window.__SOURCE_PISTOL_PREVIEW__.audit());
  if(empty.loaded||empty.memory.geometries!==0||empty.memory.textures!==0)throw Error('Pistol owner did not release GPU geometry/textures');
  results.push({weapon,team,frames,empty});
 }
 await page.evaluate(e=>window.__SOURCE_PISTOLS_GPU_EVIDENCE__=e,{results,errors,scope:'Four original first-person owners: actual GPU, source-time sampling, USP exact activity/bodygroup and empty-resource baseline; no full pistol gameplay'});await p.close();
 if(errors.length)throw Error(errors.join('\n'));
}
