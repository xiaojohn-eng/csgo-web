"""Original AWP command -> idle -> viewmodel -> event54 continuous oracle.
Runs separate original weapon/VM instances and joins only their real call contract.
"""
from pathlib import Path
import importlib.util,json
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
w=load('awp_runtime_command','scripts/probe-source-awp-command.py');c=load('awp_runtime_clock','scripts/probe-source-awp-animation-clock.py');g=w.g;d=g.d
class NativeAWPIdle(w.NativeAWP):
 def __init__(self):
  super().__init__();self.profiles=json.loads((ROOT/'output/tests/source-awp-animation-clock-native.json').read_text())['profiles'];self.byName={p['name']:p['sequence']for p in self.profiles}
  assert self.attrs['time to idle']=='2'and self.attrs['idle interval']=='60'
 def setup(self,state,ctx):
  super().setup(state,ctx);self.ints(g.VT+0x4dc,[0xd47610]);self.ints(g.VT+0x48c,[0x5d62c0]);self.ints(g.VT+0x480,[g.NOOP]);self.ints(g.VT+0x4bc,[g.ZERO]);self.ints(g.VT+0x338,[g.NOOP]);self.floats(d.T+0xe4,[2,60]);self.floats(d.W+0x990,[state.get('idleTime',0)]);self.ints(d.W+0x410,[self.byName[self.currentSequence]]);self.idleStores=[];self.idleInvoked=False
 def hook(self,u,at,size,data):
  if at==0xd47610:self.idleInvoked=True
  if at in [0xd43530,0x5d62c0,0x5b5860,0x5b3e20,0x5b29a0,0x601010]:
   d.OriginalDamage.hook(self,u,at,size,data)
   if at in self.stops:return
   sp=u.reg_read(UC_X86_REG_ESP)
   if at==0xd43530:self.events.append(dict(kind='activity',activity=self.uint(sp+8)))
   elif at==0x5d62c0:self.idleStores.append(self.read(sp+8))
   elif at==0x5b5860:self.ret({183:2,185:0,192:1,194:3}.get(self.uint(sp+8),0xffffffff))
   elif at==0x5b3e20:self.ret(self.uint(sp+12))
   elif at==0x5b29a0:self.floatret(0 if self.operation=='holster'else self.profiles[self.uint(d.W+0x410)]['duration'])
   else:self.ret()
   return
  super().hook(u,at,size,data)
 def state(self):
  self.currentSequence=self.profiles[self.uint(d.W+0x410)]['name'];return super().state()
 def frame(self,state,ctx):
  r=super().frame(state,ctx);r.update(idleTime=self.read(d.W+0x990),idleInvoked=self.idleInvoked,idleStores=self.idleStores);return r

def main():
 e=NativeAWPIdle();vm=c.NativeAWPClock();rows=[];chains=[];idleCases=[];postEvents=[]
 for clip in [0,1,3,5]:
  for idleTime in [0,10,10.000000953674316,20]:
   for buttons in [0,1,2048,8192,8193]:
    for nextPrimary in [0,10,11]:
     s=dict(clip=clip,idleTime=idleTime,nextPrimary=nextPrimary);ctx=dict(now=10,dt=1/64,buttons=buttons,commandSeed=99)
     try:r=e.frame(s,ctx)
     except Exception:print(s,ctx,[hex(x)for x in e.trace[-40:]],flush=True);raise
     idleCases.append(dict(input=s,context=ctx,result=r))
 for clip in [0,1,5]:
  start=len(rows);state=dict(clip=clip);anim=vm.clock(dict(sequence=0,animTime=10,previousAnimTime=10,playbackRate=0),dict(now=10,advance=False,dispatch=False))['state'];action=None
  for tick in range(1000):
   now=d.f32(10+tick/64);buttons=2048 if tick in [0,25,460,480,820]else 1 if tick in [30,170,310,600,850]else 8192 if tick==450 else 0
   ctx=dict(now=now,dt=1/64,buttons=buttons,commandSeed=1000+tick,serverSeed=9000+tick)
   if tick==700:ctx['operation']='holster'
   if 701<=tick<730:ctx['active']=False
   if tick==730:ctx['operation']='deploy'
   inputState=state;inputAnim=anim;r=e.frame(state,ctx);state=dict(r['state'],idleTime=r['idleTime']);commandAnimation=anim
   for event in r['events']:
    if event['kind']=='activity':
     seq={183:2,185:0,192:1,194:3}.get(event['activity'])
     if seq is not None and vm.requestGuard(commandAnimation,seq):
      commandAnimation=vm.clock(commandAnimation,dict(now=now,reset=seq,advance=False,dispatch=False))['state']
      if event['activity']!=185:action=dict(activity=event['activity'],time=now,generation=(action['generation']if action else 0)+1)
   if tick<700 or tick>=730:
    clockResult=vm.clock(commandAnimation,dict(now=now));anim=clockResult['state']
    for event in clockResult['events']:
     if event['recordEvent']==54:
      applied=e.animationEvent(state,54,ctx);state=dict(applied['state'],idleTime=state['idleTime']);postEvents.append(dict(chain=clip,tick=tick,event=event))
   else:clockResult=None;anim=commandAnimation
   rows.append(dict(input=inputState,animation=inputAnim,context=ctx,command=r,commandAnimation=commandAnimation,clock=clockResult,state=state,animationAfter=anim,action=action))
  chains.append(dict(start=start,count=len(rows)-start))
 out=ROOT/'output/tests/source-awp-runtime-native.json';out.write_text(json.dumps(dict(serverSha256=g.discover.SHA,sourceMdlSha256=vm.mdlSha,idleCases=idleCases,cases=rows,sequences=chains,reloadEvents=postEvents),separators=(',',':'))+'\n')
 print(json.dumps(dict(idleCases=len(idleCases),cases=len(rows),reloadEvents=len(postEvents),path=str(out))))
if __name__=='__main__':main()
