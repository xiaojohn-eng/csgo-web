"""Measure, node by node, how the frozen exporter wrote a rifle's fire clip.

The append step has to produce tracks the runtime reads the same way as the ones
already shipped, so rather than assume the exporter's bone convention this solves
it from the clip that already shipped, per node, and reports the residual of each
candidate relation. Nothing is written except this report.

Run: blender --background --factory-startup --python this_file.py
"""
from pathlib import Path
import json,struct,sys
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
EXPORTS=ROOT/'.reference-assets/source-exports'
data=json.loads((EXPORTS/'rifle-fire-variants-audit/audit.json').read_text())
npz=np.load(EXPORTS/'rifle-fire-variants-audit/rifle-fire-variant-frames.npz')
WEAPONS={w['weapon']:w for w in data['weapons']}
CASE=dict(asset='ak47-draw',weapon='vandal',gunJoints=58,clip='fire__ak47_fire1',sequence='ak47_fire1')

def split_glb(payload):
 length,kind=struct.unpack_from('<II',payload,12);doc=json.loads(payload[20:20+length]);blen,_=struct.unpack_from('<II',payload,20+length)
 return doc,payload[28+length:]
def accessor(doc,binary,index):
 a=doc['accessors'][index];view=doc['bufferViews'][a['bufferView']];width={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']]
 stride=view.get('byteStride')or width*4;start=view.get('byteOffset',0)+a.get('byteOffset',0)
 return np.stack([np.frombuffer(binary,dtype='<f4',count=width,offset=start+i*stride).copy()for i in range(a['count'])])
def clip_channels(doc,binary,name):
 animation=next(a for a in doc['animations']if a.get('name')==name)
 return {(c['target']['node'],c['target']['path']):accessor(doc,binary,animation['samplers'][c['sampler']]['output'])for c in animation['channels']}
def mul(a,b):
 v=a[3]*b[:3]+b[3]*a[:3]+np.cross(a[:3],b[:3]);return np.r_[v,a[3]*b[3]-np.dot(a[:3],b[:3])]
def inverse(q):return np.r_[-np.asarray(q[:3]),q[3]]
def rotmat(q):
 x,y,z,w=q;v=np.asarray(q[:3]);return(w*w-np.dot(v,v))*np.eye(3)+2*np.outer(v,v)+2*w*np.array([[0,-z,y],[z,0,-x],[-y,x,0]])
def angles(q):
 q=np.asarray(q,dtype=np.float64);q=q/np.linalg.norm(q);return np.degrees(2*np.arccos(min(1.0,abs(q[3]))))
def quat_error(a,b):
 return float(np.minimum(np.abs(a-b),np.abs(a+b)).max())
def relative(a,b):
 """Both relations that carry the source key onto the shipped one."""
 return mul(b,inverse(a)),mul(inverse(a),b)

doc,binary=split_glb((ROOT/'public/source/csgo-12426148'/CASE['asset']/'viewmodel.glb').read_bytes())
channels=clip_channels(doc,binary,CASE['clip'])
gun=WEAPONS[CASE['weapon']];frames=npz[CASE['weapon']+'_'+CASE['sequence']+'_quaternions'].astype(np.float64)
frames/=np.linalg.norm(frames,axis=-1,keepdims=True)
# Child-node local rotations follow from the source locals and their parents, exactly
# as the shipped clip's own parents chain them; the root is the only converted one.
children={}
for i,b in enumerate(gun['bones']):children.setdefault(b['parent'],[]).append(i)
gun_skin=next(s for s in doc['skins']if len(s['joints'])==CASE['gunJoints'])
gun_nodes={doc['nodes'][n]['name']:n for n in gun_skin['joints']}
arms=[s for s in doc['skins']if len(s['joints'])==48][0]
arm_nodes={doc['nodes'][n]['name']:n for n in arms['joints']}
rows=[]
for i,b in enumerate(gun['bones']):
 node=gun_nodes[b['name']];mine=frames[:,i]
 shipped=np.asarray(channels[(node,'rotation')],dtype=np.float64)
 pre=np.array([mul(s,inverse(m))for s,m in zip(shipped,mine)]);post=np.array([mul(m,inverse(s))for s,m in zip(shipped,mine)])
 pre*=np.where(pre[:,3:]<0,-1.0,1.0);post*=np.where(post[:,3:]<0,-1.0,1.0)
 pre_mean=pre.mean(axis=0);post_mean=post.mean(axis=0)
 rows.append(dict(role='weapon',name=b['name'],parent=b['parent'],
   preConstant=round(float(pre.std(axis=0).max()),9),preResidual=round(quat_error(np.array([mul(pre_mean,m)for m in mine]),shipped),9),
   postConstant=round(float(post.std(axis=0).max()),9),postResidual=round(quat_error(np.array([mul(m,post_mean)for m in mine]),shipped),9),
   identityResidual=round(quat_error(mine,shipped),9),
   preMean=[round(float(v),6)for v in pre_mean/np.linalg.norm(pre_mean)],postMean=[round(float(v),6)for v in post_mean/np.linalg.norm(post_mean)]))
armsMeta=json.loads((EXPORTS/'m4a4-t-arms/t-metadata.json').read_text())['bones']
explained=lambda r:min(r['preResidual'],r['postResidual'],r['identityResidual'])<2e-3
print('WEAPON_NODES',len(rows),'UNEXPLAINED',sum(1 for r in rows if not explained(r)))
for r in rows:
 if not explained(r):print('UNEXPLAINED_NODE',json.dumps(r))
print('PRE_WINS',sum(1 for r in rows if r['preResidual']<=min(r['postResidual'],r['identityResidual'])),
      'POST_WINS',sum(1 for r in rows if r['postResidual']<=min(r['preResidual'],r['identityResidual'])),
      'IDENTITY_WINS',sum(1 for r in rows if r['identityResidual']<=min(r['preResidual'],r['postResidual'])))
for r in rows[:6]:print('NODE',json.dumps(r))
print('ARMS_NODE_COUNT',len(armsMeta))
(ROOT/'output').mkdir(exist_ok=True);(ROOT/'output/source-rifle-fire-node-convention.json').write_text(json.dumps(dict(case=CASE,nodes=rows),indent=2)+'\n')
