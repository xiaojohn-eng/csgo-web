"""Original App740 rifle OnLand and SharedRandomFloat oracle, isolated CPU only.

Executes the complete weapon callback, original CRC32 code, and vstdlib RNG.
Only external asinf uses host libm rounded to float; not a glibc ulp claim.
"""
from pathlib import Path
import importlib.util,json,struct,math,zlib
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
acc=module('accuracy','probe-source-accuracy.py');spread=module('spread','probe-source-spread.py')
d=acc.d;f=acc.f
LAND_CAPTURE=d.STOP+0x900;MOVDATA=d.T+0x9000;MOVVT=d.T+0xa000
class NativeLanding(acc.NativeAccuracy):
    def __init__(self):
        super().__init__();self.rng=spread.NativeRandom();self.shared=[]
        assert self.external[0xd40630]=='__asinf_finite'
        assert self.external[0x8d2b8f]=='RandomSeed' and self.external[0x8d2bac]=='RandomFloat'
        assert self.raw[0x12e5a45:self.raw.index(0,0x12e5a45)]==b'LandPunchAngleYaw'
        assert struct.unpack_from('<I',self.raw,0x12e7c5c+0x718)[0]==0xd40580
        assert struct.unpack_from('<I',self.raw,0x12a2184+0x80)[0]==0xb9fdc0
        assert struct.unpack_from('<f',self.raw,0x12e6c78)[0]==f(11.459155082702637)
    def hook(self,u,at,size,data):
        super().hook(u,at,size,data)
        if at in self.stops:return
        sp=u.reg_read(UC_X86_REG_ESP)
        if at==0xd4062f:
            self.floats(acc.RESULT+4,[f(math.asin(self.read(sp)))]);self.ints(sp-4,[at+5])
            u.reg_write(UC_X86_REG_ESP,sp-4);u.reg_write(UC_X86_REG_EIP,acc.FLOAT_ADAPTER)
        elif at==0x8d2b8e:
            seed=self.uint(sp);self.shared.append(dict(seed=seed));self.rng.seed(seed if seed<0x80000000 else seed-0x100000000)
            u.reg_write(UC_X86_REG_EIP,at+5)
        elif at==0xe84db0:
            pointer=self.uint(sp+4);length=0
            while self.u.mem_read(pointer+length,1)!=b'\0':
                length+=1;assert length<256
            self.ret(length) # standard strlen resolver only; CRC bytes execute
        elif at==LAND_CAPTURE:
            self.landed.append(self.read(sp+8));self.ret()
        elif at==0x8d2bab:
            # Original function tail-jumps RandomFloat; preserve its caller's return.
            lo,hi=self.read(sp+4),self.read(sp+8);value=self.rng.random(lo,hi)
            self.shared[-1].update(low=lo,high=hi,value=value)
            self.floats(acc.RESULT+4,[value]);u.reg_write(UC_X86_REG_EIP,acc.FLOAT_ADAPTER)
    def land(self,attrs,before,fall,seed):
        self.setup(attrs,before,dict(grounded=True));self.shared=[];self.ints(0x16d2424,[seed])
        self.call(0xd40580,[d.W,struct.unpack('<I',struct.pack('<f',fall))[0]])
        expected=zlib.crc32(struct.pack('<II',seed,0)+b'LandPunchAngleYaw')
        assert len(self.shared)==1 and self.shared[0]['seed']==expected,self.shared
        return dict(state=self.state(),shared=self.shared[0])
    def sample(self,attrs,before,previous,grounded,vz):
        self.setup(attrs,before,dict(grounded=grounded));self.floats(d.P+0xa58,[previous]);self.ints(acc.MOVE+8,[MOVDATA]);self.floats(MOVDATA+0x48,[vz]);self.u.reg_write(UC_X86_REG_EBX,acc.MOVE)
        self.run(0x714b04,[0x714b2b]);return self.read(d.P+0xa58)
    def transition(self,attrs,before,fall,grounded):
        self.setup(attrs,before,dict(grounded=grounded));self.floats(d.P+0xa58,[fall]);self.ints(acc.MOVE,[MOVVT]);self.ints(MOVVT+0x80,[LAND_CAPTURE]);self.landed=[]
        # health=0 skips independent rough-fall sound/damage/platform branch.
        # The normal grounded/positive gate, landing-view assignment, virtual
        # dispatch and fall-field clear execute their original instructions.
        self.call(0x709a00,[acc.MOVE]);first=dict(fallVelocitySource=self.read(d.P+0xa58),events=list(self.landed))
        self.call(0x709a00,[acc.MOVE]);return dict(first=first,second=dict(fallVelocitySource=self.read(d.P+0xa58),events=self.landed[len(first['events']):]))
    def sequence(self,attrs,before,fall,seed,time,dt):
        self.setup(attrs,before,dict(grounded=True),time,dt);self.shared=[];self.ints(0x16d2424,[seed])
        self.call(0x712520,[acc.MOVE]);self.call(0xba6f20,[acc.MOVE]);self.call(0xd40580,[d.W,struct.unpack('<I',struct.pack('<f',fall))[0]]);self.call(0xd42060,[d.W])
        return self.state()

def main():
    native=NativeLanding();ps=acc.profiles();rows=[]
    before=dict(penalty=.037,recoilIndex=2.75,lastShotTime=.7,lastUpdateTime=.9,angle=[-3.2,1.1,.2],velocity=[-15,3,-1],viewPunch=[-.2,.05,0])
    seeds=[0,1,2,42,255,256,65535,2147483647,303923,1896173357]
    falls=[0,.0001,1,16,20,100,200,301.993377,349.99,350,580,1024,2000,3500,5000]
    for weapon,attrs in ps.items():
        for seed in seeds:
            for fall in falls:rows.append(dict(weapon=weapon,before=before,fallVelocitySource=fall,commandSeed=seed,original=native.land(attrs,before,fall,seed)))
    samples=[dict(previous=previous,grounded=grounded,velocityZSource=vz,original=native.sample(ps['ak47'],before,previous,grounded,vz))for previous in [-20,0,300]for grounded in [False,True]for vz in [-600,-301.993377,-1,0,20,301.993377]]
    transitions=[dict(fallVelocitySource=fall,grounded=grounded,original=native.transition(ps['ak47'],before,fall,grounded))for fall in [-300,-1,0,1,16,20,300,350,1024,3500]for grounded in [False,True]]
    sequences=[dict(weapon=weapon,before=before,fallVelocitySource=fall,commandSeed=42,time=1.1,dt=dt,original=native.sequence(attrs,before,fall,42,1.1,dt))for weapon,attrs in ps.items()for fall in [1,300,1024]for dt in [0,1/128,1/64,1/60,.1]]
    report=dict(status='original_onland_shared_crc_rng_executed',sourceServerSha256=d.SHA,sourceVstdlibSha256=spread.VSHA,
        functions=dict(weaponOnLand='0xd40580',sharedRandomFloat='0x8d2b60',sharedSeedCRC='0x8d2530',crcProcessBuffer='0xe74610'),rows=rows,samples=samples,transitions=transitions,sequences=sequences,
        limits=['asinf is a host libm float ABI adapter, not an assertion of exact Linux glibc transcendental ulps.',
                'CheckFalling probe sets health=0 to bypass unrelated rough-fall sound/damage/platform side effects; it executes original ground/positive gates, dispatch and clear. Not full native movement.',
                'Weapon callback only: generic fall damage, stamina, water, moving bases and camera bob are outside this receipt.',
                '5000 Source units/s is an explicit synthetic asin clamp boundary, not a normal allowed player speed.'])
    (ROOT/'output/tests/source-landing-native.json').write_text(json.dumps(report,separators=(',',':'))+'\n')
    print(json.dumps(dict(status=report['status'],cases=len(rows),crcSeedErrors=0)))
if __name__=='__main__':main()
