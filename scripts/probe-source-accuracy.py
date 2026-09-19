"""Execute App740 accuracy and aim-punch functions, never a game process.

Only object ownership/info queries, network dirty notifications and external
libm calls are adapters. The original branches, stores and SSE execute intact.
"""
from pathlib import Path
import importlib.util, json, struct, math, hashlib
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('damage',ROOT/'scripts/probe-source-damage.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
f=d.f32
VT=d.T+0x1000;PVT=VT+0x1000;GLOBALS=d.T+0x4000;MOVE=d.T+0x5000
RET_FLOAT=d.STOP+0x400;FLOAT_ADAPTER=d.STOP+0x440;INFO=d.STOP+0x480;NOOP=d.STOP+0x490
RESULT=d.STOP+0x600
ECON=d.T+0x7000;ITEM=ECON+0x100;TREE=ECON+0x200;TABLE=ECON+0x300

ATTR_OFFSETS={'max player speed': 308, 'max player speed alt': 312, 'spread': 320, 'spread alt': 324, 'inaccuracy crouch': 328, 'inaccuracy crouch alt': 332, 'inaccuracy stand': 336, 'inaccuracy stand alt': 340, 'inaccuracy jump initial': 344, 'inaccuracy jump apex': 348, 'inaccuracy jump': 352, 'inaccuracy jump alt': 356, 'inaccuracy land': 360, 'inaccuracy land alt': 364, 'inaccuracy ladder': 368, 'inaccuracy ladder alt': 372, 'inaccuracy fire': 376, 'inaccuracy fire alt': 380, 'inaccuracy move': 384, 'inaccuracy move alt': 388, 'inaccuracy reload': 392, 'recoil seed': 396, 'recoil angle': 400, 'recoil angle alt': 404, 'recoil angle variance': 408, 'recoil angle variance alt': 412, 'recoil magnitude': 416, 'recoil magnitude alt': 420, 'recoil magnitude variance': 424, 'recoil magnitude variance alt': 428, 'spread seed': 432, 'recovery time crouch': 436, 'recovery time stand': 440, 'recovery time crouch final': 444, 'recovery time stand final': 448, 'recovery transition start bullet': 452, 'recovery transition end bullet': 456, 'inaccuracy pitch shift': 548, 'inaccuracy alt sound threshold': 552}

class NativeAccuracy(d.OriginalDamage):
    def __init__(self):
        super().__init__()
        self.u.mem_write(RET_FLOAT,b'\xd9\x1d'+struct.pack('<I',RESULT)+b'\xe9'+struct.pack('<i',d.STOP-(RET_FLOAT+11)))
        self.u.mem_write(FLOAT_ADAPTER,b'\xd9\x05'+struct.pack('<I',RESULT+4)+b'\xc3')
        self.cv={0x187a340:0,0x187a2c0:0,0x18718a0:0,0x187a0c0:1,0x1808b60:f(301.993377),
                 0x187a3c0:2,0x1879e40:0,0x1879c40:0,0x187a4c0:18,0x187a540:8,0x187a440:4.5,0x186b7e0:f(.055),0x1741760:18}
        self.tables={}
        self.defaults={}
        names=['weapon_accuracy_forcespread','weapon_accuracy_nospread','weapon_air_spread_scale','sv_jump_impulse',
               'weapon_recoil_decay_coefficient','sv_turning_inaccuracy_enabled','weapon_accuracy_reset_on_deploy',
               'weapon_recoil_decay2_lin','weapon_recoil_decay2_exp','weapon_recoil_vel_decay','weapon_recoil_view_punch_extra','view_punch_decay']
        for name in names:
            name_at=self.raw.index(name.encode()+b'\0');pattern=b'\x68'+struct.pack('<I',name_at);at=-1;matches=[]
            while True:
                at=self.raw.find(pattern,at+1)
                if at<0:break
                if self.raw[at-5]!=0x68 or self.raw[at+5]!=0x68 or self.raw[at+10]!=0xe8:continue
                instance=struct.unpack_from('<I',self.raw,at+6)[0]
                if instance not in self.cv:continue
                value_at=struct.unpack_from('<I',self.raw,at-4)[0];value=self.raw[value_at:self.raw.index(0,value_at)].decode()
                assert f(float(value))==f(self.cv[instance]),(name,value,self.cv[instance])
                matches.append(dict(instance=hex(instance),registration=hex(at),default=value))
            assert len(matches)==1,(name,matches)
            self.defaults[name]=matches[0]
        # The two movement virtual slots and ordinary rifle getter/update slots
        # are read from their original primary vtables, not inferred names.
        assert struct.unpack_from('<I',self.raw,0x12a2184+0x48)[0]==0x712520
        assert struct.unpack_from('<I',self.raw,0x12a2184+0x138)[0]==0xba6f20
        assert struct.unpack_from('<2I',self.raw,0x12e7c5c+0x738)==(0xd3ff60,0xd42060)
        self.exp_calls={p-1 for p,n in self.external.items() if n=='__expf_finite'}
        assert all(p in self.exp_calls for p in [0xd42259,0xd42307,0xba6e62,0xba71bd])
        assert self.external[0xc7087d]=='sincosf'
    def ret(self,value=0):
        sp=self.u.reg_read(UC_X86_REG_ESP);self.u.reg_write(UC_X86_REG_EAX,value)
        self.u.reg_write(UC_X86_REG_EIP,self.uint(sp));self.u.reg_write(UC_X86_REG_ESP,sp+4)
    def hook(self,u,at,size,data):
        super().hook(u,at,size,data)
        if at in self.stops:return
        sp=u.reg_read(UC_X86_REG_ESP)
        if at in [0xe78280,0x4f56c0,0x7cbc30,0x5dba30,NOOP]:self.ret()
        elif at==0x5dba40:self.ret(ECON)
        elif at==0xa14a10:self.ret(ITEM)
        elif at==0xca36b0:self.ret(0) # resource lookup only; original index math follows
        elif at==0xd3fed0:self.ret(d.P)
        elif at==0x7967f0:self.ret(1 if self.grounded else 0)
        elif at==INFO:self.ret(d.T)
        elif at==0x4aa490:self.ret(int(self.cv.get(self.uint(sp+4),0)))
        elif at==0x4aa340:
            self.floats(RESULT+4,[self.cv[self.uint(sp+4)]]);u.reg_write(UC_X86_REG_EIP,FLOAT_ADAPTER)
        elif at in self.exp_calls:
            self.floats(RESULT+4,[f(math.exp(self.read(sp)))]);self.ints(sp-4,[at+5])
            u.reg_write(UC_X86_REG_ESP,sp-4);u.reg_write(UC_X86_REG_EIP,FLOAT_ADAPTER)
        elif at==0xc7087c:
            angle=self.read(sp);self.floats(self.uint(sp+4),[f(math.sin(angle))]);self.floats(self.uint(sp+8),[f(math.cos(angle))])
            u.reg_write(UC_X86_REG_EIP,at+5)
    def setup(self,attrs,state,context,time=0,dt=1/60):
        self.reset();self.grounded=context['grounded']
        self.ints(d.W,[VT]);self.ints(VT+0x704,[INFO]);self.ints(VT+0x6b8,[0xba9e80]);self.ints(VT+0x694,[0xd34540])
        self.ints(VT+0x688,[0xd34510]);self.ints(VT+0x6c0,[0xd34760]);self.u.mem_write(d.T+0xec,b'\x01')
        self.ints(ECON,[ECON+0x40]);self.ints(ECON+0x40+0x34,[0x5cda80]);self.ints(ITEM,[ITEM+0x40]);self.ints(ITEM+0x40,[0x5cd800])
        self.ints(0x186e948+4,[TREE]);self.ints(TREE+0xc,[TABLE])
        if self.tables:self.floats(TABLE+4,[v for row in self.tables[int(attrs['recoil seed'])]for entry in row for v in [entry['angle'],entry['magnitude']]])
        self.ints(d.P,[PVT]);self.ints(PVT+0x790,[0x7bc7c0]);self.ints(d.P+0x9ec,[PVT]);self.ints(PVT+4,[NOOP])
        self.ints(0x178610c,[GLOBALS]);self.floats(GLOBALS+0x10,[time]);self.floats(GLOBALS+0x20,[dt]);self.ints(MOVE+0xe54,[d.P]);self.ints(MOVE+4,[d.P])
        for addr,value in self.cv.items():
            self.ints(addr+0x1c,[addr]);self.ints(addr+0x2c,[struct.unpack('<I',struct.pack('<f',value))[0]^addr]);self.ints(addr+0x30,[int(value)^addr])
        for name,offset in ATTR_OFFSETS.items():
            value=float(attrs.get(name,0));value=f(f(value)*f(.001))if name.startswith(('inaccuracy','spread'))else f(value)
            if name in ['recoil seed','spread seed','recovery transition start bullet','recovery transition end bullet']:self.ints(d.T+offset,[int(value)])
            else:self.floats(d.T+offset,[value])
        self.floats(d.T+0xdc,[float(attrs['cycletime'])])
        self.ints(d.P+0xe0,[(1 if context['grounded']else 0)|(2 if context.get('crouching')else 0)])
        self.u.mem_write(d.P+0xee,bytes([9 if context.get('ladder')else 2]));self.u.mem_write(d.P+0x16a9,bytes([int(context.get('walking',False))]))
        self.u.mem_write(d.P+0x160a,bytes([int(context.get('exoJump',False))]))
        self.floats(d.P+0x184,context.get('velocitySource',[0,0,0]));self.u.mem_write(d.W+0x9c1,bytes([int(context.get('reloading',False))]))
        self.floats(d.W+0xa84,[state['penalty'],state['lastUpdateTime']]);self.floats(d.W+0xa98,[state['recoilIndex']]);self.floats(d.W+0xaec,[state['lastShotTime']])
        self.floats(d.P+0xa70,state.get('angle',[0,0,0]));self.floats(d.P+0xa7c,state.get('velocity',[0,0,0]));self.floats(d.P+0xa64,state.get('viewPunch',[0,0,0]))
    def call(self,fn,args,float_result=False):
        self.ints(d.F,[RET_FLOAT if float_result else d.STOP,*args]);self.u.reg_write(UC_X86_REG_ESP,d.F)
        self.run(fn,[d.STOP]);return self.read(RESULT)if float_result else None
    def state(self):
        return dict(penalty=self.read(d.W+0xa84),lastUpdateTime=self.read(d.W+0xa88),recoilIndex=self.read(d.W+0xa98),lastShotTime=self.read(d.W+0xaec),
                    angle=list(struct.unpack('<3f',self.u.mem_read(d.P+0xa70,12))),velocity=list(struct.unpack('<3f',self.u.mem_read(d.P+0xa7c,12))),
                    viewPunch=list(struct.unpack('<3f',self.u.mem_read(d.P+0xa64,12))))
    def tick(self,attrs,state,context,time,dt):
        self.setup(attrs,state,context,time,dt);recovery=self.call(0xd41e70,[d.W],True)
        self.call(0x712520,[MOVE]);self.call(0xba6f20,[MOVE])
        self.call(0xd42060,[d.W]);inaccuracy=self.call(0xd3ff60,[d.W],True)
        return dict(state=self.state(),inaccuracy=inaccuracy,recoveryTime=recovery)
    def impulse(self,attrs,state,context,angle,magnitude):
        self.setup(attrs,state,context);bits=lambda x:struct.unpack('<I',struct.pack('<f',x))[0]
        self.call(0xc70850,[d.P,bits(angle),bits(magnitude)]);return self.state()
    def deploy(self,attrs,state,context,time):
        self.setup(attrs,state,context,time);self.u.reg_write(UC_X86_REG_EBP,d.F);self.u.reg_write(UC_X86_REG_EBX,d.W)
        # Original default-off recovery branch through index/turning resets.
        self.run(0xd44ec0,[0xd44e50]);return self.state()
    def fire(self,attrs,state,context,time):
        self.setup(attrs,state,context,time);self.u.reg_write(UC_X86_REG_EBP,d.F);self.u.reg_write(UC_X86_REG_EBX,d.W)
        self.u.reg_write(UC_X86_REG_ESI,d.P);self.u.reg_write(UC_X86_REG_EDI,d.T);self.ints(d.F+0x10,[0])
        self.run(0xd4b56f,[0xd4b614]) # original penalty -> ApplyRecoil/table -> shots/index
        self.u.reg_write(UC_X86_REG_EBX,d.W);self.run(0xd43a43,[0xd43a6f]) # original shot notification timestamp
        return self.state()

def profiles():
    catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text());out={}
    source=next(r for r in catalog['sourceFilesRead']if r['path']=='scripts/items/items_game.txt')
    assert hashlib.sha256((ROOT/'.reference-assets/csgo-legacy/csgo'/source['path']).read_bytes()).hexdigest()==source['sha256']
    for key,name in [('ak47','weapon_ak47_prefab'),('m4a4','weapon_m4a1_prefab')]:
        attrs={}
        def merge(name):
            row=catalog['prefabs'][name]
            for parent in row.get('prefab','').split():merge(parent)
            attrs.update(row.get('attributes',{}))
        merge(name);out[key]=attrs
    return out

def main():
    engine=NativeAccuracy();ps=profiles();rows=[];deploy=[];impulses=[];sequences=[]
    spec=importlib.util.spec_from_file_location('recoil',ROOT/'scripts/probe-source-recoil.py');recoil=importlib.util.module_from_spec(spec);spec.loader.exec_module(recoil)
    generator=recoil.NativeRecoil()
    for attrs in ps.values():engine.tables[int(attrs['recoil seed'])]=generator.table(attrs)
    neutral=dict(penalty=0,recoilIndex=0,lastShotTime=-1,lastUpdateTime=0,angle=[0,0,0],velocity=[0,0,0],viewPunch=[0,0,0])
    for weapon,attrs in ps.items():
        for grounded in [True,False]:
            for crouching in [False,True]:
                for walking in [False,True]:
                    for speed in [0,50,100,150,float(attrs['max player speed'])]:
                        for vz in ([0]if grounded else [-600,-301.993377,-20,0,20,301.993377,600]):
                            for index in [0,2.75,4,6]:
                                context=dict(grounded=grounded,crouching=crouching,walking=walking,velocitySource=[speed*.6,speed*.8,vz])
                                state=dict(neutral,penalty=.1,recoilIndex=index,angle=[-3.2,1.1,.2],velocity=[-15,3,-1],viewPunch=[-.2,.05,0])
                                rows.append(dict(weapon=weapon,context=context,before=state,time=1.1,dt=1/60,original=engine.tick(attrs,state,context,1.1,1/60)))
        context=dict(grounded=True)
        for dt in [0,1/128,1/64,1/60,.1]:
            for time in [.5,.500001,1]:
                state=dict(neutral,penalty=.07,recoilIndex=4,lastShotTime=.4,lastUpdateTime=.4)
                rows.append(dict(weapon=weapon,context=context,before=state,time=time,dt=dt,original=engine.tick(attrs,state,context,time,dt)))
        for amount in [1e-25,1e-20,1e-10,.0001,1]:
            state=dict(neutral,angle=[amount,-amount,amount],velocity=[0,0,0],viewPunch=[amount,amount,-amount])
            rows.append(dict(weapon=weapon,context=context,before=state,time=1,dt=1/64,original=engine.tick(attrs,state,context,1,1/64)))
        for elapsed in [0,.01,.1,.3,1]:
            for crouching in [False,True]:
                context=dict(grounded=True,crouching=crouching);state=dict(neutral,penalty=.07,recoilIndex=4,lastUpdateTime=1)
                deploy.append(dict(weapon=weapon,context=context,before=state,time=1+elapsed,original=engine.deploy(attrs,state,context,1+elapsed)))
        for angle in [-70,-5,0,35,179.9]:
            for magnitude in [0,22.5,30]:
                state=dict(neutral,angle=[-1,2,3],velocity=[-11,4,0],viewPunch=[-.2,.05,0])
                impulses.append(dict(weapon=weapon,before=state,angle=angle,magnitude=magnitude,original=engine.impulse(attrs,state,context,angle,magnitude)))
        punch={key:neutral[key]for key in ['angle','velocity','viewPunch']};states={key:{k:v for k,v in neutral.items()if k not in punch}for key in ps};active=weapon;frames=[]
        for tick in range(640):
            dt=1/64;time=f(tick*dt);speed=float(ps[active]['max player speed'])
            label='idle';context=dict(grounded=True,velocitySource=[0,0,0]);switch=None
            if 32<=tick<64:label='walking';context.update(walking=True,velocitySource=[100,0,0])
            elif 64<=tick<96:label='running';context.update(velocitySource=[speed*.6,speed*.8,0])
            elif 96<=tick<160:label='crouch';context.update(crouching=True)
            elif 160<=tick<192:label='crouch-move';context.update(crouching=True,velocitySource=[60,0,0])
            elif 192<=tick<240:label='jump';context.update(grounded=False,velocitySource=[100,50,301.993377-(tick-192)*800/64])
            elif 240<=tick<300:label='stop-recovery'
            elif 300<=tick<320:label='ladder';context.update(ladder=True,velocitySource=[0,0,80])
            elif 320<=tick<340:label='reload';context.update(reloading=True)
            if tick in [360,400,480]:
                active='m4a4'if active=='ak47'else'ak47';switch=active;label='switch'
                updated=engine.deploy(ps[active],dict(states[active],**punch),context,time)
                states[active]={k:updated[k]for k in neutral if k not in punch}
            before=dict(states[active],**punch)
            result=engine.tick(ps[active],before,context,time,dt);after=result['state'];shot=None
            if (90<=tick<270 and tick%7==0)or tick in [352,375,411,490]:
                shot=dict(inaccuracy=result['inaccuracy'],recoilIndex=after['recoilIndex'],angle=after['angle'])
                after=engine.fire(ps[active],after,context,time)
            states[active]={k:after[k]for k in neutral if k not in punch};punch={k:after[k]for k in punch}
            frames.append(dict(tick=tick,time=time,dt=dt,label=label,context=context,switch=switch,active=active,shot=shot,original=dict(weapons={k:dict(v)for k,v in states.items()},punch=dict(punch))))
        sequences.append(dict(initialWeapon=weapon,initial=neutral,frames=frames))
    report=dict(status='original_accuracy_punch_functions_executed',sourceServerSha256=d.SHA,profiles=ps,defaults=engine.defaults,
                functions=dict(update='0xd42060',inaccuracy='0xd3ff60',recovery='0xd41e70',viewPunchTick='0x712520',punchTick='0xba6f20',punchImpulse='0xc70850',deployBlock=['0xd44ec0','0xd44e50'],shotStateBlock=['0xd4b56f','0xd4b614'],shotTimestamp=['0xd43a43','0xd43a6f']),
                rows=rows,deploy=deploy,impulses=impulses,sequences=sequences,
                limits=['Mode0 ordinary AK/M4; ExoJump and nondefault ConVars excluded.', 'Object ownership/info and dirty/visual notification adapters; all numerical branches execute original.',
                        'External expf and sincosf use host double libm rounded to float; not a claim of every glibc ulp.', 'Does not execute the complete engine command/ammo/animation pipeline.'])
    (ROOT/'output/tests/source-accuracy-native.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(status=report['status'],ticks=len(rows),deploy=len(deploy),impulses=len(impulses),sequenceTicks=sum(len(s['frames'])for s in sequences))))
if __name__=='__main__':main()
