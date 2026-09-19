"""Export the three original projectile/dropped models and raw VMT inputs.

Run with factory-startup Blender, just like import-source-shell-models.py.
Original files are read only; generated files have their own asset directory.
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))
OUT = ROOT / '.reference-assets/source-exports/fidelity-grenades-20260913'
DEST = ROOT / 'public/source/csgo-12426148/grenade-models'
OUT.mkdir(parents=True, exist_ok=True)
DEST.mkdir(parents=True, exist_ok=True)

import bpy
from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager import ContentManager
from SourceIO.library.shared.content_manager.providers.loose_files import LooseFilesContentProvider
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.utils import TinyPath, MemoryBuffer
from SourceIO.library.utils.pylib.vtf import load_vtf_texture
from SourceIO.library.utils.pylib.image import encode_png
from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.blender_bindings.models import import_model
from SourceIO.blender_bindings.operators.import_settings_base import ModelOptions
from SourceIO.blender_bindings.models.common import put_into_collections

spec = importlib.util.spec_from_file_location('grenade_items', ROOT / 'scripts/inventory-source-items.py')
items = importlib.util.module_from_spec(spec)
spec.loader.exec_module(items)
context = items.initialize()
sources = items.Sources()
sources.read_budget = 192_000_000
catalog = json.loads((ROOT / 'research/source-items-catalog.json').read_text())
names = dict(he='weapon_hegrenade', smoke='weapon_smokegrenade', flash='weapon_flashbang')
sha = lambda raw: hashlib.sha256(raw).hexdigest()
receipt = dict(format='source-grenade-models-v1', build=12426148, context=context,
               metersPerSourceUnit=.0254, models={}, textures={}, materials={}, files=[])
colliders = {}

def write(name, raw):
    for directory in (OUT, DEST):
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        assert path.read_bytes() == raw
    row = dict(path=name, bytes=len(raw), sha256=sha(raw))
    receipt['files'].append(row)
    return row

def texture(reference):
    source = 'materials/' + reference.replace('\\', '/').removesuffix('.vtf') + '.vtf'
    if source in receipt['textures']:
        return receipt['textures'][source]['png']['path']
    raw = sources.read(source)
    pixels, width, height, is_float = load_vtf_texture(raw)
    if is_float:
        raise ValueError('Unexpected floating-point grenade texture: ' + source)
    path = 'textures/' + sha(source.encode())[:16] + '.png'
    receipt['textures'][source] = dict(source=source, sourceBytes=len(raw), sourceSha256=sha(raw),
        width=width, height=height, rgbaSha256=sha(bytes(pixels)), png=write(path, encode_png(pixels,width,height,4)))
    return path

cm = ContentManager()
cm.clean()
providers = []
install = ROOT / '.reference-assets/csgo-legacy'
for folder, pak in ((install/'csgo','pak01_dir.vpk'), (install/'platform','platform_pak01_dir.vpk')):
    if not folder.is_dir():
        continue
    providers.append(LooseFilesContentProvider(TinyPath(str(folder)), SteamAppId.COUNTER_STRIKE_GO))
    if (folder/pak).exists():
        providers.append(VPKContentProvider(TinyPath(str(folder/pak)), SteamAppId.COUNTER_STRIKE_GO))
for provider in providers:
    cm.add_child(provider)
cm.priority_list = providers[:]

for kind, item_name in names.items():
    definition = next(w['resolvedDefinition'] for w in catalog['weapons'] if w['name']==item_name)
    source = definition['model_dropped']
    raw = sources.read(source)
    mdl = MdlV49.from_buffer(MemoryBuffer(raw))
    model_files = {}
    for suffix in ('.mdl','.vvd','.dx90.vtx','.phy'):
        path = source[:-4] + suffix
        if sources.exists(path):
            data = sources.read(path)
            model_files[suffix] = dict(source=path, bytes=len(data), sha256=sha(data))
    material_bindings = {}
    for material in mdl.materials:
        candidates = ['materials/'+str(directory).replace('\\','/').strip('/')+'/'+material.name+'.vmt'
                      for directory in mdl.materials_paths]
        path = next((path for path in candidates if sources.exists(path)), None)
        if path is None:
            raise ValueError('Missing original grenade material '+material.name)
        vmt = sources.read(path)
        parsed = items.parse_kv(vmt,path)
        shader, params = next(iter(parsed.items()))
        if shader.lower() == 'patch':
            raise ValueError('Grenade material patch must be resolved explicitly '+path)
        inputs = {}
        for key in ('$basetexture','$bumpmap','$phongexponenttexture','$lightwarptexture','$envmapmask'):
            if params.get(key):
                inputs[key] = texture(params[key])
        receipt['materials'][path] = dict(source=path, sourceSha256=sha(vmt), sourceBytes=len(vmt),
            shader=shader, parameters=params, textures=inputs, rawVmt=vmt.decode('utf-8-sig'))
        material_bindings[material.name] = path
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    options = ModelOptions.default()
    options.scale = 1.0
    options.import_animations = False
    options.import_include_animations = False
    # Runtime binds the verified raw VTF pixels and VMT parameters below. Do
    # not invoke SourceIO's UI texture-cache/material node setup in background.
    options.import_textures = False
    options.load_refpose = False
    options.use_bvlg = False
    container = import_model(TinyPath(source), MemoryBuffer(raw), cm, options, SteamAppId.COUNTER_STRIKE_GO)
    if container is None or not container.objects:
        raise ValueError('No grenade geometry imported '+source)
    put_into_collections(container,kind,bodygroup_grouping=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in ([container.armature] if container.armature else []) + list(container.objects):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = container.armature or container.objects[0]
    target = OUT / (kind+'.glb')
    desired = dict(filepath=str(target),export_format='GLB',use_selection=True,export_animations=False,
        export_skins=True,export_all_influences=True,export_def_bones=False,export_extras=True,export_tangents=True)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties
    assert bpy.ops.export_scene.gltf(**{k:v for k,v in desired.items() if k in props}) == {'FINISHED'}
    payload = target.read_bytes()
    length, tag = struct.unpack_from('<II',payload,12)
    assert tag == 0x4e4f534a
    gltf = json.loads(payload[20:20+length])
    # The solid body alone supplies a convex collision hull; pin and spoon are
    # detachable bodygroups. Freeze the exported Y-up frame and use the same
    # centre in physics and rendering, so the model cannot float around a .12m
    # sphere. These are geometry-derived collision shapes, not original PHY.
    body = next(obj for obj in container.objects if not obj.name.endswith(('_pin','_spoon')))
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
    points = [[float(p.x)*.0254,float(p.z)*.0254,-float(p.y)*.0254] for p in points]
    evaluated.to_mesh_clear()
    low = [min(p[i] for p in points) for i in range(3)]
    high = [max(p[i] for p in points) for i in range(3)]
    centre = [(a+b)/2 for a,b in zip(low,high)]
    unique = sorted(set(tuple(round(p[i]-centre[i],7) for i in range(3)) for p in points))
    colliders[kind] = dict(centreMetres=centre, spanMetres=[b-a for a,b in zip(low,high)],
        hullMetres=[coordinate for p in unique for coordinate in p])
    receipt['models'][kind] = dict(source=source, item=item_name, files=model_files,
        glb=write(kind+'.glb',payload), materialBindings=material_bindings,
        gltfMaterials=[m.get('name') for m in gltf.get('materials',[])],
        geometry=[dict(name=obj.name,vertices=len(obj.data.vertices),polygons=len(obj.data.polygons)) for obj in container.objects],
        bones=[bone.name for bone in container.armature.data.bones] if container.armature else [],
        throwVelocityUnits=float(definition['attributes']['throw velocity']),
        collider=dict(centreMetres=centre,spanMetres=colliders[kind]['spanMetres'],points=len(unique),
                      source='convex hull of original visual body; not original PHY'))

receipt['sourceFiles'] = sources.reads
receipt['limitations'] = ['Raw original dropped/projectile models. Held viewmodel animation is owned separately.',
    'Geometry uses the SourceIO glTF Z-up to Y-up conversion; runtime applies .0254 units exactly once.',
    'Physics collision shape is independent of the visual model. Rapier is not the original VPhysics solver.']
raw = (json.dumps(receipt,indent=2,ensure_ascii=False)+'\n').encode()
for folder in (OUT,DEST):
    (folder/'manifest.json').write_bytes(raw)
(ROOT/'game/source-grenade-contract.json').write_text(json.dumps(dict(build=12426148,manifestSha256=sha(raw)),indent=2)+'\n')
(ROOT/'game/source-grenade-colliders.ts').write_text('// Generated from original grenade body geometry by import-source-grenade-models.py.\n'
    + 'export const SOURCE_GRENADE_COLLIDERS: Record<"he"|"smoke"|"flash", {centreMetres:number[];spanMetres:number[];hullMetres:number[]}> = '
    + json.dumps(colliders,separators=(',',':'))+';\n')
print('GRENADE_EXPORT',json.dumps({k:dict(source=r['source'],glb=r['glb'],geometry=r['geometry'],materials=r['gltfMaterials'])
                                 for k,r in receipt['models'].items()}))
