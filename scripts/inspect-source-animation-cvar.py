"""Read-only evidence for the installed official server's compiled CVar default.

No game binary is executed. This deliberately asserts this build's exact x86-64
instruction windows rather than guessing defaults from adjacent strings.
"""
from pathlib import Path
import hashlib
import json
import struct
import subprocess

ROOT=Path(__file__).resolve().parents[1]
BINARY=ROOT/'.reference-assets/csgo-legacy/csgo/bin/linux64/server_client.so'
OUTPUT=ROOT/'.reference-assets/source-exports/character-t/combat'
b=BINARY.read_bytes()
assert b[:6]==b'\x7fELF\x02\x01'
phoff=struct.unpack_from('<Q',b,32)[0];phents,phnum=struct.unpack_from('<HH',b,54)
segments=[struct.unpack_from('<IIQQQQQQ',b,phoff+i*phents) for i in range(phnum)]
def file_offset(address):
    return next(s[2]+address-s[3] for s in segments if s[0]==1 and s[3]<=address<s[3]+s[5])
def code(address,size):
    offset=file_offset(address);return b[offset:offset+size]
def rip_lea(address,prefix):
    instruction=code(address,7);assert instruction[:3]==bytes.fromhex(prefix)
    return address+7+struct.unpack_from('<i',instruction,3)[0]
def cstring(address):
    offset=file_offset(address);return b[offset:b.index(b'\0',offset)].decode('ascii')

# SysV ABI: RDI=this, RSI=name, RDX=default, ECX=flags, R8=help.
name=rip_lea(0x5ea248,'48 8d 35');default=rip_lea(0x5ea23d,'48 8d 15')
help_text=rip_lea(0x5ea231,'4c 8d 05');object_address=rip_lea(0x5ea253,'48 8d 3d')
assert cstring(name)=='anim_3wayblend';assert cstring(default)=='1'
assert cstring(help_text)=='Toggle the 3-way animation blending code.'
assert code(0x5ea238,5)==bytes.fromhex('b9 00 20 00 00')
assert code(0x5ea25a,5)==bytes.fromhex('e8 91 b1 a7 00') # call 0x10653f0
assert code(0x1065477,5)==bytes.fromhex('e8 54 fd ff ff') # wrapper -> 0x10651d0
# Create's nonnull RDX becomes [this+0x40]; it is then copied to the mutable
# string and converted to float/int, eliminating the adjacent-string ambiguity.
assert code(0x10651ef,3)==bytes.fromhex('48 85 d2')
assert code(0x1065200,4)==bytes.fromhex('48 0f 45 fa')
assert code(0x1065216,4)==bytes.fromhex('48 89 7b 40')
assert code(0x1065253,4)==bytes.fromhex('48 8b 73 40')
assert code(0x106525e,5)==bytes.fromhex('e8 2d 0a 52 ff') # memcpy@plt
assert code(0x10652a8,4)==bytes.fromhex('48 8b 7b 48') # numeric conversion of mutable string

# Confirm the initializer is present in ELF initialization data.
shoff=struct.unpack_from('<Q',b,40)[0];shents,shnum,shstridx=struct.unpack_from('<HHH',b,58)
sections=[struct.unpack_from('<IIQQQQIIQQ',b,shoff+i*shents) for i in range(shnum)]
names=sections[shstridx];strings=b[names[4]:names[4]+names[5]]
initializers=[]
for section in sections:
    name_offset=section[0];section_name=strings[name_offset:strings.index(b'\0',name_offset)].decode()
    if section_name=='.init_array':
        initializers=list(struct.unpack_from('<'+'Q'*(section[5]//8),b,section[4]))
assert 0x5ea230 in initializers,'Initializer must be included in this ELF init array'
OUTPUT.mkdir(exist_ok=True)
disassembly=[]
for start,end in ((0x5ea230,0x5ea25f),(0x10653f0,0x1065487),(0x10651d0,0x10652f7)):
    disassembly.append(subprocess.check_output(['/usr/bin/objdump','--disassemble',f'--start-address={start}',f'--stop-address={end}',str(BINARY)],text=True))
(OUTPUT/'anim-3wayblend-disassembly.txt').write_text('\n'.join(disassembly))
report={'status':'compiled_default_verified','binary':str(BINARY.relative_to(ROOT)),
    'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'elfClass':'64-bit little-endian x86-64',
    'initializer':'0x5ea230','initializerPresentInELFInitArray':True,'call':'0x5ea25a','constructor':'0x10653f0','create':'0x10651d0',
    'arguments':{'name':{'address':hex(name),'string':cstring(name)},'default':{'address':hex(default),'string':cstring(default)},
        'flags':'0x2000','help':{'address':hex(help_text),'string':cstring(help_text)},'object':hex(object_address)},
    'compiledDefault':1,'binaryExecuted':False,
    'scope':'Installed official Linux64 server binary compiled default; runtime config/replication overrides and client binary not inferred',
    'evidence':'Exact asserted instructions, ELF init-array entry, RDX default pointer flow into retained/mutable value, independent llvm-objdump disassembly'}
(OUTPUT/'anim-3wayblend-default.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
