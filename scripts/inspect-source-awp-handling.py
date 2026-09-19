"""AWP's own virtual consumers and original instruction byte identities."""
from pathlib import Path
import importlib.util,hashlib,json
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('awp_handling_inspect',ROOT/'scripts/inspect-source-glock-command.py');d=importlib.util.module_from_spec(s);s.loader.exec_module(d)
slots={'FullAuto':0x688,'CycleTime':0x694,'MaxSpeed':0x6b8,'BurstCapable':0x6c0,'OnLand':0x718,'Inaccuracy':0x738,'UpdateAccuracy':0x73c}
vt=0x12e92f4;functions={}
addresses={d.word(vt+off)for off in slots.values()}|{0xd41e70,0xd3ed90,0xd42490,0xca30e0,0xc70850,0x712520,0xba6f20,0xd44d10,0xd4b1f0}
for address in sorted(addresses):
 start,size=d.function(address);blob=d.raw[d.offset(start):d.offset(start)+size]
 file=ROOT/f'output/source-awp-handling-{start:x}.asm';file.write_text('\n'.join(f'{i.address:08x}: {i.mnemonic} {i.op_str}'for i in d.md.disasm(blob,start))+'\n')
 functions[hex(address)]=dict(start=hex(start),bytes=size,sha256=hashlib.sha256(blob).hexdigest(),disassembly=str(file.relative_to(ROOT)))
report=dict(serverSha256=d.SHA,vtable=hex(vt),slots={name:dict(offset=hex(off),function=hex(d.word(vt+off)))for name,off in slots.items()},functions=functions,
 note='Original AWP FullAuto d47710 returns the actual false item attribute; its full-auto-only continuation is not bypassed by substituting the base rifle slot. BurstCapable d4e890 reads the original zero byte. Both own slots are installed in the native AWP oracle.')
(ROOT/'output/source-awp-handling-discovery.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(functions=len(functions),slots=report['slots'])))
