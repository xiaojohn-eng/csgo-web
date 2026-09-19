"""Bounded current-install non-bump shader and original sprp RGBA evidence.

This proves a baked diffuse term, not the complete shader/default constant ABI.
No gameplay, material activation, source asset or image edits.
"""
from pathlib import Path
import hashlib,importlib.util,json,struct,sys
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.reference-assets/source-exports/dust2-vhv/encoding'
def sha(data):return hashlib.sha256(data).hexdigest()
def module(name,file):
    s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def main():
    e=module('branch_shader','inspect-source-vhv-encoding.py');v=module('branch_vpk','inventory-source-map.py').VPKIndex(ROOT/'.reference-assets/csgo-legacy/platform/platform_pak01_dir.vpk')
    directory=OUT/'non-bump';directory.mkdir(exist_ok=True);records=[];programs=[]
    for name,st,dy in [('vertexlit_and_unlit_generic_vs30.vcs',0,0),('vertexlit_and_unlit_generic_ps30.vcs',8,16)]:
        path='shaders/fxc/'+name;raw=v.read(path);code,record=e.vcs_combo(raw,st,dy);record.update(file=path,container='platform/platform_pak01',vcsBytes=len(raw),vcsSha256=sha(raw))
        (directory/name).write_bytes(raw);prefix=name[:-4]+f'-static{st}-dynamic{dy}'
        (directory/(prefix+'.dx9')).write_bytes(code);(directory/(prefix+'.tokens.txt')).write_text(e.shader_text(code));records.append(record);programs.append(e.instructions(code))
    vs,ps=programs
    declarations=[w for w in vs.values() if w[0]&65535==31 and w[1]&15==10]
    assert declarations==[(0x0200001f,0x8001000a,0x900f0002)] # only COLOR1, not COLOR2/3
    assert vs[124]==(0x05000051,0xa00f0001,0x400ccccd,0x3e59999a,0x3f372474,0x3d93a92a)
    expected_vs={217:(0x03000002,0x80070000,0x90e40002,0x90e40002),
      221:(0x0200000f,0x80010001,0x80000000),224:(0x0200000f,0x80020001,0x80550000),227:(0x0200000f,0x80040001,0x80aa0000),
      230:(0x03000005,0x80070000,0x80e40001,0xa0000001),234:(0x0200000e,0x80010001,0x80000000),
      237:(0x0200000e,0x80020001,0x80550000),240:(0x0200000e,0x80040001,0x80aa0000),
      182:(0x02000023,0x80080000,0xa0000032),185:(0x0300000c,0x80080000,0x81ff0000,0x80ff0000),
      243:(0x03000005,0xe0070007,0x80ff0000,0x80e40001),361:(0x02000001,0xe0070005,0xa0000000),367:(0x02000001,0xe0080007,0xa0000000)}
    for at,words in expected_vs.items():assert vs[at]==words
    expected_ps={167:(0x0200001f,0x80040005,0x90070002),170:(0x0200001f,0x80060005,0x900f0003),
      279:(0x02000001,0x80070002,0x90e40003),282:(0x03000002,0x80070002,0x80e40002,0x90e40002),
      286:(0x03000005,0x80070000,0x80e40000,0x80e40002),290:(0x03000005,0x80070000,0x80e40000,0x80e40001)}
    for at,words in expected_ps.items():assert ps[at]==words
    result={'status':'installed_non_bump_baked_diffuse_term_verified','programs':records,'colorInput':'COLOR1 only: stream1 offset0 D3DCOLOR from previously verified CPU declaration',
      'bakedTerm':'pow(2*normalizedCOLOR1.rgb,2.200000047683716)','vertexGate':'TEXCOORD6.xyz = bakedTerm * float(abs(c50.x)>0)',
      'pixelTerm':'albedo * otherMaterialFactors * (TEXCOORD6.xyz + TEXCOORD4.xyz)',
      'independentDynamicTerm':'Selected VS writes TEXCOORD4.xyz = c0.x; constant ABI/dynamic-light setup not reconstructed',
      'alphaBoundary':'VS computes a separate COLOR1-alpha-derived term in TEXCOORD4.w; selected PS declares TEXCOORD4.xyz only; no VHV-alpha exponent interpretation',
      'implementedScope':'Explicit static VHV term only; one COLOR1 sample, no three-direction weights or synthetic normal',
      'limitations':['c50/c0 runtime register ABI and original dynamic lights not reproduced','Original instance modulation and material tint remain separate',
        'No implicit activation for envmap, detail, decal, treesway, vertexcolorpower, tintmask or selfillum']}
    (directory/'evidence.json').write_text(json.dumps(result,indent=2)+'\n')
    # Re-read original sprp bytes independently of SourceIO's parsed JSON.
    raw=(ROOT/'output/source1/de_dust2/lumps/35-game.bin').read_bytes();inv=json.loads((ROOT/'.reference-assets/source-exports/dust2/source-metadata/inventory.json').read_text())
    lump=next(x for x in inv['lumps'] if x['id']==35);assert sha(raw)==lump['sha256'];count=struct.unpack_from('<I',raw)[0]
    h=next(struct.unpack_from('<4sHHII',raw,4+16*i) for i in range(count) if raw[4+16*i:8+16*i]==b'prps');_,flags,version,offset,size=h
    assert version==11 and flags==0;start=offset-lump['offset'];end=start+size;models=struct.unpack_from('<I',raw,start)[0];at=start+4+128*models
    leaves=struct.unpack_from('<I',raw,at)[0];at+=4+2*leaves;count=struct.unpack_from('<I',raw,at)[0];at+=4;assert end-at==count*80
    parsed=json.loads((ROOT/'output/source1/de_dust2/static-props.json').read_text())['props'];assert len(parsed)==count==3158
    colors=[]
    for i,p in enumerate(parsed):
        c=list(struct.unpack_from('<4B',raw,at+80*i+64));assert c==p['diffuse_modulation'];colors.append({'index':i,'rgba':c})
    modulation={'status':'raw_BSP_sprp_v11_instance_RGBA_readback_passed','sourceBspSha256':inv['bspSha256'],'lumpSha256':sha(raw),'version':11,'recordSize':80,
      'rgbaByteOffset':64,'instances':count,'whiteRGBA':sum(c['rgba']==[255]*4 for c in colors),'distinctRGBA':len({tuple(c['rgba']) for c in colors}),
      'shaderInterpretation':'Pending actual installed modulation/tint constant consumer evidence; bytes not yet applied','colors':colors}
    (OUT/'instance-modulation.json').write_text(json.dumps(modulation,indent=2)+'\n');print(json.dumps(result,indent=2));print({k:v for k,v in modulation.items() if k!='colors'})
if __name__=='__main__':main()
