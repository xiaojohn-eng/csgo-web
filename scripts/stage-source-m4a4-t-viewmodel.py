"""Stage exact M4A4+original T arms without changing the CT profile.

The shipped T profile now also carries the rifle's other two original fire variants
(scripts/append-source-rifle-fire-variants.py), so a destination that has moved past
this export stops the run rather than silently reverting them."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[1];source=ROOT/'.reference-assets/source-exports/m4a4-t-arms';target=ROOT/'public/source/csgo-12426148/m4a4-t'
sha=lambda b:hashlib.sha256(b).hexdigest()
audit=json.loads((source/'audit.json').read_text())
if (target/'viewmodel.glb').exists():
 assert (target/'viewmodel.glb').read_bytes()==Path(audit['glb']['path']).read_bytes(),f'{target}/viewmodel.glb is newer than this export; run scripts/append-source-rifle-fire-variants.py after staging instead of re-staging'
readback=json.loads((source/'three-readback.json').read_text());runtime=json.loads((source/'runtime-readback.json').read_text())
assert readback['status']=='passed'and readback['sha256']==audit['glb']['sha256']and runtime['sourceGlbSha256']==audit['glb']['sha256']and runtime['status']=='passed'
ct=ROOT/'public/source/csgo-12426148/m4a4';manifest=json.loads((ct/'manifest.json').read_text());files=[]
def stage(path,name,expected=None):
 data=path.read_bytes();h=sha(data);assert expected is None or h==expected
 to=target/name;to.parent.mkdir(parents=True,exist_ok=True);to.write_bytes(data);assert to.read_bytes()==data;files.append(dict(path=name,bytes=len(data),sha256=h))
stage(Path(audit['glb']['path']),'viewmodel.glb',audit['glb']['sha256'])
for stem in ['rif_m4a1','rif_m4a1_exponent','v_model_base_arms_color','v_model_base_arms_normal','v_model_base_arms_exp','skin_gradient','t_base_fingerless_glove_color','t_base_fingerless_glove_normal','t_base_fingerless_glove_exp']:stage(source/f'textures/{stem}-rgba.png',f'textures/{stem}-rgba.png')
for name in ['m4a4-metadata.json','three-readback.json','runtime-readback.json']:stage(source/name,name)
for row in manifest['files']:
 if row['path'].startswith('sounds/'):stage(ct/row['path'],row['path'],row['sha256'])
manifest.update(armsProfile='t_arms',sourceArms='models/weapons/t_arms.mdl',files=files,runtimeNumericalReadback=runtime,
 runtimeBoneMerge='47 source-name matches after original M4 sampling; T48 skin and raw IBM remain independent; unmatched Bip01 retains rest')
(target/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('M4_T_STAGED',audit['glb']['sha256'],len(files),sum(f['bytes']for f in files))
