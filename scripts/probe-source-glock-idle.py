"""Original Glock idle selection and timeWeaponIdle stores; frozen command untouched."""
from pathlib import Path
import importlib.util,json,struct
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
g=load('idle_command','scripts/probe-source-glock-command.py');d=g.d
class NativeIdle(g.NativeGlock):
 def __init__(self):
  super().__init__();j=json.loads((ROOT/'output/tests/source-glock-animation-clock-native.json').read_text());assert j['sourceMdlSha256']=='48ab6740def0ad8d7d4a42476583a61c8aa7d9f9f784b2d2f167720f14875242';self.profiles=j['profiles'];assert self.attrs['time to idle']=='2.000000'and self.attrs['idle interval']=='20'
 def setup(self,state,ctx):
  super().setup(state,ctx);self.ints(g.VT+0x4dc,[0xd47610]);self.ints(g.VT+0x48c,[0x5d62c0]);self.ints(g.VT+0x480,[g.NOOP]);self.ints(g.VT+0x4bc,[g.ZERO]);self.ints(g.VT+0x338,[g.NOOP]);self.floats(d.T+0xe4,[float(self.attrs['time to idle']),float(self.attrs['idle interval'])]);self.floats(d.W+0x990,[state.get('idleTime',0)]);self.ints(d.W+0x410,[state.get('sequence',0)]);self.idleStores=[];self.idleInvoked=False
 def hook(self,u,at,size,data):
  if at==0xd47610:self.idleInvoked=True
  if at in [0xd43530,0x5d62c0,0x5b5860,0x5b3e20,0x5b29a0,0x601010]:
   d.OriginalDamage.hook(self,u,at,size,data)
   if at in self.stops:return
   sp=u.reg_read(UC_X86_REG_ESP)
   if at==0xd43530:self.events.append(dict(kind='activity',activity=self.uint(sp+8))) # execute real wrapper
   elif at==0x5d62c0:self.idleStores.append(self.read(sp+8)) # execute original store
   elif at==0x5b5860:self.ret({183:3,185:0,192:1,194:4,195:2}.get(self.uint(sp+8),0xffffffff))
   elif at==0x5b3e20:self.ret(self.uint(sp+12))
   elif at==0x5b29a0:self.floatret(self.profiles[self.uint(d.W+0x410)]['duration'])
   else:self.ret()
   return
  super().hook(u,at,size,data)
 def frame(self,state,ctx):
  r=super().frame(state,ctx);r.update(idleTime=self.read(d.W+0x990),idleInvoked=self.idleInvoked,idleStores=self.idleStores);return r

def main():
 e=NativeIdle();rows=[]
 def case(label,state,ctx):
  ctx={**dict(now=10,dt=1/64,buttons=0,commandSeed=99),**ctx}
  try:r=e.frame(state,ctx)
  except Exception:print(label,state,ctx,[hex(x)for x in e.trace[-50:]],flush=True);raise
  rows.append(dict(label=label,input=state,context=ctx,result=r));return dict(**r['state'],idleTime=r['idleTime'])
 for clip in [0,1,3,20]:
  for idleTime in [0,9,10,10.000000953674316,20]:
   for buttons in [0,1,2048,8192,8193]:
    for nextPrimary in [0,10,11]:case('idle-gate',dict(clip=clip,idleTime=idleTime,nextPrimary=nextPrimary),dict(buttons=buttons))
 for reloading in [False,True]:
  for ownerNextAttack in [0,10,11]:
   for reserve in [0,120]:
    for buttons in [0,8192]:case('reload-busy',dict(clip=3,reserve=reserve,reloading=reloading,ownerNextAttack=ownerNextAttack),dict(buttons=buttons))
 for burstRemaining in [1,2]:
  for burstMode in [False,True]:
   for buttons in [0,1,8192]:case('queued-idle',dict(burstRemaining=burstRemaining,nextBurst=9,burstMode=burstMode,mode=int(burstMode)),dict(buttons=buttons))
 for op in ['deploy','holster']:
  case(op,dict(idleTime=20),dict(operation=op))
 state={}
 for i in range(320):state=case('continuous-fire-idle',state,dict(now=10+i/64,buttons=1 if i==0 else 0))
 path=ROOT/'output/tests/source-glock-idle-native.json';path.write_text(json.dumps(dict(serverSha256=g.discover.SHA,itemsSha256=e.itemsSha,profiles=e.profiles,caseCount=len(rows),cases=rows),separators=(',',':'))+'\n');print(path,len(rows))
if __name__=='__main__':main()
