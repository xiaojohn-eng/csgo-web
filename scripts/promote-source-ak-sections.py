"""Promote only root-approved section candidates; preserve the previous receipts."""
from pathlib import Path
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.reference-assets/source-exports';BACKUP=BASE/'section-before-20260909'
sha=lambda b:hashlib.sha256(b).hexdigest()
expected={'t':'8e93eb7f575bcf4ae7cd05cfce32d374fd8d114d9993e76dd5f1adc5182b0baa','ct':'8a8a31f668a54255eeea1556859878910828ad84001f670b566c5e43b5a43e55'}
changes=[]
def backup(path):
 if path.exists():
  to=BACKUP/path.relative_to(ROOT);to.parent.mkdir(parents=True,exist_ok=True)
  if not to.exists():shutil.copyfile(path,to)
def put(source,target,remap=None):
 data=source.read_bytes()
 if remap and source.suffix=='.json':
  data=data.decode().replace(str(remap[0]),str(remap[1])).encode()
 backup(target);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);assert target.read_bytes()==data
 changes.append(dict(path=str(target.relative_to(ROOT)),sha256=sha(data)))
for team,live in [('t','ak47-arms'),('ct','ak47-ct-arms')]:
 source=BASE/f'ak47-{team}-section-candidate';target=BASE/live;audit=json.loads((source/'audit.json').read_text());proof=json.loads((source/'three-readback.json').read_text())
 assert audit['glb']['sha256']==expected[team] and proof['sha256']==expected[team] and proof['status']=='passed'
 for name in ['v_rif_ak47-with-arms-source-unit.glb','audit.json','gltf-structure.json','three-readback.json']+(['ct-metadata.json']if team=='ct'else[]):put(source/name,target/name,(source,target))
 source=BASE/f'character-{team}-ak-section-candidate';target=BASE/f'character-{team}'
 proof=json.loads((source/'continuous/verification.json').read_text());assert proof['status']=='passed-source-pose-conformance'
 for folder in ['continuous','combat']:
  for path in (source/folder).iterdir():
   if path.is_file():put(path,target/folder/path.name)
 # This new audit explicitly records repaired raw section inputs. Historical
 # world baked clips remain source artifacts; production uses the new index.
 put(source/'combat-audit.json',target/'combat-audit.json',(source,target))
 for name in [f'public/source/csgo-12426148/{"ak47"if team=="t"else"ak47-ct"}/{"provenance.json"if team=="t"else"manifest.json"}',f'public/source/csgo-12426148/{"character-ak"if team=="t"else"character-ct-ak"}/manifest.json']:
  backup(ROOT/name)
for file,old,new in [
 ('game/source-t-viewmodel.ts','e29d4e64a7a204a8d80bd9c338f12078609f2d4cb38feadadffe04dd93833ee7',expected['t']),
 ('game/source-ct-viewmodel.ts','09e4bbc5a0efe7ee880452e906d19ee902f9f9bc9491415378fb76998d99b687',expected['ct']),
 ('scripts/stage-source-weapon.py','e29d4e64a7a204a8d80bd9c338f12078609f2d4cb38feadadffe04dd93833ee7',expected['t']),
 ('scripts/stage-source-ct-viewmodel.py','09e4bbc5a0efe7ee880452e906d19ee902f9f9bc9491415378fb76998d99b687',expected['ct'])]:
 path=ROOT/file;data=path.read_text();assert old in data or new in data
 backup(path);path.write_text(data.replace(old,new))
(BACKUP/'promotion.json').write_text(json.dumps(dict(status='promoted-private-and-loader-constants-await-stage-validation',changes=changes),indent=2)+'\n')
print('PROMOTED_PRIVATE',len(changes),str(BACKUP))
