import {afterEach,expect,it,vi} from 'vitest';
import * as T from 'three';
import {readFileSync} from 'node:fs';
import {createSourceAWPScopeRenderer,loadSourceAWPScopeRenderer} from '../game/source-awp-scope-renderer';
import {SOURCE_AWP_SCOPE_TEXTURES} from '../game/source-awp-scope-assets';
afterEach(()=>vi.unstubAllGlobals());
const context={width:1280,height:720,dt:1/60,scoped:true,playerFov:40,zoomFov:40,displayInaccuracy:.002,spread:.0002};
it('renders the original ordered primitives without tone mapping, preserves UVs and clears on unzoom',()=>{
 const textures=new Map([1,2,3].map(id=>[id,new T.Texture()])),r=createSourceAWPScopeRenderer(textures);
 try{
  const frame=r.update(context);expect(frame.draws).toHaveLength(13);expect(r.scene.children).toHaveLength(13);
  expect(r.scene.children.map(p=>p.renderOrder)).toEqual(Array.from({length:13},(_,i)=>i));
  const lens=r.scene.children[0]as T.Mesh<T.BufferGeometry,T.RawShaderMaterial>;
  expect(lens.material.uniforms.scopeTexture.value).toBe(textures.get(3));expect(lens.material.depthTest).toBe(false);expect(lens.material.toneMapped).toBe(false);
  expect(lens.geometry.getAttribute('uv').getX(0)).toBe(.998046875);expect(lens.geometry.getAttribute('uv').getY(0)).toBe(.001953125);
  expect(r.scene.children[1]).toBeInstanceOf(T.Line);
  r.update({...context,sniperWidth:3,width:1024,height:768});expect(r.scene.children[1]).toBeInstanceOf(T.Mesh);expect(r.camera.right).toBe(1024);expect(r.camera.bottom).toBe(768);
  r.update({...context,scoped:false,playerFov:90,zoomFov:90});expect(r.audit().state.blur).toBe(2);expect(r.scene.children.every(p=>!p.visible)).toBe(true);
  r.reset();expect(r.audit().state.blur).toBe(1);
 }finally{r.dispose();textures.forEach(t=>t.dispose());}expect(()=>r.update(context)).toThrow(/disposed/);
});
it('waits for all sibling decodes and releases them when one original texture is corrupt',async()=>{
 const closed:number[]=[];let decoded=0;
 vi.stubGlobal('fetch',async(url:string)=>{const row=SOURCE_AWP_SCOPE_TEXTURES.find(r=>r.path===url)!;const bytes=Uint8Array.from(readFileSync('public'+url));if(row.id===2)bytes[bytes.length-1]^=1;return new Response(bytes);});
 vi.stubGlobal('createImageBitmap',async(blob:Blob)=>{const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),id=++decoded;return{width:view.getUint32(16),height:view.getUint32(20),close:()=>closed.push(id)};});
 vi.stubGlobal('ImageBitmap',Object);
 await expect(loadSourceAWPScopeRenderer(SOURCE_AWP_SCOPE_TEXTURES,'/')).rejects.toThrow(/SHA differs/);expect(decoded).toBe(2);expect(closed).toHaveLength(2);
});
