"""Recover raw original DMX unpack schemas via each registered operator factory.
Read-only ELF inspection, not a claim of executing particle simulation methods.
"""
from pathlib import Path
from elftools.elf.elffile import ELFFile
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP,UC_X86_REG_EIP,UC_X86_REG_EAX
import struct,json,hashlib,sys,re
ROOT=Path(__file__).resolve().parents[1];OUT=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'.reference-assets/source-exports/pistol-particles'
p=ROOT/'.reference-assets/csgo-legacy/csgo/bin/client_client.so';raw=p.read_bytes()
with p.open('rb')as f:
 elf=ELFFile(f);segments=[dict(s.header)for s in elf.iter_segments()if s['p_type']=='PT_LOAD'];imports={}
 for section in elf.iter_sections():
  if section['sh_type']in ['SHT_REL','SHT_RELA']:
   symbols=elf.get_section(section['sh_link'])
   for relocation in section.iter_relocations():
    if relocation['r_info_sym']:imports[relocation['r_offset']]=symbols.get_symbol(relocation['r_info_sym']).name
def offset(va):
 s=next(s for s in segments if s['p_vaddr']<=va<s['p_vaddr']+s['p_filesz']);return va-s['p_vaddr']+s['p_offset']
def word(va):return struct.unpack_from('<I',raw,offset(va))[0]
def string(va):
 if not va:return None
 at=offset(va);end=raw.index(0,at);return raw[at:end].decode()
def instructions(va,count=160):return list(Cs(CS_ARCH_X86,CS_MODE_32).disasm(raw[offset(va):offset(va)+count],va))
graph=json.loads((OUT/'graph.json').read_text());names=sorted({e['attributes']['functionName']for e in graph['elements']if 'functionName'in e['attributes']})
# The fields the shipped graphs actually override for a name, used to tell two
# registrations of the same name apart: the right schema must be able to hold every
# one of them. Nothing is chosen by preference - a name that still has more than one
# possible schema after this is refused.
overridden={}
for e in graph['elements']:
 fn=e['attributes'].get('functionName')
 if fn:overridden.setdefault(fn,set()).update(k for k in e['attributes']if k!='functionName')
result=[]
unresolved=[]
legacyAliases=[]
def discover(name):
 """Every registration of one operator name, read from the binary."""
 candidates=[];start=0
 while True:
  at=raw.find(name.encode()+b'\0',start)
  if at<0:break
  start=at+1;reference=0
  while True:
   reference=raw.find(struct.pack('<I',at),reference)
   if reference<0:break
   ref=reference;reference+=1
   if not(0x400000<ref<0x410000)or raw[ref-6:ref-4]!=b'\xc7\x05'or raw[ref-16:ref-14]!=b'\xc7\x05':continue
   vt=struct.unpack_from('<I',raw,ref-10)[0]
   call=next((i for i in instructions(ref+4,50)if i.mnemonic=='call'),None)
   if not call:continue
   getter=int(call.op_str,16);table=next((int(i.op_str.split(', ')[1],16)for i in instructions(getter,160)if i.mnemonic=='mov'and i.op_str.startswith('eax, 0x')),None)
   if not table:continue
   fields=[]
   for n in range(200):
    row=table+n*44;field=word(row)
    if not field:break
    fields.append(dict(name=string(field),default=string(word(row+4)),offset=word(row+12),bytes=word(row+16),
     rawRecordVA=hex(row),rawRecordHex=raw[offset(row):offset(row)+44].hex()))
   candidates.append(dict(registrationVA=hex(ref-6),definitionVTable=hex(vt),factory=hex(word(vt+4)),unpackGetter=hex(getter),tableVA=hex(table),fields=fields))
 if len(candidates)!=1:
  wanted=overridden.get(name,set())
  matching=[c for c in candidates if wanted<={f['name']for f in c['fields']}]
  if len(matching)==1:candidates=matching
 return candidates

# A shipped PCF can name an operator by the lowercase class-style spelling its authoring
# tool wrote, which this build does not register at all (`remap scalar to vector`). The
# display name it stands for is found from the binary's own string table by the same
# normalised, unique match the runtime uses, and that name is then read like any other -
# so the alias target is discovered, never spelled out by hand. A legacy name whose
# normalised form matches more than one registered string stays unresolved.
normalise=lambda value:''.join(character for character in value.lower()if character not in' _')
stringTable=[m.group()[:-1].decode()for m in re.finditer(rb'[\x20-\x7e]{2,60}\x00',raw)]
for name in names:
 candidates=discover(name)
 # A name this build cannot be told apart is resolved to the unique registration whose
 # fields can hold every override; anything still ambiguous fails closed.
 if len(candidates)!=1:
  wanted=overridden.get(name,set())
  matching=[c for c in candidates if wanted<={f['name']for f in c['fields']}]
  if len(matching)==1:candidates=matching
 if len(candidates)!=1:
  spellings=sorted({text for text in stringTable if normalise(text)==normalise(name)})
  resolved=[(text,discover(text))for text in spellings]
  resolved=[(text,c[0])for text,c in resolved if len(c)==1]
  if len(resolved)==1:
   text,record=resolved[0]
   legacyAliases.append(dict(requested=name,resolved=text))
   if text not in [row['functionName']for row in result]:result.append(dict(functionName=text,**record))
   continue
  unresolved.append(dict(functionName=name,candidates=len(candidates),
   spellings=spellings,overridden=sorted(overridden.get(name,set()))))
  continue
 result.append(dict(functionName=name,**candidates[0]))
u=Uc(UC_ARCH_X86,UC_MODE_32)
for s in segments:
 start=s['p_vaddr']&~4095;end=(s['p_vaddr']+s['p_memsz']+4095)&~4095;u.mem_map(start,end-start)
 u.mem_write(s['p_vaddr'],raw[s['p_offset']:s['p_offset']+s['p_filesz']])
STACK=0x20000000;RET=STACK+0x1000;u.mem_map(STACK,0x2000);externalCalls=[]
def hook(u,at,size,data):
 if at==RET:u.emu_stop();return
 if raw[offset(at):offset(at)+1]==b'\xe8'and at+1 in imports:
  name=imports[at+1]
  if name not in ['__cxa_guard_acquire','__cxa_guard_release']:raise ValueError('Unreviewed unpack dependency '+name)
  externalCalls.append(name);u.reg_write(UC_X86_REG_EAX,1 if name=='__cxa_guard_acquire'else 0);u.reg_write(UC_X86_REG_EIP,at+5)
u.hook_add(UC_HOOK_CODE,hook)
for record in result:
 u.mem_write(STACK+0x800,struct.pack('<I',RET));u.reg_write(UC_X86_REG_ESP,STACK+0x800)
 u.emu_start(int(record['unpackGetter'],16),RET,count=10000)
 if u.reg_read(UC_X86_REG_EAX)!=int(record['tableVA'],16):raise ValueError('Native schema returned unexpected table')
 for field in record['fields']:
  data=bytes(u.mem_read(int(field['rawRecordVA'],16),44));field['nativeType']=struct.unpack_from('<I',data,8)[0]
 record['nativeGetterExecuted']=True
report=dict(format='source-pistol-particle-native-defaults-v1',clientSHA256=hashlib.sha256(raw).hexdigest(),status='original-unpack-getters-executed',operators=result,unresolved=unresolved,legacyAliases=legacyAliases,externalAdapters=sorted(set(externalCalls)),
 boundary='Raw defaults and target offsets are original binary data; C++ typed conversion, RNG, per-particle operators and SpriteCard execution remain separate verification.')
(OUT/'native-defaults.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps([{k:r[k]for k in ['functionName','factory','tableVA']}for r in result],indent=2))
