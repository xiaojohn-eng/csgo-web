"""Export the original tracer systems every weapon's `tracer_effect` names.

Why this exists
---------------
`items_game.txt` gives every weapon a `tracer_effect`, and the three systems it names
(`weapon_tracers_assrifle` for the rifles, `weapon_tracers_rifle` for the AWP,
`weapon_tracers_pistol` for the pistols) ship in `particles/weapons/cs_weapon_fx.pcf`.
A tracer is not a sprite card: the system draws a **trail** (`render_sprite_trail`) that
moves between two control points, so what the port has to reproduce is a streak along the
shot's own line, not a billboard at a point.

What is exported
----------------
* every attribute of the three systems and of each operator they carry, verbatim, so the
  runtime table is a statement about the shipped file rather than a summary of it;
* the schema and default of every operator those systems use that the PCF leaves empty,
  read from this build's own native tables;
* receipts for the material and its texture, and for the PCF itself.

Run: blender --background --factory-startup --python-exit-code 1 \
       --python scripts/export-source-tracers.py
"""
from __future__ import annotations
import hashlib
import importlib.util
import io
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))
OUT = ROOT / '.reference-assets/source-exports/tracers'

spec = importlib.util.spec_from_file_location('shell_items', ROOT / 'scripts/inventory-source-items.py')
items = importlib.util.module_from_spec(spec)
spec.loader.exec_module(items)

from SourceIO.library.utils import datamodel  # noqa: E402
from SourceIO.library.utils.pylib.image import encode_png  # noqa: E402
from SourceIO.library.utils.pylib.vtf import load_vtf_texture  # noqa: E402

PCF = 'particles/weapons/cs_weapon_fx.pcf'
NATIVE = ROOT / 'public/source/csgo-12426148/muzzle-particles/native-defaults.json'
ROOTS = ('weapon_tracers_assrifle', 'weapon_tracers_rifle', 'weapon_tracers_pistol')
COLLECTIONS = ('renderers', 'operators', 'initializers', 'emitters', 'children', 'forces', 'constraints')

items.initialize()
sources = items.Sources()
OUT.mkdir(parents=True, exist_ok=True)


def write(name: str, data: bytes) -> dict:
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    if path.read_bytes() != data:
        raise ValueError('Tracer export readback differs: ' + name)
    return dict(path=name, bytes=len(data), sha256=items.digest(data))


def scalar(value):
    """A DMX attribute in a stable, JSON-safe form. Element references keep their name."""
    if isinstance(value, datamodel.Element):
        return {'ref': value.type, 'name': value.name}
    if isinstance(value, bytes):
        return {'bytesHex': value.hex()}
    if isinstance(value, list):
        return [scalar(entry) for entry in value]
    return value


dm = datamodel.load(in_file=io.BytesIO(sources.read(PCF)))
systems = {e.name: e for e in dm.elements if e.type == 'DmeParticleSystemDefinition'}
missing = [name for name in ROOTS if name not in systems]
if missing:
    raise ValueError('Shipped PCF no longer defines the original tracer systems: ' + str(missing))

exported = {}
material_paths = set()
for root in ROOTS:
    system = systems[root]
    row = {str(key): scalar(value) for key, value in system.items() if str(key) not in COLLECTIONS}
    row['collections'] = {str(key): [entry.name for entry in (system.get(key) or [])] for key in COLLECTIONS}
    operators = {}
    for key in COLLECTIONS:
        for entry in (system.get(key) or []):
            operators[entry.name] = {str(field): scalar(value) for field, value in entry.items()}
    row['operators'] = operators
    # A tracer has no model: the material is the system's own, and every material it names has
    # to exist. A missing one is refused rather than replaced by something that looks similar.
    named = [row.get('material')] + [entry.get('material') for key in COLLECTIONS
                                     for entry in (system.get(key) or [])]
    for material in named:
        if not material:
            continue
        path = 'materials/' + str(material).replace('\\', '/').removesuffix('.vmt') + '.vmt'
        if not sources.exists(path):
            raise ValueError(f'{root} names a material this build does not ship: {path}')
        material_paths.add(path)
    exported[root] = row

# The operator closure in the shape `probe-source-pistol-particle-defaults.py` walks, so the
# schemas for these systems are read from this build's own registrations.
closure = []
seen_elements = set()
for root in ROOTS:
    row = exported[root]
    for key in COLLECTIONS:
        for name in row['collections'][key]:
            record = row['operators'].get(name)
            if record is None or name in seen_elements:
                continue
            seen_elements.add(name)
            closure.append(dict(id=name, name=name, type='DmeParticleOperator', attributes=dict(record)))
write('graph.json', (json.dumps(dict(format='source-tracers-closure-v1', roots=list(ROOTS),
                                     elements=closure), indent=2, ensure_ascii=False) + '\n').encode())

needed = set()
for row in exported.values():
    for key in COLLECTIONS:
        needed.update(row['collections'][key])
native_path = OUT / 'native-defaults.json'
native_source = native_path if native_path.exists() else NATIVE
native = json.loads(native_source.read_text())
schemas = {row['functionName']: row for row in native['operators']}
# The PCF spells one operator in lower case while this build registers it capitalised. The
# client's own table records that pair, so the resolution is read from it and recorded rather
# than guessed from the spelling.
aliases = {row['requested']: row['resolved'] for row in native.get('legacyAliases', [])}
resolutions = {name: aliases[name] for name in needed if name not in schemas and name in aliases}
unresolved = sorted(name for name in needed if name not in schemas and name not in aliases)
resolved = {name: schemas[resolutions.get(name, name)] for name in needed if name in schemas or name in resolutions}
documented = sorted(resolved)
if len(documented) < 8 or unresolved:
    raise ValueError('Native operator schemas for the tracer systems are missing: ' + str(unresolved))

material_rows = {}
for path in sorted(material_paths):
    raw = sources.read(path)
    definition = items.parse_kv(raw, path)
    if len(definition) != 1:
        raise ValueError('Original tracer material has several shaders: ' + path)
    shader, body = next(iter(definition.items()))
    textures = []
    if isinstance(body, dict):
        for key, value in body.items():
            if isinstance(value, str) and 'texture' in str(key).lower():
                texture = 'materials/' + value.replace('\\', '/').removesuffix('.vtf') + '.vtf'
                if not sources.exists(texture):
                    raise ValueError('Original tracer texture is absent: ' + texture)
                payload = sources.read(texture)
                if payload[:4] != b'VTF\0':
                    raise ValueError('Original tracer texture is not a VTF: ' + texture)
                width, height = struct.unpack_from('<HH', payload, 16)
                frames = struct.unpack_from('<H', payload, 24)[0]
                if frames != 1 or width < 1 or height < 1:
                    raise ValueError(f'{texture} does not hold exactly one usable frame')
                pixels, decoded_width, decoded_height, is_float = load_vtf_texture(payload)
                if is_float or (decoded_width, decoded_height) != (width, height):
                    raise ValueError(f'{texture} decodes to {decoded_width}x{decoded_height} '
                                     f'but declares {width}x{height}')
                png = encode_png(pixels, decoded_width, decoded_height, 4)
                if encode_png(pixels, decoded_width, decoded_height, 4) != png:
                    raise ValueError('Original tracer texture PNG is not reproducible: ' + texture)
                name = 'png/' + Path(texture).with_suffix('.png').name
                png_stamp = write(name, png)
                vtf_stamp = write('original/' + Path(texture).name, payload)
                rgba = hashlib.sha256(bytes(pixels)).hexdigest()
                textures.append(dict(parameter=str(key), source=texture, vtf=vtf_stamp, png=png_stamp,
                                     width=width, height=height, rgbaSha256=rgba,
                                     vtfVersion=list(struct.unpack_from('<II', payload, 4)),
                                     vtfHeaderBytes=struct.unpack_from('<I', payload, 12)[0],
                                     vtfFlags=struct.unpack_from('<I', payload, 20)[0],
                                     vtfMipCount=payload[56]))
    material_rows[path] = dict(source=path, shader=shader.strip('"'), body=body if isinstance(body, dict) else None,
                               textures=textures,
                               **write('original/' + Path(path).name, raw))

receipt = dict(
    format='source-tracers-v1', build=12426148, context=items.initialize(),
    pcf=dict(source=PCF, **write('original/cs_weapon_fx.pcf', sources.read(PCF))),
    effects=exported, materials=material_rows,
    nativeSchemas={name: resolved[name] for name in documented},
    operatorResolutions=resolutions, nativeUndocumented=unresolved,
    nativeSource=dict(path=str(native_source.relative_to(ROOT)) if native_source.is_relative_to(ROOT) else str(native_source),
                      sha256=hashlib.sha256(native_source.read_bytes()).hexdigest()),
    sourceFiles=sources.reads)
(OUT / 'tracers.json').write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + '\n')
(ROOT / 'research/source-tracers.json').write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + '\n')

print('TRACER_EXPORT', json.dumps({root: {key: exported[root][key] for key in
      ('max_particles', 'material', 'renderers', 'maximum draw distance')
      if key in exported[root]} for root in ROOTS}, ensure_ascii=False))
for root in ROOTS:
    print('---', root)
    print('  attributes', {k: v for k, v in exported[root].items()
                           if k not in ('operators', 'collections', 'fallback')})
    print('  collections', exported[root]['collections'])
    for name, record in exported[root]['operators'].items():
        print('   *', name, json.dumps(record, ensure_ascii=False))
print('materials', sorted(material_rows))
for path, row in sorted(material_rows.items()):
    print('  ', path, row['shader'], json.dumps(row['body'], ensure_ascii=False))
    print('     textures', json.dumps(row['textures'], ensure_ascii=False))
print('native schemas', documented)
print('operator resolutions', resolutions)
print('undocumented operators', unresolved)
