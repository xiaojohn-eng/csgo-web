"""Export the original shell-casing systems the weapons eject on every shot.

Why this exists
---------------
`items_game.txt` names an `eject_brass_effect` for every weapon
(`weapon_shell_casing_rifle` / `_50cal` / `_9mm`), and those three systems ship in
`particles/weapons/cs_weapon_fx.pcf` with their own model, gravity, drag, lifetime,
spin rates, spawn velocity and collision response. None of it was read before, so the
port drew a procedurally invented brass case with invented physics.

What is exported
----------------
* every attribute of the three systems and of each operator they carry, verbatim, so the
  runtime table is a statement about the shipped file rather than a summary of it;
* the schema and default of every operator those systems use that the PCF leaves empty
  (`Alpha Fade Out Random`, `Rotation Random`, and the rest), read from this build's own
  native tables;
* receipts for the models, their vertex data, their material and their texture, and for
  the PCFs themselves.

The three models ship at `models/models/weapons/shared/...` in this depot while their own
internal name is `models/weapons/shared/...` — the same name the PCF asks for. Both facts
are recorded rather than reconciled by guessing.

Run: Blender --background --factory-startup --python-exit-code 1 \
       --python scripts/export-source-shell-casings.py
"""
from __future__ import annotations
import hashlib
import importlib.util
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))
OUT = ROOT / '.reference-assets/source-exports/shell-casings'

spec = importlib.util.spec_from_file_location('shell_items', ROOT / 'scripts/inventory-source-items.py')
items = importlib.util.module_from_spec(spec)
spec.loader.exec_module(items)

from SourceIO.library.utils import datamodel, MemoryBuffer  # noqa: E402
from SourceIO.library.models.mdl.v49 import MdlV49  # noqa: E402

PCF = 'particles/weapons/cs_weapon_fx.pcf'
NATIVE = ROOT / 'public/source/csgo-12426148/muzzle-particles/native-defaults.json'
ROOTS = ('weapon_shell_casing_rifle', 'weapon_shell_casing_50cal', 'weapon_shell_casing_9mm')
COLLECTIONS = ('renderers', 'operators', 'initializers', 'emitters', 'children', 'forces', 'constraints')

items.initialize()
sources = items.Sources()
OUT.mkdir(parents=True, exist_ok=True)


def write(name: str, data: bytes) -> dict:
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    if path.read_bytes() != data:
        raise ValueError('Shell casing export readback differs: ' + name)
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
    raise ValueError('Shipped PCF no longer defines the original casing systems: ' + str(missing))

exported = {}
for root in ROOTS:
    system = systems[root]
    row = {str(key): scalar(value) for key, value in system.items() if str(key) not in COLLECTIONS}
    row['collections'] = {str(key): [entry.name for entry in (system.get(key) or [])] for key in COLLECTIONS}
    operators = {}
    for key in COLLECTIONS:
        for entry in (system.get(key) or []):
            operators[entry.name] = {str(field): scalar(value) for field, value in entry.items()}
    row['operators'] = operators
    # The fallback each system names has to exist; the port reports it rather than
    # silently using the primary model at every distance.
    fallback = system.get('fallback replacement definition')
    if fallback:
        if fallback not in systems:
            raise ValueError('Original casing fallback is not a system in the PCF: ' + str(fallback))
        target = systems[fallback]
        row['fallback'] = {str(key): scalar(value) for key, value in target.items() if str(key) not in COLLECTIONS}
        row['fallback']['collections'] = {str(key): [entry.name for entry in (target.get(key) or [])]
                                          for key in COLLECTIONS}
        row['fallback']['operators'] = {entry.name: {str(field): scalar(value) for field, value in entry.items()}
                                        for key in COLLECTIONS for entry in (target.get(key) or [])}
    exported[root] = row

# The operator closure in the shape `probe-source-pistol-particle-defaults.py` walks, so the
# schemas for these systems are read from this build's own registrations rather than reused
# from another closure's table.
closure = []
seen_elements = set()
for root in ROOTS:
    row = exported[root]
    names = [name for key in COLLECTIONS for name in row['collections'][key]]
    if 'fallback' in row:
        names += [name for key in COLLECTIONS for name in row['fallback']['collections'][key]]
    for name in names:
        record = row['operators'].get(name) or (row.get('fallback') or {}).get('operators', {}).get(name)
        if record is None or name in seen_elements:
            continue
        seen_elements.add(name)
        closure.append(dict(id=name, name=name, type='DmeParticleOperator', attributes=dict(record)))
write('graph.json', (json.dumps(dict(format='source-shell-casings-closure-v1', roots=list(ROOTS),
                                     elements=closure), indent=2, ensure_ascii=False) + '\n').encode())

# The operators these systems use but whose PCF blocks leave empty: the runtime needs the
# schema and default this build itself applies, not an assumption about them. The probe that
# reads them from the client writes `native-defaults.json` beside this file.
needed = set()
for row in exported.values():
    for name in row['collections']['operators'] + row['collections']['initializers'] + \
            row['collections']['emitters'] + row['collections']['constraints'] + row['collections']['renderers']:
        needed.add(name)
native_path = OUT / 'native-defaults.json'
native_source = native_path if native_path.exists() else NATIVE
native = json.loads(native_source.read_text())
schemas = {row['functionName']: row for row in native['operators']}
documented = sorted(needed & set(schemas))
undocumented = sorted(needed - set(schemas))
if len(documented) < 8:
    raise ValueError('Native operator schemas for the casing systems are missing: ' + str(undocumented))

# Models, vertex data, material and texture the three systems draw.
model_rows = {}
material_paths = set()
for root, row in exported.items():
    reference = row['operators']['Render models']['sequence 0 model']
    normalized = reference.replace('\\', '/').lower()
    base = normalized[:-4] if normalized.endswith('.mdl') else normalized
    files = {}
    for suffix in ('.mdl', '.vvd', '.dx90.vtx', '.phy'):
        # This depot stores these four models under a doubled `models/models/...` prefix while
        # the model's own internal name (and the PCF's reference) carries a single one; both
        # spellings are tried and the one that resolved is recorded.
        candidates = [base + suffix, 'models/' + base + suffix]
        found = next((name for name in candidates if sources.exists(name)), None)
        if found is None:
            continue
        payload = sources.read(found)
        files[suffix] = dict(source=found, **write('original/' + Path(found).name, payload))
    if '.mdl' not in files or '.vvd' not in files or '.dx90.vtx' not in files:
        raise ValueError('Original casing model is incomplete: ' + reference)
    mdl = MdlV49.from_buffer(MemoryBuffer(sources.read(files['.mdl']['source'])))
    model_rows[root] = dict(
        reference=reference, internalName=mdl.header.name, bone=[b.name for b in mdl.bones],
        vertices=[part_model.vertex_count for part in mdl.body_parts for part_model in part.models],
        materialPaths=[str(path) for path in mdl.materials_paths],
        materials=[material.name for material in mdl.materials],
        surfaceProp=mdl.header.surface_prop, files=files)
    for path in mdl.materials_paths:
        for material in mdl.materials:
            material_paths.add('materials/' + str(path).replace('\\', '/').strip('/') + '/' + material.name + '.vmt')

material_rows = {}
for path in sorted(material_paths):
    if not sources.exists(path):
        raise ValueError('Original casing material is absent: ' + path)
    raw = sources.read(path)
    definition = items.parse_kv(raw, path)
    if len(definition) != 1:
        raise ValueError('Original casing material has several shaders: ' + path)
    shader, body = next(iter(definition.items()))
    textures = []
    if isinstance(body, dict):
        for key, value in body.items():
            if isinstance(value, str) and 'texture' in str(key).lower():
                texture = 'materials/' + value.replace('\\', '/').removesuffix('.vtf') + '.vtf'
                if not sources.exists(texture):
                    raise ValueError('Original casing texture is absent: ' + texture)
                textures.append(dict(parameter=str(key), source=texture, **write('original/' + Path(texture).name,
                                                                               sources.read(texture))))
    material_rows[path] = dict(source=path, shader=shader.strip('"'), textures=textures,
                               **write('original/' + Path(path).name, raw))

receipt = dict(
    format='source-shell-casings-v1', build=12426148, context=items.initialize(),
    pcf=dict(source=PCF, **write('original/cs_weapon_fx.pcf', sources.read(PCF))),
    effects=exported, models=model_rows, materials=material_rows,
    nativeSchemas={name: schemas[name] for name in documented}, nativeUndocumented=undocumented,
    nativeSource=dict(path=str(native_source.relative_to(ROOT)) if native_source.is_relative_to(ROOT) else str(native_source),
                      sha256=hashlib.sha256(native_source.read_bytes()).hexdigest()),
    sourceFiles=sources.reads,
    limitations=[
        '`Collision via traces` is applied against the level\'s own collision; the operator\'s "brush only" flag is honoured as "the level, not actors or dynamic props".',
        '`Alpha Fade Out Random` ships with every field at this build\'s default of zero, so no alpha fade is applied.',
        'The fallback systems are exported but the primary model is drawn at every distance.',
        'The emitter frame is the weapon\'s own shell-eject attachment; the PCF names the velocity as local to the emitter and does not name the attachment itself.',
    ])
(OUT / 'shell-casings.json').write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + '\n')
(ROOT / 'research/source-shell-casings.json').write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + '\n')

print('SHELL_EXPORT', json.dumps({root: {key: exported[root][key] for key in
      ('max_particles', 'radius', 'material', 'maximum draw distance')} for root in ROOTS}, ensure_ascii=False))
print('models', {root: (model_rows[root]['internalName'], model_rows[root]['vertices'],
                        model_rows[root]['files']['.mdl']['source']) for root in ROOTS})
print('materials', sorted(material_rows))
print('native schemas', documented)
print('undocumented operators', undocumented)
