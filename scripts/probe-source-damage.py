"""Execute bounded original App740 damage instructions in isolated Unicorn.

Only the external standard pow(double,double) call is a host math callback.
Hitgroup, IsArmored, ratio, insufficient-armor branch and integer conversion
execute original bytes. Does not execute game entity/event/health side effects.
"""
from pathlib import Path
import hashlib
import json
import math
import struct
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import *

ROOT=Path(__file__).resolve().parents[1]
SERVER=ROOT/'.reference-assets/csgo-legacy/csgo/bin/server.so'
SHA='7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386'
F=0x3010000;P=0x4000000;W=0x4010000;T=0x4020000;STOP=0x5000000;POW=STOP+256
f32=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]


class OriginalDamage:
    def __init__(self):
        self.raw=SERVER.read_bytes();assert hashlib.sha256(self.raw).hexdigest()==SHA
        self.u=u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0,0x2000000)
        self.external={}
        with SERVER.open('rb') as f:
            elf=ELFFile(f)
            for segment in elf.iter_segments():
                if segment['p_type']=='PT_LOAD':u.mem_write(segment['p_vaddr'],segment.data())
            symbols=elf.get_section_by_name('.dynsym')
            for section in elf.iter_sections():
                if section['sh_type']=='SHT_REL':
                    for rel in section.iter_relocations():
                        if rel['r_info_sym']:self.external[rel['r_offset']]=symbols.get_symbol(rel['r_info_sym']).name
        assert self.external[0xc74cac]=='__pow_finite'
        assert self.raw[0x12be10c:0x12be10c+len(b'9CCSPlayer\0')]==b'9CCSPlayer\0'
        assert struct.unpack_from('<I',self.raw,0x12be8d4+0x10c)[0]==0xc2c860
        assert struct.unpack_from('<I',self.raw,0x12be8d4+0x114)[0]==0xc449b0
        assert struct.unpack_from('<9I',self.raw,0x12bdbf8)==(0xc2d058,0xc2d200,0xc2d42a,0xc2d0a3,0xc2d06b,0xc2d06b,0xc2d4a6,0xc2d4a6,0xc2d42a)
        for at,code in [(0xc46024,'f30f1081f8000000'),(0xc4602c,'f30f59c1'),
                        (0xc2d03d,'f30f108af4000000'),(0xc74c8e,'f30f5905607a1d01')]:
            assert self.raw[at:at+len(code)//2].hex()==code
        u.mem_map(0x3000000,0x100000);u.mem_map(P,0x30000);u.mem_map(STOP,4096)
        # Host libm return adapter: the external callback supplies a double,
        # the tiny trampoline places it in x87 ST0 as the actual i386 ABI does.
        u.mem_write(POW,b'\xdd\x05'+struct.pack('<I',POW+64)+b'\xc3')
        self.stops=set();self.trace=[];self.powCalls=[];u.hook_add(UC_HOOK_CODE,self.hook)

    def ints(self,p,values):self.u.mem_write(p,struct.pack('<%dI'%len(values),*[v&0xffffffff for v in values]))
    def floats(self,p,values):self.u.mem_write(p,struct.pack('<%df'%len(values),*values))
    def read(self,p):return struct.unpack('<f',self.u.mem_read(p,4))[0]
    def uint(self,p):return struct.unpack('<I',self.u.mem_read(p,4))[0]
    def xmm(self,register,value):self.u.reg_write(register,struct.unpack('<I',struct.pack('<f',value))[0])
    def reset(self):
        self.u.mem_write(F-0x2000,bytes(0x4000));self.u.mem_write(P,bytes(0x30000));self.trace=[]
        for r in [UC_X86_REG_EAX,UC_X86_REG_EBX,UC_X86_REG_ECX,UC_X86_REG_EDX,UC_X86_REG_EDI,UC_X86_REG_ESI]:self.u.reg_write(r,0)
        for r in range(UC_X86_REG_XMM0,UC_X86_REG_XMM7+1):self.u.reg_write(r,0)
        self.u.reg_write(UC_X86_REG_EBP,F);self.u.reg_write(UC_X86_REG_ESP,F-0x1000)
    def hook(self,u,address,size,user):
        self.trace.append(address)
        if address in self.stops:u.emu_stop();return
        if address==0xc74cab:
            sp=u.reg_read(UC_X86_REG_ESP);base,exponent=struct.unpack('<2d',u.mem_read(sp,16))
            value=math.pow(base,exponent);self.powCalls.append(dict(base=base,exponent=exponent,result=value))
            u.mem_write(POW+64,struct.pack('<d',value));self.ints(sp-4,[address+5])
            u.reg_write(UC_X86_REG_ESP,sp-4);u.reg_write(UC_X86_REG_EIP,POW)
    def run(self,at,stops):
        self.stops=set(stops);self.u.emu_start(at,STOP,count=10000)
        end=self.u.reg_read(UC_X86_REG_EIP)
        assert end in self.stops,(hex(at),hex(end),[hex(x)for x in self.trace[-20:]])
        return end
    def distance(self,damage,modifier,distance):
        self.reset();self.floats(F-0x63c,[distance]);self.floats(F-0x4b4,[1]);self.floats(F-0x610,[0])
        self.floats(F-0x5fc,[damage]);self.u.mem_write(F-0x658,struct.pack('<d',f32(modifier)))
        self.run(0xc74c6b,[0xc74cf2])
        return self.read(F-0x5fc)
    def hitgroup(self,damage,group,armor,helmet,head=4,head_scale=1,body_scale=1):
        self.reset();self.u.reg_write(UC_X86_REG_EDX,W);self.u.reg_write(UC_X86_REG_ESI,P)
        self.ints(F+0x14,[T]);self.ints(T+0x44,[group]);self.ints(P+0xfb8,[armor])
        self.u.mem_write(P+0x174c,bytes([int(helmet),0]));self.floats(W+0xf4,[head])
        self.floats(F-0xac,[damage]);self.floats(F-0xb8,[body_scale]);self.xmm(UC_X86_REG_XMM0,head_scale)
        # Stop at each ordinary group's completed damage assignment, before
        # independent blood/flinch/sound/event code. These are original branch
        # exits after the actual table dispatch, never a host hitgroup switch.
        self.run(0xc2d03d,[0xc2d058,0xc2d229,0xc2d45a,0xc2d0db,0xc2d09e,0xc2d4e1])
        return self.read(F-0xac)
    def armor(self,damage,ratio,group,armor,helmet):
        self.reset();u=self.u;u.reg_write(UC_X86_REG_ECX,W);u.reg_write(UC_X86_REG_EDI,P);u.reg_write(UC_X86_REG_EAX,2)
        self.ints(P+0xfb8,[armor]);self.ints(P+0x708,[group]);u.mem_write(P+0x174c,bytes([int(helmet),0]))
        self.floats(W+0xf8,[ratio]);self.ints(F-0x16c,[2]);self.floats(F-0x248,[damage]);self.floats(F-0x24c,[1])
        end=self.run(0xc4601c,[0xc4537c,0xc45f50])
        applied=end==0xc45f50
        return dict(damage=self.read(F-0x238)if applied else f32(damage),armored=applied,
                    armorAfter=u.reg_read(UC_X86_REG_EAX)if applied else armor,
                    reportedArmorDamage=u.reg_read(UC_X86_REG_EDX)if applied else 0,
                    nativeExit=hex(end))
    def health_integer(self,damage):
        self.reset();self.u.reg_write(UC_X86_REG_EDI,P);self.floats(F-0x238,[damage])
        self.run(0xc4577a,[0xc457a9])
        return int(self.read(F-0x178))


def main():
    oracle=OriginalDamage();rows=[]
    scales={}
    for name,at,instance in [('mp_damage_scale_ct_head',0x44d43f,0x180d1a0),('mp_damage_scale_ct_body',0x44d408,0x180d220),
                             ('mp_damage_scale_t_head',0x44d4ad,0x180d0a0),('mp_damage_scale_t_body',0x44d476,0x180d120)]:
        raw=oracle.raw;name_at=raw.index(name.encode()+b'\0')
        assert raw[at:at+5]==b'\x68'+struct.pack('<I',name_at) and raw[at-5]==0x68
        assert raw[at+5:at+10]==b'\x68'+struct.pack('<I',instance)
        default_at=struct.unpack_from('<I',raw,at-4)[0];default=raw[default_at:raw.index(0,default_at)].decode()
        assert default=='1.0'
        scales[name]=dict(default=default,registrationVA=hex(at),instanceVA=hex(instance))
    catalog=json.loads((ROOT/'research/source-items-catalog.json').read_bytes())
    source=next(r for r in catalog['sourceFilesRead'] if r['path']=='scripts/items/items_game.txt')
    assert hashlib.sha256((ROOT/'.reference-assets/csgo-legacy/csgo'/source['path']).read_bytes()).hexdigest()==source['sha256']
    profiles={}
    for weapon,prefab in [('ak47','weapon_ak47_prefab'),('m4a4','weapon_m4a1_prefab')]:
        attributes={};chain=[]
        def merge(name):
            row=catalog['prefabs'][name]
            for parent in row.get('prefab','').split():merge(parent)
            attributes.update(row.get('attributes',{}));chain.append(name)
        merge(prefab)
        profiles[weapon]=dict(prefabChain=chain,attributes={key:float(attributes[key]) for key in
            ['damage','headshot multiplier','armor ratio','range','range modifier']})
    for name,damage,ratio,modifier in [('ak47',36,1.55,.98),('m4a4',33,1.4,.97)]:
        assert profiles[name]['attributes']=={'damage':damage,'headshot multiplier':4,'armor ratio':ratio,'range':8192,'range modifier':modifier}
        for distance in [0,1,100,500,1000,2000,8192]:
            attenuated=oracle.distance(damage,modifier,distance)
            for group in range(9):
                for armor in [0,1,5,20,100]:
                    for helmet in [False,True]:
                        grouped=oracle.hitgroup(attenuated,group,armor,helmet)
                        final=oracle.armor(grouped,ratio,group,armor,helmet)
                        final['healthDamageInteger']=oracle.health_integer(final['damage'])
                        rows.append(dict(weapon=name,baseDamage=damage,armorRatio=ratio,rangeModifier=modifier,distanceSource=distance,
                                         hitgroup=group,armor=armor,helmet=helmet,attenuated=attenuated,grouped=grouped,original=final))
        print('ORIGINAL_DAMAGE',name,'rays',len(rows),flush=True)
    report=dict(sourceServerSha256=SHA,appId=740,build=12426148,status='original_normal_damage_blocks_executed',
        functions={'CCSPlayer.TraceAttack':'0xc2c860','CCSPlayer.OnTakeDamage':'0xc449b0','IsArmored':'0xc18af0','FireBullet':'0xc737e0'},
        fields={'playerArmor':0xfb8,'hasHelmet':0x174c,'heavyArmor':0x174d,'lastHitgroup':0x708,'weaponHeadMultiplier':0xf4,'weaponArmorRatio':0xf8},
        distanceFactor=struct.unpack_from('<f',oracle.raw,0x11d7a60)[0],powCalls=oracle.powCalls,rows=rows,
        weaponSource=source,weaponProfiles=profiles,
        normalDamageScaleDefaults=scales,
        limits=['Bounded original normal no-penetration blocks, not an original engine process or complete TakeDamage event/health pipeline.',
                'Heavy armor, friendly fire, damage-scale overrides, penetration, special weapon damage and complete entity health/death application are not covered.',
                'Only standard external pow(double,double) is supplied by the host; all float32 scaling, armor decisions and integer armor conversions execute original instructions.',
                'AK range modifier .98 and head multiplier4 inherit from the original statted_item_base prefab; weapon_m4a1 is the M4A4, not M4A1-S.'])
    (ROOT/'output/tests/source-damage-native.json').write_text(json.dumps(report,indent=2)+'\n')
    print('PASS',len(rows),'cases; sample',rows[0],rows[-1])


if __name__=='__main__':main()
