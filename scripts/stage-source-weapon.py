#!/usr/bin/env python3
"""Stage the verified original AK+arms and raw texture/sound inputs, without conversion."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / '.reference-assets/source-exports/ak47-arms'
sound_root = ROOT / '.reference-assets/source-exports/ak47/sounds'
target = ROOT / 'public/source/csgo-12426148/ak47'
source_glb = 'v_rif_ak47-with-arms-source-unit.glb'
expected = '8e93eb7f575bcf4ae7cd05cfce32d374fd8d114d9993e76dd5f1adc5182b0baa'
audit = json.loads((source / 'audit.json').read_text())
rows = []

def stage(file, relative, expected_sha=None):
    data = file.read_bytes(); sha = hashlib.sha256(data).hexdigest()
    if expected_sha and sha != expected_sha:
        raise ValueError('Frozen source changed: ' + str(file))
    output = target / relative; output.parent.mkdir(parents=True, exist_ok=True); output.write_bytes(data)
    if output.read_bytes() != data:
        raise IOError('Staged output differs: ' + relative)
    rows.append({'path': relative, 'bytes': len(data), 'sha256': sha, 'source': str(file.relative_to(ROOT))})

stage(source / source_glb, 'viewmodel.glb', expected)
for name in ['ak47-rgba.png', 'ak47_exponent-rgba.png']:
    stage(source / 'textures' / name, 'textures/' + name)
arms = ROOT / '.reference-assets/source-exports/arms-materials'
arms_audit = json.loads((arms / 'audit.json').read_text())
for texture in arms_audit['textures'].values():
    file = ROOT / texture['output']
    stage(file, 'textures/' + file.name, texture['pngSha256'])
sounds = json.loads((sound_root / 'manifest.json').read_text())
for sound in sounds['sounds']:
    stage(sound_root / sound['file'], 'sounds/' + sound['file'], sound['sha256'])
manifest = {'sourceApp':740,'build':12426148,'files':rows,
    'clips':{k:{field:v[field] for field in ['action_name','duration_seconds','fps','frame_count','events']} for k,v in audit['clip_checks'].items()},
    'arms':'models/weapons/t_arms.mdl; separate original inverse-bind matrices',
    'copyright':'Original Valve game content; staged for this local/LAN development build.',
    'publicInternetPublished':False}
(target / 'provenance.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'files':len(rows),'bytes':sum(r['bytes'] for r in rows),'glb':rows[0]},ensure_ascii=False))
