"""Compose independently executed original command events and math consumers.
The command corpus is immutable input; no TypeScript implementation generates
its events or the numerical expectations. This is not a whole-engine run.
"""
from pathlib import Path
import importlib.util,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('pistol',ROOT/'scripts/probe-source-pistol-handling.py');p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
def main():
 source=ROOT/'output/tests/source-glock-command-native.json';raw=source.read_bytes();cmd=json.loads(raw);assert cmd['serverSha256']==p.d.SHA
 ps,_=p.profiles();attrs=ps['glock18'];engine=p.PistolAccuracy();engine.tables[4484]=p.PistolRecoil().table(attrs)
 neutral=dict(penalty=0,recoilIndex=0,lastShotTime=0,lastUpdateTime=0,angle=[0,0,0],velocity=[0,0,0],viewPunch=[0,0,0])
 def frame(index,before):
  row=cmd['cases'][index];ctx=row['context'];mode=row['input'].get('mode',0);time=ctx['now'];dt=ctx['dt']
  motion=[dict(grounded=True),dict(grounded=True,walking=True,velocitySource=[110,0,0]),dict(grounded=True,velocitySource=[240,0,0]),dict(grounded=True,crouching=True,velocitySource=[50,0,0]),dict(grounded=False,velocitySource=[120,0,220])][index%5]
  engine.setup(attrs,before,dict(motion,mode=mode),time,dt);before=engine.state();engine.call(0x712520,[p.a.MOVE]);engine.call(0xba6f20,[p.a.MOVE]);current=engine.state();events=[]
  for event in row['result']['events']:
   if event['kind']=='weapon-tick':
    mode=event['mode'];engine.setup(attrs,current,dict(motion,mode=mode,reloading=event['reloading']),time,dt);engine.call(0xd42060,[p.d.W]);current=engine.state();events.append(dict(event=event,original=current))
   elif event['kind']=='bullet':
    mode=event['accuracyMode'];c=dict(motion,mode=mode,commandSeed=event['commandSeed']);engine.setup(attrs,current,c,time,dt)
    shot=dict(inaccuracy=engine.call(0xd3ff60,[p.d.W],True),spread=engine.call(0xd3ed90,[p.d.W],True),recoilIndex=current['recoilIndex'])
    current=engine.queued(attrs,current,c,time)if event['source']=='queued'else engine.fire(attrs,current,c,time)
    events.append(dict(event=event,original=current,shot=shot))
   elif event['kind']=='activity'and event['activity']==194:
    current=engine.reload(attrs,current,dict(motion,mode=mode))['after'];events.append(dict(event=event,original=current))
  # The independent ORIGINAL command result owns this timestamp, including dry fire.
  current=dict(current,lastShotTime=p.f(row['result']['state']['lastShot']))
  return dict(caseIndex=index,commandLabel=row['label'],time=time,dt=dt,modeBefore=row['input'].get('mode',0),before=before,motion=motion,events=events,finalMode=row['result']['state']['mode'],original=current)
 independent=[];chains=[]
 for i,row in enumerate(cmd['cases']):
  if row['context'].get('operation','frame')!='frame':continue
  independent.append(frame(i,dict(neutral,penalty=.037,recoilIndex=2.75,lastShotTime=row['input'].get('lastShot',0),angle=[-2,1,.1],velocity=[-12,3,-1],viewPunch=[-.2,.04,0])))
 for seq in cmd['sequences']:
  if seq['label']!='burst-held-release':continue
  frames=[];state=dict(neutral)
  for i in range(seq['start'],seq['start']+seq['count']):
   item=frame(i,state);state=item['original'];frames.append(item)
  chains.append(dict(initialClip=seq['initialClip'],frames=frames))
 out=dict(status='original_command_events_composed_with_original_pistol_consumers',serverSha256=p.d.SHA,commandCorpusSha256=hashlib.sha256(raw).hexdigest(),independent=independent,chains=chains,
  limits=['Command branch trace and each numerical consumer execute in separate isolated original-code runs; not a single whole-engine oracle.', 'Player pose/movement context is supplied explicitly; no browser/physics/network claim.', 'Weapon-tick ordering is native queued before accuracy; the later primary gate still checks the Player latch, not an automatically accepted shot.', 'Original command result supplies primary notification time including dry fire; queued math never writes it.'])
 (ROOT/'output/tests/source-glock-handling-chain-native.json').write_text(json.dumps(out,separators=(',',':'))+'\n');print(json.dumps(dict(status=out['status'],independent=len(independent),chainFrames=sum(len(c['frames'])for c in chains))))
if __name__=='__main__':main()
