"""Bounded original IN_SPEED classification and ordinary rifle acceleration."""
from pathlib import Path
import importlib.util,struct,json
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('accuracy',ROOT/'scripts/probe-source-accuracy.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
d=a.d;f=a.f;MVD=d.T+0x9000;MVT=d.T+0xa000;TRUE=d.STOP+0x920;DIR=d.T+0xb000
class NativeWalking(a.NativeAccuracy):
    def __init__(self):
        super().__init__();self.cv.update({0x17903e0:1,0x18085e0:0})
        assert self.raw[0x16cff84:0x16cff8c]==struct.pack('<II',0x11ad198,0x1fc)
        assert self.raw[0x16cfc84:0x16cfc8c]==struct.pack('<II',0x11bcbd4,0x184)
        assert struct.unpack_from('<f',self.raw,0x12c4e38)[0]==f(.52)
        assert self.external[0xba162e]==self.external[0xba140d]=='__dynamic_cast'
    def hook(self,u,at,size,data):
        super().hook(u,at,size,data)
        if at in self.stops:return
        sp=u.reg_read(UC_X86_REG_ESP)
        if at==TRUE:self.ret(1)
        elif at==0x5cfc00:self.ret(d.W)
        elif at in [0xba162d,0xba140c]:u.reg_write(UC_X86_REG_EAX,self.uint(sp));u.reg_write(UC_X86_REG_EIP,at+5)
    def prepare(self,attrs,c):
        self.setup(attrs,dict(penalty=0,recoilIndex=0,lastShotTime=0,lastUpdateTime=0),dict(grounded=True))
        self.ints(a.MOVE+8,[MVD]);self.ints(a.MOVE,[MVT]);self.ints(MVT+0x68,[TRUE]);self.ints(a.PVT+0x15c,[0x546df0]);self.ints(a.VT+0x708,[0xba9bc0])
        self.ints(d.P+0x1560,[-1]);self.floats(d.P+0x1274,[c.get('surfaceFriction',1)]);self.floats(a.GLOBALS+0x14,[1/64])
        buttons=(0x20000 if c['speedButton']else 0)|(4 if c['duckPressed']else 0);self.ints(MVD+0x24,[buttons]);self.ints(d.P+0xe0,[1|(2 if c['ducked']else 0)])
        self.u.mem_write(d.P+0xa3d,bytes([int(c['ducking'])]));self.u.mem_write(d.P+0x16a9,bytes([int(c['walkingBefore'])]))
        self.floats(d.P+0x1fc,c['velocitySource']);self.floats(MVD+0x38,[c['maxSpeedSource']]);self.floats(MVD+0x40,c['velocitySource'])
    def gate(self,attrs,c):
        self.prepare(attrs,c);self.u.reg_write(UC_X86_REG_EBX,a.MOVE);self.u.reg_write(UC_X86_REG_ESI,d.P)
        self.run(0xba26f4,[0xba2730]);return dict(walking=bool(self.u.mem_read(d.P+0x16a9,1)[0]),walkRequested=bool(self.u.mem_read(d.F-0x34,1)[0]),wishSpeedLimitSource=self.read(MVD+0x38))
    def accelerate(self,attrs,c,wishSpeed,direction,dt):
        self.prepare(attrs,c);self.floats(a.GLOBALS+0x14,[dt]);self.floats(DIR,direction)
        bits=lambda x:struct.unpack('<I',struct.pack('<f',x))[0]
        self.ints(d.F,[d.STOP,a.MOVE,DIR,bits(wishSpeed),bits(5.5)]);self.u.reg_write(UC_X86_REG_ESP,d.F)
        self.run(0xba1330,[0xba15c5,0xba1bda]);return list(struct.unpack('<3f',self.u.mem_read(MVD+0x40,12)))
    def accuracy(self,attrs,c,grounded):
        gate=self.gate(attrs,c);self.grounded=grounded;self.floats(d.P+0x184,c['velocitySource']);self.floats(d.W+0xa84,[.037]);self.ints(d.P+0xe0,[1 if grounded else 0])
        return dict(gate=gate,inaccuracy=self.call(0xd3ff60,[d.W],True))
def main():
    e=NativeWalking();ps=a.profiles();rows=[]
    for weapon,attrs in ps.items():
        maximum=float(attrs['max player speed']);threshold=f(f(f(maximum)*f(.52))+25)
        for speed in [0,20,80,110,threshold-.0001,threshold,threshold+.0001,maximum]:
            for walking in [False,True]:
                for duckKind in ['none','button','transition','ducked']:
                    for pressed in [False,True]:
                        for vertical in [False,True]:
                            c=dict(maxSpeedSource=maximum,velocitySource=[0,0,speed]if vertical else[speed,0,0],walkingBefore=walking,speedButton=pressed,duckPressed=duckKind=='button',ducking=duckKind=='transition',ducked=duckKind=='ducked')
                            rows.append(dict(weapon=weapon,input=c,original=e.gate(attrs,c)))
    accelerations=[]
    for weapon,attrs in ps.items():
        maximum=float(attrs['max player speed'])
        for speed in [0,50,100,106.8,110,116,140,200,250]:
            for pressed in [False,True]:
                c=dict(maxSpeedSource=maximum,velocitySource=[speed,0,0],walkingBefore=False,speedButton=pressed,duckPressed=False,ducking=False,ducked=False)
                gate=e.gate(attrs,c);wish=gate['wishSpeedLimitSource']
                for direction in [[1,0,0],[.6,.8,0],[-1,0,0]]:
                    for dt in [1/128,1/64,1/60,.1]:
                        for friction in [.5,1,1.2]:
                            context=dict(c,surfaceFriction=friction)
                            accelerations.append(dict(weapon=weapon,input=context,wishSpeedSource=wish,direction=direction,dt=dt,original=e.accelerate(attrs,context,wish,direction,dt)))
    accuracies=[]
    for weapon,attrs in ps.items():
        for speed in [70,100,160,215]:
            for pressed in [False,True]:
                for previous in [False,True]:
                    for grounded in [False,True]:
                        c=dict(maxSpeedSource=float(attrs['max player speed']),velocitySource=[speed,0,0 if grounded else 200],walkingBefore=previous,speedButton=pressed,duckPressed=False,ducking=False,ducked=False)
                        accuracies.append(dict(weapon=weapon,input=c,grounded=grounded,original=e.accuracy(attrs,c,grounded)))
    report=dict(status='original_walking_gate_and_acceleration_executed',sourceServerSha256=d.SHA,rows=rows,accelerations=accelerations,accuracies=accuracies,
                limits=['Accelerate executes original start through velocity writes, with weapon/player type/ownership and CanAccelerate adapters; excludes later movement-history side effects.',
                        'Normal standing rifles/default weapon-speed acceleration, no ExoJump/heavy armor/hostage/encumbrance/stamina slowdown; no air or duck acceleration is claimed here.',
                        'IN_SPEED classification samples m_vecVelocity (local Source XYZ), while the original accuracy getter samples m_vecAbsVelocity (horizontal magnitude). Static unparented players make them equal.'])
    (ROOT/'output/tests/source-walking-native.json').write_text(json.dumps(report,separators=(',',':'))+'\n');print(json.dumps(dict(status=report['status'],gateCases=len(rows),accelerationCases=len(accelerations))))
if __name__=='__main__':main()
