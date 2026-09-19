"""Bounded original pistol HandleAnimEvent dispatcher and state writes."""
from pathlib import Path
import importlib.util,json,struct,hashlib
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
g=load('event_glock','scripts/probe-source-glock-command.py');d=g.d
vpk=load('event_vpk','scripts/inventory-source-items.py')
MDL=0x6000000;HDR=d.T+0x800;OUT=d.T+0x9000
MARKERS={d.STOP+0x600:'player-command-frame',d.STOP+0x610:'player-animation-events',d.STOP+0x620:'world-weapon-advance',d.STOP+0x630:'viewmodel-advance',d.STOP+0x640:'world-weapon-events',d.STOP+0x650:'viewmodel-events-target-weapon'}
class NativeEvent(g.NativeGlock):
 def __init__(self):
  super().__init__();self.u.mem_map(MDL,0x20000);entries,_=vpk.directory_index(vpk.GAME/'pak01_dir.vpk');entry=entries['models/weapons/v_pist_glock18.mdl']
  with(vpk.GAME/f"pak01_{entry['archiveIndex']:03}.vpk").open('rb')as f:f.seek(entry['archiveOffset']);self.mdl=f.read(entry['archiveBytes'])
  self.mdlSha=hashlib.sha256(self.mdl).hexdigest();assert self.mdlSha=='48ab6740def0ad8d7d4a42476583a61c8aa7d9f9f784b2d2f167720f14875242'
  count,offset=struct.unpack_from('<II',self.mdl,0xbc);self.reloadSequence=next(i for i in range(count)if self.mdl[offset+i*212+struct.unpack_from('<i',self.mdl,offset+i*212+4)[0]:].startswith(b'glock_reload\0'))
  self.seq=MDL+offset+self.reloadSequence*212;eventcount,eventoffset=struct.unpack_from('<II',self.mdl,self.seq-MDL+24);self.eventTable=self.seq+eventoffset;self.eventCount=eventcount
  self.eventIndex=next(i for i in range(eventcount)if self.mdl[self.eventTable-MDL+i*80+struct.unpack_from('<i',self.mdl,self.eventTable-MDL+i*80+76)[0]:].startswith(b'AE_WPN_COMPLETE_RELOAD\0'))
  self.eventCycle=struct.unpack_from('<f',self.mdl,self.eventTable-MDL+self.eventIndex*80)[0]
 def hook(self,u,at,size,data):
  if getattr(self,'orderProbe',False) and (at in MARKERS or at==0x7c43d0):
   d.OriginalDamage.hook(self,u,at,size,data)
   if at in self.stops:return
   if at==0x7c43d0:self.ret(d.P+0x5000)
   else:self.order.append(dict(callback=MARKERS[at],selfAddress=hex(self.uint(u.reg_read(UC_X86_REG_ESP)+4)),targetAddress=hex(self.uint(u.reg_read(UC_X86_REG_ESP)+8))));self.ret()
   return
  if at==0x5a6ff0:
   d.OriginalDamage.hook(self,u,at,size,data)
   if at not in self.stops:self.ret(self.eventTable)
   return
  super().hook(u,at,size,data)
 def postOrder(self):
  self.setup({},{});self.orderProbe=True;self.order=[];vm=d.P+0x5000;vmvt=d.T+0xb000;handles=d.T+0xc000
  self.ints(g.PVT+0x728,[d.STOP+0x600]);self.ints(g.PVT+0x368,[d.STOP+0x610]);self.ints(g.PVT+0x520,[g.ZERO]);self.ints(g.PVT+0x15c,[g.ONE]);self.ints(g.VT+0x330,[d.STOP+0x620]);self.ints(g.VT+0x368,[d.STOP+0x640]);self.ints(vm,[vmvt]);self.ints(vmvt+0x330,[d.STOP+0x630]);self.ints(vmvt+0x368,[d.STOP+0x650]);self.ints(vm+0x4d8,[d.T+0xe000]);self.ints(d.T+0xe000,[MDL+100])
  self.ints(0x16dc400,[handles]);self.ints(handles+24,[0,d.W,0]);self.ints(d.P+0x96c,[1]);self.ints(0x100c,[0]);self.ints(d.P+0x410,[0]);self.ints(d.F-0x2c,[0]);self.u.reg_write(UC_X86_REG_ESI,d.P);self.u.reg_write(UC_X86_REG_EBP,d.F);self.u.reg_write(UC_X86_REG_ESP,d.F-0x80)
  self.run(0x7ce291,[0x7ce13c]);self.orderProbe=False
  return dict(callbacks=self.order,executed=list(map(hex,self.trace)))
 def collect(self,start,end):
  self.setup({},{});self.u.mem_write(MDL,self.mdl);self.ints(HDR,[MDL,0]);self.ints(self.eventTable+self.eventIndex*80+4,[54<<16,0x411])
  # Registration adapter applies original server registration id54/type17 to
  # the raw new-event record. Original collector creates the runtime struct.
  bits=lambda x:struct.unpack('<I',struct.pack('<f',x))[0]
  index=0;events=[]
  while True:
   index=self.call(0x5a80d0,[HDR,self.reloadSequence,OUT,bits(start),bits(end),index])
   if not index:break
   events.append(dict(record=index-1,eventIndex=self.uint(OUT)>>16 if self.uint(OUT+16)&1024 else self.uint(OUT),eventType=self.uint(OUT+16),eventCycle=self.read(OUT+8),runtimeBytes=bytes(self.u.mem_read(OUT,24)).hex()))
  return dict(start=start,end=end,events=events)
 def event(self,state,event,context):
  self.setup(state,context);self.ints(d.T+0x9000,[event<<16]);self.ints(d.T+0x9010,[0x411 if event==54 else 0x401]);self.ints(d.T+0x9014,[0])
  self.u.reg_write(UC_X86_REG_EBP,d.F);self.u.reg_write(UC_X86_REG_ESP,d.F-0x400);self.u.reg_write(UC_X86_REG_EDI,d.W);self.u.reg_write(UC_X86_REG_EBX,d.T+0x9000)
  end=self.run(0xd45296,[0xd452bc,0xd452cf,0xd45ef4,0xd4587c])
  return dict(state=self.state(),events=self.events,stop=hex(end),executed=list(map(hex,self.trace)))
def main():
 e=NativeEvent();cases=[]
 for event in [44,46,54]:
  for owner in [False,True]:
   for reloading in [False,True]:
    for clip,reserve in [(0,0),(0,7),(3,120),(20,120)]:
     state=dict(clip=clip,reserve=reserve,reloading=reloading,nextPrimary=12,nextSecondary=12,ownerNextAttack=12)
     result=e.event(state,event,dict(now=11,owner=owner));cases.append(dict(input=state,event=event,context=dict(now=11,owner=owner),result=result))
 near=lambda x,k:struct.unpack('<f',struct.pack('<I',struct.unpack('<I',struct.pack('<f',x))[0]+k))[0]
 windows=[e.collect(a,b)for a,b in [(0,e.eventCycle),(0,near(e.eventCycle,1)),(e.eventCycle,near(e.eventCycle,1)),(near(e.eventCycle,1),1),(0,1),(.5,.4)]]
 order=e.postOrder()
 path=ROOT/'output/tests/source-pistol-animation-events-native.json';path.write_text(json.dumps(dict(serverSha256=g.discover.SHA,sourceMdlSha256=e.mdlSha,eventCycle=e.eventCycle,cases=cases,cycleWindows=windows,postThinkOrder=order),separators=(',',':'))+'\n');print(path,len(cases));print(json.dumps(order['callbacks'],indent=2))
if __name__=='__main__':main()
