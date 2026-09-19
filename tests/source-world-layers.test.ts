import {describe,it,expect} from 'vitest';
import * as T from 'three';
import receipt from './fixtures/source-world-layer-native.json';
import {applySourceWorldLightmaps} from '../game/source-world-lightmaps';
import {decorateSourceWorldLayer,sourceWorldLayerBlend,sourceWorldDirectionalWeights,sourceWorldTint,sourceWorldUVTransform,type WorldLayerMaterial} from '../game/source-world-layers';
import {createSourceWorldBatch} from '../game/source-world-batch';

describe('original world shader arithmetic',()=>{
  it('keeps inactive original material keys from selecting invented effects',()=>{
    const g=receipt.materialGates;
    expect(g.nativeFancyBlendModes.outputs).toEqual([1,2,3]);
    expect(g.registration.WorldVertexTransition.names).not.toContain('$BLENDTINTBYBASEALPHA');
    expect(g.registration.LightmappedGeneric.names).not.toContain('$BLENDTINTBYBASEALPHA');
    expect(g.registration.VertexLitGeneric.names).toContain('$BLENDTINTBYBASEALPHA');
    expect(g.dropshadow.variants).toHaveLength(9);
    for(const variant of g.dropshadow.variants)expect(variant.readsC26).toEqual([]);
  });
  it('matches 54 original PS bytecode cases including the native-negated border offset',()=>{
    for(const c of receipt.cases){
      const fresh=c.static===1161;
      const p={$newlayerblending:fresh?'1':'0',$blendsoftness:String(c.parameters[0]),$layerborderstrength:String(c.parameters[1]),$layerborderoffset:String(c.parameters[2]),$layerbordersoftness:String(c.parameters[3])};
      const result=sourceWorldLayerBlend(c.alpha,c.mod as[number,number],p);
      expect(result.blend).toBeCloseTo(c.output.blend,5);
      const base1=[.3*.8,.5*.7,.7*.6],base2=[.8,.6*.9,.4*.8],border=[.36,.25,.16];
      const expected=base1.map((v,i)=>v*(1+(border[i]-1)*result.border)*(1-result.blend)+base2[i]*result.blend);
      expected.forEach((v,i)=>expect(v).toBeCloseTo(c.output.base[i],5));
      const n1=[.4,-.2,.9],n2=[-.4,.3,.8];
      const normal=n1.map((v,i)=>fresh?v*(1-result.blend)+n2[i]*result.blend:v);
      sourceWorldDirectionalWeights(normal).forEach((v,i)=>expect(v).toBeCloseTo(c.output.normalWeights[i],5));
    }
  });
  it('decodes native tint and preserves transform scale without altering base UVs',()=>{
    const tint=sourceWorldTint('{160 135 110}').toArray();
    expect(tint[0]).toBeCloseTo((160/255)**2.2,6);
    expect(sourceWorldTint('{245 245 245}').toArray()).toEqual([1,1,1]);
    expect(new T.Vector3(.2,.3,1).applyMatrix3(sourceWorldUVTransform('center 0 0 scale 2 2 rotate 0 translate 0 0')).toArray()).toEqual([.4,.6,1]);
  });
  it('makes a zero-width modulation ramp finite at exact boundaries',()=>{
    for(const alpha of [0,.5,1])expect(Number.isFinite(sourceWorldLayerBlend(alpha,[0,.5],{}).blend)).toBe(true);
  });
});

function fixture(){
  const root=new T.Group(),map=new T.Texture();const textures=new Map(['second','normal','normal2','mod'].map(k=>[k,new T.Texture()]));
  const atlases=[0,1,2].map(()=>new T.DataTexture(new Uint8Array(16),2,2));
  const record:WorldLayerMaterial={index:0,source:'test-world',vmtSha256:'a'.repeat(64),shader:'worldvertextransition',maps:{$basetexture2:'second',$bumpmap:'normal',$bumpmap2:'normal2',$blendmodulatetexture:'mod'},parameters:{$newlayerblending:'1',$layerborderoffset:'.1'}};
  for(let k=0;k<2;k++){
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
    geometry.setAttribute('normal',new T.Float32BufferAttribute([0,1,0,0,1,0,0,1,0],3));geometry.setIndex([0,1,2]);
    for(const a of ['uv','uv1','uv2'])geometry.setAttribute(a,new T.Float32BufferAttribute([0,0,1,0,0,1],2));
    geometry.setAttribute('sourceWorldBlend',new T.Float32BufferAttribute([.1,1,.4,1,.8,1],2));
    const material=new T.MeshBasicMaterial({map});material.userData.full_path=k?'second-record':'test-world';root.add(new T.Mesh(geometry,material));
  }
  const hdr=applySourceWorldLightmaps(root,{format:'source-hdr-lightmaps-v1',sourceBspSha256:'test',width:2,height:2,verifiedOriginalSamples:1,atlasFiles:[]},new ArrayBuffer(16),
    (m,o)=>decorateSourceWorldLayer(m,{...record,source:o.userData.full_path,parameters:{...record.parameters,$layertint1:o.userData.full_path==='test-world'?'[1 1 1]':'[.8 .7 .6]'}},textures,atlases));
  return {root,hdr};
}
describe('world material and batch integration',()=>{
  it('retains separate uniforms when first texture matches but original layer state differs',()=>{
    const {root,hdr}=fixture();const batch=createSourceWorldBatch(root);expect(batch.audit.groups).toBe(2);
    const host=root.getObjectByName('source_world_batch')!;
    for(const obj of host.children){
      const mesh=obj as T.Mesh;expect([...mesh.geometry.getAttribute('sourceWorldBlend').array]).toHaveLength(6);
      const material=mesh.material as T.Material;
      const shader={uniforms:{},vertexShader:T.ShaderLib.basic.vertexShader,fragmentShader:T.ShaderLib.basic.fragmentShader};
      material.onBeforeCompile(shader as never,{} as T.WebGLRenderer);
      expect(shader.fragmentShader).toContain('sourceDirectionalSample(sourceDirectional2,vLightMapUv)');
      expect(shader.fragmentShader).toContain('sourceBaseColor1*=mix');
      expect(shader.vertexShader).toContain('vSourceWorldBlend=sourceWorldBlend');
      expect(shader.vertexShader).toContain('sourceWorldVisibleFactor');
      expect(shader.fragmentShader.match(/uniform vec2 sourceAtlasSize;/g)).toHaveLength(1);
      expect(shader.fragmentShader.indexOf('uniform vec2 sourceAtlasSize;')).toBeLessThan(shader.fragmentShader.indexOf('vec3 sourceDirectionalTexel'));
    }
    batch.dispose();hdr.dispose();
  });
});
