"""Stage the reviewed AK draw pair at new URLs, retaining all existing assets.

The shipped pair now also carries the rifle's other two original fire variants
(scripts/append-source-rifle-fire-variants.py), so a destination that has moved past
this candidate stops the run rather than silently reverting them."""
from pathlib import Path
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parents[1]
rows=json.loads((ROOT/'.reference-assets/source-exports/ak47-draw-candidates/stage-list.json').read_text());out=[]
expected={'t':('ak47-draw','470da3b7046651a266c2433290bf2edb9f8f71b82ce56ac4ec69877f340fdaaf'),'ct':('ak47-ct-draw','6e19aecab6484e665b98b725cfb3d0b78ca2df5e20dff6fcfc260ac470619af1')}
for row in rows:
 name,sha=expected[row['team']];src=ROOT/row['candidateDirectory'];dst=ROOT/'public/source/csgo-12426148'/name
 if (dst/'viewmodel.glb').exists():
  assert (dst/'viewmodel.glb').read_bytes()==(src/'viewmodel.glb').read_bytes(),f'{dst}/viewmodel.glb is newer than this candidate; run scripts/append-source-rifle-fire-variants.py after staging instead of re-staging'
 raw=(src/row['manifest']).read_bytes();assert hashlib.sha256(raw).hexdigest()==sha==row['manifestSHA256'];manifest=json.loads(raw)
 checked=[]
 for file in manifest['files']:
  rel=Path(file['path']);assert not rel.is_absolute() and '..' not in rel.parts
  data=(src/rel).read_bytes();assert len(data)==file['bytes'] and hashlib.sha256(data).hexdigest()==file['sha256']
  target=dst/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src/rel,target)
  assert target.read_bytes()==data;checked.append({'path':str(rel),'bytes':len(data),'sha256':file['sha256']})
 dst.mkdir(parents=True,exist_ok=True);(dst/row['manifest']).write_bytes(raw);assert (dst/row['manifest']).read_bytes()==raw
 out.append({'team':row['team'],'directory':str(dst),'manifestSHA256':sha,'files':checked})
(ROOT/'output/source-ak-draw-staged.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'profiles':len(out),'filesIncludingManifests':sum(len(r['files'])+1 for r in out),'originalURLsUnchanged':True}))
