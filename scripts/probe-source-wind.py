"""Bounded App740 CEnvWindShared oracle; never starts a game/server process.

Runs the installed i386 client's complete Init, ComputeWindVariation,
UpdateTreeSway, WindThink and AngleVectors (including original FSINCOS).
Two isolated original vstdlib streams supply their original ABI results.
Only render-context/resource notifications are stubbed. No wind arithmetic
or random event selection is replaced by Python.
"""
from pathlib import Path
import hashlib, struct, json, re, importlib.util
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import *

ROOT=Path(__file__).resolve().parents[1]
CLIENT=ROOT/'.reference-assets/csgo-legacy/csgo/bin/client_client.so'
SHA='21d2d652a3b2e07c44fa0a3b638886744af9d24ba0c91e64f97a0d8afc43d4cb'
P=0x10000000; STACK=P+0x80000; STOP=P+0xf0000; FLOATRET=STOP+16; RESULT=STOP+64
f=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
bits=lambda x:struct.unpack('<I',struct.pack('<f',x))[0]
spec=importlib.util.spec_from_file_location('spread_native',ROOT/'scripts/probe-source-spread.py')
spread=importlib.util.module_from_spec(spec);spec.loader.exec_module(spread)

class WindRandom(spread.NativeRandom):
    def __init__(self):
        super().__init__()
        # Link RandomInt to the installed GenerateRandomNumber implementation.
        assert self.raw[0x1d18c:0x1d191]==b'\xe8\xfc\xff\xff\xff'
        self.u.mem_write(0x1d18d,struct.pack('<i',0x1ce70-0x1d191))
    def integer(self,lo,hi):
        value=self.run(0x1d150,[spread.P,lo&0xffffffff,hi&0xffffffff])
        return value if value<0x80000000 else value-0x100000000
    def snapshot(self):
        a=struct.unpack('<34i',self.u.mem_read(spread.P+4,136))
        return dict(idum=a[0],iy=a[1],iv=list(a[2:]))

CONFIG=dict(minWind=2,maxWind=4,minGust=3,maxGust=6,minGustDelay=10,maxGustDelay=20,
            gustDuration=5,gustDirChange=20)

class NativeWind:
    def __init__(self):
        raw=CLIENT.read_bytes();assert hashlib.sha256(raw).hexdigest()==SHA
        self.u=u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0,0x6000000);u.mem_map(P,0x100000)
        self.external={}
        with CLIENT.open('rb') as stream:
            elf=ELFFile(stream)
            for segment in elf.iter_segments():
                if segment['p_type']=='PT_LOAD':u.mem_write(segment['p_vaddr'],segment.data())
            symbols=elf.get_section_by_name('.dynsym')
            for section in elf.iter_sections():
                if section['sh_type']=='SHT_REL':
                    for r in section.iter_relocations():
                        if r['r_info_sym']:self.external[r['r_offset']]=symbols.get_symbol(r['r_info_sym']).name
        expected={0x684c26:'7SetSeedEi',0x684c3b:'7SetSeedEi',0x684d13:'11RandomFloatEff',
                  0x684d31:'11RandomFloatEff',0x68512f:'9RandomIntEii',0x685170:'11RandomFloatEff',
                  0x685289:'9RandomIntEii',0x6852ad:'9RandomIntEii'}
        for at,suffix in expected.items():
            assert self.external[at+1]=='_ZN20CUniformRandomStream'+suffix
        assert self.external[0x9c68af]=='memset' # C_BaseEntity operator new zeroes complete object.
        self.calls=expected;self.streams={P+0x98:WindRandom(),P+0x12c:WindRandom()}
        self.render=[0,0,0];self.events=[]
        # Valid non-null resource objects; virtual calls are intercepted below.
        self.uint(P+0x1000,P+0x1100);self.uint(P+0x1200,P+0x1100)
        self.uint(0x5967380,P+0x1000)
        u.mem_write(FLOATRET,b'\xd9\x05'+struct.pack('<I',RESULT)+b'\xc3')
        u.hook_add(UC_HOOK_CODE,self.hook)
    def uint(self,at,value):self.u.mem_write(at,struct.pack('<I',value&0xffffffff))
    def readuint(self,at):return struct.unpack('<I',self.u.mem_read(at,4))[0]
    def readfloat(self,at):return struct.unpack('<f',self.u.mem_read(at,4))[0]
    def readint(self,at):return struct.unpack('<i',self.u.mem_read(at,4))[0]
    def floats(self,at,values):self.u.mem_write(at,struct.pack('<%df'%len(values),*values))
    def vec(self,at):return list(struct.unpack('<3f',self.u.mem_read(at,12)))
    def hook(self,u,at,size,data):
        if at==STOP:u.emu_stop();return
        sp=u.reg_read(UC_X86_REG_ESP)
        if at in self.calls:
            stream=self.streams[self.readuint(sp)];kind=self.calls[at]
            if 'SetSeed' in kind:stream.seed(self.readint(sp+4));u.reg_write(UC_X86_REG_EIP,at+5)
            elif 'RandomInt' in kind:
                value=stream.integer(self.readint(sp+4),self.readint(sp+8))
                u.reg_write(UC_X86_REG_EAX,value&0xffffffff);u.reg_write(UC_X86_REG_EIP,at+5)
            else:
                value=stream.random(self.readfloat(sp+4),self.readfloat(sp+8))
                self.floats(RESULT,[value]);self.uint(sp-4,at+5)
                u.reg_write(UC_X86_REG_ESP,sp-4);u.reg_write(UC_X86_REG_EIP,FLOATRET)
        elif at==0x684f45:
            u.reg_write(UC_X86_REG_EAX,P+0x1200);u.reg_write(UC_X86_REG_EIP,at+6)
        elif at in [0x684bfc,0x684c13,0x684c51,0x684c90,0x684caa,0x684f5b,0x685002,0x685011]:
            # Network dirty notification, Begin/EndRender, Release.
            u.reg_write(UC_X86_REG_EIP,at+3)
        elif at==0x684ff0:
            assert self.readuint(sp+4)==3
            self.render=self.vec(self.readuint(sp+8));u.reg_write(UC_X86_REG_EIP,at+6)
        elif at in [0x685193,0x6852f8]:
            self.events.append(dict(time=self.readfloat(P+0x7c),gusting=bool(self.readuint(P+0x88)&255),
                                    averageSpeed=self.readfloat(P+0x84),direction=self.readint(P+0x40),
                                    switchTime=self.readfloat(P+0x80)))
    def run(self,at,args,retfloat=False):
        u=self.u;u.reg_write(UC_X86_REG_ESP,STACK);u.reg_write(UC_X86_REG_EBP,0)
        ret=STOP+128 if retfloat else STOP
        if retfloat:u.mem_write(ret,b'\xd9\x1d'+struct.pack('<I',RESULT)+b'\xe9'+struct.pack('<i',STOP-(ret+11)))
        u.mem_write(STACK,struct.pack('<%dI'%(len(args)+1),ret,*[a&0xffffffff for a in args]))
        u.emu_start(at,STOP+4096,count=2000000)
        assert u.reg_read(UC_X86_REG_EIP)==STOP,hex(u.reg_read(UC_X86_REG_EIP))
        return self.readfloat(RESULT) if retfloat else None
    def init(self,seed=0,startTime=0,initialDirection=0,initialSpeed=0,config=None):
        self.u.mem_write(P,bytes(0x300));self.uint(P,P+0x1100)
        self.events=[];self.render=[0,0,0]
        c=CONFIG if config is None else config
        for key,offset in dict(minWind=0xc,maxWind=0x10,minGust=0x18,maxGust=0x1c,gustDirChange=0x2c).items():self.uint(P+offset,c[key])
        for key,offset in dict(minGustDelay=0x20,maxGustDelay=0x24,gustDuration=0x28).items():self.floats(P+offset,[c[key]])
        self.run(0x684bb0,[P,1,seed,bits(startTime),initialDirection,bits(initialSpeed)])
    def snapshot(self):
        state={k:self.readfloat(P+o)for k,o in dict(startTime=4,windSpeed=0x44,initialSpeed=0x70,
            variationTime=0x74,swayTime=0x78,simTime=0x7c,switchTime=0x80,averageSpeed=0x84,
            angleVariation=0x8c,speedVariation=0x90).items()}
        state.update(seed=self.readint(P+8),direction=self.readint(P+0x40),initialDirection=self.readint(P+0x6c),
                     gusting=bool(self.readuint(P+0x88)&255),currentWind=self.vec(P+0x48),currentSway=self.vec(P+0x54),
                     previousSway=self.vec(P+0x60),renderParameter3=self.render,
                     averageRandom=self.streams[P+0x98].snapshot(),variationRandom=self.streams[P+0x12c].snapshot())
        return state
    def step(self,time):
        self.events=[];nextThink=self.run(0x685070,[P,bits(time)],True)
        return dict(time=f(time),nextThink=nextThink,state=self.snapshot(),events=self.events)

def caller_evidence(native):
    """Original argument forwarding/clock getter instructions, no host times.

    Supplies fake object/global addresses, stops at each external interface
    boundary, and copies its *read-back* arguments to the next original block.
    This verifies value flow without pretending the whole engine was loaded.
    """
    paths={
      'server':('csgo/bin/server.so','7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386'),
      'engine':('bin/engine_client.so','4ab884d3acfc94f2687f5504724d10d3270a46e29cab4c6aad3ec6feae71c312'),
      'material':('bin/materialsystem_client.so','223ebff789b330fe7a1ab102ab08d297140b5e982e17925b6368d7e727712176'),
      'shaderapi':('bin/shaderapidx9_client.so','4b476b4924b56b9861f9cffee9101270f15826de4821982acf38478147817b65')}
    images={};raws={}
    for name,(relative,digest) in paths.items():
        p=ROOT/'.reference-assets/csgo-legacy'/relative;raw=p.read_bytes();assert hashlib.sha256(raw).hexdigest()==digest
        u=Uc(UC_ARCH_X86,UC_MODE_32)
        with p.open('rb')as stream:
            segments=[s for s in ELFFile(stream).iter_segments()if s['p_type']=='PT_LOAD']
            size=max(s['p_vaddr']+s['p_memsz']for s in segments);u.mem_map(0,(size+4095)&~4095)
            for s in segments:u.mem_write(s['p_vaddr'],s.data())
        u.mem_map(P,0x100000);images[name]=u;raws[name]=raw
    def integer(u,at,n):u.mem_write(at,struct.pack('<I',n&0xffffffff))
    def floating(u,at,n):integer(u,at,bits(n))
    def word(u,at):return struct.unpack('<I',u.mem_read(at,4))[0]
    def execute(u,start,end):
        u.emu_start(start,end,count=2000);assert u.reg_read(UC_X86_REG_EIP)==end
    server=images['server'];spawn=[]
    for time in [0,.1,17.125,10000.25]:
        for yaw in [0,90,-73.9,359.99]:
            for entIndex in [0,23]:
                server.reg_write(UC_X86_REG_ESP,STACK);server.reg_write(UC_X86_REG_EBX,P)
                integer(server,0x178610c,P+0x2000);floating(server,P+0x2010,time)
                integer(server,P+0x2060,P+0x3000);integer(server,P+0x24,P+0x3000+entIndex*16 if entIndex else 0)
                floating(server,P+0x300,yaw)
                execute(server,0x67b0a3,0x67b0db);sp=server.reg_read(UC_X86_REG_ESP)
                args=struct.unpack('<6I',server.mem_read(sp,24));assert args[0]==P+0x3a8
                decoded=dict(entityIndex=args[1],seed=args[2],startTime=struct.unpack('<f',struct.pack('<I',args[3]))[0],
                             initialDirection=struct.unpack('<i',struct.pack('<I',args[4]))[0],initialSpeed=struct.unpack('<f',struct.pack('<I',args[5]))[0])
                assert decoded==dict(entityIndex=entIndex,seed=0,startTime=f(time),initialDirection=int(f(yaw)),initialSpeed=0)
                spawn.append(dict(time=time,yaw=yaw,originalArguments=decoded))
    engine,material,shader=images['engine'],images['material'],images['shaderapi'];cl=native.u
    # Same CGlobalVars pointer passed by engine into CHLClient's vtable[0].
    cb=CLIENT.read_bytes();assert struct.unpack_from('<I',cb,0x100e8c8)[0]==0x760360
    assert raws['engine'][0x3bbba7:0x3bbbab]==bytes.fromhex('c7442408')
    assert struct.unpack_from('<I',raws['engine'],0x3bbbab)[0]==0xead6c0
    # CMatRenderContext::SetCurrentTime -> IShaderAPI secondary vtable[0x404]
    # -> shader object float member 0x37a4 -> dynamic CurrentTime vtable[8].
    assert struct.unpack_from('<I',raws['material'],0x115164)[0]==0x7c930
    assert struct.unpack_from('<I',raws['shaderapi'],0xcb358)[0]==0x578a0
    assert struct.unpack_from('<I',raws['shaderapi'],0xcaf74)[0]==0x3ad20
    rows=[]
    for time in [0,.01,.1,.125,1.234567,17.125,999.999,10000.25,999999.75]:
        # Client receives engine's global pointer, then WindThink caller reads +0x10.
        cl.reg_write(UC_X86_REG_ESP,STACK);cl.reg_write(UC_X86_REG_EBP,P+0x8000)
        integer(cl,P+0x8010,0xead6c0);floating(cl,0xead6d0,time)
        execute(cl,0x7603b5,0x7603c8);assert word(cl,0x1492c10)==0xead6c0
        integer(cl,P+0x8008,P);execute(cl,0x9feca7,0x9fecbf);clientBits=word(cl,STACK+4)
        # Engine submits the same global +0x10 to SetCurrentTime.
        engine.reg_write(UC_X86_REG_ESP,STACK);engine.reg_write(UC_X86_REG_EAX,P)
        integer(engine,P,P+0x1000);floating(engine,0xead6d0,time)
        execute(engine,0x5fe030,0x5fe03f);engineBits=word(engine,STACK+4)
        material.reg_write(UC_X86_REG_ESP,STACK);integer(material,STACK,STOP)
        integer(material,STACK+4,P);integer(material,STACK+8,engineBits)
        integer(material,0x176424,P+0x24c);integer(material,P+0x24c,P+0x4000)
        integer(material,P+0x4404,0x578a0)
        execute(material,0x7c930,0x7c944);assert material.reg_read(UC_X86_REG_EAX)==0x578a0
        shader.mem_write(STACK,bytes(material.mem_read(STACK,12)));shader.reg_write(UC_X86_REG_ESP,STACK)
        execute(shader,0x578a0,STOP);assert word(shader,P+0x37a4)==engineBits
        shader.mem_write(STOP+128,b'\xdd\x1d'+struct.pack('<I',RESULT)+b'\xe9'+struct.pack('<i',STOP-(STOP+139)))
        shader.reg_write(UC_X86_REG_ESP,STACK);integer(shader,STACK,STOP+128);integer(shader,STACK+4,P+0x24c)
        execute(shader,0x3ad20,STOP);shaderTime=struct.unpack('<d',shader.mem_read(RESULT,8))[0]
        assert clientBits==engineBits==bits(time) and shaderTime==f(time)
        rows.append(dict(inputTime=time,clientWindTime=f(time),shaderCurrentTime=shaderTime))
    return dict(binarySha256={k:v[1]for k,v in paths.items()},spawnArguments=spawn,clockForwarding=rows)

def main():
    native=NativeWind();callers=caller_evidence(native);cases=[]
    # Fine, uneven, late-created and sparse calls exercise cache timing separately.
    for name,init,times in [
        ('dust2-60hz',{},[i/60 for i in range(10801)]),
        ('seed-negative-uneven',dict(seed=-98765,startTime=17.125,initialDirection=-73,initialSpeed=17),
         [17.125+i*.137 for i in range(1601)]),
        ('late-zero-cache',dict(seed=2147483647,startTime=10000.25,initialDirection=359,initialSpeed=5),
         [10000.25,10000.5,10001,10002,10004,10006,10012,10050,10200]),
        ('sparse-catchup',dict(seed=-2147483648),[0,0,.1,2,2,4,19,61,179,300]),
    ]:
        native.init(**init);initial=native.snapshot();rows=[]
        for i,t in enumerate(times):
            row=native.step(t)
            # Store every step's scalar/cache values, full RNG every 120th / event.
            if i%120 and not row['events'] and i!=len(times)-1:
                del row['state']['averageRandom'];del row['state']['variationRandom']
            rows.append(row)
        cases.append(dict(name=name,init=init,config=CONFIG,initial=initial,rows=rows))
    # Native exact switch, variation and two-second cache boundary probes.
    native.init();native.step(0);native.step(.01);switch=native.readfloat(P+0x80)
    boundaryTimes=[switch,struct.unpack('<f',struct.pack('<I',bits(switch)+1))[0]]
    native.init();rows=[native.step(t)for t in [0,.01,*boundaryTimes,boundaryTimes[-1]+5,boundaryTimes[-1]+5.00001]]
    cases.append(dict(name='switch-strict-greater',init={},config=CONFIG,initial=None,rows=rows))
    entityRaw=(ROOT/'output/source1/de_dust2/lumps/00-entities.bin').read_bytes()
    entities=[b.decode()for b in re.findall(rb'\{[^{}]*\}',entityRaw)if b'"env_wind"'in b];assert len(entities)==1
    report=dict(schema=1,status='original_client_wind_and_vstdlib_executed',clientSha256=SHA,
        vstdlibSha256=spread.VSHA,entity=entities[0],callers=callers,cases=cases,
        entrypoints=dict(init='0x684bb0',variation='0x684ce0',treeSway='0x684eb0',think='0x685070',
                         angleVectors='0xc98ed0',renderParameter3Call='0x684ff0',serverSpawnInitCall='0x67b0db'),
        limits=['Unicorn interprets original x87 FSINCOS; this is not a claim about physical x87 last-bit agreement.',
                'Resource and network dirty callbacks are stubs. No engine process or time/network transport is run.',
                'Call schedule is an explicit input; 2-second cache samples the preceding WindThink current vector.'])
    out=ROOT/'output/tests/source-wind-native.json';out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(report,separators=(',',':'))+'\n')
    print(json.dumps(dict(status=report['status'],cases=len(cases),steps=sum(len(c['rows'])for c in cases),
                         events=sum(len(r['events'])for c in cases for r in c['rows']),path=str(out))))
if __name__=='__main__':main()
