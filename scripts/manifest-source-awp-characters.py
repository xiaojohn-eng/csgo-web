"""Freeze the second AWP increment and prove the first asset pack was untouched."""
from pathlib import Path
import json,hashlib
ROOT=Path(__file__).resolve().parents[1];sha=lambda raw:hashlib.sha256(raw).hexdigest()
prior=json.loads((ROOT/'docs/source-awp-asset-files.json').read_text())
for row in prior['files']:
 raw=(ROOT/row['path']).read_bytes();assert len(raw)==row['bytes']and sha(raw)==row['sha256'],('First AWP increment changed',row['path'])
roots=['public/source/csgo-12426148/character-t-awp','public/source/csgo-12426148/character-ct-awp','.reference-assets/source-exports/awp-character-candidates']
evidence=['output/awp-character-export.log','output/awp-character-assembly.log','output/awp-character-reference.log','output/awp-character-t-conformance.log','output/awp-character-ct-conformance.log','output/awp-character-gltf-validation.log','output/awp-character-native-hitbox.log','output/awp-character-native-ties.log','output/awp-character-hitbox-verification.json','output/awp-character-tests.log','output/awp-character-typecheck.log','output/source-awp-character-staged.json','output/tests/source-awp-character-hitbox-native.json','output/tests/source-awp-character-hitbox-tie-requests.json','output/tests/source-awp-character-hitbox-ties-native.json']
tests=(ROOT/'output/awp-character-tests.log').read_text();assert '13 passed' in tests and 'failed'not in tests
assert 'error TS'not in(ROOT/'output/awp-character-typecheck.log').read_text()
hit=json.loads((ROOT/'output/awp-character-hitbox-verification.json').read_text());assert hit['rays']==4092 and hit['maximumDistanceErrorMeters']<2e-6 and hit['maximumNativeBoundaryUlpDifference']<=2
paths=sorted({p for root in roots for p in(ROOT/root).rglob('*')if p.is_file()}|{ROOT/p for p in evidence});rows=[]
for path in paths:
 raw=path.read_bytes();rows.append(dict(path=str(path.relative_to(ROOT)),bytes=len(raw),sha256=sha(raw)))
report=dict(format='source-awp-character-handoff-v1',sourceApp=740,sourceBuild=12426148,baseCheckpoint='a5660eba950083ea341a6ec87cad81a8d14706ec',firstAWP166FilesUnchanged=True,assetRoots=roots,fileCount=len(rows),totalBytes=sum(r['bytes']for r in rows),verification=dict(testFiles=4,tests=13,typecheck='passed',bodyFramesPerTeam=1625,bodyDescriptorsPerTeam=92,fullPoseCasesPerTeam=120,exactCombinedIBMByTeam=dict(t=165,ct=168),nativeHitbox=hit),files=rows,limitations=['No shared gameplay/runtime integration or GPU/LAN/original-client acceptance in this increment.','23 same-group hitbox ID boundaries: 14 exact native fraction ties and 9 differences of at most 2 float32 ULP; group/head match, max distance difference 1.1632e-6 m.'])
(ROOT/'docs/source-awp-character-asset-files.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k]for k in ['fileCount','totalBytes','firstAWP166FilesUnchanged','verification']},indent=2))
