"""Import the three original shell-casing models into glTF for the port.

The three systems in `cs_weapon_fx.pcf` draw a model, not a sprite
(`models/weapons/shared/shell_{762,50cal,9mm}_hr.mdl`), so the port needs their geometry
in a format a browser can read. This uses the same Blender-side SourceIO import and glTF
export the weapon viewmodels already go through, one model at a time, and records the
byte and pixel receipts of everything it read.

Run: Blender --background --factory-startup --python-exit-code 1 \
       --python scripts/import-source-shell-models.py
"""
from __future__ import annotations
import hashlib
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))
OUT = ROOT / '.reference-assets/source-exports/shell-models'
INSTALL = ROOT / '.reference-assets/csgo-legacy'
GAME = INSTALL / 'csgo'
OUT.mkdir(parents=True, exist_ok=True)

MODELS = {
    'shell_762': 'models/models/weapons/shared/shell_762_hr.mdl',
    'shell_50cal': 'models/models/weapons/shared/shell_50cal_hr.mdl',
    'shell_9mm': 'models/models/weapons/shared/shell_9mm_hr.mdl',
}
TEXTURES = ['materials/models/weapons/shared/shells/shells.vtf']


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write(name: str, data: bytes) -> dict:
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    if path.read_bytes() != data:
        raise ValueError('Shell model export readback differs: ' + name)
    return dict(path=name, bytes=len(data), sha256=digest(data))


import bpy  # noqa: E402

from SourceIO.library.shared.app_id import SteamAppId  # noqa: E402
from SourceIO.library.shared.content_manager import ContentManager  # noqa: E402
from SourceIO.library.shared.content_manager.providers.loose_files import LooseFilesContentProvider  # noqa: E402
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider  # noqa: E402
from SourceIO.library.utils import TinyPath  # noqa: E402
from SourceIO.library.utils.pylib.vtf import load_vtf_texture  # noqa: E402
from SourceIO.library.utils.pylib.image import encode_png  # noqa: E402
from SourceIO.blender_bindings.models import import_model  # noqa: E402
from SourceIO.blender_bindings.operators.import_settings_base import ModelOptions  # noqa: E402
from SourceIO.blender_bindings.models.common import put_into_collections  # noqa: E402

if not bpy.app.background or '--factory-startup' not in sys.argv:
    raise ValueError('Independent factory-startup Blender required')

cm = ContentManager()
cm.clean()
providers = []
for folder, pak_name in ((GAME, 'pak01_dir.vpk'), (INSTALL / 'platform', 'platform_pak01_dir.vpk')):
    if not folder.is_dir():
        continue
    providers.append(LooseFilesContentProvider(TinyPath(str(folder)), SteamAppId.COUNTER_STRIKE_GO))
    if (folder / pak_name).exists():
        providers.append(VPKContentProvider(TinyPath(str(folder / pak_name)), SteamAppId.COUNTER_STRIKE_GO))
for provider in providers:
    cm.add_child(provider)
cm.priority_list = providers[:]

receipt = {'format': 'source-shell-models-v1', 'build': 12426148, 'models': {}, 'textures': [],
           'mounts': [str(provider.filepath) for provider in providers]}

for name, source in MODELS.items():
    buffer = cm.find_file(TinyPath(source))
    if buffer is None:
        raise ValueError('Original shell model is absent: ' + source)
    raw = buffer.read()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    options = ModelOptions.default()
    options.scale = 1.0
    options.import_animations = False
    options.import_include_animations = False
    options.import_textures = True
    options.load_refpose = False
    options.use_bvlg = False
    buffer.seek(0)
    container = import_model(TinyPath(source), buffer, cm, options, SteamAppId.COUNTER_STRIKE_GO)
    if container is None or not container.objects:
        raise ValueError('Shell model imported nothing: ' + source)
    put_into_collections(container, name, bodygroup_grouping=True)
    bpy.ops.object.select_all(action='DESELECT')
    selected = []
    for obj in [*( [container.armature] if container.armature else []), *container.objects, *container.attachments]:
        obj.select_set(True)
        selected.append(obj.name)
    bpy.context.view_layer.objects.active = container.armature or container.objects[0]
    target = OUT / f'{name}.glb'
    properties = bpy.ops.export_scene.gltf.get_rna_type().properties
    desired = {'filepath': str(target), 'export_format': 'GLB', 'use_selection': True,
               'export_animations': False, 'export_skins': True, 'export_all_influences': True,
               'export_def_bones': False, 'export_extras': True, 'export_tangents': True}
    kwargs = {key: value for key, value in desired.items() if key in properties}
    if bpy.ops.export_scene.gltf(**kwargs) != {'FINISHED'}:
        raise ValueError('Shell model glTF export failed: ' + name)
    payload = target.read_bytes()
    length, kind = struct.unpack_from('<II', payload, 12)
    if kind != 0x4E4F534A:
        raise ValueError('Shell model glTF has no JSON chunk: ' + name)
    geometry = [dict(name=obj.name, vertices=len(obj.data.vertices), polygons=len(obj.data.polygons),
                     materials=[material.name if material else None for material in obj.data.materials])
                for obj in container.objects]
    receipt['models'][name] = dict(
        source=source, sourceBytes=len(raw), sourceSha256=digest(raw),
        glb=write(f'{name}.glb', payload), selected=selected, geometry=geometry,
        bones=[bone.name for bone in container.armature.data.bones] if container.armature else [])

for path in TEXTURES:
    buffer = cm.find_file(TinyPath(path))
    if buffer is None:
        raise ValueError('Original shell texture is absent: ' + path)
    raw = buffer.read()
    pixels, width, height, is_float = load_vtf_texture(raw)
    if is_float:
        raise ValueError('Floating-point shell texture needs a separate export: ' + path)
    png = encode_png(pixels, width, height, 4)
    receipt['textures'].append(dict(source=path, sourceBytes=len(raw), sourceSha256=digest(raw),
                                    width=width, height=height, png=write(Path(path).stem + '.png', png),
                                    rgbaSha256=digest(bytes(pixels))))

(OUT / 'receipt.json').write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + '\n')
print('SHELL_MODELS', json.dumps({name: (row['glb']['bytes'], row['geometry']) for name, row in receipt['models'].items()},
                                 ensure_ascii=False))
print('textures', [(row['source'], row['width'], row['height'], row['png']['bytes']) for row in receipt['textures']])
