"""Original App740 OBB trace on independently generated full pistol body poses.
Reuses the SHA-gated original instruction interpreter; never changes rifle receipts.
"""
from pathlib import Path
import json,hashlib,importlib.util
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('original_hitbox_trace',ROOT/'scripts/probe-source-hitboxes.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
engine=module.OriginalTrace();actors=[];rows=[]
for team in ('t','ct'):
 for weapon in ('glock','usp'):
  folder=ROOT/f'.reference-assets/source-exports/pistol-candidates/character-{team}-{weapon}'
  raw=(folder/'body-pose-data.json').read_bytes();body=json.loads(raw);ref=json.loads((folder/'python-reference.json').read_text())
  assert hashlib.sha256(raw).hexdigest()==ref['bodyDataSHA256']
  samples=[c for i,c in enumerate(ref['cases']) if i%10==0 or c['input'].get('bodyLayers')]
  boxes=body['hitboxSets'][0]['hitboxes'];profile=f'{team}-{weapon}'
  actors.append(dict(profile=profile,team=team,weapon=weapon,dataSha256=ref['bodyDataSHA256'],samples=[c['input'] for c in samples]))
  for si,sample in enumerate(samples):
   matrices=[[v for row in m[:3] for v in row] for m in sample['bodyWorldMatrices']]
   for h in boxes:
    mid=[(a+b)*.5 for a,b in zip(h['min'],h['max'])];rot=engine.angle(h['extensionFloat32'][:3]);local=[sum(rot[r*4+c]*mid[c]for c in range(3))for r in range(3)]
    bone=matrices[h['bone']];center=[sum(bone[r*4+c]*local[c]for c in range(3))+bone[r*4+3]for r in range(3)]
    axis=(h['index']+si)%3;start=center.copy();end=center.copy();start[axis]-=100;end[axis]+=100
    result=engine.trace(boxes,matrices,start,end);assert result['hit']
    rows.append(dict(profile=profile,sample=si,targetHitbox=h['index'],start=start,end=end,original=result))
  print(profile,len(samples),'poses',len(samples)*len(boxes),'rays',flush=True)
out=ROOT/'output/tests/source-pistol-hitbox-native.json';out.write_text(json.dumps(dict(serverSha256=module.SHA,
 scope='Actual original CPU OBB/group instructions on independent Python complete pistol body matrices, including explicit reload/silencer layers. Not the closed original AnimState, live shot, damage, or weapon hitboxes.',actors=actors,rays=rows,executedCalls=engine.calls),indent=2)+'\n')
print('PASS',len(rows),'original pistol pose rays',flush=True)
