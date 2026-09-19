"""Forensic native individual-box readback for the five observed boundary IDs."""
from pathlib import Path
import json,importlib.util
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('original_hitbox_trace',ROOT/'scripts/probe-source-hitboxes.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
engine=m.OriginalTrace();corpus=json.loads((ROOT/'output/tests/source-pistol-hitbox-native.json').read_text());out=[]
requests=[('t-glock',27,16,16,15),('t-glock',32,13,13,12),('t-usp',27,16,16,15),('ct-glock',30,2,13,12),('ct-usp',30,2,13,12)]
for profile,si,target,actual,expected in requests:
 folder=ROOT/f'.reference-assets/source-exports/pistol-candidates/character-{profile}';body=json.loads((folder/'body-pose-data.json').read_text());ref=json.loads((folder/'python-reference.json').read_text())
 samples=[c for i,c in enumerate(ref['cases']) if i%10==0 or c['input'].get('bodyLayers')];matrices=[[v for row in b[:3] for v in row]for b in samples[si]['bodyWorldMatrices']]
 ray=next(r for r in corpus['rays']if r['profile']==profile and r['sample']==si and r['targetHitbox']==target);boxes=body['hitboxSets'][0]['hitboxes']
 results=[dict(hitbox=i,original=engine.trace([boxes[i]],matrices,ray['start'],ray['end']))for i in (actual,expected)]
 out.append(dict(profile=profile,sample=si,target=target,actual=actual,expected=expected,individual=results,
  identicalNativeFraction=results[0]['original']['fraction']==results[1]['original']['fraction'],sameGroup=results[0]['original']['group']==results[1]['original']['group']))
 print(out[-1],flush=True)
(ROOT/'output/tests/source-pistol-hitbox-ties-native.json').write_text(json.dumps(out,indent=2)+'\n')
