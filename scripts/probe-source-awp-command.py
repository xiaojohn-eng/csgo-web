"""Original App740 AWP command oracle; no game process or synthetic timings.

The inherited harness adapts ownership, economy resources, model lookup and
transport. AWP's original vtable selects the exact shared base-gun bytes.
"""
from pathlib import Path
import importlib.util,json,struct,hashlib
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
g=load('awp_command_base','scripts/probe-source-glock-command.py');d=g.d
VTABLE=0x12e92f4
def attributes():
 catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text());attrs={}
 def merge(key):
  p=catalog['prefabs'][key]
  for parent in p.get('prefab','').split():merge(parent)
  values=p.get('attributes',{})
  for block in values if isinstance(values,list)else[values]:attrs.update(block)
 merge('weapon_awp_prefab')
 for key,value in list(attrs.items()):
  if isinstance(value,list):
   assert len(set(value))==1,(key,value) # Repeated original attribute entries, when present, must agree.
   attrs[key]=value[0]
 return attrs
class NativeAWP(g.NativeGlock):
 def __init__(self):
  super().__init__();self.attrs=attributes()
  assert self.attrs['is full auto']=='0' and self.attrs['has burst mode']=='0' and self.attrs['has silencer']=='0'
  assert g.discover.word(0x1725f18)==5 and g.discover.word(0x1725f1c)==g.discover.va(self.raw.index(b'SniperRifle\0'))
  assert [float(self.attrs[k])for k in ['primary clip size','primary reserve ammo max','cycletime','unzoom after shot','zoom levels','zoom fov 1','zoom fov 2','zoom time 0','zoom time 1','zoom time 2']]==[5,30,1.455,1,2,40,10,.05,.05,.05]
  assert g.discover.word(VTABLE-4)==0x12e7208
  assert [g.discover.word(VTABLE+i)for i in [0x4ac,0x4b0,0x4d0,0x4f8,0x4fc,0x500,0x738]]==[0xd4d5c0,0xd4cc60,0xd4ac70,0xd4ca70,0xd4b7e0,0xd4bd20,0xd3ff60]
  path=ROOT/'.reference-assets/source-exports/awp-candidates/awp-ct/audit.json'
  audit=json.loads(path.read_text());self.modelActivities={};self.modelSequences=audit['sequences']
  self.sequenceDurations={v['sequence']:d.f32(v['duration_seconds'])for v in audit['clip_checks'].values()}
  for row in audit['sequences']:
   if not row['activity_name']:continue
   ptr=g.discover.va(self.raw.index(row['activity_name'].encode()+b'\0'));ref=next(p for p in g.discover.refs(ptr)if 0x4af090<=p<0x4b3170)
   assert self.raw[g.discover.offset(ref)-6]==0x68
   activity=struct.unpack_from('<I',self.raw,g.discover.offset(ref)-5)[0];self.modelActivities.setdefault(activity,[]).append(row['name'])
 def setup(self,state,context):
  super().setup(state,context);self.reserve=state.get('reserve',30);self.currentSequence=state.get('sequence','awp_idle')
  self.u.mem_write(g.VT,self.raw[VTABLE:VTABLE+0x750])
  for off,fn in [(0x704,g.GETINFO),(0x59c,g.MAXCLIP),(0x5a0,g.ZERO),(0x5d8,g.ONE),(0x5dc,g.ZERO),(0x48c,g.NOOP),(0x4dc,g.NOOP),(0x5bc,g.ONE if context.get('noAutoReload',False)else g.ZERO),(0x4b8,g.NOOP),(0x510,g.ZERO),(0x590,g.ZERO),(0x594,g.ZERO)]:self.ints(g.VT+off,[fn])
  self.u.mem_write(d.T+0x23c,b'\0\0\0');self.ints(d.W+0x974,[state.get('clip',5)])
  self.ints(d.W+0x9b0,[state.get('activity',185)]);self.ints(d.W+0x9ac,[194])
  self.ints(d.T+0xc8,[5]);self.u.mem_write(d.T+0x1cc,b'\x01');self.ints(d.T+0x1d0,[2,40,10]);self.floats(d.T+0x1dc,[.05,.05,.05])
  self.u.mem_write(d.T+0x7000,b'Weapon_AWP.Zoom\0');self.ints(d.T+0x21c,[d.T+0x7000,d.T+0x7000])
  self.ints(d.W+0xb00,[state.get('zoomLevel',0)]);self.floats(d.W+0xa90,[state.get('zoomReadyTime',0)]);self.floats(d.W+0xa8c,[state.get('zoomSmoothing',0)])
  self.floats(d.W+0xa84,[state.get('ballisticPenalty',0)])
  self.u.mem_write(d.P+0x16a8,bytes([state.get('scoped',False)]));self.u.mem_write(d.P+0x16aa,bytes([state.get('resumeZoom',False)]))
  self.ints(d.P+0xda4,[state.get('fovTarget',90)]);self.ints(d.P+0xdac,[state.get('fovStart',90)]);self.floats(d.P+0xdb0,[state.get('fovTime',0)]);self.floats(d.P+0xa2c,[state.get('fovDuration',0)])
  self.ints(d.P+0xdc0,[-1]);self.ints(d.P+0xd48,[-1]);self.ints(d.P+0x9ec,[g.PVT+0xb00]);self.ints(g.PVT+0xb04,[g.NOOP]);self.ints(g.PVT+0x674,[0x7cb6b0])
 def hook(self,u,at,size,data):
  if at in [0xd4be42,0xd4c0f7,g.APPLY,0x866940,0x61d9c0,0x7cb6b0,0x61d750,0xc1a4b0,0xd42060,0xd4bffd]:
   d.OriginalDamage.hook(self,u,at,size,data)
   if at in self.stops:return
   sp=u.reg_read(UC_X86_REG_ESP)
   if at in [0xd4be42,0xd4c0f7]:self.events.append(dict(kind='zoom-smoothing-reset',field='0xa8c',value=0)) # actual following a8c store executes
   elif at==g.APPLY:
    name=bytes(u.mem_read(self.uint(sp+16),100)).split(b'\0')[0].decode();assert name=='cycletime_when_zoomed' and 'cycletime when zoomed'not in self.attrs
    self.attributeCalls.append(dict(name=name,input=self.read(sp+8),found=False));self.floatret(self.read(sp+8))
   elif at==0x866940:self.events.append(dict(kind='sound',name=bytes(u.mem_read(self.uint(sp+8),80)).split(b'\0')[0].decode()));self.ret()
   elif at==0x61d9c0:
    self.events.append(dict(kind='fov',target=self.uint(sp+12),duration=self.read(sp+16),startOverride=self.uint(sp+20)))
    # Execute original CBasePlayer SetFOV, including original GetFOV start sample.
   elif at==0x7cb6b0:pass # Actual original integer smoothstep FOV getter.
   elif at==0x61d750:self.ret(90) # supplied ordinary default player FOV
   elif at==0xc1a4b0:self.ret(0) # no separate aim-controller entity
   elif at==0xd42060:self.events.append(dict(kind='weapon-tick',mode=self.uint(d.W+0xa6c),reloading=bool(u.mem_read(d.W+0x9c1,1)[0])));self.ret()
   elif at==0xd4bffd:u.reg_write(UC_X86_REG_EIP,0xd4c05f) # zoom game-event transport only
   return
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
   else:self.ret(5 if at==g.MAXCLIP else 1)
   return
  super().hook(u,at,size,data)
 def state(self):
  s=super().state()
  for key in ['burstMode','burstRemaining','nextBurst']:del s[key]
  return dict(s,activity=self.uint(d.W+0x9b0),sequence=self.currentSequence,zoomLevel=self.uint(d.W+0xb00),zoomReadyTime=self.read(d.W+0xa90),zoomSmoothing=self.read(d.W+0xa8c),ballisticPenalty=self.read(d.W+0xa84),
   scoped=bool(self.u.mem_read(d.P+0x16a8,1)[0]),resumeZoom=bool(self.u.mem_read(d.P+0x16aa,1)[0]),fovTarget=self.uint(d.P+0xda4),fovStart=self.uint(d.P+0xdac),fovTime=self.read(d.P+0xdb0),fovDuration=self.read(d.P+0xa2c))
 def animationEvent(self,state,event,context):
  if not hasattr(self,'_eventAdapter'):self._eventAdapter=load('awp_event_adapter','scripts/probe-source-pistol-animation-events.py').NativeEvent.event
  return self._eventAdapter(self,state,event,context)
def main():
 e=NativeAWP();rows=[];events=[];chains=[];visited=set()
 near=lambda x,k:struct.unpack('<f',struct.pack('<I',struct.unpack('<I',struct.pack('<f',x))[0]+k))[0]
 def zoom(level,**state):return dict(zoomLevel=level,mode=int(level>0),scoped=level>0,fovTarget=[90,40,10][level],fovStart=[90,40,10][level],**state)
 def case(label,state,ctx):
  ctx=dict(dict(now=10,dt=1/64,buttons=0,commandSeed=123456,serverSeed=987654,reloadDuration=d.f32(110/30)),**ctx)
  try:r=e.frame(state,ctx)
  except Exception:print(label,state,ctx,[hex(x)for x in e.trace[-40:]],flush=True);raise
  visited.update(e.trace);rows.append(dict(label=label,input=state,context=ctx,result=r));return r['state']
 for level in range(3):
  for clip in [0,1,4,5]:
   for buttons in [0,1,2048,8192,2049,8193,10240]:
    for offset in [-1,0,1]:case('command-boundary',zoom(level,clip=clip,nextPrimary=near(10,offset),nextSecondary=near(10,offset)),dict(buttons=buttons))
 for blocked in ['rulePredicateBlock','playerBlocked','playerBlockingField15a0']:
  for clip in [0,1,5]:
   for buttons in [0,1,2048,8192,8193]:case('primary-gates',zoom(1,clip=clip),{blocked:1 if blocked=='playerBlockingField15a0'else True,'buttons':buttons})
 for shots in [0,1,3]:
  for wait in [False,True]:
   for buttons in [0,1,2048,8192]:
    for at in [near(10,-1),10,near(10,1)]:case('owner-busy-latch',zoom(2,clip=3,shotsFired=shots,waitForNoAttack=wait,ownerNextAttack=at),dict(buttons=buttons))
 for level in range(3):
  for clip in [0,1,5]:
   for buttons in [0,1,2048,8192]:
    for at in [near(10,-1),10,near(10,1)]:
     for noAuto in [False,True]:case('resume-zoom-before-input',dict(zoom(level,clip=clip,nextPrimary=at),mode=0,scoped=False,resumeZoom=True,fovTarget=90),dict(buttons=buttons,noAutoReload=noAuto))
 for reserve in [0,1,5,30]:
  for clip in [0,1,4,5]:
   for buttons in [0,1,2048,8192]:
    for at in [near(10,-1),10,near(10,1)]:case('reload-completion',zoom(0,clip=clip,reserve=reserve,reloading=True,ownerNextAttack=at,nextPrimary=at,nextSecondary=at),dict(buttons=buttons))
 for age in [0,1/128,1/64,near(1/64,1),1]:case('primary-drift',zoom(1,nextPrimary=10-age),dict(buttons=1))
 for level in range(3):
  for clip in [0,3]:
   for reserve in [0,30]:case('no-auto-reload',zoom(level,clip=clip,reserve=reserve),dict(noAutoReload=True))
 for active in [False,True]:
  for owner in [False,True]:case('ownership',zoom(2),dict(active=active,owner=owner,buttons=1))
 for owner in [False,True]:
  for level in range(3):
   for reloading in [False,True]:
    for complete in [False,True]:case('holster',zoom(level,reloading=reloading,reloadVisComplete=complete,resumeZoom=level>0,nextPrimary=12,nextSecondary=13,ownerNextAttack=14),dict(operation='holster',owner=owner))
   for clock in [0,10,14]:case('deploy',zoom(level,shotsFired=3,resumeZoom=level>0,nextPrimary=clock,nextSecondary=clock+1),dict(owner=owner,operation='deploy'))
 for clip in [0,3,5]:
  for reserve in [0,30]:
   for buttons in [0,8192]:case('reload-clears-old-visual-completion',dict(clip=clip,reserve=reserve,reloadVisComplete=True),dict(buttons=buttons))
 for level in range(3):
  for age in [0,.01,.025,.05,.1]:
   for buttons in [1,2048,8192]:case('fov-in-flight',dict(zoom(level,clip=3),fovStart=90,fovTime=10-age,fovDuration=d.f32(.05)),dict(buttons=buttons))
 for clip in [0,1,5]:
  start=len(rows);state=dict(clip=clip)
  for tick in range(850):
   buttons=2048 if tick in [0,25,450,470,720]else 1 if tick in [30,160,290,550,740]else 8192 if tick==400 else 0
   ctx=dict(now=d.f32(10+tick/64),buttons=buttons,commandSeed=1000+tick,serverSeed=9000+tick)
   if tick==610:ctx['operation']='holster'
   if 611<=tick<630:ctx['active']=False
   if tick==630:ctx['operation']='deploy'
   state=case('continuous-zoom-fire-reload-switch',state,ctx)
  chains.append(dict(start=start,count=len(rows)-start))
 for owner in [False,True]:
  for reloading in [False,True]:
   for clip,reserve in [(0,0),(0,3),(3,30),(5,30)]:
    state=dict(zoom(1,clip=clip,reserve=reserve,reloading=reloading,nextPrimary=12,nextSecondary=12,ownerNextAttack=12));ctx=dict(now=11,owner=owner)
    events.append(dict(input=state,event=54,context=ctx,result=e.animationEvent(state,54,ctx)))
 fieldIsolation=[]
 for level in range(3):
  state=dict(zoom(level),ballisticPenalty=.37,zoomSmoothing=.25);ctx=dict(now=10,dt=1/64,buttons=2048,commandSeed=1)
  r=e.frame(state,ctx);assert r['state']['ballisticPenalty']==d.f32(.37) and r['state']['zoomSmoothing']==0
  fieldIsolation.append(dict(input=state,context=ctx,result=r))
 fovs=[]
 for target in [0,10,40,90]:
  for start in [10,40,90]:
   for duration in [0,.05,.1]:
    for age in [-.1,0,.001,.01,.025,.05,.075,.1,.5]:
     state=dict(fovTarget=target,fovStart=start,fovDuration=duration,fovTime=10);ctx=dict(now=d.f32(10+age))
     e.setup(state,ctx);value=e.call(0x7cb6b0,[d.P]);fovs.append(dict(input=state,context=ctx,value=value,state=e.state()))
 critical=[0xd4b7e0,0xd4bd20,0xd4ca70,0xd4cc60,0xd4d5c0,0xd47770,0xd3e960,0xd3e9d0,0xd4ad10,0xd4ad7c,0xd4ba45,0xd4c7a9,0x61d9c0,0x7cb6b0]
 assert all(at in visited for at in critical),list(map(hex,set(critical)-visited))
 report=dict(serverSha256=g.discover.SHA,itemsSha256=e.itemsSha,originalVtable=hex(VTABLE),activities=e.modelActivities,attrs=e.attrs,cases=rows,eventCases=events,sequences=chains,fovCases=fovs,zoomFieldIsolation=fieldIsolation,criticalExecuted=list(map(hex,critical)),
  limits=['Ordinary owned AWP. Default FOV90; owner environmental gates and resource lookups are explicit adapters.', 'Original command, ammo, zoom, SetFOV and integer FOV interpolation execute; aim-controller entity absent.', 'Accuracy/recoil/damage and game-event transport excluded. Named UNZOOM is not a server registered event.'])
 out=ROOT/'output/tests/source-awp-command-native.json';out.write_text(json.dumps(report,separators=(',',':'))+'\n');print(json.dumps(dict(cases=len(rows),eventCases=len(events),fovCases=len(fovs),activities=e.modelActivities,file=str(out))))
if __name__=='__main__':main()
