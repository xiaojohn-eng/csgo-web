"""Reproduce the original Dust2 IDF first-person arms with the frozen AK importer.

Blender --background --factory-startup --python-exit-code 1 --python this_file.py
All new outputs stay in the project-private CT directory. No addon preferences.
"""
from pathlib import Path
import ast
import hashlib
import importlib.util
import json
import runpy
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/ak47-ct-arms'
OUT.mkdir(parents=True, exist_ok=True)
metadata_only = '--metadata-only' in sys.argv
# SourceIO detects Blender from argv[0]; runpy temporarily replaces that name.
# Import it while the real Blender executable is still present, before delegation.
sys.path.insert(0, str(ROOT / '.tools'))
import SourceIO
sys.argv = [*(sys.argv[:sys.argv.index('--')] if '--' in sys.argv else sys.argv),
            '--', '--confirmed-complete', '--model', 'models/weapons/v_rif_ak47.mdl',
            '--arms-model', 'models/weapons/ct_arms_idf.mdl', '--export-glb', '--output-dir', str(OUT)]
if not metadata_only:
    runpy.run_path(str(ROOT / 'scripts/import-source-weapon.py'), run_name='__main__')

spec = importlib.util.spec_from_file_location('ct_viewmodel_items', ROOT / 'scripts/inventory-source-items.py')
items = importlib.util.module_from_spec(spec)
spec.loader.exec_module(items)
context = items.initialize()
sources = items.Sources()
from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.utils import MemoryBuffer
from SourceIO.library.utils.pylib.vtf import load_vtf_texture
from SourceIO.library.utils.pylib.image import encode_png
import numpy as np

# The generic SourceIO KV lexer drops this file's unquoted branches. Reuse the
# already verified original-gamemodes token parser, without running T's importer.
parser_source = ROOT / 'scripts/import-source-character.py'
functions = [n for n in ast.parse(parser_source.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'gamemode_blocks']
helpers = {'re': re}
exec(compile(ast.Module(body=functions, type_ignores=[]), str(parser_source), 'exec'), helpers)
gamemodes = items.json_kv(helpers['gamemode_blocks'](sources.read('gamemodes.txt')))['gamemodes.txt']
assert gamemodes['maps']['de_dust2']['ct_arms'] == 'models/weapons/ct_arms_idf.mdl'
raw = sources.read('models/weapons/ct_arms_idf.mdl')
mdl = MdlV49.from_buffer(MemoryBuffer(raw))
materials, textures = {}, {}

def extract_texture(path):
    path = path.lower().replace('\\', '/')
    if path in textures:
        return
    data = sources.read(path)
    pixels, width, height, is_float = load_vtf_texture(data)
    assert not is_float, 'Do not quantize float VTF'
    rgba = np.frombuffer(pixels, dtype=np.uint8).reshape(height, width, 4)
    png = encode_png(pixels, width, height, 4)
    output = OUT / 'textures' / (Path(path).stem + '-rgba.png')
    output.parent.mkdir(exist_ok=True)
    assert not output.exists() or output.read_bytes() == png, 'Texture filename collision'
    output.write_bytes(png)
    textures[path] = {'source': sources.reads[path], 'output': str(output.relative_to(OUT)),
        'pngSha256': items.digest(png), 'pixelSha256': items.digest(pixels),
        'width': width, 'height': height, 'channels': 'RGBA8 original decoded bytes',
        'min': rgba.min(axis=(0, 1)).tolist(), 'max': rgba.max(axis=(0, 1)).tolist()}

def extract_material(path):
    path = path.lower().replace('\\', '/')
    if path in materials:
        return
    data = sources.read(path)
    parsed = items.parse_kv(data, path)
    output = OUT / 'materials' / Path(path).name
    output.parent.mkdir(exist_ok=True)
    output.write_bytes(data)
    materials[path] = {'source': sources.reads[path], 'output': str(output.relative_to(OUT)), 'parsed': parsed}
    def walk(value):
        if not isinstance(value, dict):
            return
        for key, val in value.items():
            if key == 'include' and isinstance(val, str):
                extract_material(val)
            elif key in ('$basetexture', '$bumpmap', '$phongexponenttexture', '$lightwarptexture', '$phongwarptexture') and isinstance(val, str):
                extract_texture('materials/' + val.removesuffix('.vtf') + '.vtf')
            else:
                walk(val)
    walk(parsed)

for material in mdl.materials:
    candidates = ['materials/' + material.name + '.vmt']
    candidates += ['materials/' + folder + '/' + material.name + '.vmt' for folder in mdl.materials_paths]
    candidates = [path.lower().replace('\\', '/').replace('//', '/') for path in candidates]
    found = next((path for path in candidates if sources.exists(path)), None)
    assert found, f'Missing CT material {material.name}: {candidates}'
    extract_material(found)

metadata = {'context': context, 'source': sources.reads['models/weapons/ct_arms_idf.mdl'],
    'gamemodes': sources.reads['gamemodes.txt'], 'dust2': gamemodes['maps']['de_dust2'],
    'boneCount': len(mdl.bones), 'bones': [{'name': b.name, 'parent': b.parent_id,
        'position': list(b.position), 'quaternion': list(b.quat),
        'inverseBind': [list(row) for row in b.pose_to_bone.T] + [[0, 0, 0, 1]]} for b in mdl.bones],
    'materials': materials, 'textures': textures,
    'conversion': 'Native VTF decoded RGBA8 to lossless PNG; no PBR bake or color conversion',
    'sourceImporterSha256': hashlib.sha256((ROOT / 'scripts/import-source-weapon.py').read_bytes()).hexdigest()}
# Restore the CT skin's separately encoded raw bind matrices exactly. The AK's
# buffers, tracks, attachments and skin stay untouched and get compared to T.
audit = json.loads((OUT / 'audit.json').read_text())
glb_path = Path(audit['glb']['path'])
glb = bytearray(glb_path.read_bytes())
json_size = struct.unpack_from('<I', glb, 12)[0]
doc = json.loads(glb[20:20 + json_size])
skin = next(s for s in doc['skins'] if s['name'] == audit['arms']['armature_name'])
assert len(skin['joints']) == len(mdl.bones) == 48
accessor = doc['accessors'][skin['inverseBindMatrices']]
view = doc['bufferViews'][accessor['bufferView']]
assert accessor['type'] == 'MAT4' and accessor['componentType'] == 5126 and not view.get('byteStride')
binary_start = 28 + json_size
offset = binary_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
by_name = {b['name']: b for b in metadata['bones']}
ci = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=np.float64)
before_error = 0
for i, joint in enumerate(skin['joints']):
    b = by_name[doc['nodes'][joint]['name']]
    expected = np.asarray(np.asarray(b['inverseBind']) @ ci, dtype='<f4').flatten(order='F')
    previous = np.frombuffer(glb, dtype='<f4', count=16, offset=offset + i * 64).copy()
    before_error = max(before_error, float(np.abs(previous - expected).max()))
    assert before_error < .002, 'Unexpected CT inverse-bind coordinate layout'
    glb[offset + i * 64:offset + (i + 1) * 64] = expected.tobytes()
glb_path.write_bytes(glb)
audit['ctExactInverseBind'] = {'count': 48, 'formula': 'rawSourceIBM * inverse(C)',
    'maximumPreviousDifferenceSourceUnits': before_error, 'finalFloat32Difference': 0,
    'weaponBuffersModified': False}
audit['glb']['sha256'] = items.digest(glb)
(OUT / 'audit.json').write_text(json.dumps(audit, indent=2, ensure_ascii=False) + '\n')
metadata['exactInverseBind'] = audit['ctExactInverseBind']
metadata['glb'] = audit['glb']
(OUT / 'ct-metadata.json').write_text(json.dumps(metadata, indent=2, ensure_ascii=False, default=lambda v: v.tolist()) + '\n')
print('CT_VIEWMODEL_METADATA', json.dumps({'bones': len(mdl.bones), 'materials': list(materials), 'textures': len(textures)}))
