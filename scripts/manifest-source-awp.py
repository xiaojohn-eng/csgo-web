"""Freeze the exact AWP-only untracked asset/evidence handoff after verification."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[1]
roots=['public/source/csgo-12426148/awp-t','public/source/csgo-12426148/awp-ct','public/source/csgo-12426148/awp-world','.reference-assets/source-exports/awp-candidates']
evidence=['output/awp-tests.log','output/awp-typecheck.log','output/awp-fp-t-validation.log','output/awp-fp-ct-validation.log','output/awp-world-validation.log','output/awp-world-dense-validation.log','output/source-awp-staged.json','output/source-awp-audio-stage.json','output/source-awp-world-staged.json','output/awp-world-reference.log','output/awp-audio-extend.log']
assert '13 passed' in (ROOT/'output/awp-tests.log').read_text() and 'failed' not in (ROOT/'output/awp-tests.log').read_text()
assert 'error TS' not in (ROOT/'output/awp-typecheck.log').read_text()
paths=sorted({p for root in roots for p in (ROOT/root).rglob('*')if p.is_file()}|{ROOT/p for p in evidence})
rows=[]
for path in paths:
 raw=path.read_bytes();rows.append(dict(path=str(path.relative_to(ROOT)),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest()))
report=dict(format='source-awp-asset-handoff-v1',sourceApp=740,sourceBuild=12426148,baseCheckpoint='156ab6cb6897a93d89b3bd34bb9cd0b24fe350fa',assetRoots=roots,files=rows,fileCount=len(rows),totalBytes=sum(r['bytes']for r in rows),verification=dict(tests=13,testFiles=4,typecheck='passed',fpFramesPerTeam=435,fpInverseBindsPerTeam=105,worldFrames=445,worldInverseBinds=94,worldAttachmentMatrices=6230,independentPythonCases=30),limitations=['Asset and CPU verification only. No GPU/original-client visual equivalence, scope optics, gameplay or LAN acceptance claim.'])
(ROOT/'docs/source-awp-asset-files.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({key:report[key]for key in ['fileCount','totalBytes','verification']},indent=2))
