"""Original default Glock viewmodel reset/advance/dispatch, isolated from command.
Runs actual i386 clock arithmetic and source MDL event collector; no UI elapsed.
"""
from pathlib import Path
import importlib.util,json,struct,hashlib
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
a=load('animation_event_base','scripts/probe-source-pistol-animation-events.py');g=a.g;d=g.d
FLOATZERO=d.STOP+0x700;CAPTURE=d.STOP+0x710
OFFSETS={'cycle':0x40c,'animTime':0x70,'previousAnimTime':0x6c,'eventCursor':0x3b0,'playbackRate':0x3d4}
INTS={'sequence':0x410,'sequenceParity':0x488,'resetEventsParity':0x48c,'animationParity':0x504}
class NativeClock(a.NativeEvent):
 def __init__(self):
  super().__init__();audit=json.loads((ROOT/'.reference-assets/source-exports/pistol-candidates/glock-ct/audit.json').read_text());duration={c['sequence']:d.f32(c['duration_seconds'])for c in audit['clip_checks'].values()};self.profiles=[]
  start,size=g.discover.function(0x6ba9d0);instructions=list(g.discover.md.disasm(self.raw[g.discover.offset(start):g.discover.offset(start)+size],start));self.registrations={}
  for name in ['AE_WPN_COMPLETE_RELOAD','AE_CLIENT_EJECT_BRASS','AE_CL_SET_STATTRAK_GLOW','AE_BEGIN_TAUNT_LOOP']:
   ptr=g.discover.va(self.raw.index(name.encode()+b'\0'));i=next(i for i,x in enumerate(instructions)if x.mnemonic=='push'and x.op_str==hex(ptr));flags,id= instructions[i-2:i]
   assert flags.mnemonic==id.mnemonic=='push'
   self.registrations[name]=dict(id=int(id.op_str,0),type=int(flags.op_str,0)|1024,registrationVA=hex(flags.address))
  _,base=struct.unpack_from('<II',self.mdl,0xbc)
  for s in audit['sequences']:
   index=s['sequence_index'];at=base+index*212;count,off=struct.unpack_from('<II',self.mdl,at+24)
   self.profiles.append(dict(sequence=index,name=s['name'],flags=struct.unpack_from('<I',self.mdl,at+12)[0],duration=duration[s['name']],fadeOut=struct.unpack_from('<f',self.mdl,at+108)[0],events=s['events'],eventTable=a.MDL+at+off,eventCount=count))
  assert all(p['flags']&1==0 for p in self.profiles)
 def setupClock(self,state,now):
  super().setup({},dict(now=now));self.u.mem_write(a.MDL,self.mdl);self.ints(a.HDR,[a.MDL,0]);self.ints(d.W+0x4d8,[a.HDR]);self.u.mem_write(g.VT,self.raw[g.discover.offset(0x11c54b8):g.discover.offset(0x11c54b8)+0x3f0]);self.ints(d.W,[g.VT]);self.ints(g.VT+0x340,[FLOATZERO]);self.ints(g.VT+0x36c,[CAPTURE]);self.ints(d.W+0x508,[-1]);self.ints(0x173b5dc,[0x173b5c0]);self.ints(0x173b5f0,[0x173b5c0])
  for key,off in OFFSETS.items():self.floats(d.W+off,[state.get(key,1 if key=='playbackRate'else 0)])
  for key,off in INTS.items():self.ints(d.W+off,[state.get(key,0)])
  self.u.mem_write(d.W+0x404,bytes([state.get('finished',False),0]));self.captured=[]
  for p in self.profiles:
   for i,event in enumerate(p['events']):
    if event['name']:
     reg=self.registrations[event['name']];self.ints(p['eventTable']+i*80+4,[reg['id']<<16,reg['type']])
 def hook(self,u,at,size,data):
  if getattr(self,'sharedVMProbe',False) and at==0x7c43d0:
   d.OriginalDamage.hook(self,u,at,size,data)
   return
  if at in [0x4f5840,0x923930,0x5b29a0,0x5b4880,0x5a6ff0,0x5a6fc0,0x793930,0x629550,0x601010,0xec43e0,FLOATZERO,CAPTURE,0x4aa490]:
   d.OriginalDamage.hook(self,u,at,size,data)
   if at in self.stops:return
   sp=u.reg_read(UC_X86_REG_ESP)
   if at==0x4f5840:self.ret(a.HDR)
   elif at==0x5b4880:
    _,base=struct.unpack_from('<II',self.mdl,0xbc);index=self.uint(sp+8);seq=a.MDL+base+index*212;self.ret(seq+self.uint(seq+4))
   elif at==0x923930:self.ret(1)
   elif at==0x5b29a0:self.floatret(self.profiles[self.uint(d.W+0x410)]['duration'])
   elif at==0x5a6ff0:
    seq=self.uint(sp+4);self.ret(seq+self.uint(seq+28))
   elif at==CAPTURE:
    event=self.uint(sp+8);kind=self.uint(event+16);options=self.uint(event+4);profile=self.profiles[self.uint(d.W+0x410)];record=(options-profile['eventTable']-12)//80
    self.captured.append(dict(record=record,recordEvent=self.uint(event)>>16 if kind&1024 else self.uint(event),type=kind,cycle=self.read(event+8),eventTime=self.read(event+12),options=bytes(u.mem_read(options,64)).split(b'\0')[0].decode()));self.ret()
   elif at==FLOATZERO:self.floatret(0)
   else:self.ret()
   return
  super().hook(u,at,size,data)
 def clockState(self):return {**{k:self.read(d.W+v)for k,v in OFFSETS.items()},**{k:self.uint(d.W+v)for k,v in INTS.items()},'finished':bool(self.u.mem_read(d.W+0x404,1)[0])}
 def clock(self,state,ctx):
  self.setupClock(state,ctx['now'])
  if 'reset'in ctx:self.call(0x629820,[d.W,ctx['reset']])
  afterReset=self.clockState()
  if ctx.get('advance',True):self.call(0x5b7fc0,[d.W])
  afterAdvance=self.clockState()
  if ctx.get('dispatch',True):self.call(0x5b4290,[d.W,d.W])
  return dict(state=self.clockState(),afterReset=afterReset,afterAdvance=afterAdvance,events=self.captured)
 def requestGuard(self,state,sequence):
  self.setupClock(state,10);self.u.reg_write(UC_X86_REG_EDI,sequence);self.u.reg_write(UC_X86_REG_EBX,d.W);self.u.reg_write(UC_X86_REG_EBP,d.F);self.u.reg_write(UC_X86_REG_ESP,d.F-0x100)
  return self.run(0xd446fa,[0xd44752,0xd44760])==0xd44760
 def sharedVM(self):
  self.setupClock({},10);self.sharedVMProbe=True;handles=d.T+0xc000;vm=d.P+0x5000;weapons=[d.W,d.W+0x3000];self.ints(0x16dc400,[handles]);self.ints(handles+24,[0,vm,0]);self.ints(d.P+0xfd8,[1]);results=[]
  for weapon in weapons:
   self.u.reg_write(UC_X86_REG_EBX,weapon);self.run(0x5de0e1,[0x5de0eb]);index=self.uint(weapon+0x944);result=self.call(0x7c43d0,[d.P,index]);results.append(dict(weapon=hex(weapon),viewmodelIndex=index,ownerArrayOffset=hex(0xfd8+index*4),viewmodel=hex(result)))
  self.sharedVMProbe=False;return results
def main():
 e=NativeClock();rows=[];visited=set()
 def case(label,state,ctx):
  try:r=e.clock(state,ctx)
  except Exception:print(label,state,ctx,[hex(x)for x in e.trace[-50:]],flush=True);raise
  visited.update(e.trace);rows.append(dict(label=label,input=state,context=ctx,result=r));return r['state']
 for seq in range(6):
  for cycle in [0,.3,.99,1]:
   for age in [-1,0,.0005,.001,.002,1/64,.2,1,10]:
    case('advance-boundaries',dict(sequence=seq,cycle=cycle,animTime=10,previousAnimTime=9,eventCursor=cycle),dict(now=10+age))
 for old in range(6):
  for seq in range(6):
   for parity in [0,7]:
    case('reset-same-different',dict(sequence=old,cycle=.8,animTime=10,previousAnimTime=9,eventCursor=.7,finished=True,playbackRate=.5,sequenceParity=parity,resetEventsParity=parity,animationParity=parity),dict(now=10.015625,reset=seq))
 sequences=[]
 for seq in range(6):
  start=len(rows);state=dict(sequence=seq,animTime=10,previousAnimTime=9)
  for tick in range(500):state=case('continuous',state,dict(now=d.f32(10+tick/64),**({'reset':seq}if tick==0 else{})))
  sequences.append(dict(sequence=seq,start=start,count=len(rows)-start))
 for rate in [0,.5,1,2]:case('playback',dict(sequence=4,cycle=.4,animTime=10,previousAnimTime=9,eventCursor=.4,playbackRate=rate),dict(now=10.1))
 initialization=[]
 for now in [0,10,1000]:
  e.setupClock(dict(animTime=9,previousAnimTime=8),now);e.u.reg_write(UC_X86_REG_EBX,d.W);e.u.reg_write(UC_X86_REG_EBP,d.F);e.u.reg_write(UC_X86_REG_ESP,d.F-0x100);e.run(0x5b22b0,[0x5b2310]);initialization.append(dict(now=now,animTime=e.read(d.W+0x70),previousAnimTime=e.read(d.W+0x6c)))
 requestGuards=[]
 near=lambda x,k:struct.unpack('<f',struct.pack('<I',struct.unpack('<I',struct.pack('<f',x))[0]+k))[0]
 for old in range(6):
  for new in range(6):
   for cycle in [0,.5,near(.98,-1),d.f32(.98),1]:
    state=dict(sequence=old,cycle=cycle);requestGuards.append(dict(input=state,sequence=new,accepted=e.requestGuard(state,new)))
 critical=[0x629820,0x5b45a0,0x5b46db,0x5b46e2,0x5b7fc0,0x5b8045,0x5b80e7,0x5b4c10,0x5b4aa0,0x5b43ba,0x5b43e0,0x5a80d0,0x5a8249]
 assert all(x in visited for x in critical),list(map(hex,set(critical)-visited))
 shared=e.sharedVM()
 out=ROOT/'output/tests/source-glock-animation-clock-native.json';out.write_text(json.dumps(dict(serverSha256=g.discover.SHA,sourceMdlSha256=e.mdlSha,profiles=e.profiles,registrations=e.registrations,initialization=initialization,requestGuards=requestGuards,sharedViewmodel=shared,caseCount=len(rows),criticalExecuted=list(map(hex,critical)),sequences=sequences,cases=rows),separators=(',',':'))+'\n');print(out,len(rows))
if __name__=='__main__':main()
