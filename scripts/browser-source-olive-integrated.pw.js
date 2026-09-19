async page=>{
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:27018/assets/source-exports/olive-preview/index.html');
 await page.waitForFunction(()=>!!window.__SOURCE_OLIVE__);
 await page.evaluate(()=>window.__SOURCE_OLIVE__.focus('t'));
 const evidence={errors,load:await page.evaluate(()=>window.__SOURCE_OLIVE__.loadIntegrated())};
 await page.screenshot({path:'output/playwright/source-olive-integrated-rest.png'});
 evidence.wind=await page.evaluate(()=>window.__SOURCE_OLIVE__.advance(0,8));
 await page.screenshot({path:'output/playwright/source-olive-integrated-wind.png'});
 evidence.unload=await page.evaluate(()=>window.__SOURCE_OLIVE__.unload());
 await page.evaluate(e=>window.__SOURCE_OLIVE_INTEGRATED__=e,evidence);
 if(evidence.load.map.propLighting.totalAppliedMeshes!==2459||evidence.load.olive.meshes!==64||evidence.load.skyOliveCopies!==48)throw Error('Integrated olive coverage differs');
 const uniforms=evidence.wind.compiledLeafUniforms,expected=[0,8,...evidence.wind.wind.state.renderParameter3.slice(0,2)];
 if(uniforms.length!==134||uniforms.some(x=>!x.gpuTimeWind||x.gpuTimeWind.some((v,i)=>v!==expected[i])))throw Error('Original palm/sumac/olive GPU uniforms did not share the same wind');
 if(evidence.unload.memory.geometries!==0||evidence.unload.memory.textures!==2||evidence.unload.memory.programs!==0||!evidence.unload.windDisposed)throw Error('Integrated olive resources leaked');
 if(errors.length)throw Error(errors.join('\n'));
 evidence.status='passed_integrated_private';await page.evaluate(e=>window.__SOURCE_OLIVE_INTEGRATED__=e,evidence);
}
