"""Extract the Dust2 cloud layer's second texture out of the original install.

The cloud layer this port draws is an `unlittwotexture` material whose own program multiplies
its two textures and the per-material modulation together
(`scripts/probe-source-cloud-layer-branch.py`). The first texture is already in the shipped
map's glTF material; the second one - the material's `$texture2` - is not, so this stores it
losslessly as PNG next to the map's other staged sky data.

Nothing is synthesised: a texture this script cannot store losslessly (a float texture, or one
the original stores as several frames) is refused, not converted.

Run: blender --background --factory-startup --python scripts/export-source-sky-cloud-texture.py
"""
from __future__ import annotations
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import runpy
import struct

ROOT = Path(__file__).resolve().parents[1]
MATERIALS = ROOT / '.reference-assets/source-exports/dust2/sky/skydome-materials.json'
OUT = ROOT / '.reference-assets/source-exports/dust2/sky'
CLOUD_MATERIAL = 'nuke_clouds_002'

OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'cloud-texture2.json').write_text(json.dumps({
    'status': 'running', 'startedAt': datetime.now(timezone.utc).isoformat()}) + '\n')

helpers = runpy.run_path(str(ROOT / 'scripts/inventory-source-items.py'))
environment = helpers['initialize']()
source = helpers['Sources']()
from SourceIO.library.utils.pylib.vtf import load_vtf_texture
from SourceIO.library.utils.pylib.image import encode_png
import numpy as np


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fail(message: str):
    raise SystemExit('export-source-sky-cloud-texture: ' + message)


materials = json.loads(MATERIALS.read_text())
cloud = next((row for row in materials if row['source'].endswith('/' + CLOUD_MATERIAL)), None)
if cloud is None or cloud['shader'] != 'unlittwotexture':
    fail('the staged skydome materials no longer carry the cloud layer')
base, second = cloud['parameters'].get('$basetexture'), cloud['parameters'].get('$texture2')
if not base or not second:
    fail('the cloud material no longer names both of its textures')
if cloud['parameters'].get('$translucent') != '1':
    fail('the cloud material is no longer the translucent branch this export is for')

path = 'materials/' + second + '.vtf'
if not source.exists(path):
    fail('the original install does not hold ' + path)
metadata = source.metadata(path)
if not isinstance(metadata.get('bytes'), int):
    fail('the VPK index records no size for ' + path)
source.read_budget = metadata['bytes'] + 16_000_000
data = source.read(path)
if data[:4] != b'VTF\0':
    fail(path + ' does not start with a VTF signature')
width, height = struct.unpack_from('<HH', data, 16)
frames = struct.unpack_from('<H', data, 24)[0]
flags = struct.unpack_from('<I', data, 20)[0]
if width < 1 or height < 1:
    fail(path + ' does not declare usable dimensions')
if frames != 1:
    fail(f'{path} stores {frames} frames; a multi-frame texture needs its own export')
pixels, decoded_width, decoded_height, is_float = load_vtf_texture(data)
if is_float:
    fail(path + ' is a float texture and needs a lossless export of its own')
if (decoded_width, decoded_height) != (width, height):
    fail(f'{path} decodes to {decoded_width}x{decoded_height} but declares {width}x{height}')
png = encode_png(pixels, decoded_width, decoded_height, 4)
target = OUT / (Path(second).name + '.png')
target.write_bytes(png)
rgba = np.frombuffer(pixels, np.uint8).reshape(decoded_height, decoded_width, 4)

report = {
    'status': 'cloud_texture2_extracted',
    'completedAt': datetime.now(timezone.utc).isoformat(),
    'environment': environment,
    'scriptSha256': digest(Path(__file__).read_bytes()),
    'materialsSha256': digest(MATERIALS.read_bytes()),
    'material': cloud['source'], 'shader': cloud['shader'],
    'baseTexture': base, 'texture2': second,
    'source': {'path': path, **metadata, 'sha256': digest(data)},
    'png': {'file': str(target.relative_to(ROOT)), 'bytes': len(png), 'sha256': digest(png)},
    'rgba8Sha256': digest(pixels),
    'width': width, 'height': height,
    'vtfVersion': list(struct.unpack_from('<II', data, 4)),
    'vtfHeaderBytes': struct.unpack_from('<I', data, 12)[0],
    'vtfFlags': flags,
    'vtfClampS': bool(flags & 0x4), 'vtfClampT': bool(flags & 0x8),
    'vtfEightBitAlpha': bool(flags & 0x2000),
    'vtfFrameCount': frames,
    'vtfHighResFormat': struct.unpack_from('<i', data, 52)[0],
    'vtfMipCount': data[56],
    'channels': {name: {'min': int(rgba[:, :, index].min()), 'max': int(rgba[:, :, index].max()),
                        'uniqueValues': int(len(np.unique(rgba[:, :, index]))),
                        'mean': float(rgba[:, :, index].mean())}
                 for index, name in enumerate('RGBA')},
    'sourceReads': source.reads,
    'boundaries': [
        'Original native VTF decoded and re-encoded losslessly to PNG; no colour, gamma or alpha conversion.',
        'This is the material\'s own $texture2, read from the texture path that material names.',
    ],
}
(OUT / 'cloud-texture2.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
print('CLOUD_TEXTURE2 ' + json.dumps({key: report[key] for key in
    ('material', 'texture2', 'width', 'height', 'vtfFlags', 'png', 'channels')}, ensure_ascii=False))
