"""Export what the original build decides when a bullet lands on a surface.

Why this exists
---------------
A shot that misses an actor still has an original outcome: the surface it hit
picks an impact sound and a bullet decal. Which surface a face is comes from the
material's own `$surfaceprop`; the group that names the sound and the decal list
comes from `scripts/surfaceproperties_cs.txt`; the game material letter that
selects the decal group comes from that file's `gamematerial`; the letter-to-group
table and the per-group decal lists come from `scripts/decals_subrect.txt`; and
each decal's atlas rectangle comes from its own `_subrect` VMT. None of that was
read before, so nothing in the port could place an original decal or play an
original impact sound.

What this file does NOT do
--------------------------
* It does not guess a surface for a face whose material declares no
  `$surfaceprop`; those sides contribute nothing and the brush is reported as
  unresolved instead of being assigned the `default` group.
* It does not invent a decal for a game material letter that
  `scripts/decals_subrect.txt` does not map (the shipped table deliberately leaves
  several letters out).
* It does not decode the `Subrect` shader; it records the atlas, the rectangle and
  the original scale/variation numbers so the port can be measured against them.

Run: Blender --background --factory-startup --python-exit-code 1 \
       --python scripts/export-source-surface-props.py
"""
from __future__ import annotations
import hashlib
import importlib.util
import io
import json
import struct
import sys
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))
OUT = ROOT / '.reference-assets/source-exports/impact'
MAP = ROOT / 'output/source1/de_dust2'

spec = importlib.util.spec_from_file_location('impact_items', ROOT / 'scripts/inventory-source-items.py')
items = importlib.util.module_from_spec(spec)
spec.loader.exec_module(items)

from SourceIO.library.utils.pylib.image import encode_png  # noqa: E402
from SourceIO.library.utils.pylib.vtf import load_vtf_texture  # noqa: E402
from SourceIO.library.utils import MemoryBuffer  # noqa: E402
from SourceIO.library.models.mdl.v49 import MdlV49  # noqa: E402

SURFACE_SCRIPT = 'scripts/surfaceproperties_cs.txt'
MANIFEST_SCRIPT = 'scripts/surfaceproperties_manifest.txt'
DECAL_SCRIPT = 'scripts/decals_subrect.txt'
SOUND_MANIFEST = 'scripts/game_sounds_manifest.txt'
atlas_cache: dict[str, dict] = {}


def write(name: str, data: bytes) -> dict:
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    if path.read_bytes() != data:
        raise ValueError('Impact export readback differs: ' + name)
    return dict(path=name, bytes=len(data), sha256=items.digest(data))


def jsonfile(name: str, data) -> dict:
    return write(name, (json.dumps(data, indent=2, ensure_ascii=False) + '\n').encode())


# --------------------------------------------------------------------------- #
# original scripts
# --------------------------------------------------------------------------- #
context = items.initialize()
sources = items.Sources()
manifest_text = sources.read(MANIFEST_SCRIPT).decode('utf-8-sig')
if 'surfaceproperties_cs.txt' not in manifest_text:
    raise ValueError('Shipped surface manifest no longer names surfaceproperties_cs.txt')
surface_kv = items.parse_kv(sources.read(SURFACE_SCRIPT), SURFACE_SCRIPT)
decal_kv = items.parse_kv(sources.read(DECAL_SCRIPT), DECAL_SCRIPT)

# Original group spelling is mixed case (`Wood`, `Wood_Panel`) while the materials
# that reference it are lowercase (`$surfaceprop "wood"`). Both spellings ship in
# this build, and each lowercase name has exactly one group, so the lookup this
# export performs is case-insensitive over a table proven unambiguous.
groups: dict[str, dict] = {}


def repeated_last(value):
    """The shipped file documents that a group listed twice overrides itself."""
    return value[-1] if isinstance(value, list) else value


# The shipped parser folds every key to lower case, and the shipped files lean on
# that: `scripts/surfaceproperties_cs.txt` spells groups `Wood`/`Wood_Panel` while
# the materials that use them say `$surfaceprop "wood"`/`"wood_panel"`. The table
# below is therefore keyed by the folded name on both sides, and a group set that
# would collide once folded is rejected rather than silently merged.
for raw_name, raw_body in surface_kv.items():
    name = str(raw_name).casefold()
    body = repeated_last(raw_body)
    if not isinstance(body, dict):
        raise ValueError('Original surface group is not a block: ' + name)
    if name in groups:
        raise ValueError('Original surface groups collide without case: ' + name)
    groups[name] = body

resolution: dict[str, dict] = {}


def resolve_group(name: str) -> dict:
    """Walk `base` the way the shipped file documents: absent keys inherit."""
    if name in resolution:
        return resolution[name]
    if name not in groups:
        raise ValueError('Unknown original surface group: ' + name)
    chain = []
    current = name
    merged: dict[str, object] = {}
    seen = set()
    while True:
        if current in seen:
            raise ValueError('Original surface group base cycle at ' + current)
        seen.add(current)
        chain.append(current)
        body = groups[current]
        for key, value in body.items():
            if key == 'base' or key in merged:
                continue
            merged[key] = repeated_last(value)
        base = repeated_last(body.get('base'))
        if base is None:
            break
        if not isinstance(base, str):
            raise ValueError('Conditional surface base in ' + current)
        current = str(base).casefold()
        if current not in groups:
            raise ValueError('Unknown original surface base ' + base + ' referenced by ' + name)
    value = dict(name=name, baseChain=chain, **merged)
    resolution[name] = value
    return value


def surface_group_for(surface_prop: str) -> dict:
    folded = str(surface_prop).casefold()
    if folded not in groups:
        raise ValueError('Surface property is not a group in the shipped file: ' + surface_prop)
    return resolve_group(folded)


# --------------------------------------------------------------------------- #
# decal groups and atlas rectangles
# --------------------------------------------------------------------------- #
# The shipped parser folds keys, so the translation block and its group names are
# read in their folded spelling on both sides of the lookup.
translation = repeated_last(decal_kv.get('translationdata'))
if not isinstance(translation, dict):
    raise ValueError('Shipped decal script has no TranslationData block')
if repeated_last(translation.get('-')) != '':
    raise ValueError('Shipped TranslationData no longer refuses decals with "-"')
game_material_to_group = {}
for letter, target in translation.items():
    target = repeated_last(target)
    if not isinstance(target, str):
        raise ValueError('Conditional decal translation for ' + letter)
    game_material_to_group[str(letter)] = target.casefold()

decal_groups: dict[str, list] = {}
for group, raw_body in decal_kv.items():
    body = repeated_last(raw_body)
    if group in ('translationdata', 'models') or not isinstance(body, dict):
        continue
    entries = []
    for material, weight in body.items():
        entries.append(dict(material=str(material).replace('\\', '/').lower(),
                            weight=float(repeated_last(weight))))
    if entries:
        decal_groups[group] = entries


def decal_definition(material: str) -> dict:
    """Read one decal material's own VMT; a `_subrect` decal names its atlas."""
    path = 'materials/' + material.lower() + '.vmt'
    if not sources.exists(path):
        raise ValueError('Original decal material is absent: ' + path)
    definition = items.parse_kv(sources.read(path), path)
    if len(definition) != 1:
        raise ValueError('Original decal material has several shaders: ' + path)
    shader, body = next(iter(definition.items()))
    if not isinstance(body, dict):
        raise ValueError('Original decal body is not a block: ' + path)
    flat = {key.casefold(): repeated_last(value) for key, value in body.items()}
    for key, value in flat.items():
        if isinstance(value, dict):
            raise ValueError(f'Conditional decal value {key} in {path}')
    return dict(source=path, shader=shader.strip('"'), parameters=flat)


def parse_pair(text, label, path):
    parts = str(text).split()
    if len(parts) != 2:
        raise ValueError(f'Original decal {label} is not a pair: {path} {text!r}')
    return [float(parts[0]), float(parts[1])]


used_decals = sorted({entry['material'] for entries in decal_groups.values() for entry in entries})
decal_materials: dict[str, dict] = {}


def texture_extent(path: str):
    if not sources.exists(path):
        return None
    data = sources.read(path)
    if data[:4] != b'VTF\0':
        return None
    return [struct.unpack_from('<H', data, 16)[0], struct.unpack_from('<H', data, 18)[0]]


def model_decal_scale(material: str):
    """The decal's own standalone material, which the same decal also ships as.
     Read so the size convention can be cross-checked instead of assumed.
    """
    path = 'materials/' + material + '.vmt'
    if not material or not sources.exists(path):
        return None, None
    definition = items.parse_kv(sources.read(path), path)
    if len(definition) != 1:
        return None, None
    body = next(iter(definition.values()))
    if not isinstance(body, dict):
        return None, None
    flat = {str(key).casefold(): repeated_last(value) for key, value in body.items()}
    scale = flat.get('$decalscale')
    return (float(scale) if scale is not None else None), texture_extent(path[:-4] + '.vtf')
for material in used_decals:
    row = decal_definition(material)
    flat = row['parameters']
    if row['shader'].casefold() != 'subrect':
        # Only the shipped `Subrect` decals carry an atlas rectangle; a decal that
        # is not one is recorded unresolved rather than given a made-up rect.
        row['atlas'] = None
        row['resolved'] = False
        decal_materials[material] = row
        continue
    row['atlas'] = str(flat.get('$material', '')).replace('\\', '/').lower()
    row['pos'] = parse_pair(flat['$pos'], '$Pos', row['source'])
    row['size'] = parse_pair(flat['$size'], '$Size', row['source'])
    # The shipped set is not uniform: a decal that names no scale ships without one,
    # and a placeholder decal ships a zero rectangle. Both stay unresolved here so the
    # runtime refuses them instead of drawing a decal the original did not describe.
    row['decalScale'] = float(flat['$decalscale']) if '$decalscale' in flat else None
    row['decalScaleVariation'] = float(flat['$decalscalevariation']) if '$decalscalevariation' in flat else None
    row['modelMaterial'] = str(flat.get('$modelmaterial', '')).replace('\\', '/').lower()
    row['resolved'] = bool(row['atlas']) and row['size'][0] > 0 and row['size'][1] > 0 and row['decalScale'] is not None
    # The same decal also ships as a standalone material for models. Its own texel extent
    # and scale are read so `size x scale` can be checked against that counterpart rather
    # than assumed to be the size convention.
    model_scale, model_extent = model_decal_scale(row['modelMaterial'])
    row['modelScale'] = model_scale
    row['modelExtent'] = model_extent
    row['subrectUnits'] = [row['size'][0] * row['decalScale'], row['size'][1] * row['decalScale']]
    row['modelUnits'] = ([model_extent[0] * model_scale, model_extent[1] * model_scale]
                         if model_scale is not None and model_extent is not None else None)
    decal_materials[material] = row

atlas_rows: dict[str, dict] = {}


def stage_atlas(atlas: str) -> dict:
    """Decode one decal atlas so the port draws the shipped pixels, not a copy."""
    if atlas in atlas_rows:
        return atlas_rows[atlas]
    vtf_path = 'materials/' + atlas + '.vtf'
    if not sources.exists(vtf_path):
        raise ValueError('Original decal atlas texture is absent: ' + vtf_path)
    data = sources.read(vtf_path)
    if data[:4] != b'VTF\0':
        raise ValueError('Original decal atlas is not VTF: ' + vtf_path)
    major, minor, header_size = struct.unpack_from('<III', data, 4)
    width, height = struct.unpack_from('<HH', data, 16)
    frames = struct.unpack_from('<H', data, 24)[0]
    if major != 7 or minor < 3 or header_size < 80 or frames != 1:
        raise ValueError(f'Unreviewed original decal atlas layout {major}.{minor} frames={frames}: {vtf_path}')
    pixels, decoded_width, decoded_height, is_float = load_vtf_texture(data)
    if is_float or decoded_width != width or decoded_height != height:
        raise ValueError('Unreviewed original decal atlas conversion: ' + vtf_path)
    png = encode_png(pixels, width, height, 4)
    atlas_rows[atlas] = dict(source=vtf_path, version=[major, minor], width=width, height=height,
                             rgbaSha256=items.digest(bytes(pixels)),
                             image=write('atlases/' + Path(atlas).name + '.png', png))
    return atlas_rows[atlas]

# --------------------------------------------------------------------------- #
# bullet impact sounds
# --------------------------------------------------------------------------- #
# The shipped manifest is not the complete registry in this build: an event the
# surface table names is looked up across every shipped `scripts/game_sounds*.txt`
# and has to be defined exactly once, which the check below enforces per event.
sound_scripts = sorted(path for path in sources.entries
                       if path.startswith('scripts/game_sounds') and path.endswith('.txt'))
if len(sound_scripts) < 40:
    raise ValueError('Shipped sound script set is unexpectedly small: ' + str(len(sound_scripts)))
sound_trees = {script: items.parse_kv(sources.read(script), script) for script in sound_scripts}


def sound_event(name: str) -> dict:
    matches = []
    for script, tree in sound_trees.items():
        key = next((key for key in tree if str(key).casefold() == name.casefold()), None)
        if key is not None:
            matches.append((script, tree[key]))
    if len(matches) != 1:
        raise ValueError(f'Original impact sound {name} has {len(matches)} definitions')
    script, body = matches[0]
    if not isinstance(body, dict):
        raise ValueError('Original sound entry is not a block: ' + name)
    waves = []
    for path, value in items.walk(body):
        if path[-1].casefold() != 'wave':
            continue
        for wave in items.scalar_values(value):
            waves.append(str(wave))
    if not waves:
        raise ValueError('Original impact sound has no wave: ' + name)

    def bounds(key, default):
        raw = body.get(key)
        if raw is None:
            return [default, default]
        values = [float(part.strip()) for part in str(raw).split(',')]
        if len(values) not in (1, 2):
            raise ValueError(f'Original {key} is not a range: {name}')
        return [values[0], values[-1]]

    def pitch():
        raw = body.get('pitch')
        if raw is None or str(raw).strip().upper() == 'PITCH_NORM':
            return [100.0, 100.0]
        values = [float(part.strip()) for part in str(raw).split(',')]
        return [values[0], values[-1]]

    rows = []
    for wave in sorted(set(waves)):
        relative = wave[1:] if wave.startswith('~') else wave
        path = 'sound/' + relative.replace('\\', '/').lstrip('/')
        data = sources.read(path)
        if not (data[:4] == b'RIFF' or data[:3] == b'ID3' or data[:2] in (b'\xff\xfb', b'\xff\xf3', b'\xff\xfa')):
            raise ValueError('Original impact wave is not a recognised audio container: ' + path)
        rows.append(dict(source=path, event=name, **write('sounds/' + relative.replace('\\', '/'), data)))
    return dict(event=name, script=script, volume=bounds('volume', 1.0), pitch=pitch(),
                soundLevel=str(body.get('soundlevel', '')), waves=rows)


# --------------------------------------------------------------------------- #
# the map's own faces: brushes, displacements, static props
# --------------------------------------------------------------------------- #
brushdata = json.loads((MAP / 'collision-brushes.json').read_text())
propdata = json.loads((MAP / 'static-props.json').read_text())['props']
lump = lambda name: (MAP / 'lumps' / name).read_bytes()
texdata = lump('02-texdata.bin')
texinfo = lump('06-texinfo.bin')
strings = lump('43-texdata_strings.bin').split(b'\0')
dispinfo = lump('26-dispinfo.bin')
faces = lump('07-faces.bin')
if len(texdata) % 32 or len(texinfo) % 72 or len(dispinfo) % 176 or len(faces) % 56:
    raise ValueError('Original BSP lump sizes are not whole records')
texdata_names = [struct.unpack_from('<i', texdata, index * 32 + 12)[0] for index in range(len(texdata) // 32)]
if any(name < 0 or name >= len(strings) for name in texdata_names):
    raise ValueError('Original texdata name index is out of range')
texinfo_texdata = [struct.unpack_from('<i', texinfo, index * 72 + 68)[0] for index in range(len(texinfo) // 72)]
if any(index < 0 or index >= len(texdata_names) for index in texinfo_texdata):
    raise ValueError('Original texinfo texdata index is out of range')
face_texinfo = [struct.unpack_from('<h', faces, index * 56 + 10)[0] for index in range(len(faces) // 56)]
if any(index < 0 or index >= len(texinfo_texdata) for index in face_texinfo):
    raise ValueError('Original face texinfo index is out of range')


def material_for_texinfo(index: int) -> str:
    return strings[texdata_names[texinfo_texdata[index]]].decode('utf-8').replace('\\', '/').lower()


pak_lump = lump('40-pakfile.bin')
pak = zipfile.ZipFile(io.BytesIO(pak_lump))
pak_index = {name.casefold(): name for name in pak.namelist()}
if len(pak_index) != len(pak.namelist()):
    raise ValueError('Embedded map pak has ambiguous case-insensitive paths')
material_vmt_cache: dict[str, dict | None] = {}
missing_materials: dict[str, int] = {}


def material_vmt(material: str):
    if material in material_vmt_cache:
        return material_vmt_cache[material]
    path = 'materials/' + material + '.vmt'
    row = None
    embedded = pak_index.get(path.casefold())
    if embedded is not None:
        payload = pak.read(embedded)
        row = dict(source='embedded-pak:' + embedded, bytes=len(payload), sha256=items.digest(payload),
                   container='embedded-map-pak')
    elif sources.exists(path):
        payload = sources.read(path)
        row = dict(sources.reads[path])
    if row is not None:
        if len(payload) != row['bytes'] or items.digest(payload) != row['sha256']:
            raise ValueError('Original material bytes changed between reads: ' + path)
        definition = items.parse_kv(payload, path)
        if len(definition) != 1:
            raise ValueError('Original material has several shaders: ' + path)
        shader, block = next(iter(definition.items()))
        properties = {}
        if isinstance(block, dict):
            for key, value in block.items():
                # Nested blocks (`proxies`, `$keywords`-less sub-blocks) are irrelevant
                # to the surface property and are recorded by name only.
                properties[key.casefold()] = value if isinstance(value, (dict, list)) else repeated_last(value)
        row['shader'] = shader.strip('"')
        row['surfaceProp'] = properties.get('$surfaceprop')
        row['surfaceProp2'] = properties.get('$surfaceprop2')
        row['keywords'] = properties.get('%keywords')
    else:
        missing_materials[material] = missing_materials.get(material, 0) + 1
    material_vmt_cache[material] = row
    return row


used_surface_props: dict[str, int] = {}
unresolved_brushes: list[dict] = []


def surface_prop_for_material(material: str):
    """The surface a face reports, or None when its material does not name one.

    Absent `$surfaceprop` stays unresolved: the port does not substitute the
    `default` group for a face the original never labelled.
    """
    row = material_vmt(material)
    if row is None or not row.get('surfaceProp'):
        return None, row
    name = str(row['surfaceProp']).casefold()
    if name not in groups:
        return None, row
    return name, row


brush_rows = {}
for index, brush in enumerate(brushdata['brushes']):
    sides = brushdata['sides'][brush['firstSide']:brush['firstSide'] + brush['sideCount']]
    found: dict[str, str] = {}
    declared = 0
    for side in sides:
        if side['bevelRaw16'] & 1:
            continue
        material = material_for_texinfo(side['texinfo'])
        value, _ = surface_prop_for_material(material)
        if value is None:
            continue
        declared += 1
        found.setdefault(value.casefold(), value)
    if not found:
        unresolved_brushes.append(dict(brush=index, contents=brush['contents'],
                                       materials=sorted({material_for_texinfo(side['texinfo'])
                                                         for side in sides if not side['bevelRaw16'] & 1})))
        continue
    if len(found) != 1:
        unresolved_brushes.append(dict(brush=index, contents=brush['contents'], ambiguous=sorted(found.values()),
                                       materials=sorted({material_for_texinfo(side['texinfo'])
                                                         for side in sides if not side['bevelRaw16'] & 1})))
        continue
    name = next(iter(found.values()))
    used_surface_props[name] = used_surface_props.get(name, 0) + 1
    brush_rows[str(index)] = name

# Displacement chunks are keyed exactly the way the collision export keys them, so
# the runtime can resolve an instance without a second lookup table. The chunk set
# is cross-checked against the colliders the map actually ships.
surface_props_by_disp = {}
used_surface_props_by_disp = {}
for index in range(len(dispinfo) // 176):
    map_face = struct.unpack_from('<H', dispinfo, index * 176 + 36)[0]
    if map_face >= len(face_texinfo):
        raise ValueError('Original dispinfo map face is out of range')
    material = material_for_texinfo(face_texinfo[map_face])
    value, _ = surface_prop_for_material(material)
    if value is None:
        continue
    surface_props_by_disp[index] = value
    used_surface_props_by_disp[value] = used_surface_props_by_disp.get(value, 0) + 1

collision = json.loads((ROOT / 'public/source/csgo-12426148/dust2/collision.json').read_text())
shipped_disp_keys = []
for instance in collision['colliders']:
    if instance['source'].get('layer') != 'displacement':
        continue
    key = ','.join(str(part) for part in instance['source']['grid']) + ',' + str(instance['source']['contents'])
    if key not in shipped_disp_keys:
        shipped_disp_keys.append(key)

# Rebuild the same chunk keys the collision export builds. The base quad and the
# displacement offsets come straight from the shipped lump bytes; the rebuilt key
# order is asserted equal to the one the shipped colliders carry, so the runtime can
# key an instance without a second table.
import numpy as np  # noqa: E402

expected_vertices = sum(((1 << struct.unpack_from('<i', dispinfo, index * 176 + 20)[0]) + 1) ** 2
                        for index in range(len(dispinfo) // 176))
# `DispVert` is vec3 + distance + alpha, and the offset the collision export uses is
# that vector scaled by its own distance (checked against SourceIO's own
# `transformed_vertices`, which is the same product in float32).
if len(lump('33-disp_vertices.bin')) != expected_vertices * 20:
    raise ValueError('Original displacement vertex lump is not 20-byte records')
disp_props = {}
vert = np.frombuffer(lump('03-vertices.bin'), dtype='<f4').reshape(-1, 3).astype(np.float64)
edge = np.frombuffer(lump('12-edges.bin'), dtype='<u2').reshape(-1, 2)
surfedge = np.frombuffer(lump('13-surfedges.bin'), dtype='<i4')
disp_raw = np.frombuffer(lump('33-disp_vertices.bin'), dtype='<f4').reshape(-1, 5)
dispvert = (disp_raw[:, :3] * disp_raw[:, 3:4]).astype(np.float32)
disp_order = []
for index in range(len(dispinfo) // 176):
    start_position = np.asarray(struct.unpack_from('<3f', dispinfo, index * 176), np.float64)
    disp_vert_start = struct.unpack_from('<i', dispinfo, index * 176 + 12)[0]
    power = struct.unpack_from('<i', dispinfo, index * 176 + 20)[0]
    contents = struct.unpack_from('<i', dispinfo, index * 176 + 32)[0]
    map_face = struct.unpack_from('<H', dispinfo, index * 176 + 36)[0]
    first_edge = struct.unpack_from('<i', faces, map_face * 56 + 4)[0]
    edge_count = struct.unpack_from('<h', faces, map_face * 56 + 8)[0]
    corners = surfedge[first_edge:first_edge + edge_count]
    base = vert[edge[np.abs(corners), 1 - (corners > 0).astype(np.uint8)]]
    if len(base) != 4:
        raise ValueError('Displacement base is not quad')
    start = int(np.argmin(np.linalg.norm(base - start_position, axis=1)))
    n = (1 << power) + 1
    points = []
    for row in range(n):
        left = base[start] + (base[(start + 1) & 3] - base[start]) * row / (n - 1)
        right = base[(start + 3) & 3] + (base[(start + 2) & 3] - base[(start + 3) & 3]) * row / (n - 1)
        points.extend(left + (right - left) * column / (n - 1) for column in range(n))
    points = np.asarray(points) + dispvert[disp_vert_start:disp_vert_start + n * n]
    key = (*np.floor(points.mean(axis=0) / 1024).astype(int), contents)
    text = ','.join(str(part) for part in key)
    if text not in disp_order:
        disp_order.append(text)
        disp_props[text] = {}
    prop = surface_props_by_disp.get(index)
    if prop is not None:
        disp_props[text][prop] = disp_props[text].get(prop, 0) + 1
if disp_order != shipped_disp_keys:
    first = next((index for index, (a, b) in enumerate(zip(disp_order, shipped_disp_keys)) if a != b),
                 min(len(disp_order), len(shipped_disp_keys)))
    raise ValueError('Rebuilt displacement chunk order differs from the shipped colliders: '
                     f'at {first} rebuilt={disp_order[first:first + 3]} shipped={shipped_disp_keys[first:first + 3]} '
                     f'counts rebuilt={len(disp_order)} shipped={len(shipped_disp_keys)}')
resolved_disp = {key: (sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]) for key, counts in disp_props.items()}

prop_rows = {}
prop_missing = {}
for prop in propdata:
    name = prop['model']
    if name in prop_rows or name in prop_missing:
        continue
    path = name.replace('\\', '/').lower()
    payload = None
    container = None
    embedded = pak_index.get(path.casefold())
    if embedded is not None:
        # Autocombined props are compiled into the map and only exist there.
        payload = pak.read(embedded)
        container = 'embedded-pak'
    elif path.endswith('.mdl') and sources.exists(path):
        payload = sources.read(path)
        container = sources.reads[path]['container']
    if payload is None:
        prop_missing[name] = 'mdl-absent'
        continue
    # A solid static prop takes its surface from the model's own header, not from its
    # materials, so the `.mdl` string is the authoritative source here.
    mdl = MdlV49.from_buffer(MemoryBuffer(payload))
    value = (mdl.header.surface_prop or '').strip().casefold()
    if not value or value not in groups:
        prop_missing[name] = 'unresolved:' + value
        continue
    prop_rows[name] = dict(surfaceProp=value, container=container, bytes=len(payload),
                           sha256=items.digest(payload))
    used_surface_props[value] = used_surface_props.get(value, 0) + 1

# --------------------------------------------------------------------------- #
# the table the runtime consumes
# --------------------------------------------------------------------------- #
impact_rows = {}
for surface_prop in sorted(set(brush_rows.values()) | set(resolved_disp.values())
                           | {row['surfaceProp'] for row in prop_rows.values()}):
    group = surface_group_for(surface_prop)
    letter = group.get('gamematerial')
    target = game_material_to_group.get(str(letter).casefold()) if letter is not None else None
    entries = decal_groups.get(str(target), []) if target else []
    sound = group.get('bulletimpact')
    impact_rows[surface_prop.casefold()] = dict(
        surfaceProp=group['name'], baseChain=group['baseChain'],
        gameMaterial=None if letter is None else str(letter),
        decalGroup=(str(target) if target else None),
        decals=[dict(material=entry['material'], weight=entry['weight']) for entry in entries],
        penetrationModifier=group.get('penetrationmodifier'), damageModifier=group.get('damagemodifier'),
        bulletImpact=(str(sound) if sound else None))

needed_sounds = sorted({row['bulletImpact'] for row in impact_rows.values() if row['bulletImpact']})
sound_rows = {name: sound_event(name) for name in needed_sounds}

# Only the atlases an impact actually reaches are decoded; the shipped decal set also
# contains scorch and blood groups this map's surfaces never select.
needed_atlases = sorted({decal_materials[entry['material']]['atlas']
                         for row in impact_rows.values() for entry in row['decals']
                         if decal_materials.get(entry['material'], {}).get('atlas')})
for atlas in needed_atlases:
    stage_atlas(atlas)

receipt = dict(
    format='source-surface-props-v1', build=12426148,
    context=context,
    scripts=dict(surface=SURFACE_SCRIPT, surfaceManifest=MANIFEST_SCRIPT, decals=DECAL_SCRIPT,
                 soundScripts=sound_scripts),
    sourceFiles=sources.reads,
    mapInputs={name: dict(bytes=(MAP / name).stat().st_size,
                          sha256=hashlib.sha256((MAP / name).read_bytes()).hexdigest())
               for name in ('collision-brushes.json', 'static-props.json')},
    lumpInputs={name: dict(bytes=len(lump(name)), sha256=items.digest(lump(name))) for name in
                ('02-texdata.bin', '03-vertices.bin', '06-texinfo.bin', '07-faces.bin', '12-edges.bin',
                 '13-surfedges.bin', '26-dispinfo.bin', '33-disp_vertices.bin', '40-pakfile.bin',
                 '43-texdata_strings.bin')},
    embeddedMapPak=dict(bytes=len(pak_lump), sha256=items.digest(pak_lump), materials=len(pak_index)),
    surfaceGroups=resolution,
    gameMaterialToDecalGroup=game_material_to_group,
    decalGroups=decal_groups,
    decalMaterials=decal_materials,
    decalAtlases=atlas_rows,
    impact=impact_rows,
    sounds=sound_rows,
    brushes=brush_rows,
    materials=material_vmt_cache,
    displacementChunks=resolved_disp,
    displacementChunkCounts=disp_props,
    props=prop_rows,
    unresolvedBrushes=unresolved_brushes,
    unresolvedProps=prop_missing,
    missingMaterials=missing_materials,
    usedSurfaceProps=used_surface_props,
    coverage=dict(brushes=len(brush_rows), brushTotal=len(brushdata['brushes']),
                  brushUnresolvedReasons=dict(Counter(
                      'ambiguous' if 'ambiguous' in row else 'no-surface-property'
                      for row in unresolved_brushes)),
                  displacementChunks=len(resolved_disp), displacementChunkTotal=len(shipped_disp_keys),
                  props=len(prop_rows), propTotal=len({p['model'] for p in propdata}),
                  propUnresolvedReasons=dict(Counter(
                      'mdl-absent' if value == 'mdl-absent' else 'no-surface-property'
                      for value in prop_missing.values())),
                  surfaceProps=sorted(impact_rows), decals=len(decal_materials), atlases=len(atlas_rows),
                  sounds=len(sound_rows), impactSounds={name: len(row['waves']) for name, row in sound_rows.items()}),
    limitations=[
        'A face whose material declares no $surfaceprop contributes nothing; the brush is reported unresolved instead of being given the default group.',
        'A brush whose declared sides disagree on the surface property is reported unresolved rather than resolved per hit normal.',
        'Displacement chunks that merge several original displacements take the majority surface property; the per-displacement counts are exported beside it.',
        'The original Subrect shader, its depth fade and the decal fade-out are not executed here; only the atlas rectangle and the shipped scale numbers are recorded.',
        'Impact sound operator stacks (CS_limit_bullet_impact, CS_up...), soundlevel attenuation and room acoustics are not reproduced.',
    ])
jsonfile('surface-props.json', receipt)
# The versioned research receipt keeps every receipt and every original number, but drops
# the per-face maps: those ship in the staged table, and the unresolved audit is kept as
# its own summary so the gap stays visible without a megabyte of repeated material lists.
combo = Counter(','.join(row['materials']) for row in unresolved_brushes)
research = {key: value for key, value in receipt.items()
            if key not in ('brushes', 'displacementChunks', 'displacementChunkCounts', 'props',
                           'unresolvedBrushes', 'unresolvedProps', 'materials')}
research['unresolvedBrushAudit'] = dict(
    byReason=receipt['coverage']['brushUnresolvedReasons'],
    byMaterials=dict(combo.most_common()),
    ambiguous=[row for row in unresolved_brushes if 'ambiguous' in row][:12])
research['unresolvedPropAudit'] = sorted(prop_missing.items())
# The per-face maps themselves ship in the staged runtime table; only their counts belong
# in the receipt, so the receipt cannot drift from what the runtime actually reads.
research['surfaceSourceCounts'] = dict(brushes=len(brush_rows), displacementChunks=len(resolved_disp),
                                      props=len(prop_rows))
(ROOT / 'research/source-surface-props.json').write_text(
    json.dumps(research, indent=2, ensure_ascii=False) + '\n')
print('IMPACT_EXPORT', json.dumps(receipt['coverage'], ensure_ascii=False))
print('unresolved brushes', len(unresolved_brushes), 'unresolved props', len(prop_missing),
      'missing materials', len(missing_materials))
print('unresolved prop sample', list(prop_missing.items())[:6])
print('missing material sample', list(missing_materials.items())[:8])
print('impact table', json.dumps(impact_rows, ensure_ascii=False)[:1600])
print('sounds', {name: [wave['source'] for wave in row['waves']] for name, row in sound_rows.items()})
