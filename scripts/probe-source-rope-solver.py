"""Execute the shipped x86-64 rope solver with fixed-endpoint adapters.
PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages python3 scripts/probe-source-rope-solver.py
Only gravity callback and endpoint attachments are adapters. The original
CSimplePhysics integration, damping, spring constraints and prediction execute.
"""
from pathlib import Path
import hashlib,json,math,struct
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64,UC_HOOK_CODE
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
f=lambda n:struct.unpack('<f',struct.pack('<f',n))[0]
def main():
 path=ROOT/'.reference-assets/csgo-legacy/csgo/bin/linux64/client_client.so';raw=path.read_bytes()
 report=json.loads((ROOT/'research/source-ropes.json').read_text());assert hashlib.sha256(raw).hexdigest()==report['sources']['client64Sha256']
 with path.open('rb')as file:segments=[dict(s.header)for s in ELFFile(file).iter_segments()if s['p_type']=='PT_LOAD']
 def at(va):
  s=next(s for s in segments if s['p_vaddr']<=va<s['p_vaddr']+s['p_filesz']);return s['p_offset']+va-s['p_vaddr']
 checks={0xaa918a:'41be03000000',0x85c771:'c741080080bbc4',0x9d2d27:None}
 for address,expected in checks.items():
  if expected:assert raw[at(address):at(address)+len(expected)//2].hex()==expected
 u=Uc(UC_ARCH_X86,UC_MODE_64)
 for address in [0xaa9000,0xab4000,0x192c000,0x1933000,0x193c000,0x1941000]:
  u.mem_map(address,4096);u.mem_write(address,raw[at(address):at(address)+4096])
 arena=0x30000000;u.mem_map(arena,0x20000);obj=arena+0x100;nodes=arena+0x1000;springs=arena+0x2000;lengths=arena+0x3000
 vtable=arena+0x4000;delegate=arena+0x4100;dvtable=arena+0x4200;gravity=arena+0x5000;lock=arena+0x5010;ret=arena+0x5020;stack=arena+0x1f000
 def write(va,fmt,*values):u.mem_write(va,struct.pack('<'+fmt,*values))
 write(vtable,'QQ',0xaa9140,0xaa9180);write(delegate,'Q',dvtable);write(dvtable,'QQ',gravity,lock)
 endpoints=[];force=[0,0,-1500];counts={'gravity':0,'lock':0}
 def hook(uc,pc,size,data):
  if pc==gravity:
   write(uc.reg_read(UC_X86_REG_RCX),'3f',*force);counts['gravity']+=1
  elif pc==lock:
   write(nodes,'3f',*endpoints[0]);write(nodes+9*36,'3f',*endpoints[1]);counts['lock']+=1
  elif pc==ret:uc.emu_stop();return
  else:return
  sp=uc.reg_read(UC_X86_REG_RSP);dest=struct.unpack('<Q',uc.mem_read(sp,8))[0];uc.reg_write(UC_X86_REG_RSP,sp+8);uc.reg_write(UC_X86_REG_RIP,dest)
 u.hook_add(UC_HOOK_CODE,hook)
 def call(pc,xmm=0):
  write(stack,'Q',ret);u.reg_write(UC_X86_REG_RSP,stack);u.reg_write(UC_X86_REG_RDI,obj);u.reg_write(UC_X86_REG_XMM0,int.from_bytes(struct.pack('<f',xmm),'little'))
  u.emu_start(pc,ret,count=3000000)
  assert u.reg_read(UC_X86_REG_RIP)==ret
 text=(ROOT/'game/source-ropes-data.ts').read_text();table=json.loads(text.split('export const SOURCE_ROPES_DATA = ',1)[1].split(' as const;',1)[0])
 ropes=table['ropes'];byname={r['targetname']:r for r in ropes if r['targetname']};spans=[r for r in ropes if r['nextKey']]
 chosen=[spans[0],min(spans,key=lambda r:r['slack']),max(spans,key=lambda r:r['slack']),spans[-1]];rows=[];windrows=[]
 # The actual GetNodeForces non-zero wind path multiplies raw wind by 10,
 # after the original gravity initialization. Execute those instructions;
 # input wind is an explicit getter boundary, not a foliage render uniform.
 wu=Uc(UC_ARCH_X86,UC_MODE_64)
 for address in [0x85c000,0x1933000]:wu.mem_map(address,4096);wu.mem_write(address,raw[at(address):at(address)+4096])
 wa=0x31000000;wu.mem_map(wa,0x10000);wp=wa+0x8000;wo=wa+0x1000
 wind=[4.,-2.,.5]
 wu.reg_write(UC_X86_REG_RBP,wp);wu.reg_write(UC_X86_REG_RBX,wo)
 wu.mem_write(wp-0x40,struct.pack('<3f',*wind));wu.mem_write(wo,struct.pack('<3f',0,0,-1500))
 wu.emu_start(0x85c988,0x85c9f1,count=100)
 nativeforce=list(struct.unpack('<3f',wu.mem_read(wo,12)));assert nativeforce==[40.,-20.,-1495.]
 for rope in chosen:
  force[:]=[0,0,-1500]
  a=list(map(f,rope['origin']));b=list(map(f,byname[rope['nextKey']]['origin']));endpoints[:]=[a,b]
  delta=[f(x-y)for x,y in zip(a,b)];length=int(f(math.sqrt(f(f(f(delta[0]*delta[0])+f(delta[1]*delta[1]))+f(delta[2]*delta[2])))))
  spring=f(max(0,f((length+rope['slack']-100)/9)))
  write(obj,'QQQi',vtable,delegate,nodes,10);write(obj+32,'QffQ',springs,spring,f(spring*spring),lengths)
  for i in range(9):write(springs+i*16,'QQ',nodes+i*36,nodes+(i+1)*36)
  for i in range(10):
   p=[f(a[k]+f(f(b[k]-a[k])*f(i/9)))for k in range(3)];write(nodes+i*36,'9f',*p,*p,0,0,0)
  call(0xaa94b0);call(0xaa9590,5)
  points=[struct.unpack('<3f',u.mem_read(nodes+i*36+24,12))for i in range(10)]
  rows.append(dict(hammerId=rope['hammerId'],start=a,end=b,slack=rope['slack'],sourceLength=length,springLength=spring,predicted=points))
  force[:]=nativeforce;frames=[]
  for dt in [.016,.018,.033,.016,.1,.016]:
   call(0xaa9590,f(dt))
   frames.append(dict(dt=f(dt),predicted=[struct.unpack('<3f',u.mem_read(nodes+i*36+24,12)) for i in range(10)]))
  windrows.append(dict(hammerId=rope['hammerId'],start=a,end=b,slack=rope['slack'],frames=frames))
 out=dict(format='source-native-rope-initial-hang-v1',clientSha256=report['sources']['client64Sha256'],native=dict(simulate='0xaa9590',constraints='0xaa9180',integration='0xab4840',gravityInstruction='0x85c771',constraintPasses=3,timestep=f(.02),damping=f(.98),adapters=['gravity 0,0,-1500; original instruction asserted','lock both original fixed endpoints after each constraint pass']),callbackCounts=counts,cases=rows)
 target=ROOT/'tests/fixtures/source-rope-native-hang.json';target.parent.mkdir(exist_ok=True);target.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
 windout=dict(format='source-native-rope-wind-v1',clientSha256=report['sources']['client64Sha256'],
  force=dict(start='0x85c988',end='0x85c9f1',rawWind=wind,acceleration=nativeforce,
    getter='0x8e60d0 reads current wind vector at 64-bit CEnvWindShared+0x4c; foliage uses a separate interpolated rendering parameter'),
  native=out['native'],scope='Original native wind force span and original solver for 24 continuation frames; fixed map endpoints, zero collision/impulse; no GPU or synchronized random-gust claim',cases=windrows)
 (ROOT/'tests/fixtures/source-rope-native-wind.json').write_text(json.dumps(windout,indent=2)+'\n')
if __name__=='__main__':main()
