"""Read-only current-build accuracy/recoil call-chain discovery, no game process."""
from pathlib import Path
import json,struct,bisect,hashlib
from elftools.elf.elffile import ELFFile
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
ROOT=Path(__file__).resolve().parents[1]
raw=(ROOT/'.reference-assets/csgo-legacy/csgo/bin/server.so').read_bytes()
fdes=json.loads((ROOT/'output/source-hitbox-fdes.json').read_text());starts=[r[0]for r in fdes]
md=Cs(CS_ARCH_X86,CS_MODE_32)
with (ROOT/'.reference-assets/csgo-legacy/csgo/bin/server.so').open('rb')as f:
    elf=ELFFile(f);symbols=elf.get_section_by_name('.dynsym');external={}
    for section in elf.iter_sections():
        if section['sh_type']=='SHT_REL':
            for r in section.iter_relocations():
                if r['r_info_sym']:external[r['r_offset']]=symbols.get_symbol(r['r_info_sym']).name
def function(at):
    i=bisect.bisect_right(starts,at)-1
    return tuple(fdes[i])if i>=0 and at<sum(fdes[i])else None
def dump(at):
    a,n=function(at)
    lines=[]
    for i in md.disasm(raw[a:a+n],a):
        names=[external[p]for p in range(i.address,i.address+i.size)if p in external]
        lines.append(f'{i.address:08x}: {i.mnemonic} {i.op_str}'+(' ; '+','.join(names)if names else ''))
    (ROOT/f'output/source-handling-{a:x}.asm').write_text('\n'.join(lines)+'\n')
    return hex(a),n
terms=['weapon_accuracy_nospread','weapon_recoil_scale','weapon_recoil_decay1_exp','weapon_recoil_decay2_exp',
       'weapon_recoil_decay2_lin','weapon_recoil_vel_decay','weapon_recoil_suppression_shots','weapon_recoil_suppression_factor',
       'weapon_recoil_variance','weapon_recoil_view_punch_extra','weapon_accuracy_forcespread','m_fAccuracyPenalty',
       'm_flRecoilIndex','m_iRecoilIndex','m_iShotsFired','m_aimPunchAngle','m_aimPunchAngleVel','recoil seed',
       'spread seed','inaccuracy stand','inaccuracy fire','inaccuracy move','recovery time stand']
report={}
for term in terms:
    s=raw.find(term.encode()+b'\0');refs={};p=0
    if s>=0:
        while True:
            p=raw.find(struct.pack('<I',s),p)
            if p<0:break
            func=function(p)
            if func:refs[func]=p
            p+=1
    report[term]={'stringVA':hex(s),'functions':[{'function':dump(a),'reference':hex(p)}for (a,n),p in refs.items()]}
for at in [0xcb4bc0,0xc737e0]:dump(at)
(ROOT/'output/source-handling-discovery.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
for filename in ['libvstdlib.so','libtier0.so']:
    path=ROOT/'.reference-assets/csgo-legacy/bin'/filename
    if not path.exists():continue
    with path.open('rb')as f:
        elf=ELFFile(f);symbols=elf.get_section_by_name('.dynsym')
        print(filename,hashlib.sha256(path.read_bytes()).hexdigest())
        for s in symbols.iter_symbols():
            if any(t in s.name.lower()for t in ['random','md5_pseud']):print(hex(s['st_value']),s['st_size'],s.name)
