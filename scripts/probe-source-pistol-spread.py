"""Actual normal pistol spread branches and completed USP silencer events.
Item/schema identity and external libm are adapters. No RNG/branch arithmetic
is replaced. Original R8/Negev tests execute with actual nonmatching identities.
"""
from pathlib import Path
import importlib.util,json,struct,math
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('pistol','%s/scripts/probe-source-pistol-handling.py'%ROOT);p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
d=p.d;a=p.a;f=p.f;SCHEMA=d.T+0xa000
class PistolSpread(p.PistolAccuracy):
 def __init__(self):
  super().__init__();self.rng=p.r.s.NativeRandom();self.draws=[]
  # Original cached item comparisons are specifically Revolver and Negev.
  assert self.raw[0xcb6017:0xcb6021]==bytes.fromhex('c7055c1c870174422a01')
  assert self.raw[0xcb6145:0xcb614f]==bytes.fromhex('c705501c870157432a01')
  assert self.raw[0x12a4274:0x12a4274+16]==b'weapon_revolver\0'
  assert self.raw[0x12a4357:0x12a4357+13]==b'weapon_negev\0'
  # Original m_bSilencerOn network registration explicitly owns byte aa5.
  assert self.raw[0xd3fb95:0xd3fba1]==bytes.fromhex('6a0168a50a000068b5592e01')
 def hook(self,u,at,size,data):
  super().hook(u,at,size,data)
  if at in self.stops:return
  sp=u.reg_read(UC_X86_REG_ESP)
  if at==0xa355f0:self.ret(SCHEMA)
  elif at==0xcb53a9:
   self.rng.seed(struct.unpack('<i',u.mem_read(sp,4))[0]);u.reg_write(UC_X86_REG_EIP,at+5)
  elif at in [0xcb5a3a,0xcb5a4e,0xcb5c5a,0xcb5c7e]:
   lo,hi=struct.unpack('<2f',u.mem_read(sp,8));value=self.rng.random(lo,hi);self.draws.append(value)
   self.floats(a.RESULT+4,[value]);self.ints(sp-4,[at+5]);u.reg_write(UC_X86_REG_ESP,sp-4);u.reg_write(UC_X86_REG_EIP,a.FLOAT_ADAPTER)
  elif at in [0xcb5be9,0xcb577b]:
   angle=self.read(sp);self.floats(self.uint(sp+4),[f(math.sin(angle))]);self.floats(self.uint(sp+8),[f(math.cos(angle))]);u.reg_write(UC_X86_REG_EIP,at+5)
 def spread(self,attrs,mode,seed_byte,inaccuracy,spread):
  neutral=dict(penalty=0,recoilIndex=0,lastShotTime=0,lastUpdateTime=0)
  self.setup(attrs,neutral,dict(mode=mode,grounded=True));self.draws=[]
  self.ints(SCHEMA+0x2c,[1]);self.ints(0x1871c60,[a.ITEM+0x100]);self.ints(0x1871c64,[1]);self.ints(0x1871c54,[a.ITEM+0x200]);self.ints(0x1871c58,[1])
  self.u.reg_write(UC_X86_REG_ESI,a.ECON);self.u.reg_write(UC_X86_REG_EBX,0)
  self.ints(d.F+0x20,[seed_byte]);self.ints(d.F+0x1c,[mode]);self.floats(d.F+0x28,[spread]);self.floats(d.F-0x2e8,[inaccuracy])
  self.ints(d.F-0x288,[d.P]);self.ints(d.F-0x290,[d.P+16]);self.ints(d.F-0x2b0,[0]);self.ints(d.F-0x2ac,[0])
  # Check special-item identities even when both special feature flags are on.
  self.u.mem_write(d.F-0x2da,b'\1\1')
  self.run(0xcb539f,[0xcb53ae]);self.run(0xcb5a30,[0xcb57ed])
  assert len(self.draws)==4
  return dict(x=self.read(d.P),y=self.read(d.P+16),draws=self.draws)
 def completed_silencer_event(self,attrs,enabled,before_mode,before_on):
  self.setup(attrs,dict(penalty=.07,recoilIndex=4,lastShotTime=1,lastUpdateTime=2),dict(mode=before_mode,grounded=True))
  self.u.mem_write(d.W+0xaa5,bytes([before_on]));self.u.reg_write(UC_X86_REG_EDI,d.W)
  self.run(0xd45ec1 if enabled else 0xd45861,[0xd45ef4 if enabled else 0xd4587c])
  return dict(mode=self.uint(d.W+0xa6c),silencerOn=bool(self.u.mem_read(d.W+0xaa5,1)[0]),state=self.state())
def main():
 ps,sha=p.profiles();engine=PistolSpread();rows=[];modes=[];command_seeds=[]
 for weapon in ['glock18','usp-s']:
  attrs=ps[weapon]
  for mode in [0,1]:
   spread=f(f(float(attrs['spread alt'if mode else'spread']))*f(.001))
   for seed_byte in range(256):
    for inaccuracy in [0,.005,.07,1]:
     rows.append(dict(weapon=weapon,mode=mode,seedByte=seed_byte,inaccuracy=inaccuracy,spread=spread,original=engine.spread(attrs,mode,seed_byte,inaccuracy,spread)))
 for enabled in [False,True]:
  for mode in [0,1]:
   for on in [False,True]:modes.append(dict(enabled=enabled,beforeMode=mode,beforeOn=on,original=engine.completed_silencer_event(ps['usp-s'],enabled,mode,on)))
 # Original command scope installs both globals; primary and queue consume the
 # same server low byte without modifying it. No per-bullet seed manufacture.
 for command_seed,server_seed in [(0,0),(42,256),(5426,0x12345678),(4484,255),(0x7fffffff,0x7fffffff),(-1,-1),(-0x80000000,-0x80000000),(123456,987654)]:
  engine.reset();engine.ints(d.P+0x40,[command_seed,server_seed]);engine.call(0x600360,[d.P]);bytes_read=[]
  for at,stop in [(0xd49c0e,0xd49c15),(0xd4b494,0xd4b49b),(0xd49c0e,0xd49c15)]:
   engine.run(at,[stop]);bytes_read.append(engine.u.reg_read(UC_X86_REG_EAX))
  current=dict(commandGlobal=engine.uint(0x16d2424),serverGlobal=engine.uint(0x16d2420),bulletBytes=bytes_read)
  engine.call(0x600360,[0]);current['afterScope']=[engine.uint(0x16d2424),engine.uint(0x16d2420)]
  command_seeds.append(dict(commandSeed=command_seed,serverSeed=server_seed,original=current))
 report=dict(status='original_pistol_spread_and_usp_completed_mode_events_executed',sourceServerSha256=d.SHA,sourceItemsSha256=sha,sourceVstdlibSha256=p.r.s.VSHA,
  functions=dict(seed=['0xcb539f','0xcb53ae'],commandSeedScope='0x600360',primarySeed='0xd4b494',queueSeed='0xd49c0e',spread=['0xcb5a30','0xcb57ed'],silencerOn=['0xd45ec1','0xd45ef4'],silencerOff=['0xd45861','0xd4587c']),rows=rows,modes=modes,commandSeeds=command_seeds,
  limits=['Completed silencer event flags only; timing/animation/secondary acceptance are separate.','Actual item identity mapped to distinct objects from R8 and Negev; original tests run.','External sincosf uses host sin/cos rounded f32; original RNG and offset SSE execute.'])
 (ROOT/'output/tests/source-pistol-spread-native.json').write_text(json.dumps(report,separators=(',',':'))+'\n');print(json.dumps(dict(status=report['status'],spreadCases=len(rows),modeCases=len(modes),commandSeeds=len(command_seeds))))
if __name__=='__main__':main()
