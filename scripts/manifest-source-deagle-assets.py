"""Read back the exact untracked Deagle handoff files; never scan source archives."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[1]
directories=['public/source/csgo-12426148/'+profile for profile in ['deagle-t','deagle-ct','character-t-deagle','character-ct-deagle']]+['.reference-assets/source-exports/deagle-candidates']
proofs=['output/deagle-gltf-validation.json','output/deagle-asset-tests.log','output/deagle-final-typecheck.log','output/source-deagle-staged.json','output/source-deagle-character-staged.json','output/source-deagle-audio-stage.json']
files=[]
for name in directories:
 folder=ROOT/name
 assert folder.is_dir(),name
 for p in sorted(folder.rglob('*')):
  if p.is_file():
   raw=p.read_bytes();files.append(dict(path=p.relative_to(ROOT).as_posix(),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest()))
for name in proofs:
 raw=(ROOT/name).read_bytes();files.append(dict(path=name,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest()))
assert len({r['path']for r in files})==len(files)
result=dict(format='source-deagle-asset-handoff-v1',sourceApp=740,build=12426148,baseCheckpoint='1c21fffeb5189c3dcda484c552aa9696675e9b17',directories=directories,files=files,totalBytes=sum(r['bytes']for r in files),limitations=['Checks prove local original asset conversion and independent numeric sampling, not whole-game parity or GPU acceptance.'])
(ROOT/'docs/source-deagle-asset-files.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'files':len(files),'bytes':result['totalBytes'],'publicFiles':sum(r['path'].startswith('public/')for r in files)}))
