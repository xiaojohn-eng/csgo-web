/** Original explosions_fx.pcf smoke-grenade dispatcher. Its named fallback is
 * a replacement, never a second burst. Particle lifetimes survive the gameplay
 * smoke volume's removal: the last native child can live until 27 seconds.
 * Refract branch reference: Valve source-sdk-2013 b8cfb12
 * src/materialsystem/stdshaders/refract_ps2x.fxc (BLUR=1, COLORMODULATE=1).
 * Rendering calls use world metres; all PCF initialization remains Source units.
 */
import {Color,Group,NoColorSpace,TextureLoader,Vector2,type Texture} from 'three';
import {createSourceMuzzleChildProgram,type SourceMuzzleChildParticle} from './source-muzzle-children';
import {loadSourceMuzzleChildrenRenderer} from './source-muzzle-children-renderer';
import {prepareSourcePistolParticleGraph,type SourceParticleNativeDefaults} from './source-pistol-particles-graph';
import {configureSourceParticleTexture,createSourceSpriteCardBatch} from './source-sprite-card';
import {sourceSha256} from './source-sha256';
import resources from './source-grenade-smoke-resources.json';
export const SOURCE_GRENADE_SMOKE_ASSET_PATH='/source/csgo-12426148/grenade-smoke-20260913/';
export type SourceParticleSceneColor={texture:Texture;width:number;height:number};
/** Valve refract_ps2x.fxc: decoded normal.xy * texture alpha * refract amount
 * * particle alpha, in screen UV units (not pixels or metres). GL's framebuffer
 * UV points up; the Source/D3D source framebuffer UV points down. */
export function sourceGrenadeRefractOffset(normal:readonly number[],alpha:number,amount=-.5):[number,number]{return[(normal[0]*2-1)*normal[3]*amount*alpha,-(normal[1]*2-1)*normal[3]*amount*alpha];}
export const SOURCE_GRENADE_REFRACT_BLUR=[[-.5,-.5,4/9],[1,-.5,2/9],[-.5,1,2/9],[1,1,1/9]]as const;
const refractFragment=`
uniform sampler2D originalTexture;uniform sampler2D sceneColor;uniform vec2 colorViewport;uniform bool colorEnabled;uniform float refractAmount;
varying vec2 uv0;varying vec4 tint;varying vec3 refractViewPosition;
void main(){
 if(!colorEnabled)discard;
 vec4 normal=texture2D(originalTexture,uv0);
 float alpha=normal.a*tint.a;if(alpha<=.001)discard;
 vec2 screen=gl_FragCoord.xy/colorViewport;
 vec2 warped=screen+(normal.xy*2.0-1.0)*vec2(1.0,-1.0)*refractAmount*alpha;
 // Native BLUR=1 uses four bilinear samples to reproduce its 3x3 kernel.
 // Its offsets are fixed 1/512 UV, independent of render target dimensions.
 vec3 blurred=texture2D(sceneColor,warped+vec2(-.5,.5)/512.0).rgb*(4.0/9.0)
  +texture2D(sceneColor,warped+vec2(1.0,.5)/512.0).rgb*(2.0/9.0)
  +texture2D(sceneColor,warped+vec2(-.5,-1.0)/512.0).rgb*(2.0/9.0)
  +texture2D(sceneColor,warped+vec2(1.0,-1.0)/512.0).rgb*(1.0/9.0);
 float silhouette=pow(clamp(-normalize(refractViewPosition).z,0.0,1.0),3.0);
 gl_FragColor=vec4(mix(texture2D(sceneColor,screen).rgb,blurred*tint.rgb,silhouette),alpha);
 #include <colorspace_fragment>
}`;
export async function loadSourceGrenadeSmokeRenderer(baseUrl=SOURCE_GRENADE_SMOKE_ASSET_PATH,options:{capacity?:number;sourceUnitMetres?:number;signal?:AbortSignal}={}){
 const capacity=options.capacity??1040,unit=options.sourceUnitMetres??.0254,signal=options.signal;
 if(!Number.isInteger(capacity)||capacity<104||capacity>4096||!Number.isFinite(unit)||unit<=0)throw Error('Invalid original grenade smoke capacity/units');
 const base=baseUrl.endsWith('/')?baseUrl:baseUrl+'/',hashVerified:Record<string,boolean>={};
 const bytes=async(path:string)=>{const receipt=resources.find(r=>r.path===path);if(!receipt)throw Error('Unverified smoke grenade resource '+path);const response=await fetch(base+path,{signal});if(!response.ok)throw Error('Original smoke grenade HTTP '+response.status+' '+path);const b=new Uint8Array(await response.arrayBuffer());if(b.byteLength!==receipt.bytes||await sourceSha256(b,signal)!==receipt.sha256)throw Error('Original smoke grenade SHA mismatch '+path);hashVerified[path]=true;return b;};
 const json=async(path:string)=>JSON.parse(new TextDecoder().decode(await bytes(path)));
 const [raw,native]=await Promise.all([json('graph.json'),json('native-defaults.json')]);
 const graph=prepareSourcePistolParticleGraph(raw),defaults=native as SourceParticleNativeDefaults;
 const childNames=graph.phase('explosion_smokegrenade','children').map(c=>c.name).sort();
 const expected=['explosion_child_distort01c','explosion_child_smoke03d_ring','explosion_child_smoke03e','explosion_child_smoke07b','explosion_child_smoke_bottom'].sort();
 if(JSON.stringify(childNames)!==JSON.stringify(expected))throw Error('Unreviewed original smoke grenade closure');
 const smoke=await loadSourceMuzzleChildrenRenderer(graph,defaults,bytes,{family:'grenade',unit,capacity,signal});
 const distort=createSourceMuzzleChildProgram(graph,defaults,'explosion_child_distort01c'),material=distort.configuration.material;
 const original=graph.data.textures.find(t=>t.source===distort.configuration.texture)!;
 let normal:Texture|null=null;
 try{const data=await bytes(original.images[0].file.path),url=URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>],{type:'image/png'}));try{normal=configureSourceParticleTexture(await new TextureLoader().loadAsync(url),NoColorSpace);}finally{URL.revokeObjectURL(url);}signal?.throwIfAborted();}catch(error){normal?.dispose();smoke.dispose();throw error;}
 const batch=createSourceSpriteCardBatch({name:'explosion_child_distort01c',texture:normal!,capacity,additive:false,addSelf:0,overbright:1,sourceUnitMetres:unit});
 // The atlas card provides the same camera-facing, rotating native sprite basis.
 // Refract has a separate original shader, never SpriteCard's colour texture path.
 batch.material.vertexShader=batch.material.vertexShader.replace('varying vec2 uv0;','varying vec3 refractViewPosition;varying vec2 uv0;').replace('particleDepth=-viewCenter.z;','refractViewPosition=viewCenter.xyz;particleDepth=-viewCenter.z;');
 batch.material.fragmentShader=refractFragment;
 Object.assign(batch.material.uniforms,{sceneColor:{value:null},colorViewport:{value:new Vector2(1,1)},colorEnabled:{value:false},refractAmount:{value:Number(material.$refractamount)}});
 batch.material.depthTest=material.$ignorez!=='1';batch.material.userData.sourceRefract=true;
 const group=new Group();group.name='original-smoke-grenade-pcf';group.add(batch.mesh,smoke.group);
 const events=new Map<string,{born:number;expiry:number;origin:{x:number;y:number;z:number};particles:SourceMuzzleChildParticle[]}>();let disposed=false;
 return{group,graph,smoke,distort,hashVerified,
  /** Stable event id prevents repeated snapshots from restarting the native PCF. */
  spawn(id:string,position:{x:number;y:number;z:number},now:number,seed:number,lightingColor?:[number,number,number]|(()=>[number,number,number]|undefined)){
   if(disposed)throw Error('Original grenade smoke renderer disposed');
   if(!id||![now,position.x,position.y,position.z].every(Number.isFinite)||!Number.isInteger(seed)||seed<0||seed>4095)throw Error('Invalid original smoke grenade event');
   if(events.has(id))return false;
   const lifetime=smoke.fire({position,forward:{x:1,y:0,z:0},up:{x:0,y:1,z:0},sourcePosition:[position.x/unit,-position.z/unit,position.y/unit],lightingColor:typeof lightingColor==='function'?lightingColor():lightingColor},now,seed);
   const particles=distort.emit(seed);events.set(id,{born:now,expiry:now+Math.max(lifetime,...particles.map(p=>p.born+p.life)),origin:{...position},particles});return true;
  },
  update(now:number){
   if(disposed)throw Error('Original grenade smoke renderer disposed');if(!Number.isFinite(now))throw Error('Invalid original smoke grenade clock');
   const result=smoke.update(now);let count=0,dropped=0;const particles=[];
   for(const [id,event]of events){if(now>=event.expiry){events.delete(id);continue;}
    for(const p of distort.sample(event.particles,now-event.born)){if(count>=capacity){dropped++;continue;}const position=[event.origin.x+p.currentPosition[0]*unit,event.origin.y+p.currentPosition[2]*unit,event.origin.z-p.currentPosition[1]*unit];
     // Native particle colour is already supplied in the renderer's linear space.
     const tint=new Color().setRGB(...p.currentColor);
     batch.set('particleCenter',count,position);batch.set('particleRadius',count,[p.currentRadius*unit]);batch.set('particleRotation',count,[p.rotation]);batch.set('particleTint',count,[tint.r,tint.g,tint.b,p.currentAlpha]);batch.set('particleUV0',count,[0,0,1,1]);count++;
     particles.push({id,system:distort.system,age:p.age,life:p.life,position,radius:p.currentRadius*unit,alpha:p.currentAlpha});
    }
   }
   batch.finish(count);return{...result,events:events.size,distortion:{particles,count,dropped,bound:batch.material.uniforms.colorEnabled.value as boolean}};
  },
  /** Completed, linear colour texture for the same world camera. The owning
   * scene must copy it before effects and never bind the target being written. */
  setSceneColor(binding:SourceParticleSceneColor|null){
   if(binding&&(![binding.width,binding.height].every(Number.isFinite)||binding.width<=0||binding.height<=0))throw Error('Invalid original grenade scene colour binding');
   batch.material.uniforms.sceneColor.value=binding?.texture??null;batch.material.uniforms.colorEnabled.value=!!binding;
   if(binding)batch.material.uniforms.colorViewport.value.set(binding.width,binding.height);
  },
  clear(){events.clear();smoke.clear();batch.finish(0);},
  dispose(){if(disposed)return;disposed=true;events.clear();smoke.dispose();batch.dispose();normal!.dispose();group.removeFromParent();},
 };
}
