"""Join native command/VM receipt to original AWP numeric consumers.

The native command receipt owns acceptance/event order; this independent CPU
executes movement, weapon accuracy, accepted recoil and spread for those events.
It is a composition of original consumers, not one uninterrupted engine call.
"""
from pathlib import Path
import importlib.util,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
p=load('awp_joint_handling','probe-source-awp-handling.py');sp=load('awp_joint_spread','probe-source-awp-spread.py')
d=p.d;f=p.f
def main():
 path=ROOT/'output/tests/source-awp-runtime-native.json';raw=path.read_bytes();commands=json.loads(raw)
 ps,items_sha=p.profiles();attrs=ps['awp'];engine=p.AWPAccuracy();spread=sp.AWPSpread()
 engine.tables[int(attrs['recoil seed'])]=p.AWPRecoil().table(attrs)
 initial=dict(penalty=f(.37),recoilIndex=f(3.75),lastShotTime=0,lastUpdateTime=0,angle=[-2.,1.,.1],velocity=[-12.,3.,-1.],viewPunch=[-.2,.04,0.])
 sequences=[];rows=[];bullets=0;mode_counts={0:0,1:0}
 for chain in commands['sequences']:
  state=dict(initial);start=len(rows)
  for index,command in enumerate(commands['cases'][chain['start']:chain['start']+chain['count']]):
   frame=command['context'];now=frame['now'];dt=frame['dt'];phase=index%360
   accuracy=dict(grounded=True,velocitySource=[0,0,0])
   if 40<=phase<80:accuracy.update(walking=True,velocitySource=[70,0,0])
   elif 80<=phase<120:accuracy.update(velocitySource=[190,0,0])
   elif 120<=phase<160:accuracy.update(crouching=True,velocitySource=[25,0,0])
   elif 160<=phase<208:accuracy.update(grounded=False,velocitySource=[75,0,301.993377-(phase-160)*800/64])
   elif 220<=phase<235:accuracy.update(ladder=True,velocitySource=[0,0,80])
   before=dict(state);engine.setup(attrs,state,accuracy,now,dt)
   engine.call(0x712520,[p.a.MOVE]);engine.call(0xba6f20,[p.a.MOVE]);state=engine.state()
   shots=[];operation=frame.get('operation')
   if operation=='deploy':state=engine.deploy(attrs,state,dict(accuracy,mode=command['input'].get('mode',0)),now)
   elif operation!='holster':
    for event in command['command']['events']:
     if event['kind']=='weapon-tick':
      context=dict(accuracy,mode=event['mode'],reloading=event['reloading'])
      engine.setup(attrs,state,context,now,dt);engine.call(0xd42060,[d.W]);state=engine.state()
     elif event['kind']=='bullet':
      mode=event['accuracyMode'];context=dict(accuracy,mode=mode,commandSeed=event['commandSeed'])
      engine.setup(attrs,state,context,now,dt);inaccuracy=engine.call(0xd3ff60,[d.W],True);width=engine.call(0xd3ed90,[d.W],True)
      shot=dict(mode=mode,accuracyMode=mode,recoilMode=event['recoilMode'],inaccuracy=inaccuracy,spread=width,recoilIndex=state['recoilIndex'],punchAngles=[f(f(v)*2)for v in state['angle']])
      if 'serverSeed'in frame:shot['offset']=spread.spread(attrs,mode,frame['serverSeed']&255,inaccuracy,width)
      shots.append(shot);state=engine.fire(attrs,state,context,now);bullets+=1;mode_counts[mode]+=1
     elif event['kind']=='activity'and event['activity']==194:state=engine.reload(attrs,state,dict(accuracy,mode=command['input'].get('mode',0)))['after']
    if command['command']['dispatch']!='inactive':state=dict(state,lastShotTime=command['command']['state']['lastShot'])
   rows.append(dict(commandIndex=chain['start']+index,accuracy=accuracy,before=before,shots=shots,original=state))
  sequences.append(dict(start=start,count=len(rows)-start,initial=initial))
 report=dict(status='original_awp_command_events_composed_with_native_handling',sourceServerSha256=d.SHA,sourceItemsSha256=items_sha,sourceCommandSha256=hashlib.sha256(raw).hexdigest(),sequences=sequences,rows=rows,bullets=bullets,modeCounts=mode_counts,
  limits=['Command/VM original receipt is independently SHA-pinned; numeric functions execute separately in actual event order, not one uninterrupted engine call.','Movement punch once before weapon frame; landing has a separate original oracle.','Original default ConVars and external host libm float ABI adapters; no complete engine/client/render claim.'])
 (ROOT/'output/tests/source-awp-runtime-handling-native.json').write_text(json.dumps(report,separators=(',',':'))+'\n')
 print(json.dumps(dict(status=report['status'],frames=len(rows),bullets=bullets,modeCounts=mode_counts)))
if __name__=='__main__':main()
