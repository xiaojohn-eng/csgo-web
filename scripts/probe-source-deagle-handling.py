"""App740 Deagle handling oracle, reusing verified base consumers: actual i386 consumers, isolated Unicorn.
No command acceptance/queue implementation; see probe-source-glock-command.py.
"""
from pathlib import Path
import importlib.util,struct,json,hashlib
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
a=load('pistol_accuracy_base','scripts/probe-source-accuracy.py');r=load('pistol_recoil_base','scripts/probe-source-recoil.py');d=a.d;f=d.f32

def profiles():
 catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text());out={}
 src=next(x for x in catalog['sourceFilesRead']if x['path']=='scripts/items/items_game.txt')
 assert hashlib.sha256((ROOT/'.reference-assets/csgo-legacy/csgo'/src['path']).read_bytes()).hexdigest()==src['sha256']
 for weapon,name in [('deagle','weapon_deagle_prefab')]:
  attrs={}
  def merge(key):
   p=catalog['prefabs'][key]
   for parent in p.get('prefab','').split():merge(parent)
   values=p.get('attributes',{})
   for block in values if isinstance(values,list)else[values]:attrs.update(block)
  merge(name)
  for key,value in list(attrs.items()):
   if isinstance(value,list):
    assert len(set(value))==1,(key,value)
    attrs[key]=value[0]
  assert attrs['is full auto']=='0';out[weapon]=attrs
 return out,src['sha256']

class PistolRecoil(r.NativeRecoil):
 def hook(self,u,at,size,data):
  super().hook(u,at,size,data)
  # Original full-auto attribute consumer yields 0 for these two profiles.
  # Keep original table arithmetic/RNG; do not accidentally apply rifle smoothing.
  if at==0xca2199:self.u.mem_write(d.F-0xe1,b'\0')

class PistolAccuracy(a.NativeAccuracy):
 def __init__(self):
  super().__init__()
  for vt in [0x12f75dc]:
   assert struct.unpack_from('<2I',self.raw,vt+0x738)==(0xd3ff60,0xd42060)
   assert struct.unpack_from('<I',self.raw,vt+0x4fc)[0]==0xd4b7e0
  assert self.raw[0xd424e0:0xd424e6]==bytes.fromhex('8b3d24246d01')
 def setup(self,attrs,state,context,time=0,dt=1/60):
  super().setup(attrs,state,context,time,dt)
  self.u.mem_write(d.T+0xec,b'\0');self.ints(d.T+0xc8,[1])
  self.ints(d.W+0xa6c,[context.get('mode',0)]);self.ints(0x16d2424,[context.get('commandSeed',0)])
 def tick(self,attrs,state,context,time,dt):
  result=super().tick(attrs,state,context,time,dt);result['spread']=self.call(0xd3ed90,[d.W],True);return result
 def fire(self,attrs,state,context,time):
  self.setup(attrs,state,context,time);self.u.reg_write(UC_X86_REG_EBP,d.F);self.u.reg_write(UC_X86_REG_EBX,d.W)
  self.u.reg_write(UC_X86_REG_ESI,d.P);self.u.reg_write(UC_X86_REG_EDI,d.T);self.ints(d.F+0x10,[context.get('mode',0)])
  self.run(0xd4b56f,[0xd4b614]) # full original ApplyRecoil executes, including command seed branch
  self.u.reg_write(UC_X86_REG_EBX,d.W);self.run(0xd43a43,[0xd43a6f])
  return self.state()
 def reload(self,attrs,state,context):
  self.setup(attrs,state,context);before=self.state();self.u.reg_write(UC_X86_REG_EBX,d.W)
  self.run(0xd4cb7f,[0xd4cbb4]);return dict(before=before,after=self.state())
 def queued(self,attrs,state,context,time):
  self.setup(attrs,state,context,time);self.u.reg_write(UC_X86_REG_EBX,d.W);self.u.reg_write(UC_X86_REG_ESI,d.P)
  self.run(0xd49e0a,[0xd49ecd]);return self.state()

def main():
 ps,items_sha=profiles();engine=PistolAccuracy();generator=PistolRecoil();tables={}
 for weapon,attrs in ps.items():
  tables[weapon]=generator.table(attrs);engine.tables[int(attrs['recoil seed'])]=tables[weapon]
 neutral=dict(penalty=0,recoilIndex=0,lastShotTime=0,lastUpdateTime=0,angle=[0,0,0],velocity=[0,0,0],viewPunch=[0,0,0])
 rows=[];shots=[];deploy=[];sequences=[];reloads=[];queued=[]
 for weapon,attrs in ps.items():
  for mode in [0]:
   for grounded in [True,False]:
    for crouching in [False,True]:
     for walking in [False,True]:
      for speed in [0,70,150,240]:
       for vz in ([0]if grounded else [-301.993377,0,301.993377]):
        for index in [0,1.75,3,5,6]:
         context=dict(mode=mode,grounded=grounded,crouching=crouching,walking=walking,velocitySource=[speed*.6,speed*.8,vz])
         before=dict(neutral,penalty=.1,recoilIndex=index,lastShotTime=.9,angle=[-2,1,.1],velocity=[-12,3,-1],viewPunch=[-.2,.04,0])
         rows.append(dict(weapon=weapon,mode=mode,context=context,before=before,time=1.1,dt=1/64,original=engine.tick(attrs,before,context,1.1,1/64)))
   for reloading in [False,True]:
    for dt in [0,1/128,1/60,.1]:
     context=dict(mode=mode,grounded=True,reloading=reloading)
     rows.append(dict(weapon=weapon,mode=mode,context=context,before=dict(neutral,penalty=.07,recoilIndex=4),time=1,dt=dt,original=engine.tick(attrs,dict(neutral,penalty=.07,recoilIndex=4),context,1,dt)))
   for seed in [*range(64),-1,0x7fffffff,-0x80000000,4484,5426]:
    for index in [0,3.75]:
     context=dict(mode=mode,grounded=True,commandSeed=seed);before=dict(neutral,penalty=.037,recoilIndex=index,angle=[-2,1,.1],velocity=[-12,3,-1],viewPunch=[-.2,.04,0])
     shots.append(dict(weapon=weapon,mode=mode,commandSeed=seed,before=before,time=1.25,original=engine.fire(attrs,before,context,1.25)))
     if weapon=='glock18':queued.append(dict(weapon=weapon,mode=mode,commandSeed=seed,before=dict(before,lastShotTime=.7),time=1.25,original=engine.queued(attrs,dict(before,lastShotTime=.7),context,1.25)))
   for elapsed in [0,.01,.1,.3,1]:
    context=dict(mode=mode,grounded=True);before=dict(neutral,penalty=.1,recoilIndex=4,lastUpdateTime=1)
    deploy.append(dict(weapon=weapon,mode=mode,before=before,context=context,time=1+elapsed,original=engine.deploy(attrs,before,context,1+elapsed)))
   for index in [0,.5,3.75,63,16777216]:
    before=dict(neutral,penalty=.037,recoilIndex=index,lastShotTime=.7,lastUpdateTime=.9,angle=[-2,1,.1],velocity=[-12,3,-1],viewPunch=[-.2,.04,0]);result=engine.reload(attrs,before,dict(mode=mode,grounded=True))
    reloads.append(dict(weapon=weapon,mode=mode,before=result['before'],original=result['after']))
   # One complete continuous native chain per weapon/mode. All clocks external.
   state=dict(neutral);frames=[]
   for tick in range(480):
    time=f(tick/64);dt=1/64;context=dict(mode=mode,grounded=True,velocitySource=[0,0,0]);label='idle'
    if 32<=tick<80:context.update(walking=True,velocitySource=[110,0,0]);label='walking'
    elif 80<=tick<128:context.update(velocitySource=[240,0,0]);label='running'
    elif 128<=tick<176:context.update(crouching=True,velocitySource=[50,0,0]);label='crouching'
    elif 176<=tick<224:context.update(grounded=False,velocitySource=[120,0,301.993377-(tick-176)*800/64]);label='air'
    elif 224<=tick<280:label='recovery'
    elif 280<=tick<310:context.update(reloading=True);label='reload'
    original=engine.tick(attrs,state,context,time,dt);state=original['state'];shot=None
    if tick in [16,30,44,58,90,105,145,165,190,210,315,329,343]:
     seed=((tick*104729)^4484)&0x7fffffff;context['commandSeed']=seed
     shot=dict(commandSeed=seed,inaccuracy=original['inaccuracy'],spread=original['spread'],before=state)
     state=engine.fire(attrs,state,context,time)
    frames.append(dict(tick=tick,time=time,dt=dt,context=context,label=label,shot=shot,original=state,inaccuracy=original['inaccuracy'],spread=original['spread']))
   sequences.append(dict(weapon=weapon,mode=mode,initial=neutral,frames=frames))
 report=dict(status='original_deagle_accuracy_recoil_punch_executed',sourceServerSha256=d.SHA,sourceItemsSha256=items_sha,sourceVstdlibSha256=r.s.VSHA,
  profiles=ps,tables=tables,rows=rows,shots=shots,deploy=deploy,sequences=sequences,reloads=reloads,queued=queued,
  functions=dict(accuracy='0xd3ff60',update='0xd42060',recovery='0xd41e70',spread='0xd3ed90',recoil='0xd42490',lookup='0xca30e0',table=['0xca2199','0xca23d0'],acceptedState=['0xd4b56f','0xd4b614']),
  limits=['Accuracy/accepted-state consumers, not command acceptance/burst queue.', 'Ordinary Deagle mode0 only; no alternate weapon mode exposed.', 'Semi-auto recoil uses prediction command seed &63, not recoilIndex or server bullet seed.', 'Ordinary default ConVars; ExoJump/turning modifiers excluded.', 'External expf/sincosf use host libm rounded f32; no complete glibc ulp claim.'])
 (ROOT/'output/tests/source-deagle-handling-native.json').write_text(json.dumps(report,separators=(',',':'))+'\n')
 print(json.dumps(dict(status=report['status'],ticks=len(rows),shots=len(shots),deploy=len(deploy),reloads=len(reloads),continuousTicks=sum(len(s['frames'])for s in sequences))))
if __name__=='__main__':main()
