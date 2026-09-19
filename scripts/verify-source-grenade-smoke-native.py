"""Regenerate original grenade ring and colour numeric oracles.
Only this worktree's output and owned test fixtures are written. Uses the staged
original graph/defaults produced by export-source-grenade-smoke.py and
probe-source-pistol-particle-defaults.py; the original VPK/ELF stay read-only.

PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages python3 scripts/verify-source-grenade-smoke-native.py
"""
from pathlib import Path
import json, os, subprocess, sys
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/fidelity-character/native-child-initializers'
FIX=ROOT/'tests/fixtures/source-grenade-smoke';FIX.mkdir(parents=True,exist_ok=True)
base={**os.environ,'PARTICLE_GRAPH_DIR':str(ROOT/'output/fidelity-character/grenade-smoke')}

def probe(system,count,env,suffix):
 subprocess.run([sys.executable,str(ROOT/'scripts/probe-source-child-initializers.py'),system,str(count),'.001','instant'],env={**base,**env},check=True,cwd=ROOT)
 return json.loads((OUT/(system+suffix+'.json')).read_text())

r=probe('explosion_child_smoke03d_ring',16,{'PARTICLE_RING_THICKNESS':'0'},'-ring-0')
o=next(o for o in r['cases'][0]['operators'] if o.get('name')=='Position Along Ring')
assert 'error' not in o
fixture=dict(format='source-particle-ring-native-v1',clientSHA256=r['clientSHA256'],initializer=o['initializer'],probe='scripts/probe-source-child-initializers.py',scope='Only the successful ring initializer positions are used. Earlier scalar calls in this synthetic batch failed, so this is not a full emission/RNG oracle.',inputOverride='PARTICLE_RING_THICKNESS=0; original radius=74, even=true, CP identity',radius=74,count=16,positions=[dict(index=i,position=p)for i,p in enumerate(o['fields']['0'])])
(FIX/'ring-native.json').write_text(json.dumps(fixture,indent=2)+'\n')
cases=[]
for env,suffix,lighting in [({'PARTICLE_COLOR_TINT':'0'},'-tint-0',None),({'PARTICLE_CACHED_COLOR':'10,100,200'},'-cached-10,100,200',[10,100,200])]:
 x=probe('explosion_child_smoke03e',4,{'PARTICLE_ONLY_INITIALIZER':'Color Random',**env},suffix)
 assert x['status']=='original-initializers-executed'
 for c in x['cases']:
  o=c['operators'][0]
  for i,color in enumerate(o['fields']['6']):cases.append(dict(seed=c['seed'],randomIndex=o['randomBefore']+i,lightingColor=lighting,color=color))
(FIX/'color-native.json').write_text(json.dumps(dict(clientSHA256=x['clientSHA256'],initializer='0xd00c60',blend='0xced000',scope='Isolated Color Random, original parameters except tint_perc=0 in the no-light cases; CP cache explicitly contains [10,100,200] for tinted cases. Original engine lighting query is not simulated.',cases=cases),indent=2)+'\n')
print('Original ring 16 positions and Color Random 24 colours regenerated; ring scope remains explicitly partial.')
