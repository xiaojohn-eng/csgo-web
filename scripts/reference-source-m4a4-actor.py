"""Independent Python/mathutils matrix samples from original M4 frame arrays."""
from pathlib import Path
import hashlib,importlib.util,json
import numpy as np
from mathutils import Matrix,Quaternion,Vector
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.reference-assets/source-exports'
spec=importlib.util.spec_from_file_location('m4_math',ROOT/'scripts/source-character-animation.py');sdk=importlib.util.module_from_spec(spec);spec.loader.exec_module(sdk)
for team in ['t','ct']:
 folder=BASE/f'character-{team}-m4';data=json.loads((folder/'continuous/pose-data.json').read_text());weapon=json.loads((folder/'weapon-data.json').read_text());sources=json.loads((folder/'continuous/interior-pose-fixtures.json').read_text())
 frames=np.frombuffer((folder/'weapon-frames.f64.bin').read_bytes(),dtype='<f8');anims={d['name']:d for d in weapon['animations']}
 def frame(name,time):
  d=anims[name];p=frames[d['positionsOffset']:d['positionsOffset']+d['positionsCount']].reshape((d['frames'],94,3));q=frames[d['quaternionsOffset']:d['quaternionsOffset']+d['quaternionsCount']].reshape((d['frames'],94,4))
  f=min(max(time*d['fps'],0),d['frames']-1);i=int(f);j=min(i+1,d['frames']-1);t=f-i
  return p[i]*(1-t)+p[j]*t,sdk.blend_quats(q[i],q[j],t)
 def worlds(bones,p,q,override={}):
  out=[]
  for i,b in enumerate(bones):
   x,y,z,w=q[i];local=Matrix.LocRotScale(Vector(p[i]),Quaternion((w,x,y,z)),(1,1,1))
   out.append(override[b['name']].copy()if b['name']in override else out[b['parent']]@local if b['parent']>=0 else local)
  return out
 samples=[]
 for n,s in enumerate(sources['samples']):
  inp=dict(s['input']);seconds=[0,.17,.71,.81,1.2][n%5];inp['fireTimeSeconds']=seconds
  ap=np.array(s['positions']).reshape(-1,3);aq=np.array(s['quaternions']).reshape(-1,4)
  p=np.array([ap[a]if a>=0 else b['position']for b,a in zip(data['mainBones'],data['mainToAnimation'])]);q=np.array([aq[a]if a>=0 else b['quaternion']for b,a in zip(data['mainBones'],data['mainToAnimation'])]);cw=worlds(data['mainBones'],p,q)
  wp,wq=frame('default',0)
  if seconds<=(anims['rifle_fire']['frames']-1)/anims['rifle_fire']['fps']:
   dp,dq=frame('rifle_fire',seconds);weights=np.asarray(anims['rifle_fire']['boneWeights']);active=weights>0
   wq[active]=sdk.multiply(wq[active],sdk.quaternion_scale(dq[active],weights[active]));wp[active]+=dp[active]*weights[active,None]
  ww=worlds(weapon['bones'],wp,sdk.normalize(wq),{b['name']:cw[i]for i,b in enumerate(data['mainBones'])})
  samples.append(dict(input=inp,character=[list(v)for m in cw for v in m],weapon=[list(v)for m in ww for v in m]))
 result=dict(reference='Python original arrays + SDK quaternion_scale/delta/post + mathutils matrices; no glTF joint read as expected pose',samples=samples,
  poseDataSHA256=hashlib.sha256((folder/'continuous/pose-data.json').read_bytes()).hexdigest(),weaponFramesSHA256=hashlib.sha256((folder/'weapon-frames.f64.bin').read_bytes()).hexdigest())
 (folder/'actor-reference.json').write_text(json.dumps(result,separators=(',',':'))+'\n');print('REFERENCE_M4_ACTOR',team,len(samples))
