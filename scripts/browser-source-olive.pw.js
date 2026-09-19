async page=>{
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:27018/assets/source-exports/olive-preview/index.html');await page.waitForFunction(()=>!!window.__SOURCE_OLIVE__);
 const evidence={errors,probe:await page.evaluate(()=>window.__SOURCE_OLIVE_PROBE__())};
 evidence.numericAccepted=evidence.probe.maxPositionErrorMetres<=.0004;
 await page.evaluate(e=>window.__SOURCE_OLIVE_EVIDENCE__=e,evidence);
 if(evidence.probe.cases!==1280||evidence.probe.maxZeroWindError!==0||evidence.probe.glError)throw Error('Original olive GPU displacement structural check failed');
 await page.evaluate(()=>window.__SOURCE_OLIVE__.focus('t'));evidence.baseline=await page.evaluate(()=>window.__SOURCE_OLIVE__.load(false));await page.screenshot({path:'output/playwright/source-olive-t-r6.png'});
 evidence.candidate=await page.evaluate(()=>window.__SOURCE_OLIVE__.load(true));await page.screenshot({path:'output/playwright/source-olive-t-r7-candidate.png'});evidence.rest=await page.evaluate(()=>window.__SOURCE_OLIVE__.audit());
 await page.evaluate(()=>window.__SOURCE_OLIVE__.advance(0,8));evidence.wind=await page.evaluate(()=>window.__SOURCE_OLIVE__.audit());await page.screenshot({path:'output/playwright/source-olive-t-r7-wind.png'});
 await page.evaluate(()=>window.__SOURCE_OLIVE__.tick(8));evidence.repeated=await page.evaluate(()=>window.__SOURCE_OLIVE__.audit());
 evidence.unload=await page.evaluate(()=>window.__SOURCE_OLIVE__.unload());
 evidence.scope='Private explicit no-CSM candidate: 64 olive meshes, 48 original sky copies, exact original VHV and VS128 olive parameters. No claim of complete original CSM/dynamic light/fog/alpha coverage or production integration.';
 await page.evaluate(e=>window.__SOURCE_OLIVE_EVIDENCE__=e,evidence);
 if(evidence.candidate.olive.meshes!==64||evidence.candidate.skyOliveCopies!==48||!evidence.candidate.olive.verification.hashVerified||evidence.candidate.olive.csm!==false)throw Error('Original olive owner or sky coverage failed');
 if(evidence.unload.memory.geometries!==0||evidence.unload.memory.textures!==2||evidence.unload.memory.programs!==0)throw Error('Private olive ownership did not return to the empty scene');
 if(errors.length)throw Error(errors.join('\n'));
 if(!evidence.numericAccepted)throw Error('Static visual and lifetime evidence saved; moving-vertex precision remains outside the current threshold');
}
