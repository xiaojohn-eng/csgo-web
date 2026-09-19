"""Read-only build 12426148 ELF harness for incremental particle probes.
Importing this module never regenerates or touches previously delivered data.
"""
from pathlib import Path
import struct,hashlib
from elftools.elf.elffile import ELFFile
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP,UC_X86_REG_EIP,UC_X86_REG_EAX
ROOT=Path(__file__).resolve().parents[1]
class NativeClient:
 def __init__(self):
  p=ROOT/'.reference-assets/csgo-legacy/csgo/bin/client_client.so';self.raw=p.read_bytes();self.sha=hashlib.sha256(self.raw).hexdigest()
  assert self.sha=='21d2d652a3b2e07c44fa0a3b638886744af9d24ba0c91e64f97a0d8afc43d4cb'
  with p.open('rb')as f:
   elf=ELFFile(f);self.segments=[dict(s.header)for s in elf.iter_segments()if s['p_type']=='PT_LOAD']
  self.u=Uc(UC_ARCH_X86,UC_MODE_32)
  for s in self.segments:
   start=s['p_vaddr']&~4095;end=(s['p_vaddr']+s['p_memsz']+4095)&~4095;self.u.mem_map(start,end-start);self.u.mem_write(s['p_vaddr'],self.raw[s['p_offset']:s['p_offset']+s['p_filesz']])
  self.stack=0x20040000;self.ret=0x20080000;self.arena=0x21000000;self.u.mem_map(0x20000000,0x100000);self.u.mem_map(self.arena,0x100000);self.adapters={}
  self.floatSlot=self.arena+0xff000;self.floatTrampoline=self.floatSlot+16;self.u.mem_write(self.floatTrampoline,b'\xd9\x05'+struct.pack('<I',self.floatSlot)+b'\xc3')
  self.u.hook_add(UC_HOOK_CODE,self.hook)
 def offset(self,va):
  s=next(s for s in self.segments if s['p_vaddr']<=va<s['p_vaddr']+s['p_filesz']);return va-s['p_vaddr']+s['p_offset']
 def disasm(self,va,n=200):return list(Cs(CS_ARCH_X86,CS_MODE_32).disasm(self.raw[self.offset(va):self.offset(va)+n],va))
 def read(self,va):return struct.unpack('<I',self.u.mem_read(va,4))[0]
 def integer(self,va,n):self.u.mem_write(va,struct.pack('<I',n&0xffffffff))
 def floating(self,va,n):self.u.mem_write(va,struct.pack('<f',n))
 def string(self,va):
  if not va:return None
  data=bytearray()
  while len(data)<1000:
   b=bytes(self.u.mem_read(va+len(data),1))
   if b==b'\0':return data.decode()
   data+=b
  raise ValueError('Unterminated native string')
 def return_value(self,value):
  sp=self.u.reg_read(UC_X86_REG_ESP);at=self.read(sp);self.u.reg_write(UC_X86_REG_EAX,value);self.u.reg_write(UC_X86_REG_ESP,sp+4);self.u.reg_write(UC_X86_REG_EIP,at)
 def return_float(self,value):
  self.floating(self.floatSlot,value);self.u.reg_write(UC_X86_REG_EIP,self.floatTrampoline)
 def hook(self,u,at,size,data):
  if at==self.ret:u.emu_stop()
  elif at in self.adapters:self.adapters[at](self)
 def call(self,at,args=(),count=100000):
  self.u.mem_write(self.stack,struct.pack('<'+'I'*(1+len(args)),self.ret,*[x&0xffffffff for x in args]));self.u.reg_write(UC_X86_REG_ESP,self.stack);self.u.emu_start(at,self.ret,count=count)
  if self.u.reg_read(UC_X86_REG_EIP)!=self.ret:raise ValueError('Native instruction budget exhausted at '+hex(self.u.reg_read(UC_X86_REG_EIP)))
  return self.u.reg_read(UC_X86_REG_EAX)
