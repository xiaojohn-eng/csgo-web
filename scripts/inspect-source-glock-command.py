"""Read-only App740 Glock RTTI/FDE/field call-chain index."""
from pathlib import Path
import json,struct,bisect,hashlib
from elftools.elf.elffile import ELFFile
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
ROOT=Path(__file__).resolve().parents[1];PATH=ROOT/'.reference-assets/csgo-legacy/csgo/bin/server.so';raw=PATH.read_bytes();SHA='7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386';assert hashlib.sha256(raw).hexdigest()==SHA
fdes=json.loads((ROOT/'output/source-hitbox-fdes.json').read_text());starts=[r[0]for r in fdes];md=Cs(CS_ARCH_X86,CS_MODE_32)
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
 (ROOT/f'output/source-glock-{a:x}.asm').write_text('\n'.join(lines)+'\n');return hex(a),n
if __name__=='__main__':
 result={'sha256':SHA,'segments':segments,'strings':{}};rtti=va(raw.index(b'12CWeaponGlock\0'));rt=refs(rtti);result['rtti']={'name':hex(rtti),'references':list(map(hex,rt))}
 for term in ['CWeaponGlock','m_iBurstShotsRemaining','m_bBurstMode','m_fNextBurstShot','m_flNextPrimaryAttack','m_flNextSecondaryAttack','m_iClip1']:
  at=raw.find(term.encode()+b'\0');r=refs(va(at))if at>=0 else[];result['strings'][term]={'string':hex(va(at))if at>=0 else None,'refs':[{'address':hex(p),'function':dump(p)if function(p)else None}for p in r]}
 for p in rt:
  print('RTTI',hex(p),[hex(word(q))for q in range(p-4,p+16,4)],'refs',list(map(hex,refs(p-4))))
 (ROOT/'output/source-glock-discovery.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
