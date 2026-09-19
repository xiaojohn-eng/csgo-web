"""Original missing ACT_VM_HOLSTER selection and Holster zero-time consumer.
Independent new script; does not modify the frozen Glock command oracle/module.
"""
from pathlib import Path
import importlib.util,struct,json,hashlib,zlib
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
g=load('glock_command','scripts/probe-source-glock-command.py');d=g.d;m=g.discover
inventory=load('holster_vpk','scripts/inventory-source-items.py')
entries,index=inventory.directory_index(inventory.GAME/'pak01_dir.vpk');entry=entries['models/weapons/v_pist_glock18.mdl'];assert entry['preloadBytes']==0
with(inventory.GAME/f"pak01_{entry['archiveIndex']:03}.vpk").open('rb')as f:f.seek(entry['archiveOffset']);mdl=f.read(entry['archiveBytes'])
assert hashlib.sha256(mdl).hexdigest()=='48ab6740def0ad8d7d4a42476583a61c8aa7d9f9f784b2d2f167720f14875242'
assert f'{zlib.crc32(mdl)&0xffffffff:08x}'==entry['crc32'];assert mdl[:4]==b'IDST'
count,offset=struct.unpack_from('<II',mdl,0xbc);assert count==6
cstring=lambda at:mdl[at:mdl.index(0,at)].decode()
records=[];registrations={}
for i in range(count):
 at=offset+i*212;label,activity_name=struct.unpack_from('<2i',mdl,at+4);name=cstring(at+label);activity=cstring(at+activity_name)if activity_name else''
 numeric=-1
 if activity:
  ptr=m.va(m.raw.index(activity.encode()+b'\0'));ref=next(p for p in m.refs(ptr)if 0x4af090<=p<0x4b3170)
  assert m.raw[m.offset(ref)-6]==0x68 and m.raw[m.offset(ref)-1]==0x68
  numeric=struct.unpack_from('<I',m.raw,m.offset(ref)-5)[0];registrations[activity]=dict(id=numeric,registrationVA=hex(ref-6))
 records.append(dict(index=i,name=name,activityName=activity,activity=numeric,weight=struct.unpack_from('<i',mdl,at+20)[0]))
assert not any(r['activityName']=='ACT_VM_HOLSTER'for r in records)
MDL=0x6000000;HDR=d.T+0x800;MAP=d.T+0x900;BUCKET=d.T+0xa00;ROWS=d.T+0xb00;TUPLES=d.T+0xc00
class MissingHolster(g.NativeGlock):
 def __init__(self):
  super().__init__();self.u.mem_map(MDL,0x10000);self.u.mem_write(MDL,mdl)
 def setup(self,state,ctx):
  super().setup(state,ctx);self.durationCalls=0;self.selectionReturns=[];self.requested=[]
  self.ints(HDR,[MDL]);self.ints(HDR+0x58,[MAP]);self.ints(MAP,[TUPLES]);self.ints(MAP+8,[BUCKET]);self.ints(MAP+0x14,[1]);self.ints(BUCKET,[ROWS]);self.ints(BUCKET+0xc,[5])
  # Activity-name registration comes from actual original registration code.
  # A one-bucket cache keeps ALL five real named activities, no synthesized hit.
  named=[r for r in records if r['activity']>=0]
  for index,r in enumerate(named):
   self.ints(ROWS+index*16,[r['activity'],index,1,1]);self.u.mem_write(TUPLES+index*16,struct.pack('<hh',r['index'],1))
   self.ints(MDL+offset+r['index']*212+0x10,[r['activity']])
  self.u.mem_write(0x173aee8,b'\1');self.ints(0x173aee0,[d.T+0xd00]);self.ints(0x100c,[0]);self.ints(d.W+0x410,[ctx.get('currentSequence',0)]);self.ints(d.W+0x9b0,[ctx.get('currentActivity',185)])
 def hook(self,u,at,size,data):
  if at in [0xd43530,0x923930,0x922dd0,0x5a7c40,0x5b5860,0x5a8dac,0x5db047,0x5b29a0]:
   d.OriginalDamage.hook(self,u,at,size,data)
   if at in self.stops:return
   if at==0xd43530:self.requested.append(self.uint(u.reg_read(UC_X86_REG_ESP)+8))
   elif at in [0x923930,0x922dd0]:self.ret(1)
   elif at==0x5a7c40:self.ret()
   elif at==0x5db047:self.selectionReturns.append(struct.unpack('<i',struct.pack('<I',u.reg_read(UC_X86_REG_EAX)))[0])
   elif at==0x5b29a0:self.durationCalls+=1;raise AssertionError('Missing holster unexpectedly queried previous SequenceDuration')
   return
  super().hook(u,at,size,data)
 def probe(self,state,ctx):
  self.setup(state,dict(operation='holster',**ctx));oldActivity=self.uint(d.W+0x9b0);oldSequence=self.uint(d.W+0x410)
  # Normal SendWeaponAnim wrapper includes original econ translation (default
  # item, no alternate activity), exact selector hash miss and failure return.
  result=self.call(0x5db1e0,[d.W,184]);assert result==0
  assert self.uint(d.W+0x9b0)==oldActivity and self.uint(d.W+0x410)==oldSequence
  self.call(0xd4cc60,[d.W,0])
  assert self.durationCalls==0 and self.selectionReturns==[-1,-1]
  assert self.read(d.P+0x6e4)==d.f32(ctx.get('now',10))
  return dict(state=self.state(),sendWeaponAnimResult=result,selectionReturns=self.selectionReturns,requestedActivities=self.requested,durationCalls=self.durationCalls,oldActivity=oldActivity,finalActivity=self.uint(d.W+0x9b0),oldSequence=oldSequence,finalSequence=self.uint(d.W+0x410))
def main():
 engine=MissingHolster();cases=[];visited=set()
 for row in records:
  for reload in [False,True]:
   s=dict(reloading=reload,clip=3,burstRemaining=2,nextBurst=10.05,ownerNextAttack=15,nextPrimary=12,nextSecondary=13)
   c=dict(now=10,currentSequence=row['index'],currentActivity=row['activity']if row['activity']>=0 else 185)
   try:r=engine.probe(s,c)
   except Exception:print([hex(x)for x in engine.trace[-40:]]);raise
   visited.update(engine.trace);cases.append(dict(input=s,context=c,result=r))
 critical=[0xa24cd0,0x5db020,0x5b5860,0x5a8d10,0x5a7160,0x5a7239,0x5a7247,0x5a7273,0x5a7310,0x5db190,0x5d9e6d,0x5d9e7d,0x5d9ec9]
 assert all(x in visited for x in critical),list(map(hex,set(critical)-visited))
 report=dict(serverSha256=m.SHA,sourceMdlSha256=hashlib.sha256(mdl).hexdigest(),vpk=index,sourceSequences=records,activityRegistrations=registrations,criticalOriginalExecuted=list(map(hex,critical)),cases=cases,
  conclusion=dict(selection=-1,sendWeaponAnimFalse=True,oldSequenceAndActivityPreserved=True,previousSequenceDurationNotQueried=True,holsterEffectiveDuration=0,ownerNextAttack='curtime',queuePreserved=True),
  adapters=['Original MDL bytes and original activity registration IDs. Native cache layout with one bucket containing all five actual named activities.',
   'Cached model valid/mapping valid/initialization queries are adapters; original hash search, miss return, SendWeaponAnim failure and Holster clock branches execute.',
   'Model draw/physics/visibility/network notifications excluded. No source GLB/module/shared/public mutation.'])
 path=ROOT/'output/tests/source-glock-holster-native.json';path.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(dict(cases=len(cases),selection=-1,sendWeaponAnim=0,durationCalls=0,path=str(path))))
if __name__=='__main__':main()
