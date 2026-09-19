"""Resolve only observed AWP hitbox-ID ties using original individual-box traces."""
from pathlib import Path
import json,hashlib,importlib.util,struct
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('original_awp_hitbox_trace',ROOT/'scripts/probe-source-hitboxes.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
engine=m.OriginalTrace();corpus=json.loads((ROOT/'output/tests/source-awp-character-hitbox-native.json').read_text());requests=json.loads((ROOT/'output/tests/source-awp-character-hitbox-tie-requests.json').read_text());out=[]
for request in requests:
 profile,si,target,actual,expected=[request[k]for k in ['profile','sample','target','actual','expected']];assert profile in ['t-awp','ct-awp']
 folder=ROOT/f'.reference-assets/source-exports/awp-character-candidates/character-{profile}';raw=(folder/'body-pose-data.json').read_bytes();body=json.loads(raw);ref=json.loads((folder/'python-reference.json').read_text());assert hashlib.sha256(raw).hexdigest()==ref['bodyDataSHA256']
 samples=[c for i,c in enumerate(ref['cases'])if i%10==0 or c['input'].get('bodyLayers')];matrices=[[v for row in b[:3]for v in row]for b in samples[si]['bodyWorldMatrices']]
 ray=next(r for r in corpus['rays']if r['profile']==profile and r['sample']==si and r['targetHitbox']==target);boxes=body['hitboxSets'][0]['hitboxes']
 results=[dict(hitbox=i,original=engine.trace([boxes[i]],matrices,ray['start'],ray['end']))for i in [actual,expected]]
 bits=[struct.unpack('<I',struct.pack('<f',r['original']['fraction']))[0]for r in results]
 out.append(dict(**request,individual=results,fractionUlpDifference=abs(bits[0]-bits[1]),identicalNativeFraction=results[0]['original']['fraction']==results[1]['original']['fraction'],sameGroup=results[0]['original']['group']==results[1]['original']['group']))
(ROOT/'output/tests/source-awp-character-hitbox-ties-native.json').write_text(json.dumps(out,indent=2)+'\n');print('AWP_NATIVE_INDIVIDUAL_TIES',len(out),all(row['fractionUlpDifference']<=2 and row['sameGroup']for row in out))
