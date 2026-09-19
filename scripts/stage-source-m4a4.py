#!/usr/bin/env python3
"""Stage only the independently verified original IDF first-person profile.

The shipped profile now also carries the rifle's other two original fire variants
(scripts/append-source-rifle-fire-variants.py), so a destination that has moved past
this export stops the run rather than silently reverting them."""
import hashlib
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '.reference-assets/source-exports/m4a4'
TARGET = ROOT / 'public/source/csgo-12426148/m4a4'
EXPECTED = 'defbb97f7c799a22b2eab42419a480d1aaffe910ffd17639cdd166360375934a'
audit = json.loads((SOURCE / 'audit.json').read_text())
if (TARGET / 'viewmodel.glb').exists():
    assert (TARGET / 'viewmodel.glb').read_bytes() == Path(audit['glb']['path']).read_bytes(), \
        f'{TARGET}/viewmodel.glb is newer than this export; run scripts/append-source-rifle-fire-variants.py after staging instead of re-staging'
readback = json.loads((SOURCE / 'three-readback.json').read_text())
metadata = json.loads((SOURCE / 'm4a4-metadata.json').read_text())
runtime = json.loads((SOURCE / 'runtime-readback.json').read_text())
assert readback['status'] == 'passed' and readback['sha256'] == EXPECTED
assert runtime['status'] == 'passed' and runtime['sourceGlbSha256'] == EXPECTED
assert metadata['arms']['boneCount'] == 48 and audit['imported']['bones'] == 57
files = []
def stage(source, relative, expected=None):
    data = source.read_bytes(); sha = hashlib.sha256(data).hexdigest()
    assert expected is None or sha == expected, f'Frozen input changed: {source}'
    target = TARGET / relative; target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data); assert target.read_bytes() == data
    files.append(dict(path=relative, bytes=len(data), sha256=sha, source=str(source.relative_to(ROOT))))
stage(Path(audit['glb']['path']), 'viewmodel.glb', EXPECTED)
for filename in ['rif_m4a1', 'rif_m4a1_exponent', 'ct_arms_idf', 'ct_arms_normal', 'ct_base_glove_color', 'ct_base_glove_normal', 'ct_base_glove_exp']:
    stage(SOURCE / 'textures' / (filename + '-rgba.png'), 'textures/' + filename + '-rgba.png')
for filename in ['m4a4-metadata.json', 'three-readback.json']:
    stage(SOURCE / filename, filename)
world_audit=json.loads((SOURCE/'world/audit.json').read_text());world_readback=json.loads((SOURCE/'world/three-readback.json').read_text())
assert world_readback['status']=='passed' and world_readback['sha256']==world_audit['glb']['sha256']
stage(Path(world_audit['glb']['path']),'world.glb',world_audit['glb']['sha256'])
for file in sorted({r['file']for r in metadata['sounds']}):stage(SOURCE/file,file)
stage(SOURCE/'world/world-original-frames.npz','world-original-frames.npz')
stage(SOURCE/'world/audit.json','world-audit.json')
manifest = dict(sourceApp=740, build=12426148, weaponId='m4a4', itemDefinition=16, animationExtension='m4', armsProfile='ct_arms_idf', sourceArms='models/weapons/ct_arms_idf.mdl',
    sourceWeapon='models/weapons/v_rif_m4a1.mdl', weaponBoneCount=57, armsBoneCount=48,
    sourceToCamera='Source (x,y,z) -> (-.0254*y,.0254*z,-.0254*x)', inverseBind='Separate original CT skin: rawIBM * inverse(C)',
    gameplay=metadata['weapon']['resolvedDefinition'], soundEvents=metadata['events'], sounds=metadata['sounds'], worldModel='models/weapons/w_rif_m4a1.mdl', worldBoneCount=94, files=files, clips={k:{field:v[field] for field in ['action_name','duration_seconds','fps','frame_count','events']} for k,v in audit['clip_checks'].items()},
    runtimeBoneMerge='47 exact source-name matches after original M4A4 sampling; CT Bip01 remains original rest',
    runtimeNumericalReadback=runtime,
    copyright='Original Valve content for this local/LAN development build', publicInternetPublished=False)
(TARGET / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
print(json.dumps(dict(files=len(files), bytes=sum(f['bytes'] for f in files), sha256=EXPECTED, target=str(TARGET))))
