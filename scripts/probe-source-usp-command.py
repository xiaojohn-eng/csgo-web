"""WIP independent original HKP2000/USP-S command oracle. Frozen Glock untouched."""
from pathlib import Path
import importlib.util,json,struct
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
g=load('glock_command_base','scripts/probe-source-glock-command.py');d=g.d
class NativeUSP(g.NativeGlock):
 def __init__(self):
  super().__init__();catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text());self.attrs={}
  def merge(key):
   p=catalog['prefabs'][key]
   for parent in p.get('prefab','').split():merge(parent)
   value=p.get('attributes',{})
   for block in value if isinstance(value,list)else[value]:self.attrs.update(block)
  merge('weapon_usp_silencer_prefab')
  assert float(self.attrs['primary clip size'])==12 and float(self.attrs['cycletime'])==.17 and self.attrs['has silencer']=='1'
  assert g.discover.word(0x12f6d5c+0x4fc)==0xd4b7e0
  audit=json.loads((ROOT/'.reference-assets/source-exports/pistol-candidates/usp-ct/audit.json').read_text());self.modelActivities={};self.modelSequences=audit['sequences']
  self.sequenceDurations={v['sequence']:d.f32(v['duration_seconds'])for v in audit['clip_checks'].values()}
  for row in audit['sequences']:
   if not row['activity_name']:continue
   ptr=g.discover.va(self.raw.index(row['activity_name'].encode()+b'\0'));ref=next(p for p in g.discover.refs(ptr)if 0x4af090<=p<0x4b3170)
   assert self.raw[g.discover.offset(ref)-6]==0x68
   activity=struct.unpack_from('<I',self.raw,g.discover.offset(ref)-5)[0];self.modelActivities.setdefault(activity,[]).append(row['name'])
 def setup(self,state,ctx):
  super().setup(state,ctx);self.reserve=state.get('reserve',24);self.currentSequence=state.get('sequence','idle')
  self.u.mem_write(g.VT,self.raw[0x12f6d5c:0x12f6d5c+0x750])
  for off,fn in [(0x704,g.GETINFO),(0x59c,g.MAXCLIP),(0x5a0,g.ZERO),(0x5d8,g.ONE),(0x5dc,g.ZERO),(0x48c,g.NOOP),(0x4dc,g.NOOP),(0x5bc,g.ONE if ctx.get('noAutoReload',False) else g.ZERO),(0x4b8,g.NOOP),(0x510,g.ZERO),(0x590,g.ZERO),(0x594,g.ZERO)]:self.ints(g.VT+off,[fn])
  # +23d is is-revolver, explicitly FALSE. Silencer uses original aa5 and
  # separate has-silencer attribute getter; never enter revolver charge code.
  self.u.mem_write(d.T+0x23c,b'\0\0\0');self.ints(d.W+0x974,[state.get('clip',12)])
  self.u.mem_write(d.W+0xaa5,bytes([state.get('silencerAttached',True)]));self.floats(d.W+0xaa8,[state.get('silencerSwitchTime',0)]);self.ints(d.W+0xa6c,[state.get('mode',1)])
  self.ints(d.W+0x9b0,[state.get('activity',185)]);self.ints(d.W+0x9ac,[state.get('reloadActivity',194)])
 def hook(self,u,at,size,data):
  if at in [g.MAXCLIP,0xc9e040,0xc204a0,0xd4c80f,0xd43530,0x5b29a0]:
   d.OriginalDamage.hook(self,u,at,size,data)
   if at in self.stops:return
   if at==0xc204a0:self.events.append(dict(kind='player-animation-event',id=self.uint(u.reg_read(UC_X86_REG_ESP)+8)));self.ret()
   elif at==0xd4c80f:u.reg_write(UC_X86_REG_ESP,u.reg_read(UC_X86_REG_ESP)+16);u.reg_write(UC_X86_REG_EIP,0xd4c86b)
   elif at==0xd43530:
    activity=self.uint(u.reg_read(UC_X86_REG_ESP)+8);choices=self.modelActivities.get(activity,[])
    # Explicit model-resource adapter: choose first among same-duration fire
    # variants. A missing silenced activity MUST NOT replace the old sequence.
    if choices:self.currentSequence=choices[0];self.ints(d.W+0x9b0,[activity])
    self.events.append(dict(kind='activity',activity=activity,selected=bool(choices),sequence=choices[0]if choices else None));self.ret(int(bool(choices)))
   elif at==0x5b29a0:self.floatret(self.sequenceDurations[self.currentSequence])
   else:self.ret(12 if at==g.MAXCLIP else 1)
   return
  super().hook(u,at,size,data)
 def animationEvent(self,state,event,context):
  if not hasattr(self,'_animationEventAdapter'):self._animationEventAdapter=load('usp_event_adapter','scripts/probe-source-pistol-animation-events.py').NativeEvent.event
  return self._animationEventAdapter(self,state,event,context)
 def state(self):
  s=super().state();s.update(silencerAttached=bool(self.u.mem_read(d.W+0xaa5,1)[0]),silencerSwitchTime=self.read(d.W+0xaa8),activity=self.uint(d.W+0x9b0),sequence=self.currentSequence);return s
if __name__=='__main__':
 e=NativeUSP()
 for s,c in [({},dict(buttons=1)),({'silencerAttached':False,'mode':0},dict(buttons=1)),({},dict(buttons=2048)),({'silencerAttached':False,'mode':0},dict(buttons=2048)),({'clip':3},dict(buttons=8192))]:
  try:print(json.dumps(dict(input=s,context=c,result=e.frame(s,c))),flush=True)
  except Exception:print([hex(x)for x in e.trace[-40:]],flush=True);raise
