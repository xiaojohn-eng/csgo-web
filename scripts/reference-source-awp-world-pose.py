"""Independent original AWP frames and Python/mathutils sequence references."""
from pathlib import Path
from types import SimpleNamespace
import hashlib,importlib.util,json
import numpy as np
from mathutils import Matrix,Quaternion,Vector
ROOT=Path(__file__).resolve().parents[1];folder=ROOT/'.reference-assets/source-exports/awp-candidates/awp-world/continuous'
raw=(folder/'pose-data.json').read_bytes();data=json.loads(raw);arrays=np.load(folder/'original-frames.npz')
spec=importlib.util.spec_from_file_location('awp_independent_math',ROOT/'scripts/source-character-animation.py');math=importlib.util.module_from_spec(spec);spec.loader.exec_module(math)
frames={a['index']:(arrays[str(a['index'])+'_positions'],arrays[str(a['index'])+'_quaternions'])for a in data['descriptors']}
mdl=SimpleNamespace(bones=[SimpleNamespace(position=b['position'],quat=b['quaternion'],parent_id=b['parent'],flags=b['flags'],q_alignment=b['alignment'])for b in data['bones']])
engine=math.PoseSampler(mdl,data,frames);cases=[];original={}
for sequence in data['sequences']:
 assert len(sequence['animationIndices'])==1 and not sequence['autoLayers']
 descriptor=next(a for a in data['descriptors']if a['index']==sequence['animationIndices'][0]);p,q=frames[descriptor['index']]
 original[sequence['name']]=dict(fps=descriptor['fps'],frames=descriptor['frames'],positions=p.tolist(),quaternionsXYZW=q.tolist())
 for cycle in [0,.1,.25,.5,.75,1]:
  pose=engine.calc(engine.named[sequence['name']],cycle,{},'sdk-3way');worlds=[]
  for i,b in enumerate(data['bones']):
   x,y,z,w=pose[1][i];local=Matrix.LocRotScale(Vector(pose[0][i]),Quaternion((w,x,y,z)),(1,1,1));worlds.append(local if b['parent']<0 else worlds[b['parent']]@local)
  cases.append(dict(input=dict(sequence=sequence['name'],cycle=cycle),positions=pose[0].tolist(),quaternions=pose[1].tolist(),sourceWorldMatrices=[[list(row)for row in m]for m in worlds]))
(folder/'original-frames.json').write_text(json.dumps(original,separators=(',',':'))+'\n')
result=dict(sourceDataSHA256=hashlib.sha256(raw).hexdigest(),caseCount=len(cases),cases=cases,boundary='Original decoded NPZ + independent Python PoseSampler and mathutils. No character graph or optics claim.')
(folder/'python-reference.json').write_text(json.dumps(result,separators=(',',':'))+'\n');print('AWP_WORLD_REFERENCE',len(cases),sum(v['frames']for v in original.values()))
