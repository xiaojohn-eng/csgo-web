"""Original RNG plus normal one-projectile rifle spread arithmetic oracle.

Executes complete original vstdlib SetSeed/GenerateRandomNumber/RandomFloat.
Only mutex thread-ID is supplied; no RNG arithmetic is replaced. Server's
offset and normalized direction use original SSE blocks, with host sin/cos
rounded to float as the external sincosf ABI (not a claim about glibc ulps).
"""
from pathlib import Path
import hashlib,struct,json,math,importlib.util
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
VPATH=ROOT/'.reference-assets/csgo-legacy/bin/libvstdlib.so'
VSHA='bed32bd6bc26d6808b3e003fdf57066e0df884f2b264255450bdc75f64b314af'
P=0x100000;STACK=0x180000;STOP=0x200000;RET=STOP+16;RESULT=STOP+64
f=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]

class NativeRandom:
    def __init__(self):
        self.raw=VPATH.read_bytes();assert hashlib.sha256(self.raw).hexdigest()==VSHA
        self.u=u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0,0x100000);u.mem_map(P,0x100000);u.mem_map(STOP,4096)
        with VPATH.open('rb')as stream:
            elf=ELFFile(stream)
            for segment in elf.iter_segments():
                if segment['p_type']=='PT_LOAD':u.mem_write(segment['p_vaddr'],segment.data())
            symbols=elf.get_section_by_name('.dynsym');rel={}
            for section in elf.iter_sections():
                if section['sh_type']=='SHT_REL':
                    for r in section.iter_relocations():
                        if r['r_info_sym']:rel[r['r_offset']]=symbols.get_symbol(r['r_info_sym']).name
            assert rel[0x1cd20]==rel[0x1ce88]=='ThreadGetCurrentId'
            assert rel[0x1d06a]=='_ZN20CUniformRandomStream20GenerateRandomNumberEv'
        # Link the original local GenerateRandomNumber call, not its algorithm.
        u.mem_write(0x1d06a,struct.pack('<i',0x1ce70-0x1d06e))
        u.mem_write(RET,b'\xd9\x1d'+struct.pack('<I',RESULT)+b'\xc3')
        u.hook_add(UC_HOOK_CODE,self.hook)
    def hook(self,u,at,size,data):
        if at==STOP:u.emu_stop()
        elif at in (0x1cd1f,0x1ce87):
            # Isolated single-thread oracle; original lock/unlock still runs.
            u.reg_write(UC_X86_REG_EAX,1);u.reg_write(UC_X86_REG_EIP,at+5)
    def run(self,address,args,returns_float=False):
        u=self.u;u.reg_write(UC_X86_REG_ESP,STACK);u.reg_write(UC_X86_REG_EBP,0)
        ret=RET if returns_float else STOP
        u.mem_write(STACK,struct.pack('<%dI'%(len(args)+2),ret,*args,STOP))
        # RET's second ret must return STOP after original stack args.
        if returns_float:u.mem_write(RET,b'\xd9\x1d'+struct.pack('<I',RESULT)+b'\xe9'+struct.pack('<i',STOP-(RET+11)))
        u.emu_start(address,STOP+4096,count=10000)
        assert u.reg_read(UC_X86_REG_EIP)==STOP
        return struct.unpack('<f',u.mem_read(RESULT,4))[0]if returns_float else u.reg_read(UC_X86_REG_EAX)
    def seed(self,seed):
        self.u.mem_write(P,bytes(0x100));self.run(0x1cd10,[P,seed&0xffffffff])
    def random(self,lo=0,hi=1):
        bits=lambda v:struct.unpack('<I',struct.pack('<f',v))[0]
        return self.run(0x1d060,[P,bits(lo),bits(hi)],True)

def main():
    rng=NativeRandom();sequences=[]
    # Multiple draws exercise the complete warmup and shuffled 32-entry state.
    for seed in [*range(1,257),0,-1,0x7fffffff,-0x80000000]:
        rng.seed(seed);values=[rng.random(-2,7)for _ in range(40)]
        sequences.append(dict(seed=seed,values=values))
    spec=importlib.util.spec_from_file_location('damage',ROOT/'scripts/probe-source-damage.py')
    d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d);server=d.OriginalDamage();rows=[]
    assert server.external[0xcb53aa]=='RandomSeed'
    assert all(server.external[p]=='RandomFloat'for p in [0xcb5a3b,0xcb5a4f,0xcb5c5b,0xcb5c7f])
    for seed_byte in range(256):
        rng.seed(seed_byte+1);draws=[rng.random(),rng.random(0,f(2*math.pi)),rng.random(),rng.random(0,f(2*math.pi))]
        r1,a1,r2,a2=draws
        for inaccuracy,spread in [(0,0),(.005,.0006),(.04,.0006),(.08,.08),(1,1)]:
            server.reset();u=server.u;F=d.F
            # Execute original radial inaccuracy multiplication.
            server.floats(F-0x2a0,[r1]);server.floats(F-0x2e8,[inaccuracy]);server.ints(F-0x2ac,[0])
            server.run(0xcb5bac,[0xcb5bd2]);radius=server.read(F-0x2b8)
            server.floats(F-0x280,[f(math.cos(a2))]);server.floats(F-0x27c,[f(math.sin(a2))])
            server.floats(F-0x2c0,[r2]);server.floats(F+0x28,[spread])
            server.floats(F-0x2a8,[f(math.cos(a1))]);server.floats(F-0x2a0,[f(math.sin(a1))])
            server.ints(F-0x288,[d.P]);server.ints(F-0x290,[d.P+16]);u.reg_write(UC_X86_REG_EBX,0)
            server.run(0xcb5780,[0xcb57ed]);x=server.read(d.P);y=server.read(d.P+16)
            # Original basis order: forward + right*x + up*y. Test an actual
            # non-axis-aligned orthonormal basis independently supplied here.
            forward=[.36,.48,.8];right=[.8,-.6,0];up=[-.48,-.64,.6]
            server.floats(F-0x5f0,forward);server.floats(F-0x5e4,right);server.floats(F-0x5d8,up)
            server.xmm(UC_X86_REG_XMM0,y);server.xmm(UC_X86_REG_XMM3,x)
            server.run(0xc738b3,[0xc7398d]);direction=[server.read(F-off)for off in [0x5cc,0x5c8,0x5c4]]
            rows.append(dict(seedByte=seed_byte,inaccuracy=inaccuracy,spread=spread,draws=draws,radius=radius,x=x,y=y,
                             basis=dict(forward=forward,right=right,up=up),direction=direction))
    report=dict(status='original_rifle_spread_blocks_executed',sourceVstdlibSha256=VSHA,sourceServerSha256=d.SHA,
                functions={'setSeed':'0x1cd10','generate':'0x1ce70','randomFloat':'0x1d060','fxFireBullets':'0xcb4bc0'},
                sequences=sequences,rows=rows,
                limits=['Single-projectile ordinary rifle spread only; not shotgun pattern/R8/Negev special shaping.',
                        'Input seed-byte extraction, accuracy/recoil state updates are separate caller contracts.',
                        'Host sin/cos rounded to float supply external sincosf; no full glibc sincosf bitwise claim.'])
    (ROOT/'output/tests/source-spread-native.json').write_text(json.dumps(report,separators=(',',':'))+'\n')
    print(json.dumps({'status':report['status'],'sequences':len(sequences),'nativeRandomValues':len(sequences)*40,'spreadCases':len(rows)}))
if __name__=='__main__':main()
