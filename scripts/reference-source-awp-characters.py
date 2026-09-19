"""Independent original NPZ/SDK Python AWP graph and float64 bone-merge oracle."""
from pathlib import Path
from types import SimpleNamespace
import ast,hashlib,importlib.util,json
import numpy as np
from mathutils import Matrix,Quaternion,Vector
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.reference-assets/source-exports/awp-character-candidates'
spec=importlib.util.spec_from_file_location('original_awp_math',ROOT/'scripts/source-character-animation.py');math=importlib.util.module_from_spec(spec);spec.loader.exec_module(math)
source=ast.parse((ROOT/'scripts/reference-source-pistol-characters.py').read_text());functions=[n for n in source.body if isinstance(n,ast.FunctionDef)and n.name in ['engine','local','local64']];exec(compile(ast.Module(body=functions,type_ignores=[]),'independent-source-matrix-math','exec'),globals())
for team in ['t','ct']:
 out=BASE/f'character-{team}-awp';bodyraw=(out/'body-pose-data.json').read_bytes();worldraw=(out/'world-pose-data.json').read_bytes();d=json.loads(bodyraw);w=json.loads(worldraw)
 assert d['animationExtension']=='awp'and all('AK'not in s['name']and 'Pistol'not in s['name']and 'PISTOL'not in s['name']for s in d['sequences'])
 b=engine(d,d['animationBones'],BASE/f'character-{team}-awp-family/combat/decoded-frames.npz');e=engine(w,w['bones'],ROOT/'.reference-assets/source-exports/awp-candidates/awp-world/continuous/original-frames.npz');sourceNames={bone['name']:i for i,bone in enumerate(d['mainBones'])};cases=[]
 cycles=[0,.04545454680919647-1e-6,.04545454680919647,.23,.5,.9272727370262146,.97,1]
 for i in range(120):
  state=list(d['states'])[i%5];cycle=(i%13)/12;parameters=dict(move_x=[-1,-.57,0,.39,1][i%5],move_y=[-.68,0,.42][i%3],body_yaw=-57+(i*17)%115,body_pitch=-87+(i*29)%175)
  body=dict(state=state,cycle=cycle,upperCycle=(i%11)/10,fireCycle=(i%7)/6,fireWeight=(i%3)/2,parameters=parameters)
  world=dict(sequence=w['sequences'][(i//5)%5]['name'],cycle=cycles[(i//3)%len(cycles)]);layers=[]if i<30 else[dict(sequence='Reload_AWP',cycle=cycles[(i//5)%len(cycles)],weight=(i%5)/4)]
  inp=dict(body=body,bodyLayers=layers,world=world);s=d['states'][state];pose=b.accumulate(b.rest,b.indexed[s['lower']],cycle,1,parameters,'sdk-3way');pose=b.accumulate(pose,b.indexed[s['upper']],body['upperCycle'],1,parameters,'sdk-3way');pose=b.accumulate(pose,b.indexed[s['shoot']],body['fireCycle'],body['fireWeight'],parameters,'sdk-3way')
  for layer in layers:pose=b.accumulate(pose,b.named[layer['sequence']],layer['cycle'],layer['weight'],parameters,'sdk-3way')
  bw=[];bw64=[]
  for j,bone in enumerate(d['mainBones']):
   at=d['mainToAnimation'][j];p,q=(pose[0][at],pose[1][at])if at>=0 else(bone['position'],bone['quaternion']);m=local(p,q);m64=local64(p,q);bw.append(m if bone['parent']<0 else bw[bone['parent']]@m);bw64.append(m64 if bone['parent']<0 else bw64[bone['parent']]@m64)
  wp=e.calc(e.named[world['sequence']],world['cycle'],{},'sdk-3way');ww=[];ww64=[]
  for j,bone in enumerate(w['bones']):
   m=local(wp[0][j],wp[1][j]);m64=local64(wp[0][j],wp[1][j]);shared=sourceNames.get(bone['name']);ww.append(bw[shared].copy()if shared is not None else m if bone['parent']<0 else ww[bone['parent']]@m);ww64.append(bw64[shared].copy()if shared is not None else m64 if bone['parent']<0 else ww64[bone['parent']]@m64)
  visible=True
  for event in e.named[world['sequence']].get('events',[]):
   if event['cycle']<=world['cycle']:
    if event['name']=='AE_CL_EJECT_MAG':visible=False
    elif event['name']=='AE_CL_EJECT_MAG_UNHIDE':visible=True
  attachments={a['name']:(ww64[a['parent_bone']]@np.array([a['matrix'][:4],a['matrix'][4:8],a['matrix'][8:12],[0,0,0,1]],dtype=np.float64)).tolist()for a in w['attachments']}
  cases.append(dict(input=inp,animationPositions=pose[0].reshape(-1).tolist(),animationQuaternions=pose[1].reshape(-1).tolist(),bodyWorldMatrices=[m.tolist()for m in bw64],weaponWorldMatrices=[m.tolist()for m in ww64],sourceAttachmentMatrices=attachments,magazineVisible=visible,maxMathutilsFloat32MatrixDeviation=float(max(max(np.max(np.abs(np.array(m)-n))for m,n in zip(bw,bw64)),max(np.max(np.abs(np.array(m)-n))for m,n in zip(ww,ww64))))))
 result=dict(caseCount=len(cases),bodyDataSHA256=hashlib.sha256(bodyraw).hexdigest(),worldDataSHA256=hashlib.sha256(worldraw).hexdigest(),cases=cases,boundary='Original AWP NPZ, Python SDK graph and independent float64/mathutils matrices. No closed AnimState, scope selection, IK or original GPU claim.')
 (out/'python-reference.json').write_text(json.dumps(result,separators=(',',':'))+'\n');print('AWP_CHARACTER_REFERENCE',team,len(cases),flush=True)
