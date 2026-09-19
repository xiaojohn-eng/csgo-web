"""Original App740 Deagle command oracle; no game process or synthetic timings.

The inherited harness adapts ownership, economy resources, model lookup and
transport. Deagle's original vtable selects the exact shared base-gun bytes.
"""
from pathlib import Path
import importlib.util,json,struct,hashlib
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
g=load('deagle_command_base','scripts/probe-source-glock-command.py');d=g.d
VTABLE=0x12f75dc
def attributes():
 catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text());attrs={}
 def merge(key):
  p=catalog['prefabs'][key]
  for parent in p.get('prefab','').split():merge(parent)
  values=p.get('attributes',{})
  for block in values if isinstance(values,list)else[values]:attrs.update(block)
 merge('weapon_deagle_prefab')
 for key,value in list(attrs.items()):
  if isinstance(value,list):
   assert len(set(value))==1,(key,value) # The original repeated cycletime entries are identical.
   attrs[key]=value[0]
 return attrs
class NativeDeagle(g.NativeGlock):
 def __init__(self):
  super().__init__();self.attrs=attributes()
  assert self.attrs['is full auto']=='0' and self.attrs['has burst mode']=='0' and self.attrs['has silencer']=='0'
  assert g.discover.word(VTABLE-4)==0x12f75a0
  assert [g.discover.word(VTABLE+i)for i in [0x4ac,0x4b0,0x4d0,0x4f8,0x4fc,0x500,0x738]]==[0xd4d5c0,0xd4cc60,0xd4ac70,0xd4ca70,0xd4b7e0,0xd4bd20,0xd3ff60]
  path=ROOT/'.reference-assets/source-exports/deagle-candidates/deagle-ct/audit.json'
  if not path.exists():path=ROOT/'.worktrees/weapon/.reference-assets/source-exports/deagle-candidates/deagle-ct/audit.json'
  audit=json.loads(path.read_text());self.modelActivities={};self.modelSequences=audit['sequences']
  self.sequenceDurations={v['sequence']:d.f32(v['duration_seconds'])for v in audit['clip_checks'].values()}
  for row in audit['sequences']:
   if not row['activity_name']:continue
   ptr=g.discover.va(self.raw.index(row['activity_name'].encode()+b'\0'));ref=next(p for p in g.discover.refs(ptr)if 0x4af090<=p<0x4b3170)
   assert self.raw[g.discover.offset(ref)-6]==0x68
   activity=struct.unpack_from('<I',self.raw,g.discover.offset(ref)-5)[0];self.modelActivities.setdefault(activity,[]).append(row['name'])
 def setup(self,state,context):
  super().setup(state,context);self.reserve=state.get('reserve',35);self.currentSequence=state.get('sequence','idle1')
  self.u.mem_write(g.VT,self.raw[VTABLE:VTABLE+0x750])
  for off,fn in [(0x704,g.GETINFO),(0x59c,g.MAXCLIP),(0x5a0,g.ZERO),(0x5d8,g.ONE),(0x5dc,g.ZERO),(0x48c,g.NOOP),(0x4dc,g.NOOP),(0x5bc,g.ONE if context.get('noAutoReload',False)else g.ZERO),(0x4b8,g.NOOP),(0x510,g.ZERO),(0x590,g.ZERO),(0x594,g.ZERO)]:self.ints(g.VT+off,[fn])
  self.u.mem_write(d.T+0x23c,b'\0\0\0');self.ints(d.W+0x974,[state.get('clip',7)])
  self.ints(d.W+0x9b0,[state.get('activity',185)]);self.ints(d.W+0x9ac,[194])
 def hook(self,u,at,size,data):
  if at in [g.MAXCLIP,0xc9e040,0xc204a0,0xd4c80f,0xd43530,0x5b29a0]:
   d.OriginalDamage.hook(self,u,at,size,data)
   if at in self.stops:return
   if at==0xc204a0:self.events.append(dict(kind='player-animation-event',id=self.uint(u.reg_read(UC_X86_REG_ESP)+8)));self.ret()
   elif at==0xd4c80f:u.reg_write(UC_X86_REG_ESP,u.reg_read(UC_X86_REG_ESP)+16);u.reg_write(UC_X86_REG_EIP,0xd4c86b)
   elif at==0xd43530:
    activity=self.uint(u.reg_read(UC_X86_REG_ESP)+8);choices=self.modelActivities.get(activity,[])
    if choices:self.currentSequence=choices[0];self.ints(d.W+0x9b0,[activity])
    self.events.append(dict(kind='activity',activity=activity,selected=bool(choices),sequence=choices[0]if choices else None));self.ret(int(bool(choices)))
   elif at==0x5b29a0:self.floatret(self.sequenceDurations[self.currentSequence]if self.operation!='holster'else 0)
   else:self.ret(7 if at==g.MAXCLIP else 1)
   return
  super().hook(u,at,size,data)
 def state(self):
  s=super().state()
  for key in ['burstMode','burstRemaining','nextBurst']:del s[key]
  return dict(s,activity=self.uint(d.W+0x9b0),sequence=self.currentSequence)
 def animationEvent(self,state,event,context):
  if not hasattr(self,'_eventAdapter'):self._eventAdapter=load('deagle_event_adapter','scripts/probe-source-pistol-animation-events.py').NativeEvent.event
  return self._eventAdapter(self,state,event,context)
def main():
 e=NativeDeagle();rows=[];events=[];sequences=[];visited=set()
 near=lambda x,k:struct.unpack('<f',struct.pack('<I',struct.unpack('<I',struct.pack('<f',x))[0]+k))[0]
 def case(label,state,ctx):
  ctx=dict(dict(now=10,dt=1/64,buttons=0,commandSeed=123456,serverSeed=987654,reloadDuration=d.f32(66/30)),**ctx)
  try:r=e.frame(state,ctx)
  except Exception:print(label,state,ctx,[hex(x)for x in e.trace[-40:]],flush=True);raise
  visited.update(e.trace);rows.append(dict(label=label,input=state,context=ctx,result=r));return r['state']
 for clip in [0,1,6,7]:
  for buttons in [0,1,2048,8192,2049,8193,10240]:
   for offset in [-1,0,1]:case('command-boundary',dict(clip=clip,nextPrimary=near(10,offset),nextSecondary=near(10,offset)),dict(buttons=buttons))
 for blocked in ['rulePredicateBlock','playerBlocked','playerBlockingField15a0']:
  for clip in [0,1,7]:
   for buttons in [0,1,2048,8192,8193]:case('primary-gates',dict(clip=clip),{blocked:1 if blocked=='playerBlockingField15a0'else True,'buttons':buttons})
 for shots in [0,1,3]:
  for wait in [False,True]:
   for buttons in [0,1,2048,8192]:
    for at in [near(10,-1),10,near(10,1)]:case('owner-busy-latch',dict(clip=3,shotsFired=shots,waitForNoAttack=wait,ownerNextAttack=at),dict(buttons=buttons))
 for reserve in [0,1,5,35]:
  for clip in [0,1,6,7]:
   for buttons in [0,1,2048,8192]:
    for at in [near(10,-1),10,near(10,1)]:case('reload-completion',dict(clip=clip,reserve=reserve,reloading=True,ownerNextAttack=at,nextPrimary=at,nextSecondary=at),dict(buttons=buttons))
 for age in [0,1/128,1/64,near(1/64,1),1]:case('primary-drift',dict(nextPrimary=10-age),dict(buttons=1))
 for clip in [0,3]:
  for reserve in [0,35]:case('no-auto-reload',dict(clip=clip,reserve=reserve),dict(noAutoReload=True))
 for active in [False,True]:
  for owner in [False,True]:case('ownership',{},dict(active=active,owner=owner,buttons=1))
 for owner in [False,True]:
  for reloading in [False,True]:
   for complete in [False,True]:case('holster',dict(reloading=reloading,reloadVisComplete=complete,nextPrimary=12,nextSecondary=13,ownerNextAttack=14),dict(operation='holster',owner=owner))
  for clock in [0,10,14]:case('deploy',dict(shotsFired=3,nextPrimary=clock,nextSecondary=clock+1),dict(owner=owner,operation='deploy'))
 for clip in [0,1,7]:
  start=len(rows);state=dict(clip=clip)
  for tick in range(240):
   buttons=1 if tick<24 or tick in [36,58,80,190,220]else 8192 if tick==102 else 0
   state=case('continuous-semi-reload',state,dict(now=d.f32(10+tick/64),buttons=buttons,commandSeed=1000+tick,serverSeed=9000+tick))
  sequences.append(dict(start=start,count=len(rows)-start))
 for owner in [False,True]:
  for reloading in [False,True]:
   for clip,reserve in [(0,0),(0,3),(3,35),(7,35)]:
    state=dict(clip=clip,reserve=reserve,reloading=reloading,nextPrimary=12,nextSecondary=12,ownerNextAttack=12);ctx=dict(now=11,owner=owner)
    events.append(dict(input=state,event=54,context=ctx,result=e.animationEvent(state,54,ctx)))
 report=dict(serverSha256=g.discover.SHA,itemsSha256=e.itemsSha,originalVtable=hex(VTABLE),activities=e.modelActivities,attrs=e.attrs,cases=rows,eventCases=events,sequences=sequences,
  limits=['Ordinary default Deagle shared base gun; owner/Player environmental gates supplied.', 'Original model resource adapter selects first same-duration fire variant; weighted sequence selection not restored.', 'Animation, transport, accuracy and economy lookup are explicit adapters; original time/ammo/command bytes execute.', 'No alternative Deagle mode, heavy armour, special reload or game-mode auto-drop.'])
 path=ROOT/'output/tests/source-deagle-command-native.json';path.write_text(json.dumps(report,separators=(',',':'))+'\n');print(json.dumps(dict(cases=len(rows),eventCases=len(events),activities=e.modelActivities,file=str(path))))
if __name__=='__main__':main()
