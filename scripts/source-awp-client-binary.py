"""Read-only Original installed i386 client RTTI/FDE/call-chain helper for AWP scope."""
from pathlib import Path
import json,struct,bisect,hashlib
from elftools.elf.elffile import ELFFile
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
ROOT=Path(__file__).resolve().parents[1];PATH=ROOT/'.reference-assets/csgo-legacy/csgo/bin/client_client.so';raw=PATH.read_bytes();SHA='21d2d652a3b2e07c44fa0a3b638886744af9d24ba0c91e64f97a0d8afc43d4cb';assert hashlib.sha256(raw).hexdigest()==SHA
fdes=json.loads((ROOT/'output/source-awp-client-fdes.json').read_text());starts=[r[0]for r in fdes];md=Cs(CS_ARCH_X86,CS_MODE_32)
with PATH.open('rb')as f:
 elf=ELFFile(f);external={};segments=[(s['p_vaddr'],s['p_offset'],s['p_filesz'])for s in elf.iter_segments()if s['p_type']=='PT_LOAD'];symbols=elf.get_section_by_name('.dynsym')
 for section in elf.iter_sections():
  if section['sh_type']=='SHT_REL':
   for r in section.iter_relocations():
    if r['r_info_sym']:external[r['r_offset']]=symbols.get_symbol(r['r_info_sym']).name

def offset(va):
 for v,p,n in segments:
  if v<=va<v+n:return p+va-v
 raise ValueError(hex(va))
def va(at):
 for v,p,n in segments:
  if p<=at<p+n:return v+at-p
 raise ValueError(hex(at))
def word(at):return struct.unpack_from('<I',raw,offset(at))[0]
def function(at):
 i=bisect.bisect_right(starts,at)-1
 return tuple(fdes[i])if i>=0 and at<sum(fdes[i])else None
def refs(value):
 out=[];at=-1
 while True:
  at=raw.find(struct.pack('<I',value),at+1)
  if at<0:return out
  out.append(va(at))
def dump(at):
 a,n=function(at);lines=[]
 for i in md.disasm(raw[offset(a):offset(a)+n],a):
  names=[external[p]for p in range(i.address,i.address+i.size)if p in external]
  lines.append(f'{i.address:08x}: {i.mnemonic} {i.op_str}'+(' ; '+','.join(names)if names else ''))
 (ROOT/f'output/source-awp-client-{a:x}.asm').write_text('\n'.join(lines)+'\n');return hex(a),n
