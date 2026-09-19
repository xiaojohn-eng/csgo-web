"""USP idle/lifecycle uses the original common native harness and its own MDL."""
from pathlib import Path
import importlib.util,json
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('usp','%s/scripts/probe-source-usp-command.py'%ROOT)
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u);g=u.g;d=u.d
class NativeUSPIdle(u.NativeUSP):
 def __init__(self):
  super().__init__();j=json.loads((ROOT/'output/tests/source-usp-animation-clock-native.json').read_text());self.profiles=j['profiles'];self.named={p['name']:p['sequence']for p in self.profiles};self.activities={k:self.named[v[0]]for k,v in self.modelActivities.items()}
 def setup(self,state,ctx):
  super().setup(state,ctx);self.ints(g.VT+0x4dc,[0xd47610]);self.ints(g.VT+0x48c,[0x5d62c0]);self.ints(g.VT+0x480,[g.NOOP]);self.ints(g.VT+0x4bc,[g.ZERO]);self.ints(g.VT+0x338,[g.NOOP]);self.floats(d.T+0xe4,[float(self.attrs['time to idle']),float(self.attrs['idle interval'])]);self.floats(d.W+0x990,[state.get('idleTime',0)]);self.ints(d.W+0x410,[self.named.get(state.get('sequence','idle'),0)]);self.idleStores=[];self.idleInvoked=False
 def hook(self,u,at,size,data):
  if at==0xd47610:self.idleInvoked=True
  if at in [0xd43530,0x5d62c0,0x5b5860,0x5b3e20,0x5b29a0,0x601010]:
   d.OriginalDamage.hook(self,u,at,size,data)
   if at in self.stops:return
   sp=u.reg_read(UC_X86_REG_ESP)
   if at==0xd43530:self.events.append(dict(kind='activity',activity=self.uint(sp+8))) # execute real wrapper
   elif at==0x5d62c0:self.idleStores.append(self.read(sp+8)) # execute original store
   elif at==0x5b5860:self.ret(self.activities.get(self.uint(sp+8),0xffffffff))
   elif at==0x5b3e20:self.ret(self.uint(sp+12))
   elif at==0x5b29a0:self.floatret(self.profiles[self.uint(d.W+0x410)]['duration'])
   else:self.ret()
   return
  super().hook(u,at,size,data)
 def frame(self,state,ctx):
  r=super().frame(state,ctx);r['state']['sequence']=self.profiles[self.uint(d.W+0x410)]['name'];r.update(idleTime=self.read(d.W+0x990),idleInvoked=self.idleInvoked,idleStores=self.idleStores);return r

def main():
 e=NativeUSPIdle();rows=[]
 for attached in [False,True]:
  for idleTime in [0,10,11]:
   for clip in [0,3,12]:
    for buttons in [0,1,2048,8192]:
     state=dict(silencerAttached=attached,mode=int(attached),clip=clip,idleTime=idleTime)
     ctx=dict(now=10,dt=1/64,buttons=buttons,commandSeed=5)
     result=e.frame(state,ctx);rows.append(dict(input=state,context=ctx,result=result))
 lifecycle=[];plain=u.NativeUSP()
 for op in ['deploy','holster']:
  for attached in [False,True]:
   for activity,sequence in [(185,'idle'),(220,'attach'),(221,'detach')]:
    for owner in [False,True]:
     for reloading,complete in [(False,False),(True,False),(True,True)]:
      st=dict(clip=3,reserve=24,silencerAttached=attached,mode=int(attached),activity=activity,sequence=sequence,silencerSwitchTime=15,nextPrimary=15,nextSecondary=15,ownerNextAttack=15,reloading=reloading,reloadVisComplete=complete)
      ctx=dict(now=10,operation=op,owner=owner);result=plain.frame(st,ctx);lifecycle.append(dict(input=st,context=ctx,result=result))
 out=ROOT/'output/tests/source-usp-idle-lifecycle-native.json';out.write_text(json.dumps(dict(cases=rows,lifecycle=lifecycle,serverSha256=g.discover.SHA,profiles=e.profiles),separators=(',',':'))+'\n');print(out,len(rows),len(lifecycle),flush=True)
if __name__=='__main__':main()
