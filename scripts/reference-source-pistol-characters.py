"""Independent original NPZ/Python pose + mathutils bonemerge reference.
No TypeScript output is used to construct expected matrices.
"""
from pathlib import Path
from types import SimpleNamespace
import copy,hashlib,importlib.util,json
import numpy as np
from mathutils import Matrix,Quaternion,Vector
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.reference-assets/source-exports/pistol-candidates'
spec=importlib.util.spec_from_file_location('independent_source_pose',ROOT/'scripts/source-character-animation.py');math=importlib.util.module_from_spec(spec);spec.loader.exec_module(math)
f=lambda x:float(np.float32(x))
def engine(data,bones,npz):
 arrays=np.load(npz);prefix='anim_'if 'anim_0_positions'in arrays else '';frames={a['index']:(arrays[prefix+str(a['index'])+'_positions'],arrays[prefix+str(a['index'])+'_quaternions'])for a in data['descriptors']};mdl=SimpleNamespace(bones=[SimpleNamespace(position=b['position'],quat=b['quaternion'],parent_id=b['parent'],flags=b['flags'],q_alignment=b['alignment'])for b in bones]);return math.PoseSampler(mdl,data,frames)
def local(p,q):
 x,y,z,w=q;return Matrix.LocRotScale(Vector(p),Quaternion((w,x,y,z)).normalized(),(1,1,1))
def local64(p,q):
 q=np.asarray(q,dtype=np.float64);q=q/np.linalg.norm(q);v=q[:3];w=q[3];x,y,z=v;cross=np.array([[0,-z,y],[z,0,-x],[-y,x,0]],dtype=np.float64);m=np.eye(4);m[:3,:3]=(w*w-np.dot(v,v))*np.eye(3)+2*np.outer(v,v)+2*w*cross;m[:3,3]=p;return m
def ramp(value,p,l):
 n=f(f(value-p['start'])/f(p['end']-p['start']));s=f(f(f(p['end']-p['start'])*n)+f(p['start']-l['peak']));s=min(1,max(0,f(s/f(l['tail']-l['peak']))));ss=f(s*s);return min(1,max(0,f(f(3*ss)-f(f(s+s)*ss))))
for team in ['t','ct']:
 for weapon in ['glock','usp']:
  out=BASE/f'character-{team}-{weapon}';d=json.loads((out/'body-pose-data.json').read_text());w=json.loads((out/'world-pose-data.json').read_text());b=engine(d,d['animationBones'],BASE/f'character-{team}-pistol/combat/decoded-frames.npz');flat=copy.deepcopy(w)
  for s in flat['sequences']:s['autoLayers']=[]
  e=engine(flat,w['bones'],BASE/f'{weapon}-world/continuous/original-frames.npz');wrapper=next(s for s in w['sequences']if s['name']=='pistol_aim_t');sourceNames={bone['name']:i for i,bone in enumerate(d['mainBones'])};worldCases=json.loads((BASE/f'{weapon}-world/continuous/python-reference.json').read_text())['cases'];cases=[]
  for i in range(60):
   state=list(d['states'])[i%5];cycle=(i%13)/12;parameters=dict(move_x=[-1,-.57,0,.39,1][i%5],move_y=[-.68,0,.42][i%3],body_yaw=-57+(i*17)%115,body_pitch=-87+(i*29)%175);body=dict(state=state,cycle=cycle,upperCycle=(i%11)/10,fireCycle=(i%7)/6,fireWeight=(i%3)/2,parameters=parameters);wl=copy.deepcopy(worldCases[(i*7)%77]['input']);actions=['Reload_PISTOL']if weapon=='glock'else['Reload_PISTOL','Silencer_Attach_Pistol','Silencer_Detach_Pistol'];layers=[]if i<30 else[dict(sequence=actions[i%len(actions)],cycle=(i%17)/16,weight=(i%5)/4)];inp=dict(body=body,bodyLayers=layers,world=wl,silencerVisible=i%2==0,magazineVisible=i%3!=0)
   s=d['states'][state];pose=b.accumulate(b.rest,b.indexed[s['lower']],cycle,1,parameters,'sdk-3way');pose=b.accumulate(pose,b.indexed[s['upper']],body['upperCycle'],1,parameters,'sdk-3way');pose=b.accumulate(pose,b.indexed[s['shoot']],body['fireCycle'],body['fireWeight'],parameters,'sdk-3way')
   for l in layers:pose=b.accumulate(pose,b.named[l['sequence']],l['cycle'],l['weight'],parameters,'sdk-3way')
   bw=[];bw64=[]
   for j,bone in enumerate(d['mainBones']):
    at=d['mainToAnimation'][j];m=local(pose[0][at],pose[1][at])if at>=0 else local(bone['position'],bone['quaternion']);bw.append(m if bone['parent']<0 else bw[bone['parent']]@m);m64=local64(pose[0][at],pose[1][at])if at>=0 else local64(bone['position'],bone['quaternion']);bw64.append(m64 if bone['parent']<0 else bw64[bone['parent']]@m64)
   params=wl['parameters'];wp=e.calc(e.named['default'],0,params,'sdk-3way')
   for l in wrapper['autoLayers']:
    p=w['poseParameters'][l['pose_id']];wp=e.accumulate(wp,e.indexed[l['sequence_id']],0,ramp(params[p['name']],p,l),params,'sdk-3way')
   for l in wl['layers']:wp=e.accumulate(wp,e.named[l['sequence']],l['cycle'],l['weight'],params,'sdk-3way')
   ww=[];ww64=[]
   for j,bone in enumerate(w['bones']):
    m=local(wp[0][j],wp[1][j]);ww.append(bw[sourceNames[bone['name']]].copy()if bone['name']in sourceNames else m if bone['parent']<0 else ww[bone['parent']]@m);m64=local64(wp[0][j],wp[1][j]);ww64.append(bw64[sourceNames[bone['name']]].copy()if bone['name']in sourceNames else m64 if bone['parent']<0 else ww64[bone['parent']]@m64)
   cases.append(dict(input=inp,animationPositions=pose[0].reshape(-1).tolist(),animationQuaternions=pose[1].reshape(-1).tolist(),bodyWorldMatrices=[m.tolist()for m in bw64],weaponWorldMatrices=[m.tolist()for m in ww64],maxMathutilsFloat32MatrixDeviation=float(max(max(np.max(np.abs(np.array(m)-n))for m,n in zip(bw,bw64)),max(np.max(np.abs(np.array(m)-n))for m,n in zip(ww,ww64))))))
  (out/'python-reference.json').write_text(json.dumps(dict(caseCount=len(cases),bodyDataSHA256=hashlib.sha256((out/'body-pose-data.json').read_bytes()).hexdigest(),worldDataSHA256=hashlib.sha256((out/'world-pose-data.json').read_bytes()).hexdigest(),cases=cases,boundary='Original decoded NPZ, Python SDK math and mathutils source-world bonemerge. No native closed AnimState, IK or client rendering oracle.'),separators=(',',':'))+'\n');print('PISTOL_COMBINED_REFERENCE',team,weapon,len(cases))
