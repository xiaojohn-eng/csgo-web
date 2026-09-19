/** Real GPU acceptance for all native style branches, with an optional complete catalogue sweep. */
import {SOURCE_FINISHES,SOURCE_FINISH_WEAPONS} from '../game/source-finish-table';
import {createSourceKitFinishResolver,SOURCE_KIT_INPUT_BASE} from '../game/source-kit-finishes';
import {createSourceRedlineCompositor,sourcePaletteRegisters} from '../game/source-redline-compositor';
import {sourceRedlineSkinParameters} from '../game/source-redline-seed';
import {loadSourcePaintNormal} from '../game/source-paint-normal';
import native from '../research/source-customweapon-all-programs.json';

const rows:Record<string,unknown>[]=[],errors:string[]=[];
const query=new URLSearchParams(location.search),full=query.get('all')==='1',zeroOnly=query.get('zero')==='1';
const proof={format:'source-paint-styles-browser-proof-v1',status:'running',fullCatalogue:full,
  startedAt:new Date().toISOString(),userAgent:navigator.userAgent,rows,errors,
  boundary:'Real WebGL composition at 256/128 QA resolution. Original native program selection, matrices and asset hashes are independently recorded. Final weapon draw, runtime compression, original mip bytes and original-client pixel equality are separate acceptance.'};
(window as unknown as{__SOURCE_PAINT_PROOF__:typeof proof}).__SOURCE_PAINT_PROOF__=proof;
const status=document.getElementById('status')!,details=document.getElementById('details')!,gallery=document.getElementById('gallery')!;
function refresh(){status.textContent=`${proof.status} · ${rows.length} 张 · ${errors.length} 个错误`;details.textContent=JSON.stringify(proof,null,2);}
function stats(bytes:Uint8Array){let nonzero=0,alpha=0;for(let i=0;i<bytes.length;i+=4){if(bytes[i]||bytes[i+1]||bytes[i+2])nonzero++;if(bytes[i+3])alpha++;}return{rgbNonzero:nonzero,alphaNonzero:alpha};}
function thumbnail(bytes:Uint8Array,size:number){
  const source=document.createElement('canvas');source.width=source.height=size;
  const pixels=new Uint8ClampedArray(bytes);for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
  source.getContext('2d')!.putImageData(new ImageData(pixels,size,size),0,0);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=96;canvas.getContext('2d')!.drawImage(source,0,0,96,96);
  source.width=source.height=0;return canvas;
}
window.addEventListener('error',event=>{errors.push(String(event.error??event.message));refresh();});
window.addEventListener('unhandledrejection',event=>{errors.push(String(event.reason));refresh();});

async function main(){
  for(const weapon of SOURCE_FINISH_WEAPONS){
    const resolver=createSourceKitFinishResolver({weapon:weapon.originalWeapon,catalogueBaseURL:'/source/csgo-12426148/skins/',kitBaseURL:SOURCE_KIT_INPUT_BASE});
    const ids=await resolver.available();
    if(JSON.stringify(ids)!==JSON.stringify(SOURCE_FINISHES[weapon.id].map(row=>row.paintKitId)))throw Error(weapon.id+' resolver/table mismatch');
    const candidates=await Promise.all(ids.map(async id=>{
      const finish=await resolver.resolve(id),range=SOURCE_FINISHES[weapon.id].find(row=>row.paintKitId===id)!;
      const parameters=sourceRedlineSkinParameters({paintKitId:id,seed:422,wear:Math.max(range.wearMinimum,Math.min(.2,range.wearMaximum))},finish.kit,finish.phong);
      return{id,finish,parameters,range,key:`${finish.kit.style}:${parameters.phongAlbedoFactor<1}`};
    }));
    candidates.sort((a,b)=>a.key.localeCompare(b.key)||a.id-b.id);
    const seen=new Set<string>();
    let compositor:Awaited<ReturnType<typeof createSourceRedlineCompositor>>|undefined,key='';
    try{
      for(const row of candidates){
        if(zeroOnly&&row.finish.kit.phongAlbedoBoost!==0)continue;
        if(!full&&!zeroOnly&&seen.has(row.key))continue;seen.add(row.key);
        try{
          const base=SOURCE_KIT_INPUT_BASE+weapon.originalWeapon+'/',style=row.finish.kit.style;
          if(key!==row.key){compositor?.dispose();compositor=undefined;
            compositor=await createSourceRedlineCompositor({inputBaseURL:base,patternBaseURL:base,weaponInputs:row.finish.inputs,
              style,phongAlbedoFactor:row.parameters.phongAlbedoFactor,colours:row.finish.kit.colours});key=row.key;}
          if(sourcePaletteRegisters(style,row.parameters.phongAlbedoFactor).length)compositor!.setPalette(row.finish.kit.colours);
          if(row.finish.pattern)await compositor!.setPattern(row.finish.pattern);
          const out=await compositor!.compose(row.parameters,256,128),selection=compositor!.audit.shaderSelection;
          for(const [pass,staticId]of[['color',selection.colorStatic],['exponent',selection.exponentStatic]]as const){
            const program=native.programs.find(program=>program.static===staticId&&program.pass===pass);
            if(!program)throw Error('Actual shader has no native selector receipt '+staticId);
          }
          let normalVerified=false;
          if(row.finish.normal){const normal=await loadSourcePaintNormal(row.finish.normal,base);normalVerified=true;normal.dispose();}
          const color=stats(out.color.rgba),exponent=stats(out.exponent.rgba);
          if(!color.rgbNonzero||!exponent.rgbNonzero)throw Error('Empty composed map');
          const result={weapon:weapon.id,paintKitId:row.id,name:row.range.chineseName,style,
            phongAlbedoFactor:Number.isFinite(row.parameters.phongAlbedoFactor)?row.parameters.phongAlbedoFactor:'Infinity',shaderSelection:selection,
            color:{size:out.color.size,sha256:out.color.sha256,...color},exponent:{size:out.exponent.size,sha256:out.exponent.sha256,...exponent},
            normalVerified,normal:row.finish.normal?.sourceMaterial??null,envmap:row.finish.phong.envmap,
            originalInputsGPUVerified:compositor!.audit.originalDecodedGPUChecksumsVerified,originalClientOutputCompared:false};
          rows.push(result);
          const article=document.createElement('article'),label=document.createElement('p');label.textContent=`${weapon.id} #${row.id} ${row.range.chineseName} · style ${style}`;
          article.appendChild(label);article.appendChild(thumbnail(out.color.rgba,out.color.size));article.appendChild(thumbnail(out.exponent.rgba,out.exponent.size));gallery.appendChild(article);
        }catch(error){errors.push(`${weapon.id} #${row.id}: ${String(error)}`);compositor?.dispose();compositor=undefined;key='';}
        refresh();await new Promise(resolve=>requestAnimationFrame(resolve));
      }
    }finally{compositor?.dispose();}
  }
  proof.status=errors.length?'failed':'passed';refresh();
  await fetch('/evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof)});
}
main().catch(error=>{errors.push(String(error));proof.status='failed';refresh();});
