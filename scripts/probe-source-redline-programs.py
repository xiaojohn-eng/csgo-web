"""Installed CustomWeapon PS extraction and bounded native selector/constant oracle.

Reads the official platform VPK and stdshader ELF; no engine or OS calls run.
Token arithmetic is a separate portable numerical model, never called native GPU.
"""
from pathlib import Path
import hashlib,importlib.util,json,struct,sys
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/ak47-redline-programs'
def module(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def ctab(code):
 at=code.index(b'CTAB')+4;size,creator,version,count,info,flags,target=struct.unpack_from('<7I',code,at)
 assert size==28
 def text(offset):return code[at+offset:code.index(b'\0',at+offset)].decode()
 rows=[]
 for i in range(count):
  name,register_set,index,n,reserved,typ,default=struct.unpack_from('<I4H2I',code,at+info+20*i)
  rows.append({'name':text(name),'registerSet':register_set,'index':index,'count':n})
 return {'creator':text(creator),'target':text(target),'constants':rows}
def main():
 m=module('redline_encoding','inspect-source-vhv-encoding.py');v=module('redline_vpk','inventory-source-map.py');x=module('redline_x64','inspect-source-prop-tint.py');OUT.mkdir(exist_ok=True)
 idx=v.VPKIndex(ROOT/'.reference-assets/csgo-legacy/platform/platform_pak01_dir.vpk');elf=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so')
 elf.check(0x65aee,'49 63 44 24 4c');elf.check(0x64ea7,'8b 05 5b c8 2f 00 89 45 bc');elf.check(0x2dd9a,'89 05 68 39 33 00')
 assert elf.cstring(elf.rip(0x2dd6a,'48 8d 05'))=='$PAINTSTYLE'
 assert elf.cstring(elf.rip(0x65c83,'48 8d 35'))=='customweapon_ps30'
 # Execute exact final selector arithmetic. Flags have already been read from
 # original material fields; do not invoke hardware/shadow virtual calls.
 u=x.emulator(elf);frame=x.BASE+0xe000;u.reg_write(UC_X86_REG_R14,x.BASE);selectors=[]
 for style in range(1,10):
  for exponent in [False,True]:
   for preview in [False,True]:
    for tint in [False,True]:
     for factor in [0.,1.,2.]:
      u.mem_write(frame-0x201,bytes([preview]));u.mem_write(frame-0x24c,bytes([tint]));u.mem_write(frame-0x238,struct.pack('<f',factor))
      u.mem_write(frame-0x208,struct.pack('<I',style));u.mem_write(frame-0x250,struct.pack('<I',exponent));u.mem_write(frame-0x244,struct.pack('<I',0))
      u.emu_start(0x65c3e,0x65cb1,count=100);assert u.reg_read(UC_X86_REG_RIP)==0x65cb1
      combined=u.reg_read(UC_X86_REG_RDX);expected=5*style+50*exponent+200*preview+400*(preview and tint)+800*(factor<1)
      assert combined==expected
      selectors.append({'style':style,'exponentMode':exponent,'preview':preview,'previewPhongAlbedoTint':tint,'phongAlbedoFactor':factor,'nativeCombined':combined,'static':combined//5})
 # Native c3 command emission in the explicit non-preview path. Values are the
 # material parameters consumed by the shader, NOT unverified paintkit mapping.
 constants=[];info=x.BASE+0x1000;params=x.BASE+0x2000;ctx=x.BASE+0x3000;var=x.BASE+0x4000;stream=x.BASE+0x8000
 for offset,n in [(0x3c,0),(0x40,1),(0x44,2)]:u.mem_write(info+offset,struct.pack('<i',n));u.mem_write(params+8*n,struct.pack('<Q',var+64*n))
 for exponent in [0.,.5,150/255,150.]:
  for intensity in [0.,.1,1.]:
   for wear in [.1,.2,.7,1.]:
    for n,value in enumerate([exponent,intensity,wear]):u.mem_write(var+64*n+0x14,struct.pack('<f',value))
    u.mem_write(frame-0x201,b'\0');u.mem_write(frame-0x208,struct.pack('<I',7));u.mem_write(ctx+0x330,struct.pack('<Q',stream))
    for reg,value in [(UC_X86_REG_R12,info),(UC_X86_REG_R13,params),(UC_X86_REG_RBX,ctx),(UC_X86_REG_RCX,stream-16),(UC_X86_REG_XMM0,0x3f800000)]:u.reg_write(reg,value)
    u.emu_start(0x666d7,0x667d6,count=100);assert u.reg_read(UC_X86_REG_RIP)==0x667d6
    words=struct.unpack('<3I4f',u.mem_read(stream,28));assert words[:3]==(3,3,1)
    assert words[3:]==tuple(map(x.f32,[1,exponent,intensity,wear]))
    constants.append({'materialParameters':[exponent,intensity,wear],'nativeCommandWords':[3,3,1],'nativeC3':list(words[3:])})
 # Execute original bind-command writers after texture-handle retrieval. The
 # handle is explicit input; original slot/bit31 flags are the measured output.
 bindings=[]
 for sampler,start,end,expected in [(0,0x67968,0x679ac,0x80000000),(1,0x67c40,0x67c84,1),(2,0x67bd8,0x67c1c,2),(3,0x67b6f,0x67bb3,0x80000003),(5,0x67aa0,0x67ae4,0x80000005),(8,0x661c1,0x66205,0x80000008)]:
  u.mem_write(ctx+0x330,struct.pack('<Q',stream));u.reg_write(UC_X86_REG_RBX,ctx);u.reg_write(UC_X86_REG_RAX,0x12345678)
  u.emu_start(start,end,count=100);assert u.reg_read(UC_X86_REG_RIP)==end
  command,flags,handle=struct.unpack('<IIQ',u.mem_read(stream,16));assert (command,flags,handle)==(10,expected,0x12345678)
  bindings.append({'sampler':sampler,'nativeCommand':command,'nativeFlags':flags,'srgbRead':bool(flags&0x80000000),'span':[hex(start),hex(end)]})
 programs=[]
 for name,static,dynamic in [('customweapon_ps30',7,0),('customweapon_ps30',17,0),('customweapon_vs30',0,0)]:
  path='shaders/fxc/'+name+'.vcs';raw=idx.read(path);(OUT/(name+'.vcs')).write_bytes(raw);code,report=m.vcs_combo(raw,static,dynamic)
  base=f'{name}-static{static}-dynamic{dynamic}';(OUT/(base+'.dx9')).write_bytes(code);(OUT/(base+'.tokens.txt')).write_text(m.shader_text(code));tokens=[list(row) for row in m.instructions(code).values()]
  programs.append({**report,'file':base+'.dx9','vcsPath':path,'vcsBytes':len(raw),'vcsSha256':m.sha(raw),'ctab':ctab(code),'tokens':tokens})
 proof={'format':'source-redline-program-evidence-v1','status':'original_shader_programs_and_native_parameter_boundary_verified','binary':elf.identity(),'selectors':selectors,'constantCases':constants,'samplerBindCommands':bindings,'programs':programs,
  'boundary':'Native bounded x64 selector and non-preview material-parameter upload; original VCS/DX9 bytes and CTAB. Paintkit-to-material normalization is independently measured by probe-source-redline-client-parameters.py; seed-to-transforms and final original-client GPU comparison remain independent.'}
 (OUT/'evidence.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'status':proof['status'],'nativeSelectors':len(selectors),'nativeConstantCases':len(constants),'programs':[{k:p[k] for k in ['file','programBytes','programSha256','ctab']} for p in programs]},indent=2))
if __name__=='__main__':main()
