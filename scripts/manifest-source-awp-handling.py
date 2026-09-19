"""SHA manifest for the independently deliverable AWP numeric/native delta."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[1]
def row(path):
 p=ROOT/path;return dict(path=path,bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
discovery=json.loads((ROOT/'output/source-awp-handling-discovery.json').read_text())
paths=['output/source-awp-handling-discovery.json','output/awp-handling-tests.log','output/awp-handling-typecheck.log']
paths += [f'output/tests/source-awp-{part}-native.json'for part in ['handling','spread','landing','damage','runtime-handling']]
paths += ['output/tests/source-awp-damage-validation.json']
paths += sorted({v['disassembly']for v in discovery['functions'].values()})
files=[row(p)for p in paths]
dependencies=['output/tests/source-awp-runtime-native.json','output/source-hitbox-fdes.json','research/source-items-catalog.json','.reference-assets/source-exports/awp-candidates/inventory.json']
dependencies += [f'scripts/{name}.py'for name in ['probe-source-accuracy','probe-source-recoil','probe-source-spread','probe-source-damage','probe-source-landing','inspect-source-glock-command']]
report=dict(schema='source-awp-handling-evidence-v1',base='ad73df1359a313872f8d2332d9bedf99ed7fc706',fileCount=len(files),totalBytes=sum(r['bytes']for r in files),files=files,existingDependencies=[row(p)for p in dependencies],sourceServerSha256=discovery['serverSha256'])
out=ROOT/'docs/source-awp-handling-evidence-files.json';out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(path=str(out),files=len(files),bytes=report['totalBytes'])))
