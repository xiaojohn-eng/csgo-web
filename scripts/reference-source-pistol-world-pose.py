"""Independent Python Source-frame + SDK math reference for the full pistol aim
wrapper and overlays. The layer ramp follows the separately executed native
consumer; does not call or duplicate the TypeScript sampling implementation.
"""
from pathlib import Path
from types import SimpleNamespace
import copy,hashlib,importlib.util,json
import numpy as np
from mathutils import Matrix,Quaternion,Vector
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.reference-assets/source-exports/pistol-candidates'
spec=importlib.util.spec_from_file_location('pistol_independent_math',ROOT/'scripts/source-character-animation.py');math=importlib.util.module_from_spec(spec);spec.loader.exec_module(math)
f=lambda x:float(np.float32(x))
for weapon in ['glock','usp']:
 folder=BASE/f'{weapon}-world/continuous';raw=(folder/'pose-data.json').read_bytes();d=json.loads(raw);arrays=np.load(folder/'original-frames.npz');frames={a['index']:(arrays[str(a['index'])+'_positions'],arrays[str(a['index'])+'_quaternions'])for a in d['descriptors']};mdl=SimpleNamespace(bones=[SimpleNamespace(position=b['position'],quat=b['quaternion'],parent_id=b['parent'],flags=b['flags'],q_alignment=b['alignment'])for b in d['bones']]);flat=copy.deepcopy(d)
 for s in flat['sequences']:s['autoLayers']=[]
 engine=math.PoseSampler(mdl,flat,frames);wrapper=next(s for s in d['sequences']if s['name']=='pistol_aim_t');names=[d['poseParameters'][l['pose_id']]['name']for l in wrapper['autoLayers']]
 def ramp(physical,p,layer,weight=1):
  normalized=f(f(physical-p['start'])/f(p['end']-p['start']));s=f(f(f(p['end']-p['start'])*normalized)+f(p['start']-layer['peak']));s=min(1,max(0,f(s/f(layer['tail']-layer['peak']))));ss=f(s*s);s=min(1,max(0,f(f(3*ss)-f(f(s+s)*ss))));return f(s*f(weight))
 probes=[]
 for active in range(5):
  for yaw in [-60,0,60]:
   for pitch in [-90,0,90]:probes.append(dict(parameters=dict(body_yaw=yaw,body_pitch=pitch,**{n:1 if i==active else 0 for i,n in enumerate(names)}),layers=[]))
 for i in range(30):
  parameters=dict(body_yaw=-57+(i*17)%115,body_pitch=-87+(i*29)%175,**{n:((i+j*3)%11)/10 for j,n in enumerate(names)})
  sequence=([s['name']for s in d['sequences']if s['name'].startswith(('pistol_fire','pistol_reload','pistol_silencer'))])[i%len([s for s in d['sequences']if s['name'].startswith(('pistol_fire','pistol_reload','pistol_silencer'))])]
  probes.append(dict(parameters=parameters,layers=[dict(sequence=sequence,cycle=(i%13)/12,weight=(i%5)/4)]))
 probes.append(dict(parameters=dict(body_yaw=13,body_pitch=-22,**{n:0 for n in names}),layers=[]))
 probes.append(dict(parameters=dict(body_yaw=13,body_pitch=-22,**{n:1 for n in names}),layers=[]))
 cases=[]
 for probe in probes:
  params=probe['parameters'];pose=engine.calc(engine.named['default'],0,params,'sdk-3way');weights=[]
  for l in wrapper['autoLayers']:
   p=d['poseParameters'][l['pose_id']];weight=ramp(params[p['name']],p,l);weights.append(weight);pose=engine.accumulate(pose,engine.indexed[l['sequence_id']],0,weight,params,'sdk-3way')
  for l in probe['layers']:pose=engine.accumulate(pose,engine.named[l['sequence']],l['cycle'],l['weight'],params,'sdk-3way')
  worlds=[]
  for i,b in enumerate(d['bones']):
   x,y,z,w=pose[1][i];local=Matrix.LocRotScale(Vector(pose[0][i]),Quaternion((w,x,y,z)),(1,1,1));worlds.append(local if b['parent']<0 else worlds[b['parent']]@local)
  cases.append(dict(input=probe,layerWeights=weights,positions=pose[0].tolist(),quaternions=pose[1].tolist(),sourceWorldMatrices=[[list(row)for row in m]for m in worlds]))
 result=dict(sourceDataSHA256=hashlib.sha256(raw).hexdigest(),caseCount=len(cases),cases=cases,boundary='Original decoded NPZ + independent Python PoseSampler and mathutils; layer weights separately anchored to native x86 660-case consumer. Closed AnimState/IK not executed.')
 (folder/'python-reference.json').write_text(json.dumps(result,separators=(',',':'))+'\n');print('PISTOL_WORLD_REFERENCE',weapon,len(cases))
