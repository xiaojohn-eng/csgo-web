"""Read-only installed App740 decal multiplication/UV/sampler evidence.
No leaked source, engine execution, guessed texture channel, or asset mutation.
"""
from pathlib import Path
import importlib.util,json,struct,sys,hashlib
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.reference-assets/source-exports/dust2-vhv/encoding/decal-tint'
def module(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def main():
 m=module('decal_evidence','inspect-source-vhv-encoding.py');v=module('decal_vpk','inventory-source-map.py');OUT.mkdir(exist_ok=True)
 shader=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so');api=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/shaderapidx9_client.so')
 vpk=v.VPKIndex(ROOT/'.reference-assets/csgo-legacy/platform/platform_pak01_dir.vpk')
 raw=vpk.read('shaders/fxc/vertexlit_and_unlit_generic_bump_ps30.vcs');head=struct.unpack_from('<7I',raw);count=head[5]
 table=dict(struct.iter_unpack('<2I',raw[28:28+count*8]));aliasAt=28+count*8;n=struct.unpack_from('<I',raw,aliasAt)[0]
 aliases=dict(struct.iter_unpack('<2I',raw[aliasAt+4:aliasAt+4+n*8]));assert len(aliases)==n and all(target in table for target in aliases.values())
 assert aliasAt+4+n*8==min(table.values())
 reports=[]
 for requested in (196612,393220,983044):
  selected=aliases.get(requested,requested);code,report=m.vcs_combo(raw,selected,80);tokens=m.instructions(code)
  report.update(requestedStatic=requested,aliasResolvedStatic=selected);reports.append(report)
  name=f'bump-ps-static{requested}-dynamic80';(OUT/(name+'.dx9')).write_bytes(code);(OUT/(name+'.tokens.txt')).write_text(m.shader_text(code))
  if requested==196612:
   assert tokens[290]==(0x03000042,0x800f0001,0x90ee0000,0xa0e4080c)
   assert tokens[294]==(0x03000005,0x80070001,0x80e40001,0xa0ff0003)
   assert tokens[298]==(0x03000005,0x80070000,0x80e40000,0x80e40001)
 vsRaw=vpk.read('shaders/fxc/vertexlit_and_unlit_generic_bump_vs30.vcs');vs,vsReport=m.vcs_combo(vsRaw,0,4);tokens=m.instructions(vs)
 assert tokens[195]==(0x0200001f,0x80010005,0x900f0006)
 assert tokens[782]==(0x02000001,0xe00c0001,0x90440006)
 # Original parameter registration, default string, and distinct struct offsets.
 assert shader.cstring(shader.rip(0x4729f,'4c 8d 2d'))=='0'
 assert shader.cstring(shader.rip(0x4846b,'48 8d 05'))=='$DETAILBLENDMODE'
 shader.check(0x48472,'4c 89 2d 7f c9 32 00');shader.check(0x4849b,'89 05 67 c9 32 00')
 assert shader.cstring(shader.rip(0x49f22,'48 8d 05'))=='$DECALBLENDMODE'
 shader.check(0xc40b5,'8b 05 4d 0d 2b 00 89 85 90 fe ff ff') # info base rbp-240 => +d0
 shader.check(0xc42b0,'8b 05 12 f9 2a 00 89 45 9c') # same base => +1dc
 shader.check(0xc4c4c,'49 63 84 24 d0 00 00 00');shader.check(0xc4c6f,'89 85 4c fb ff ff')
 shader.check(0xc4c75,'49 63 84 24 dc 01 00 00');shader.check(0xc4c8a,'89 85 30 fb ff ff')
 # Actual semi-static bind command: detail mode <1 -> bit31, sampler12.
 shader.check(0xc5cdb,'83 bd 4c fb ff ff 01');shader.check(0xc5cf6,'45 19 f6 31 c9 41 81 e6 00 00 00 80')
 shader.check(0xc5d0e,'41 83 c6 0c c7 02 0a 00 00 00');shader.check(0xc5d2a,'44 89 72 04')
 # mode1 and mode2 share the PS multiply selector; c3.w distinguishes them.
 shader.check(0xce216,'c7 85 bc fa ff ff 00 00 c0 03');shader.check(0xca5f4,'c7 85 bc fa ff ff 00 00 80 07')
 shader.check(0xc684d,'83 bd 30 fb ff ff 02');shader.check(0xc6854,'f3 0f 10 05 a8 c7 04 00')
 assert struct.unpack('<f',shader.code(0x113004,4))[0]==1
 assert struct.unpack('<f',shader.code(0x11350c,4))[0]==2
 shader.check(0xcc8b8,'f3 0f 10 05 4c 6c 04 00');shader.check(0xc688e,'c7 41 04 03 00 00 00')
 # Installed API command10, exact RTTI vtable member, and sRGB state11 consumer.
 assert 0xdefbc+struct.unpack('<i',api.code(0xdefbc+40,4))[0]==0x4e958
 api.check(0x4e96b,'89 f2 83 e6 0f 81 e2 00 00 00 e0 ff 90 90 04 00 00')
 assert api.cstring(0xdf5d0)=='13CShaderAPIDx8'
 assert struct.unpack('<Q',api.code(0x317a88+8,8))[0]==0xdf5d0
 assert struct.unpack('<Q',api.code(0x3184d0-8,8))[0]==0x317a88
 assert struct.unpack('<Q',api.code(0x3184d0+0x490,8))[0]==0x43eb0
 assert api.jump(0x43f78,'e9')==0x43820
 api.check(0x4384e,'41 89 d6');api.check(0x4391b,'44 89 f1 ba 0b 00 00 00 44 89 ee')
 api.check(0x43931,'c1 e9 1f');assert api.jump(0x4393b,'e8')==0x51f10
 # Shadow EnableSRGBRead is a no-op in this installed backend, so it cannot
 # overrule the dynamic command above; never infer sampling from that stub.
 assert struct.unpack('<Q',api.code(0x315440+0xa0,8))[0]==0x5c9d0;api.check(0x5c9d0,'55 48 89 e5 5d c3')
 result={'status':'installed_decal_multiply_uv2_and_dynamic_srgb_command_verified','binaries':[shader.identity(),api.identity()],
  'shaderVcsSha256':m.sha(raw),'aliasCount':n,'programs':reports,'vertexProgram':vsReport,
  'formula':'bakedDiffuse * originalBaseRGB * sampleSRGB(decal,originalVVD_UV2).rgb * (mode2 ? 2 : 1)',
  'decalAlphaUsed':False,'uv':'raw VVD extra type1 float2; VS v6/TEXCOORD1 -> PS v0.zw, no base UV substitute',
  'sampling':{'detailBlendModeDefault':0,'decalModes':[1,2],'commandOpcode':10,'sampler':12,'flags':'0x80000000',
    'consumer':'shaderapi 4e958 -> vtable3184d0+490 -> 43eb0 -> 43820 -> 43931 -> state11',
    'sRGBReadRequested':True,'shadowSRGBReadIsNoOp':True,'d3dStateSource':'https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dsamplerstatetype'},
  'scope':['Only no-detail/no-tint/no-envmap bumped decal multiply branches','Original texture bytes unchanged; WebGL hardware SRGB upload implements requested sampling',
    'No complete exposure/dynamic lighting reconstruction or source-client matched-frame proof','A compiler-reused stack slot in the cached draw path is not confused with semi-static bind generation'],
  'gpuVerified':False,'originalGeometryModified':False}
 (OUT/'decal-evidence.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':result['status'],'programs':len(reports),'sampling':result['sampling']},indent=2))
if __name__=='__main__':main()
