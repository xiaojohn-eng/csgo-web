"""Read-only original AWP RTTI/vtable, byte-level function and event evidence."""
from pathlib import Path
import importlib.util,json,hashlib,struct
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('awp_discovery_base',ROOT/'scripts/inspect-source-glock-command.py');d=importlib.util.module_from_spec(s);s.loader.exec_module(d)
VT=0x12e92f4;RTTI=0x12e7208
assert d.va(d.raw.index(b'10CWeaponAWP\0'))==d.word(RTTI+4)
assert d.word(VT-4)==RTTI
SLOTS={'Deploy':0x4ac,'Holster':0x4b0,'ItemPostFrame':0x4d0,'Reload':0x4f8,'PrimaryAttack':0x4fc,'SecondaryAttack':0x500,'WeaponIdle':0x4dc,'HasZoom':0x71c,'ZoomFov':0x6f4,'ZoomTime':0x6f8}
rows={};functions={}
for name,slot in SLOTS.items():
 address=d.word(VT+slot);rows[name]=dict(slot=hex(slot),function=hex(address))
for address in sorted({d.word(VT+off)for off in SLOTS.values()}|{0x61d9c0,0x7cb6b0,0xd4b1f0,0xd43820,0xd443d0,0xd45270,0xc9ac20,0xd3f530,0xd499e0,0xd3ff60,0xd42060}):
 start,size=d.function(address);blob=d.raw[d.offset(start):d.offset(start)+size]
 lines=[f'{i.address:08x}: {i.mnemonic} {i.op_str}'for i in d.md.disasm(blob,start)]
 file=ROOT/f'output/source-awp-{start:x}.asm';file.write_text('\n'.join(lines)+'\n')
 functions[hex(start)]=dict(bytes=size,sha256=hashlib.sha256(blob).hexdigest(),disassembly=str(file.relative_to(ROOT)))
checks=[]
for path in ['csgo/bin/server.so','csgo/bin/client_client.so','csgo/bin/client.dll','csgo/bin/linux64/client_client.so']:
 file=ROOT/'.reference-assets/csgo-legacy'/path;blob=file.read_bytes();checks.append(dict(path=path,bytes=len(blob),sha256=hashlib.sha256(blob).hexdigest(),namedUnzoomRegistrationStringPresent=b'AE_WPN_UNZOOM\0'in blob))
assert not any(row['namedUnzoomRegistrationStringPresent']for row in checks)
report=dict(serverSha256=d.SHA,rtti=hex(RTTI),vtable=hex(VT),slots=rows,weaponTypeTable=dict(entryVA='0x1725f18',enum=d.word(0x1725f18),name='SniperRifle'),functions=functions,unzoomNameChecks=checks,
 fields={'weaponZoomLevel':'0xb00','weaponMode':'0xa6c','weaponZoomReadyTime':'0xa90','ballisticAccuracyPenalty':'0xa84','zoomSmoothing':'0xa8c','playerScoped':'0x16a8','playerResumeZoom':'0x16aa','playerFovTarget':'0xda4','playerFovStart':'0xdac','playerFovTime':'0xdb0','playerFovDuration':'0xa2c'},
 boundary='Absence of a registration name is recorded, not a fabricated handler. UNZOOM remains an opaque original MDL marker; native command owns observed FOV transitions.')
out=ROOT/'output/source-awp-command-discovery.json';out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(dict(file=str(out),slots=rows)))
