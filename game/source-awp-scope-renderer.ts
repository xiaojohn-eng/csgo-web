import * as T from 'three';
import {createSourceAWPScopeState,sourceAWPScopePaint,type SourceAWPScopeContext,type SourceAWPScopeDraw,SOURCE_AWP_SCOPE_VERSION} from './source-awp-scope';
import {sourceSha256} from './source-sha256';

export type SourceAWPScopeTexture={id:1|2|3;path:string;bytes:number;sha256:string;width:number;height:number};
const vertexShader=`precision highp float;
uniform mat4 projectionMatrix;uniform mat4 modelViewMatrix;
attribute vec3 position;attribute vec2 uv;varying vec2 scopeUV;
void main(){scopeUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
// VGUI unlit/translucent bytes are composited after the world's color pipeline.
// The original DX9 rasterizer/filter exactness is a separate comparison gate.
const fragmentShader=`precision highp float;
uniform sampler2D scopeTexture;uniform bool textured;uniform vec4 scopeColor;
varying vec2 scopeUV;
void main(){gl_FragColor=scopeColor*(textured?texture2D(scopeTexture,scopeUV):vec4(1.0));}`;
type Primitive={mesh:T.Mesh|T.Line;geometry:T.BufferGeometry;material:T.RawShaderMaterial;kind:SourceAWPScopeDraw['kind']};
export function createSourceAWPScopeRenderer(textures:ReadonlyMap<number,T.Texture>){
 if([1,2,3].some(id=>!textures.has(id)))throw Error('Missing original scope textures');
 const scene=new T.Scene(),camera=new T.OrthographicCamera(0,1,0,1,-1,1),primitives:Primitive[]=[];
 let state=createSourceAWPScopeState(),disposed=false,current:ReturnType<typeof sourceAWPScopePaint>|null=null;
 const vector=new T.Vector2();
 function reset(){state=createSourceAWPScopeState();current=null;for(const p of primitives)p.mesh.visible=false;}
 function primitive(index:number,kind:Primitive['kind']){
  let p=primitives[index];if(p&&p.kind!==kind){scene.remove(p.mesh);p.geometry.dispose();p.material.dispose();p=undefined as unknown as Primitive;}
  if(!p){
   const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(12),3));geometry.setAttribute('uv',new T.BufferAttribute(new Float32Array(8),2));
   if(kind!=='line')geometry.setIndex([0,1,2,0,2,3]);else geometry.setDrawRange(0,2);
   const material=new T.RawShaderMaterial({vertexShader,fragmentShader,uniforms:{scopeTexture:{value:textures.get(1)},textured:{value:false},scopeColor:{value:new T.Vector4()}},
    transparent:true,depthTest:false,depthWrite:false,side:T.DoubleSide,toneMapped:false,blending:T.NormalBlending});
   const mesh=kind==='line'?new T.Line(geometry,material):new T.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=index;scene.add(mesh);
   p={mesh,geometry,material,kind};primitives[index]=p;
  }return p;
 }
 function update(input:SourceAWPScopeContext){
  if(disposed)throw Error('Scope renderer disposed');current=sourceAWPScopePaint(state,input);state=current.state;
  camera.right=input.width;camera.bottom=input.height;camera.updateProjectionMatrix();
  current.draws.forEach((draw,i)=>{
   const p=primitive(i,draw.kind),positions=p.geometry.getAttribute('position'),uv=p.geometry.getAttribute('uv');p.mesh.visible=true;
   if(draw.kind==='polygon'){
    if(draw.vertices.length!==4)throw Error('Unexpected original scope polygon');
    draw.vertices.forEach(([x,y,u,v],j)=>{positions.setXYZ(j,x,y,0);uv.setXY(j,u,v);});p.material.uniforms.scopeTexture.value=textures.get(draw.texture);
   }else{
    const[x1,y1,x2,y2]=draw.rect;
    if(draw.kind==='line'){positions.setXYZ(0,x1,y1,0);positions.setXYZ(1,x2,y2,0);}
    else [[x1,y1],[x2,y1],[x2,y2],[x1,y2]].forEach(([x,y],j)=>positions.setXYZ(j,x,y,0));
   }
   positions.needsUpdate=true;uv.needsUpdate=true;p.material.uniforms.textured.value=draw.kind==='polygon';p.material.uniforms.scopeColor.value.fromArray(draw.color.map(c=>c/255));
  });
  for(let i=current.draws.length;i<primitives.length;i++)primitives[i].mesh.visible=false;
  return current;
 }
 function render(renderer:T.WebGLRenderer,input:Omit<SourceAWPScopeContext,'width'|'height'>){
  renderer.getDrawingBufferSize(vector);const frame=update({...input,width:vector.x,height:vector.y});if(!frame.draws.length)return frame;
  const autoClear=renderer.autoClear,target=renderer.getRenderTarget();
  try{renderer.autoClear=false;renderer.setRenderTarget(null);renderer.render(scene,camera);}finally{renderer.autoClear=autoClear;renderer.setRenderTarget(target);}
  return frame;
 }
 function dispose(){if(disposed)return;disposed=true;for(const p of primitives){p.geometry.dispose();p.material.dispose();}primitives.length=0;scene.clear();}
 return{render,update,reset,dispose,scene,camera,audit:()=>({version:SOURCE_AWP_SCOPE_VERSION,state:{...state},draws:current?.draws??[],
  limitations:['DX9 and WebGL rasterization and sampling have not been proven pixel-identical.','Viewmodel scope offsets remain explicit caller inputs.']})};
}
export async function loadSourceAWPScopeRenderer(records:readonly SourceAWPScopeTexture[],baseUrl:string,signal?:AbortSignal){
 const textures=new Map<number,T.Texture>(),hashVerified:Record<string,boolean>={};let renderer:ReturnType<typeof createSourceAWPScopeRenderer>|undefined,disposed=false;
 function dispose(){if(disposed)return;disposed=true;renderer?.dispose();textures.forEach(t=>{t.dispose();if(typeof ImageBitmap!=='undefined'&&t.image instanceof ImageBitmap)t.image.close();});textures.clear();}
 try{
  if(records.length!==3||new Set(records.map(r=>r.id)).size!==3)throw Error('Scope texture identity differs');
  const pending=await Promise.allSettled(records.map(async row=>{
   signal?.throwIfAborted();const response=await fetch(row.path.startsWith('/')?row.path:baseUrl.replace(/\/$/,'')+'/'+row.path,{signal,cache:'no-cache'});if(!response.ok)throw Error('Scope HTTP '+response.status);
   const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==row.bytes||await sourceSha256(bytes,signal)!==row.sha256)throw Error('Scope texture SHA differs: '+row.path);
   const bitmap=await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>],{type:'image/png'}),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
   if(signal?.aborted||bitmap.width!==row.width||bitmap.height!==row.height){bitmap.close();signal?.throwIfAborted();throw Error('Scope texture dimensions differ');}
   const texture=new T.Texture(bitmap);texture.flipY=false;texture.colorSpace=T.NoColorSpace;texture.generateMipmaps=false;texture.minFilter=texture.magFilter=T.LinearFilter;texture.wrapS=texture.wrapT=T.ClampToEdgeWrapping;texture.needsUpdate=true;
   textures.set(row.id,texture);hashVerified[row.path]=true;
  }));for(const r of pending)if(r.status==='rejected')throw r.reason;
  signal?.throwIfAborted();renderer=createSourceAWPScopeRenderer(textures);return{...renderer,hashVerified,dispose};
 }catch(error){dispose();throw error;}
}
