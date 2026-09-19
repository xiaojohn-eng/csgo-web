"""Bounded original App740 Glock command execution; no game process/account.
Ownership/info/attribute lookup, animation, audio, bullet transport and network
notifications are explicit adapters. Original command branches and time/ammo
stores execute native i386 bytes, including the actual attribute math consumer.
"""
from pathlib import Path
import importlib.util,json,struct,hashlib
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
d=load('damage','scripts/probe-source-damage.py');discover=load('glock_discovery','scripts/inspect-source-glock-command.py')
VT=d.T+0x1000;PVT=d.T+0x2000;GLOBALS=d.T+0x4000;ECON=d.T+0x6000;MANAGER=ECON+0x100;DEFINITION=ECON+0x200;VALUE=ECON+0x300;ATTR=ECON+0x304
GETINFO=d.STOP+0x100;NOOP=d.STOP+0x110;GETECON=d.STOP+0x120;GETMANAGER=d.STOP+0x130;APPLY=d.STOP+0x140;FLOAT=d.STOP+0x200;MATH=d.STOP+0x300;MAXCLIP=d.STOP+0x380;ZERO=d.STOP+0x390;ONE=d.STOP+0x3a0
fields={'clip':0x974,'nextPrimary':0x948,'nextSecondary':0x94c,'burstRemaining':0xb04,'nextBurst':0xb08,'mode':0xa6c,'lastShot':0xaec,'dryFireCount':0x960}
class NativeGlock(d.OriginalDamage):
 def __init__(self):
  super().__init__();self.events=[];self.attributeCalls=[];self.reserve=120;self.active=True;self.freeze=False
  catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text());self.attrs={}
  source=next(x for x in catalog['sourceFilesRead']if x['path']=='scripts/items/items_game.txt');self.itemsSha=source['sha256']
  assert hashlib.sha256((ROOT/'.reference-assets/csgo-legacy/csgo'/source['path']).read_bytes()).hexdigest()==self.itemsSha
  def merge(key):
   p=catalog['prefabs'][key]
   for parent in p.get('prefab','').split():merge(parent)
   values=p.get('attributes',{})
   for block in values if isinstance(values,list)else[values]:self.attrs.update(block)
  merge('weapon_glock_prefab')
  for name,value in [('cycletime',.15),('is full auto',0),('has burst mode',1),('primary clip size',20),('cycletime when in burst mode',.5),('time between burst shots',.05)]:assert float(self.attrs[name])==value
  self.u.mem_write(FLOAT,b'\xd9\x05'+struct.pack('<I',VALUE)+b'\xc3')
  # The original a21c30 function receives definition:EAX, value pointer:EDX,
  # attribute:XMM0, dispatches actual description-format enum and stores SSE f32.
  code=b'\xb8'+struct.pack('<I',DEFINITION)+b'\xba'+struct.pack('<I',VALUE)+b'\xf3\x0f\x10\x05'+struct.pack('<I',ATTR)
  code+=b'\xe8'+struct.pack('<i',0xa21c30-(MATH+len(code)+5))+b'\xd9\x05'+struct.pack('<I',VALUE)+b'\xc3';self.u.mem_write(MATH,code)
  assert discover.word(0x12ec7ac-4)==0x12e7480
  assert [discover.word(0x12ec7ac+i)for i in [0x4ac,0x4b0,0x4d0,0x4f8,0x4fc,0x500]]==[0xd4d5c0,0xd4cc60,0xd4ac70,0xd4ca70,0xd4b7e0,0xd4bd20]
  assert discover.word(0x1721040+2*4)==discover.va(self.raw.index(b'value_is_additive\0'))
  assert discover.word(0x1721040+12*4)==discover.va(self.raw.index(b'value_is_replace\0'))
  assert discover.word(0x12768bc+2*4)==0xa21c70 and discover.word(0x12768bc+12*4)==0xa21c5a
 def ret(self,v=0):
  sp=self.u.reg_read(UC_X86_REG_ESP);self.u.reg_write(UC_X86_REG_EAX,v);self.u.reg_write(UC_X86_REG_EIP,self.uint(sp));self.u.reg_write(UC_X86_REG_ESP,sp+4)
 def floatret(self,v):self.floats(VALUE,[v]);self.u.reg_write(UC_X86_REG_EIP,FLOAT)
 def hook(self,u,at,size,data):
  super().hook(u,at,size,data)
  if at in self.stops:return
  sp=u.reg_read(UC_X86_REG_ESP)
  if at in [0xd49b70,0xd4b1f0]:self.shotSource='queued' if at==0xd49b70 else 'primary'
  if at==0xd42060:self.events.append(dict(kind='weapon-tick',mode=self.uint(d.W+0xa6c),reloading=bool(u.mem_read(d.W+0x9c1,1)[0])))
  if at in [0x4f56c0,0x5dba30,0xd42060,0xd42490,0xd476a0,0x7cbc30,0x7cbb90,0x5d62c0,0x7cb6b0,0x61d750,0x5d5e00,NOOP,0xd41d60,0xd426f0,0x5d8e80,0x6060d0,0x5d9950,0x5d8c90,0x5d7f10,0x7c43d0,0xd3f310,0xe78280,0x5b5580]:self.ret()
  elif at in [0xd3fed0,0x5d79d0]:self.ret(d.P if self.active else 0)
  elif at==0x5b29a0:self.floatret(self.holsterDuration if self.operation=='holster' else self.context.get('drawDuration',d.f32(33/30)) if self.operation=='deploy' else self.reloadDuration)
  elif at==0x61d9c0:self.ret()
  elif at==GETINFO:self.ret(d.T)
  elif at in [0x5dba40,GETECON]:self.ret(ECON)
  elif at==GETMANAGER:self.ret(MANAGER)
  elif at==MAXCLIP:self.ret(20)
  elif at==ZERO:self.ret(0)
  elif at==ONE:self.ret(1)
  elif at in [0xd3ed90,0xd3ff60]:self.floatret(0)
  elif at==0xbb8ef0:self.ret(int(self.freeze))
  elif at==0x5dba80:self.ret(self.reserve if self.uint(sp+8)==1 else 0)
  elif at==0x5dc3e0:self.reserve+=struct.unpack('<i',u.mem_read(sp+12,4))[0];self.ret()
  elif at==0x71fe70:self.ints(self.uint(sp+4),[self.uint(sp+8)]);self.ret()
  elif self.external.get(at+1)=='__dynamic_cast':u.reg_write(UC_X86_REG_EAX,ECON);u.reg_write(UC_X86_REG_EIP,at+5)
  elif at==APPLY:
   key=self.uint(sp+16);name=self.raw[key:self.raw.index(0,key)].decode();initial=self.read(sp+8);value,fmt={'time_between_burst_shots':(.05,2),'cycletime_when_in_burst_mode':(.5,12)}[name]
   self.attributeCalls.append(dict(name=name,input=initial,attribute=d.f32(value),formatEnum=fmt));self.ints(DEFINITION+0x20,[fmt]);self.floats(VALUE,[initial]);self.floats(ATTR,[value]);u.reg_write(UC_X86_REG_EIP,MATH)
  elif at==0xd43530:self.events.append(dict(kind='activity',activity=self.uint(sp+8)));self.ints(d.W+0x9b0,[self.uint(sp+8)]);self.ret(1)
  elif at==0xd3fd80:self.events.append(dict(kind='empty'));self.ret(1)
  elif at==0xcb4bc0:self.events.append(dict(kind='bullet',source=self.shotSource,mode=self.uint(sp+24),accuracyMode=self.uint(d.W+0xa6c),recoilMode=1 if self.shotSource=='queued'else self.uint(d.W+0xa6c),scheduledTime=self.read(sp+44),queue=self.uint(d.W+0xb04),commandSeed=self.context.get('commandSeed',0),**({'serverSeed':self.context['serverSeed']}if 'serverSeed'in self.context else {})));self.ret()
  elif at==0xc18c20:self.events.append(dict(kind='mode-message',message=self.raw[self.uint(sp+8):self.raw.index(0,self.uint(sp+8))].decode()));self.ret()
  elif at==0x866940:self.events.append(dict(kind='sound',name=self.raw[self.uint(sp+8):self.raw.index(0,self.uint(sp+8))].decode()));self.ret()
  elif at==0xd4419a:
   # Ordinary mode: skip the separate game-mode auto-drop event predicate.
   # Continue ORIGINAL empty-clip auto-reload conditions below.
   u.reg_write(UC_X86_REG_EIP,0xd441b3)
  elif at==0xd440fa:u.reg_write(UC_X86_REG_EIP,0xd440e3)
  elif at==0xd43921:u.reg_write(UC_X86_REG_EIP,0xd43a37) # game-event emission only
  elif at==0xd44ec0:u.reg_write(UC_X86_REG_EIP,0xd44e29) # accuracy decay has separate native oracle
 def setup(self,state,context):
  self.reset();self.context=context;self.events=[];self.attributeCalls=[];self.reserve=state.get('reserve',120);self.active=context.get('owner',True);self.freeze=context.get('rulePredicateBlock',False);self.reloadDuration=context.get('reloadDuration',d.f32(68/30));self.holsterDuration=context.get('holsterDuration',0);self.operation=context.get('operation','frame')
  self.u.mem_write(VT,self.raw[0x12ec7ac:0x12ec7ac+0x750]);self.ints(d.W,[VT]);self.u.mem_write(PVT,self.raw[0x12be8d4:0x12be8d4+0x900]);self.ints(d.P,[PVT]);
  for off,fn in [(0x704,GETINFO),(0x59c,MAXCLIP),(0x5a0,ZERO),(0x5d8,ONE),(0x5dc,ZERO),(0x48c,NOOP),(0x4dc,NOOP),(0x5bc,ONE if context.get('noAutoReload',False) else ZERO),(0x4b8,NOOP),(0x510,ZERO),(0x590,ZERO),(0x594,ZERO)]:self.ints(VT+off,[fn])
  for off in [0x548,0x688,0x48c,0x15c]:self.ints(PVT+off,[NOOP])
  self.ints(ECON,[ECON+0x40]);self.ints(ECON+0x40,[GETMANAGER]);self.ints(MANAGER,[MANAGER+0x40]);self.ints(MANAGER+0x40+0x34,[APPLY])
  self.ints(0x18a54bc,[ECON+0x400]);self.ints(ECON+0x400,[ECON+0x440]);self.ints(ECON+0x440+0x84,[NOOP]);self.ints(ECON+0x440+0x88,[NOOP]);self.ints(d.W+0x4d8,[d.T+0x800]);self.ints(d.T+0x800,[1]);self.ints(d.W+0x9ac,[194]);
  # Original info parser c9b156..c9b197: +124 is has-silencer, NOT bullets.
  # +23d is is-revolver (c9cbcf..c9cc0b); Glock has neither flag.
  self.ints(d.T+0xc8,[1]);self.ints(d.T+0x124,[int(self.attrs['has silencer'])]);self.u.mem_write(d.T+0xec,b'\0');self.u.mem_write(d.T+0x23c,b'\x01\x00\x00');self.floats(d.T+0xdc,[float(self.attrs['cycletime']),float(self.attrs['cycletime alt']),2])
  self.ints(0x178610c,[GLOBALS]);self.floats(GLOBALS+0x10,[context.get('now',10)]);self.floats(GLOBALS+0x20,[context.get('dt',1/64)])
  self.ints(0x1879c5c,[0x1879c40]);self.ints(0x1879c70,[0x1879c40]) # verified weapon_accuracy_reset_on_deploy=0
  self.ints(d.W+0x978,[-1]);self.u.mem_write(d.W+0xa9c,bytes([int(state.get('burstMode',False))]));self.u.mem_write(d.W+0x9c1,bytes([int(state.get('reloading',False))]));self.u.mem_write(d.W+0x9c2,bytes([int(state.get('fireOnEmpty',False))]));
  for name,off in fields.items():
   if name in ['clip','burstRemaining','mode','dryFireCount']:self.ints(d.W+off,[state.get(name,20 if name=='clip'else 0)])
   else:self.floats(d.W+off,[state.get(name,0)])
  self.ints(d.P+0x2b7c,[state.get('shotsFired',0)]);self.floats(d.P+0x6e4,[state.get('ownerNextAttack',0)]);self.ints(d.P+0xcb4,[context.get('buttons',0)]);self.u.mem_write(d.P+0x16ab,bytes([context.get('playerBlocked',False)]));self.ints(d.P+0x15a0,[context.get('playerBlockingField15a0',0)]);self.u.mem_write(d.P+0x2c70,bytes([state.get('waitForNoAttack',False)]));self.u.mem_write(d.W+0xaa4,bytes([state.get('reloadVisComplete',False)]))
 def state(self):
  r={name:(self.uint(d.W+off)if name in ['clip','burstRemaining','mode','dryFireCount']else self.read(d.W+off))for name,off in fields.items()}
  r.update(burstMode=bool(self.u.mem_read(d.W+0xa9c,1)[0]),reloading=bool(self.u.mem_read(d.W+0x9c1,1)[0]),fireOnEmpty=bool(self.u.mem_read(d.W+0x9c2,1)[0]),shotsFired=self.uint(d.P+0x2b7c),reserve=self.reserve,ownerNextAttack=self.read(d.P+0x6e4),waitForNoAttack=bool(self.u.mem_read(d.P+0x2c70,1)[0]),reloadVisComplete=bool(self.u.mem_read(d.W+0xaa4,1)[0]));return r
 def call(self,fn,args):
  self.ints(d.F,[d.STOP,*args]);self.u.reg_write(UC_X86_REG_ESP,d.F);self.run(fn,[d.STOP]);return self.u.reg_read(UC_X86_REG_EAX)
 def frame(self,state,context):
  self.setup(state,context);dispatch='inactive'
  if self.operation=='holster':self.call(0xd4cc60,[d.W,0]);dispatch='holster'
  elif self.operation=='deploy':self.call(0xd4d5c0,[d.W]);dispatch='deploy'
  elif self.operation=='deploy-prefix':
   self.ints(d.F,[d.STOP,d.W]);self.u.reg_write(UC_X86_REG_ESP,d.F);self.run(0xd4d5c0,[0xd4d610]);dispatch='deploy-prefix'
  elif context.get('active',True) and self.active:
   self.u.reg_write(UC_X86_REG_EBX,d.P)
   end=self.run(0x61bf19,[0x61bf30,0x61c1b0]);dispatch='busy' if end==0x61bf30 else 'post'
   self.call(0xd4aaf0 if dispatch=='busy' else 0xd4ac70,[d.W])
  return dict(state=self.state(),events=self.events,attributes=self.attributeCalls,dispatch=dispatch,buttonsAfter=self.uint(d.P+0xcb4))
def main():
 engine=NativeGlock();rows=[];sequences=[];visited=set()
 def case(label,state,ctx):
  ctx={**dict(now=10,dt=1/64,buttons=0,commandSeed=123456,serverSeed=987654,reloadDuration=d.f32(68/30)),**ctx}
  try:result=engine.frame(state,ctx)
  except Exception:print(label,state,ctx,[hex(x)for x in engine.trace[-30:]],flush=True);raise
  visited.update(engine.trace);rows.append(dict(label=label,input=state,context=ctx,result=result));return result['state']
 # Exact f32 neighbours, not decimal epsilon guesses.
 near=lambda x,k:struct.unpack('<f',struct.pack('<I',struct.unpack('<I',struct.pack('<f',x))[0]+k))[0]
 for mode in [False,True]:
  for clip in [0,1,2,3,19,20]:
   for buttons in [0,1,2048,8192,2049,8193,10240]:
    for offset in [-1,0,1]:
     case('button-clock-boundary',dict(clip=clip,burstMode=mode,mode=int(mode),nextPrimary=near(10,offset),nextSecondary=near(10,offset)),{'buttons':buttons})
 for mode in [False,True]:
  for queue in [1,2]:
   for clip in [0,1,2,3]:
    for at in [near(10,-1),10,near(10,1),8.5]:
     for buttons in [0,1,2048,8192]:case('queued-priority',dict(clip=clip,burstMode=mode,mode=int(mode),burstRemaining=queue,nextBurst=at),{'buttons':buttons})
 for blocked in ['rulePredicateBlock','playerBlocked','playerBlockingField15a0']:
  for clip in [0,1,20]:
   for buttons in [0,1,2048,8192,8193]:case('external-primary-gate',dict(clip=clip),{blocked:1 if blocked=='playerBlockingField15a0'else True,'buttons':buttons})
 for shots in [0,1,3]:
  for wait in [False,True]:
   for buttons in [0,1,2048,8192]:
    for at in [near(10,-1),10,near(10,1)]:case('owner-busy-latch',dict(clip=3,shotsFired=shots,waitForNoAttack=wait,ownerNextAttack=at,burstRemaining=2,nextBurst=8),{'buttons':buttons})
 for reserve in [0,1,5,120]:
  for clip in [0,1,19,20]:
   for buttons in [0,1,2048,8192]:
    for at in [near(10,-1),10,near(10,1)]:case('reload-completion',dict(clip=clip,reserve=reserve,reloading=True,ownerNextAttack=at,nextPrimary=at,nextSecondary=at),{'buttons':buttons})
 for age in [0,1/128,1/64,near(1/64,1),1]:case('primary-drift-base',dict(nextPrimary=10-age),{'buttons':1})
 for clip in [0,3]:
  for reserve in [0,120]:case('no-auto-reload',dict(clip=clip,reserve=reserve),{'noAutoReload':True})
 for active in [False,True]:
  for owner in [False,True]:case('ownership',dict(burstRemaining=2,nextBurst=8),{'active':active,'owner':owner,'buttons':1})
 for reload in [False,True]:
  for complete in [False,True]:
   for duration in [0,.3]:
    case('holster-preserves-queue',dict(reloading=reload,reloadVisComplete=complete,nextPrimary=12,nextSecondary=13,ownerNextAttack=14,burstRemaining=2,nextBurst=10.1),{'operation':'holster','holsterDuration':duration})
 for queue in [0,1,2]:case('deploy-prefix-clears-queue',dict(burstRemaining=queue,nextBurst=12,nextPrimary=13,nextSecondary=14,burstMode=True,mode=1),{'operation':'deploy-prefix'})
 for clip in [0,3,20]:
  for buttons in [0,1,8192]:case('reload-clears-visual-completion',dict(clip=clip,reloadVisComplete=True),{'buttons':buttons})
 for owner in [False,True]:
  for mode in [False,True]:
   for duration in [0,.4,d.f32(33/30)]:
    for clock in [0,10,14]:
     case('full-ordinary-deploy',dict(burstRemaining=2,nextBurst=9,shotsFired=3,nextPrimary=clock,nextSecondary=clock+1,burstMode=mode,mode=int(mode)),{'owner':owner,'operation':'deploy','drawDuration':duration})
 # Native state is chained, including delayed frames, release, reload and switch.
 for clip in [0,1,2,20]:
  start=len(rows);state=dict(clip=clip,burstMode=True,mode=1)
  for i in range(100):
   now=d.f32(10+i/64);buttons=1 if i<45 else (8192 if i==60 else 0)
   state=case('continuous-burst-held-release',state,{'now':now,'buttons':buttons,'commandSeed':i+1000,'serverSeed':i+9000})
  sequences.append(dict(label='burst-held-release',initialClip=clip,start=start,count=len(rows)-start))
 start=len(rows);state=case('burst-switch',dict(burstMode=True,mode=1),{'buttons':1})
 state=case('burst-switch',state,{'now':10.02,'operation':'holster'})
 state=case('burst-switch',state,{'now':11,'active':False})
 state=case('burst-switch',state,{'now':11.1,'operation':'deploy'})
 sequences.append(dict(label='holster-inactive-redeploy',start=start,count=len(rows)-start))
 critical=[0xa21c30,0xa21c70,0xa21c5a,0x61bf19,0x61bf30,0x61c1b0,0xd4ac70,0xd49b70,0xd4440b,0xd43820,0xd4b7e0,0xd4b1f0,0xd41980,0xd4bd20,0xd44310,0xd4ca70,0x5dbd22,0xd4cc60,0x5d9e34,0xd4d5c0,0xd406b0,0xd40818,0xd40828,0xd4d6db]
 assert all(x in visited for x in critical),list(map(hex,set(critical)-visited))
 report=dict(schema='source-glock-command-native-v1',serverSha256=discover.SHA,itemsSha256=engine.itemsSha,caseCount=len(rows),criticalExecuted=list(map(hex,critical)),sequences=sequences,
  boundaries=['Ordinary active owned Glock; other Player vehicle/use gates supplied externally.',
   'No economy lookups: SHA-verified default prefab profile and attribute name lookup adapters; attribute arithmetic executes original a21c30.',
   'Model selection/SequenceDuration supplied from separately decoded original default MDL; no duration-derived fire cooldown.',
   'No bullet tracing, accuracy/recoil math, game event transport, model caches, idle/inspect processing, unusual game-mode auto-drop, special attack buttons.',
   'Holster/Deploy selected duration adapters; ordinary non-heavy-armour playbackRate1; full accuracy decay excluded.',
   'commandSeed/serverSeed are current command transport metadata; native recoil seed consumer verified separately by pistol handling oracle.'],cases=rows)
 out=ROOT/'output/tests/source-glock-command-native.json';out.write_text(json.dumps(report,separators=(',',':'))+'\n');print(json.dumps(dict(cases=len(rows),criticalExecuted=len(critical),file=str(out))),flush=True)
if __name__=='__main__':main()
