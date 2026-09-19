"""Original normal camera punch composition + original AngleMatrix oracle.

Client camera block and ordinary default weapon_recoil_scale branch execute
unchanged. Starts after camera origin/base angle acquisition; no engine/UI.
"""
from pathlib import Path
import importlib.util,hashlib,struct,json,math
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1];CLIENT=ROOT/'.reference-assets/csgo-legacy/csgo/bin/client_client.so'
SHA='21d2d652a3b2e07c44fa0a3b638886744af9d24ba0c91e64f97a0d8afc43d4cb'
F=0x8008000;P=0x9000000;OUT=P+0x8000;STOP=P+0x9000;VT=P+0xa000
f=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
class NativeCamera:
    def __init__(self):
        raw=CLIENT.read_bytes();assert hashlib.sha256(raw).hexdigest()==SHA
        assert raw[0xfab1d7:raw.index(0,0xfab1d7)]==b'0.45'
        assert raw[0x10f6f38:raw.index(0,0x10f6f38)]==b'2.0'
        assert struct.unpack_from('<I',raw,0x1022b68+0x634)[0]==0x5c3f50
        assert raw[0x10223b4:raw.index(0,0x10223b4)]==b'10C_CSPlayer'
        u=self.u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0,0x7000000);u.mem_map(0x8000000,0x10000);u.mem_map(P,0x10000)
        with CLIENT.open('rb')as stream:
            elf=ELFFile(stream)
            for seg in elf.iter_segments():
                if seg['p_type']=='PT_LOAD':u.mem_write(seg['p_vaddr'],seg.data())
        # At the virtual aim getter boundary run the exact default normal
        # branch with its real frame and epilogue; only prior game-type query
        # (selecting normal vs alternate ConVar) is outside this bounded slice.
        u.hook_add(UC_HOOK_CODE,self.hook)
        self.ints(P,[VT]);self.ints(VT+0x634,[0x5c3f50]);self.ints(0x14d401c,[0x14d4000]);self.floats(0x14d402c,[.45]);self.ints(0x1517b5c,[0x1517b40]);self.floats(0x1517b6c,[2])
    def ints(self,p,v):self.u.mem_write(p,struct.pack('<%dI'%len(v),*v))
    def floats(self,p,v):self.u.mem_write(p,struct.pack('<%df'%len(v),*v))
    def hook(self,u,at,size,data):
        if at==0x57c4e8:u.emu_stop()
        elif at==0x5c3f58:
            bp=u.reg_read(UC_X86_REG_EBP);u.reg_write(UC_X86_REG_EBX,struct.unpack('<I',u.mem_read(bp+8,4))[0]);u.reg_write(UC_X86_REG_ESI,struct.unpack('<I',u.mem_read(bp+12,4))[0]);u.reg_write(UC_X86_REG_EIP,0x5c3fe0)
    def camera(self,angles,aim,view):
        self.floats(OUT,angles);self.floats(P+0x2fe0,view);self.floats(P+0x2fec,aim)
        self.u.reg_write(UC_X86_REG_EBP,F);self.u.reg_write(UC_X86_REG_ESP,F-0x1000);self.u.reg_write(UC_X86_REG_EBX,P);self.u.reg_write(UC_X86_REG_ESI,OUT)
        self.u.emu_start(0x57c43e,STOP,count=5000);assert self.u.reg_read(UC_X86_REG_EIP)==0x57c4e8
        return list(struct.unpack('<3f',self.u.mem_read(OUT,12)))
def main():
    spec=importlib.util.spec_from_file_location('trace',ROOT/'scripts/probe-source-hitboxes.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    angle=m.OriginalTrace();native=NativeCamera();rows=[]
    for yaw in [-math.pi,-2,-math.pi/2,0,.7,math.pi/2,math.pi]:
        for pitch in [-1.4,-.4,0,.35,1.4]:
            for aim,view in [([0,0,0],[0,0,0]),([-4.75,1.125,0],[-.4,.2,.1]),([2.2,-5,.3],[.3,-.2,-.5])]:
                base=[f(-pitch*180/math.pi),f((yaw+math.pi/2)*180/math.pi),0];combined=native.camera(base,aim,view);mat=angle.angle(combined)
                rows.append(dict(yaw=yaw,pitch=pitch,punch=dict(angle=aim,velocity=[0,0,0],viewPunch=view),sourceAngles=combined,original=dict(forward=[mat[0],mat[8],-mat[4]],right=[-mat[1],-mat[9],mat[5]],up=[mat[2],mat[10],-mat[6]])))
    report=dict(sourceClientSha256=SHA,sourceServerSha256=m.SHA,status='original_camera_default_punch_branch_executed',rows=rows,limits=['Camera origin/base angle acquisition, spectator/demo and alternate game-type recoil scale are outside this bounded normal branch.','Original AngleMatrix uses host sincosf rounded to float.'])
    (ROOT/'output/tests/source-camera-native.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(dict(status=report['status'],cases=len(rows))))
if __name__=='__main__':main()
