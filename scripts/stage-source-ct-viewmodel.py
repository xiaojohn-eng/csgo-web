#!/usr/bin/env python3
"""Stage only the independently verified original IDF first-person profile."""
import hashlib
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '.reference-assets/source-exports/ak47-ct-arms'
TARGET = ROOT / 'public/source/csgo-12426148/ak47-ct'
EXPECTED = '8a8a31f668a54255eeea1556859878910828ad84001f670b566c5e43b5a43e55'
audit = json.loads((SOURCE / 'audit.json').read_text())
readback = json.loads((SOURCE / 'ct-readback.json').read_text())
metadata = json.loads((SOURCE / 'ct-metadata.json').read_text())
runtime = json.loads((SOURCE / 'runtime-readback.json').read_text())
assert readback['status'] == 'passed' and readback['sha256'] == EXPECTED
assert runtime['status'] == 'passed' and runtime['sourceGlbSha256'] == EXPECTED
assert metadata['boneCount'] == 48 and audit['imported']['bones'] == 58
files = []
def stage(source, relative, expected=None):
    data = source.read_bytes(); sha = hashlib.sha256(data).hexdigest()
    assert expected is None or sha == expected, f'Frozen input changed: {source}'
    target = TARGET / relative; target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data); assert target.read_bytes() == data
    files.append(dict(path=relative, bytes=len(data), sha256=sha, source=str(source.relative_to(ROOT))))
stage(Path(audit['glb']['path']), 'viewmodel.glb', EXPECTED)
for filename in ['ak47', 'ak47_exponent', 'ct_arms_idf', 'ct_arms_normal', 'ct_base_glove_color', 'ct_base_glove_normal', 'ct_base_glove_exp']:
    stage(SOURCE / 'textures' / (filename + '-rgba.png'), 'textures/' + filename + '-rgba.png')
for filename in ['ct-metadata.json', 'ct-readback.json']:
    stage(SOURCE / filename, filename)
manifest = dict(sourceApp=740, build=12426148, armsProfile='ct_arms_idf', sourceArms='models/weapons/ct_arms_idf.mdl',
    sourceWeapon='models/weapons/v_rif_ak47.mdl', weaponBoneCount=58, armsBoneCount=48,
    sourceToCamera='Source (x,y,z) -> (-.0254*y,.0254*z,-.0254*x)', inverseBind='Separate original CT skin: rawIBM * inverse(C)',
    files=files, clips={k:{field:v[field] for field in ['action_name','duration_seconds','fps','frame_count','events']} for k,v in audit['clip_checks'].items()},
    runtimeBoneMerge='47 exact source-name matches after original AK sampling; CT Bip01 remains original rest',
    runtimeNumericalReadback=runtime,
    copyright='Original Valve content for this local/LAN development build', publicInternetPublished=False)
(TARGET / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
print(json.dumps(dict(files=len(files), bytes=sum(f['bytes'] for f in files), sha256=EXPECTED, target=str(TARGET))))
