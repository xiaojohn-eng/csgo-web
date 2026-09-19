"""Original App740 compound selector and DX9 instruction evidence, no engine run."""
from pathlib import Path
import importlib.util,json,struct,sys
from unicorn.x86_const import UC_X86_REG_RBP,UC_X86_REG_R14,UC_X86_REG_R9,UC_X86_REG_RIP,UC_X86_REG_RDX
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.reference-assets/source-exports/dust2-vhv/encoding/tint-decal'
def module(name,file):
    s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def main():
    m=module('tint_decal_encoding','inspect-source-vhv-encoding.py');t=module('tint_decal_x64','inspect-source-prop-tint.py');v=module('tint_decal_vpk','inventory-source-map.py')
    OUT.mkdir(exist_ok=True);shader=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so')
    # Original material type probes: info+1d8 decal and info+1f8 tint are distinct.
    shader.check(0xc4b81,'49 63 84 24 d8 01 00 00');shader.check(0xc4baa,'49 63 84 24 f8 01 00 00')
    shader.check(0xc4ba3,'0f 94 85 38 fb ff ff');shader.check(0xc4bcc,'0f 94 85 4a fb ff ff')
    shader.check(0xca73e,'69 95 c4 fa ff ff 00 00 40 0b');shader.check(0xca74e,'44 03 8d bc fa ff ff')
    shader.check(0xce216,'c7 85 bc fa ff ff 00 00 c0 03')
    uc=t.emulator(shader);frame=t.BASE+0xe000;uc.reg_write(UC_X86_REG_R14,t.BASE)
    rows=[]
    for tint in (0,1):
        for decal,mode in ((0,0),(1,0),(1,1),(1,2)):
            uc.mem_write(t.BASE,bytes(0x10000));uc.mem_write(frame-0x4c8,bytes([decal]));uc.mem_write(frame-0x4b6,bytes([tint]));uc.mem_write(frame-0x4d0,struct.pack('<I',mode))
            uc.reg_write(UC_X86_REG_R14,t.BASE);uc.emu_start(0xce1f0,0xca615,count=100);assert uc.reg_read(UC_X86_REG_RIP)==0xca615
            decalTerm=struct.unpack('<I',uc.mem_read(frame-0x544,4))[0];tintFlag=struct.unpack('<I',uc.mem_read(frame-0x53c,4))[0]
            assert decalTerm==(0x7800000 if not decal else 0 if mode==0 else 0x3c00000) and tintFlag==tint
            # Hold the previously verified diffuse-only baseline (static4), and
            # execute the original index arithmetic, stopping before virtual call.
            uc.mem_write(frame-0x4e8,struct.pack('<I',1));uc.reg_write(UC_X86_REG_R9,0)
            uc.emu_start(0xca690,0xca766,count=100);assert uc.reg_read(UC_X86_REG_RIP)==0xca766
            index=uc.reg_read(UC_X86_REG_RDX);rows.append({'tint':bool(tint),'decal':bool(decal),'decalMode':mode,'decalTerm':decalTerm,'combinedStaticIndex':index,'staticRecord':index//320})
    selectedRow=next(r for r in rows if r['tint'] and r['decal'] and r['decalMode']==1);assert selectedRow['staticRecord']==786436
    vpk=v.VPKIndex(ROOT/'.reference-assets/csgo-legacy/platform/platform_pak01_dir.vpk');raw=vpk.read('shaders/fxc/vertexlit_and_unlit_generic_bump_ps30.vcs')
    head=struct.unpack_from('<7I',raw);assert head[2]==320
    at=28+head[5]*8;n=struct.unpack_from('<I',raw,at)[0];aliases=dict(struct.iter_unpack('<2I',raw[at+4:at+4+n*8]))
    requested=selectedRow['staticRecord'];code,report=m.vcs_combo(raw,aliases.get(requested,requested),80)
    report.update(requestedStatic=requested,aliasResolvedStatic=aliases.get(requested,requested));name='bump-ps-static786436-dynamic80'
    (OUT/(name+'.dx9')).write_bytes(code);(OUT/(name+'.tokens.txt')).write_text(m.shader_text(code))
    tokens=m.instructions(code)
    exact={285:(0x03000042,0x800f0002,0x90e40000,0xa0e4080d),289:(0x03000002,0x80180000,0x80550002,0xa000000c),
      293:(0x03000002,0x80070002,0x80550001,0xa0e40001),297:(0x04000004,0x80070002,0x80ff0000,0x80e40002,0xa0aa0005),
      302:(0x03000005,0x80070001,0x80f80001,0x80e40002),306:(0x03000005,0x80070000,0x80e40000,0x80e40001),
      310:(0x03000042,0x800f0001,0x90ee0000,0xa0e4080c),314:(0x03000005,0x80070001,0x80e40001,0xa0ff0003),
      318:(0x03000005,0x80070000,0x80e40000,0x80e40001)}
    for address,expected in exact.items():assert tokens[address]==expected
    # Execute decoded token operands with an independent generic register model.
    # This is a float32 token interpreter, NOT original D3D GPU execution.
    f=t.f32;sourceTint=json.loads((OUT.parent/'tint/tint-evidence.json').read_text());oracle=[]
    for i in range(64):
      base=list(map(f,[.03+(i%7)/10,.12+(i%5)/9,.04+(i%3)/4,0 if i%2 else 1]));baked=list(map(f,[.3+(i%3)/5,.4+(i%4)/6,.1+(i%7)/9]));c1=sourceTint['renderHandoff']['samples'][i*4]['originalShaderConstant']
      tint=list(map(f,[.9,(i%9)/8,.1,0 if i%2 else 1]));decal=list(map(f,[.2+(i%5)/8,.1+(i%7)/10,.6,1 if i%2 else 0]));bias=-1 if i>=48 else 0
      regs={(0,0):base[:],(0,1):[baked[0],-1,baked[1],baked[2]],(1,0):[.2,.3,.7,.8],(2,1):c1,(2,3):[0,0,0,1],(2,5):[2,-1,1,0],(2,12):[bias,0,0,0]};reads=[]
      def kind(token):return ((token>>28)&7)|((token>>8)&24)
      def read(token):
        src=regs[(kind(token),token&2047)];sw=(token>>16)&255;out=[src[(sw>>(j*2))&3] for j in range(4)];modifier=(token>>24)&15
        assert modifier in (0,1);return [-x for x in out] if modifier else out
      for address,inst in exact.items():
        op=inst[0]&65535;dest=inst[1];args=inst[2:]
        if op==66:
          coords=read(args[0]);sampler=args[1]&2047;value=tint[:] if sampler==13 else decal[:];reads.append({'sampler':sampler,'uv':coords[:2]})
        else:
          a,b=map(read,args[:2]);value=[f(x+y) if op==2 else f(x*y) for x,y in zip(a,b)]
          if op==4:value=[f(x+y) for x,y in zip(value,read(args[2]))]
          assert op in (2,4,5)
        if dest&(1<<20):value=[min(1,max(0,x)) for x in value]
        current=regs.setdefault((kind(dest),dest&2047),[0]*4)
        for lane in range(4):
          if (dest>>(16+lane))&1:current[lane]=value[lane]
      assert reads==[{'sampler':13,'uv':[.2,.3]},{'sampler':12,'uv':[.7,.8]}]
      mask=min(1,max(0,f(tint[1]+bias)));expected=[f(f(base[j]*f(baked[j]*f(f(mask*f(c1[j]-1))+1)))*decal[j]) for j in range(3)]
      assert regs[(0,0)][:3]==expected
      oracle.append({'base':base,'bakedDiffuse':baked,'shaderC1':c1,'sampledTintRGBA':tint,'sampledDecalRGBA':decal,'bias':bias,'originalTokenFloat32RGB':regs[(0,0)][:3]})
    proof={'format':'source-prop-tint-decal-evidence-v1','binary':shader.identity(),'selectorCases':rows,'program':report,
        'shaderVcsSha256':m.sha(raw),'originalInstructionsExecuted':['0xce1f0..0xca615 (bounded branch graph)','0xca690..0xca766 (stop before virtual call)'],
        'verifiedInstructionWords':list(exact),'tokenFloat32Oracle':oracle,'decalMode':1,'decalAlphaUsed':False,'tintMaskChannel':'green',
        'formula':'mask=saturate(sRGB(tint,UV0).g+c12.x); tint=1+mask*(c1.rgb-1); tintedLighting=baked*tint; output=(base*tintedLighting)*(sRGB(decal,UV2).rgb*c3.w)',
        'boundary':'Bounded original x64 selector arithmetic and independent decoded-DX9-token float32 interpreter. Not original D3D GPU execution, fused-MAD precision, full Source engine, alpha pass or other decal modes.'}
    (OUT/'evidence.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof,indent=2))
if __name__=='__main__':main()
