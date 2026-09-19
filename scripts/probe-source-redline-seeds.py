"""Installed client seed draw order + full original x64 vstdlib RNG.

Only the isolated thread-ID ABI and external sincosf/text conversion are supplied.
All RNG arithmetic and the material matrix builder execute original instructions.
"""
from pathlib import Path
import importlib.util,json,math,struct,sys
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def module(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
m=module('redline_seed_elf','inspect-source-vhv-encoding.py');x=module('redline_seed_x64','inspect-source-prop-tint.py');f=x.f32
bits=lambda n:struct.unpack('<I',struct.pack('<f',n))[0]
floatreg=lambda u,r:struct.unpack('<f',struct.pack('<I',u.reg_read(r)&0xffffffff))[0]
class NativeRandom64:
 def __init__(self):
  self.elf=e=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/libvstdlib_client.so');self.u=u=x.emulator(e);self.ptr=x.BASE+0x1000;self.stop=x.BASE+0x6000
  # Resolve original same-library ELF symbols in this isolated link space.
  for got,addr in [(0x253fd0,0x253b80),(0x254148,0x1e3e0),(0x254080,0x1e550),(0x2543e8,x.BASE+0x5000)]:u.mem_write(got,struct.pack('<Q',addr))
  u.mem_write(x.BASE+0x5000,b'\xb8\x01\x00\x00\x00\xc3') # explicit isolated thread ID 1
 def call(self,address,seed=0,lo=0,hi=1):
  u=self.u;u.reg_write(UC_X86_REG_RDI,self.ptr);u.reg_write(UC_X86_REG_RSI,seed&0xffffffff);u.reg_write(UC_X86_REG_RSP,x.BASE+0xf000);u.mem_write(x.BASE+0xf000,struct.pack('<Q',self.stop));u.reg_write(UC_X86_REG_XMM0,bits(lo));u.reg_write(UC_X86_REG_XMM1,bits(hi));u.emu_start(address,self.stop,count=10000);assert u.reg_read(UC_X86_REG_RIP)==self.stop
  return floatreg(u,UC_X86_REG_XMM0)
 def reset(self):self.u.mem_write(self.ptr,bytes(0x100));self.call(0x1e520)
 def seed(self,s):self.call(0x1e3e0,s)
 def random(self,lo,hi):return self.call(0x1e750,lo=lo,hi=hi)
class NativeSeed:
 def __init__(self):
  self.elf=e=m.ELF(ROOT/'.reference-assets/csgo-legacy/csgo/bin/linux64/client_client.so');self.u=u=x.emulator(e);self.rng=NativeRandom64();self.obj=x.BASE+0x1000;self.kit=x.BASE+0x3000;self.draws=[]
  self.kitSource=json.loads((ROOT/'.reference-assets/source-exports/ak47-redline-inputs/inputs.json').read_text())['paintKit'];self.schemaFields=['pattern_scale','pattern_offset_x_start','pattern_offset_x_end','pattern_offset_y_start','pattern_offset_y_end','pattern_rotate_start','pattern_rotate_end'];assert self.kitSource['style']=='7' and self.kitSource['ignore_weapon_size_scale']=='1'
  for name,lea,store,offset in [(self.schemaFields[0],0xd1411d,0xd14145,0xec),*[(name,0xd1413b+32*i,0xd14165+32*i,0xf0+4*i) for i,name in enumerate(self.schemaFields[1:])]]:
   assert e.cstring(e.rip(lea,'48 8d 35'))==name;e.check(store,'f3 41 0f 11 85 '+struct.pack('<i',offset).hex(' '))
  self.calls=[0xf52df5,0xf52e19,0xf52e3d,0xf52e5d,0xf52e79,0xf52e95,0xf52eb1,0xf52ed1,0xf52eed,0xf52f09,0xf52f25]
  assert e.jump(0xf52dd9,'e8')==0x69fc80
  assert all(e.jump(at,'e8')==0x6a0d00 for at in self.calls)
  u.hook_add(UC_HOOK_CODE,self.hook,begin=0xf52dce,end=0xf52f25)
 def hook(self,u,at,size,data):
  if at==0xf52dce:self.rng.reset()
  elif at==0xf52dd9:self.rng.seed(u.reg_read(UC_X86_REG_RSI)&0xffffffff)
  elif at in self.calls:
   lo=floatreg(u,UC_X86_REG_XMM0);hi=floatreg(u,UC_X86_REG_XMM1);v=self.rng.random(lo,hi);u.reg_write(UC_X86_REG_XMM0,bits(v));self.draws.append({'at':hex(at),'range':[lo,hi],'value':v})
  else:return
  u.reg_write(UC_X86_REG_RIP,at+5)
 def run(self,seed):
  u=self.u;self.draws=[];u.mem_write(self.obj,bytes(0x1000));u.mem_write(self.kit,bytes(0x200));u.mem_write(self.obj+0x1c,struct.pack('<i',seed));u.mem_write(self.kit+0xec,struct.pack('<7f',*[float(self.kitSource[key]) for key in self.schemaFields]));u.mem_write(self.obj+0x9bc,struct.pack('<i',7));u.mem_write(self.kit+0x118,b'\1')
  for r,a in [(UC_X86_REG_RBX,self.obj),(UC_X86_REG_R12,self.kit),(UC_X86_REG_R13,x.BASE+0x9000),(UC_X86_REG_RDI,x.BASE+0x9000)]:u.reg_write(r,a)
  u.emu_start(0xf52dad,0xf52f38,count=1000);assert u.reg_read(UC_X86_REG_RIP)==0xf52f38
  raw=struct.unpack('<12f',u.mem_read(self.obj+0xa08,48));return {'seed':seed,'draws':self.draws,'fields':{name:list(raw[i*4:i*4+4]) for i,name in enumerate(['pattern','wear','grunge'])}}
class NativeUpload:
 def __init__(self):
  self.elf=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so');self.u=x.emulator(self.elf)
 def run(self,kind,matrix):
  u=self.u;pointer=x.BASE+0x1000;context=x.BASE+0x2000;stream=x.BASE+0x3000
  reg,start,end={'pattern':(48,0x6808d,0x65ede),'wear':(50,0x67cd9,0x66002),'grunge':(52,0x67d51,0x66126)}[kind]
  u.mem_write(pointer,struct.pack('<16f',*matrix));u.mem_write(context+0x330,struct.pack('<Q',stream));u.reg_write(UC_X86_REG_RAX,pointer);u.reg_write(UC_X86_REG_RBX,context)
  u.emu_start(start,end,count=200);assert u.reg_read(UC_X86_REG_RIP)==end
  words=struct.unpack('<3I8f',u.mem_read(stream,44));assert words[:3]==(4,reg,2) and list(words[3:])==matrix[:8]
  return {'header':list(words[:3]),'rows':list(words[3:]),'span':[hex(start),hex(end)]}
class NativeMatrix:
 def __init__(self):
  self.elf=e=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/materialsystem_client.so');self.u=u=x.emulator(e);self.frame=x.BASE+0xe000;self.output=x.BASE+0x1000;self.trig=[]
  assert e.cstring(0x1202a8)==' scale %f %f translate %f %f rotate %f'
  u.hook_add(UC_HOOK_CODE,self.hook,begin=0x25810,end=0x25810)
 def hook(self,u,at,size,data):
  arg=floatreg(u,UC_X86_REG_XMM0);s=f(math.sin(arg));c=f(math.cos(arg));u.mem_write(u.reg_read(UC_X86_REG_RDI),struct.pack('<f',s));u.mem_write(u.reg_read(UC_X86_REG_RSI),struct.pack('<f',c));sp=u.reg_read(UC_X86_REG_RSP);ret=struct.unpack('<Q',u.mem_read(sp,8))[0];u.reg_write(UC_X86_REG_RSP,sp+8);u.reg_write(UC_X86_REG_RIP,ret);self.trig.append({'argument':arg,'suppliedSin':s,'suppliedCos':c})
 def run(self,values):
  scale,tx,ty,rot=values;args=list(map(lambda z:f(float(format(z,'.2f'))),[scale,scale,tx,ty,rot]));u=self.u;F=self.frame;self.trig=[]
  u.mem_write(F-0x340,struct.pack('<Q',self.output));u.mem_write(F-0x2e0,struct.pack('<2f',*args[:2]));u.mem_write(F-0x2c0,struct.pack('<2f',*args[2:4]));u.mem_write(F-0x2e4,struct.pack('<f',args[4]));u.reg_write(UC_X86_REG_RBP,F);u.reg_write(UC_X86_REG_RSP,x.BASE+0xc000)
  u.emu_start(0x327aa,0x3291a,count=10000);assert u.reg_read(UC_X86_REG_RIP)==0x3291a
  return {'portableText':'scale %.2f %.2f translate %.2f %.2f rotate %.2f'%tuple([scale,scale,tx,ty,rot]),'parsed':args,'nativeMatrix':list(struct.unpack('<16f',u.mem_read(self.output,64))),'trigABI':self.trig}
def main():
 n=NativeSeed();matrix=NativeMatrix();upload=NativeUpload();rows=[]
 for seed in [*range(1001),-1,2147483647,-2147483648]:
  row=n.run(seed)
  F=x.BASE+0xe000;u=n.u;u.mem_write(F-0x74,struct.pack('<f',f(1/255)));row['nativeMaterialFormatArguments']={}
  for name,start,end in [('pattern',0xf522b1,0xf52352),('wear',0xf52369,0xf523ae),('grunge',0xf523c5,0xf5240a)]:
   u.emu_start(start,end,count=100);assert u.reg_read(UC_X86_REG_RIP)==end
   args=[struct.unpack('<d',struct.pack('<Q',u.reg_read(r)&0xffffffffffffffff))[0] for r in [UC_X86_REG_XMM0,UC_X86_REG_XMM1,UC_X86_REG_XMM2,UC_X86_REG_XMM3,UC_X86_REG_XMM4]];values=row['fields'][name];assert args==[values[0],*values];row['nativeMaterialFormatArguments'][name]=args
  row['matrices']={name:matrix.run(values) for name,values in row['fields'].items()};row['uploads']={name:upload.run(name,value['nativeMatrix']) for name,value in row['matrices'].items()};rows.append(row)
 descriptors=[]
 for seed in [0,422,1000]:
  for wear in [.1,.4,.7]:
   u=n.u;descriptor=x.BASE+0x7000;u.mem_write(descriptor+8,struct.pack('<iifii',282,seed,wear,0,0));u.reg_write(UC_X86_REG_R12,descriptor);u.reg_write(UC_X86_REG_RBX,n.obj);u.emu_start(0xf53365,0xf53391,count=30);assert u.reg_read(UC_X86_REG_RIP)==0xf53391
   values=struct.unpack('<iif',u.mem_read(n.obj+0x18,12));assert values==(282,seed,f(wear));descriptors.append({'input':{'paintKitId':282,'seed':seed,'wear':wear},'nativeObjectValues':list(values)})
 report={'status':'original_client_seed_rng_and_matrix_arithmetic_executed','client':n.elf.identity(),'vstdlib':n.rng.elf.identity(),'materialsystem':matrix.elf.identity(),'stdshader':upload.elf.identity(),'descriptorCases':descriptors,'schemaFieldMapping':dict(zip(n.schemaFields,[hex(0xec+i*4) for i in range(7)])),'diagnosticUploads':[upload.run(name,[f(i/7-.3) for i in range(16)]) for name in ['pattern','wear','grunge']],'cases':rows,'boundary':'Original CUniformRandomStream and caller draw order execute completely; original matrix arithmetic executes. Fixed original Redline schema fields are explicit input. %.2f formatting/sscanf and sincosf ABI are host supplied, not original glibc execution. Inventory item-to-seed/wear extraction and final D3D output remain separate.'}
 out=ROOT/'.reference-assets/source-exports/ak47-redline-programs/seed-uv.json';out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'cases':len(rows),'first':rows[0]},indent=2))
if __name__=='__main__':main()
