"""Freeze only AWP command/runtime native evidence; original source dependencies are read-only."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[1]
def row(path):
 p=ROOT/path;return dict(path=path,bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
discovery=json.loads((ROOT/'output/source-awp-command-discovery.json').read_text())
paths=['output/source-awp-command-discovery.json','output/tests/source-awp-command-native.json','output/tests/source-awp-animation-clock-native.json','output/tests/source-awp-runtime-native.json','output/awp-runtime-tests.log','output/awp-runtime-typecheck.log']
paths+=sorted({v['disassembly']for v in discovery['functions'].values()})
files=[row(p)for p in paths]
dependencies=['output/source-hitbox-fdes.json','.reference-assets/source-exports/awp-candidates/awp-ct/audit.json','.reference-assets/source-exports/pistol-candidates/glock-ct/audit.json','research/source-items-catalog.json']
report=dict(schema='source-awp-runtime-evidence-v1',base='a94e8bcc3af60ed7b3fd2002bf0dead8baefd826',fileCount=len(files),totalBytes=sum(x['bytes']for x in files),files=files,existingDependencies=[row(p)for p in dependencies],sourceServerSha256=discovery['serverSha256'])
out=ROOT/'docs/source-awp-runtime-evidence-files.json';out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(dict(files=len(files),bytes=report['totalBytes'],path=str(out))))
