"""Read-only original PCF closure export for the rifle and AWP muzzle systems.

Same discipline as `export-source-pistol-particles.py`: no particle default,
child, texture frame or renderer is inferred from a name, and every staged file
carries a byte count and SHA-256 receipt. This export additionally resolves the
one original material reference that omits its extension, and records what it
resolved to instead of silently rewriting the source string.

Run: /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
     --python-exit-code 1 --python scripts/export-source-muzzle-flash-particles.py
"""
from pathlib import Path
import importlib.util, io, json, struct, sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/muzzle-flash-particles'
spec = importlib.util.spec_from_file_location('muzzle_particle_items', ROOT / 'scripts/inventory-source-items.py')
items = importlib.util.module_from_spec(spec)
spec.loader.exec_module(items)
context = items.initialize()
sources = items.Sources()
from SourceIO.library.utils import datamodel
from SourceIO.library.utils.pylib.vtf import load_vtf_texture
from SourceIO.library.utils.pylib.image import encode_png

# The original third-person systems `items_game.txt` names for the weapons this
# build ships as primary weapons. `weapon_muzzle_flash_awp` reuses the hunting
# rifle's main system, so both roots are closed over together.
ROOTS = ['weapon_muzzle_flash_assaultrifle', 'weapon_muzzle_flash_awp']


def write(name, data):
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() != data:
        raise ValueError('Existing original particle export differs: ' + name)
    path.write_bytes(data)
    if path.read_bytes() != data:
        raise ValueError('Particle export readback differs: ' + name)
    return dict(path=name, bytes=len(data), sha256=items.digest(data))


def jsonfile(name, data):
    return write(name, (json.dumps(data, indent=2, ensure_ascii=False) + '\n').encode())


def canonical(path):
    path = path.replace('\\', '/').lower()
    if not path.startswith('materials/'):
        path = 'materials/' + path
    if '..' in Path(path).parts:
        raise ValueError('Unsafe original material path')
    return path


# The original SpriteCard sheet resource (`VTF_RSRC_SHEET`, tag 0x10). The layout
# below is the one the runtime decoder in `game/source-pistol-particles-graph.ts`
# already implements, and this export re-derives it from the shipped bytes for every
# sheet it stages:
#   sheet:    int version=1, int sequenceCount
#   sequence: int id, int flags(<=1), int frameCount, float duration (the total)
#   frame:    float duration, then four `TexCoord(left, top, right, bottom)` rects
# Every sequence must have a unique id, every frame duration must be positive and sum
# to the sequence's own total, every rect must lie inside the unit square, and the walk
# must consume the resource exactly. All three original sheets (55 sequences, 352
# frames) satisfy this, so nothing here is inferred from a name or padded.
SHEET_SEQUENCE_BYTES = 16
SHEET_RECT_BYTES = 16
SHEET_FRAME_BYTES = 4 + 4 * SHEET_RECT_BYTES


def decode_sheet(chunk, texturePath):
    if len(chunk) < 8:
        raise ValueError('Truncated original particle sheet header: ' + texturePath)
    version, sequenceCount = struct.unpack_from('<2I', chunk, 0)
    if version != 1 or not 0 < sequenceCount <= 64:
        raise ValueError(f'Unreviewed original particle sheet header {version}/{sequenceCount}: {texturePath}')
    at = 8
    sequences = []
    ids = set()
    for index in range(sequenceCount):
        if at + SHEET_SEQUENCE_BYTES > len(chunk):
            raise ValueError('Truncated original particle sheet sequence: ' + texturePath)
        sequenceId, flags, frameCount, duration = struct.unpack_from('<3If', chunk, at)
        at += SHEET_SEQUENCE_BYTES
        if sequenceId in ids or flags > 1 or not 0 < frameCount <= 4096 or duration <= 0:
            raise ValueError(f'Invalid original particle sheet sequence {index}: {texturePath}')
        ids.add(sequenceId)
        frames = []
        total = 0.0
        for frame in range(frameCount):
            if at + SHEET_FRAME_BYTES > len(chunk):
                raise ValueError('Truncated original particle sheet frame: ' + texturePath)
            frameDuration = struct.unpack_from('<f', chunk, at)[0]
            if frameDuration <= 0:
                raise ValueError(f'Invalid original particle sheet frame duration: {texturePath} '
                                 f'sequence {index} frame {frame}')
            rects = []
            for rect in range(4):
                left, top, right, bottom = struct.unpack_from('<4f', chunk, at + 4 + rect * SHEET_RECT_BYTES)
                if not (0.0 <= left <= right <= 1.0 and 0.0 <= top <= bottom <= 1.0):
                    raise ValueError(f'Invalid original particle sheet rect {rect}: {texturePath} '
                                     f'sequence {index} frame {frame}')
                rects.append([left, top, right, bottom])
            at += SHEET_FRAME_BYTES
            total += frameDuration
            frames.append(dict(rects=rects, duration=frameDuration))
        if abs(total - duration) > 1e-4:
            raise ValueError(f'Original particle sheet durations differ: {texturePath} sequence {index}')
        sequences.append(dict(id=sequenceId, flags=flags, frameCount=frameCount, duration=duration, frames=frames))
    if at != len(chunk):
        raise ValueError('Original particle sheet resource has trailing bytes: ' + texturePath)
    return dict(version=version, sequenceCount=sequenceCount,
                frameCount=sum(s['frameCount'] for s in sequences), sequences=sequences)


def resolve_material(path):
    """One original block names its material without the `.vmt` extension. The
    resolution is reported, not assumed, and fails when it is not unique."""
    candidate = canonical(path)
    if sources.exists(candidate):
        return candidate, None
    if Path(candidate).suffix:
        raise ValueError('Original particle material missing: ' + candidate)
    matches = [candidate + suffix for suffix in ('.vmt',) if sources.exists(candidate + suffix)]
    if len(matches) != 1:
        raise ValueError('Extensionless original particle material is not unique: ' + candidate)
    return matches[0], dict(sourceValue=path, resolved=candidate + '.vmt',
                            reason='original block omits the extension')


pcf = 'particles/weapons/cs_weapon_fx.pcf'
raw = sources.read(pcf)
dm = datamodel.load(in_file=io.BytesIO(raw))
systems = {e.name: e for e in dm.elements if e.type == 'DmeParticleSystemDefinition'}
for name in ROOTS:
    if name not in systems:
        raise ValueError('Original muzzle system absent: ' + name)

seen = {}
fallbacks = []
material_resolutions = []


def visit(element):
    key = str(element.id)
    if key in seen:
        return
    seen[key] = dict(id=key, name=element.name, type=element.type, attributes={},
                     attributeTypes={k: type(v).__name__ for k, v in element.items()})

    def value(v):
        if isinstance(v, datamodel.Element):
            visit(v)
            return dict(ref=str(v.id), name=v.name)
        if isinstance(v, bytes):
            return dict(binaryHex=v.hex())
        if isinstance(v, (str, bool, int, float)) or v is None:
            return v
        return [value(x) for x in v]
    seen[key]['attributes'] = {k: value(v) for k, v in element.items()}
    for k in ['fallback replacement definition', 'cull replacement definition']:
        if element.get(k):
            name = element[k]
            if name not in systems:
                raise ValueError('Unresolved original named replacement: ' + name)
            fallbacks.append(dict(source=key, field=k, target=str(systems[name].id), name=name))
            visit(systems[name])


for name in ROOTS:
    visit(systems[name])
pcf_file = write('original/cs_weapon_fx.pcf', raw)

materials = []
by_source = {}
textures = {}
textureSheets = []
raw_materials = sorted({e['attributes']['material'] for e in seen.values()
                        if e['type'] == 'DmeParticleSystemDefinition' and e['attributes'].get('material')})
for source_value in raw_materials:
    path, resolution = resolve_material(source_value)
    if resolution:
        material_resolutions.append(dict(systemValue=source_value, **resolution))
    # Two original systems name the same material, one of them without the
    # extension; they share one staged record instead of a duplicate.
    if path in by_source:
        by_source[path]['sourceValues'].append(source_value)
        continue
    data = sources.read(path)
    definition = items.parse_kv(data, path)
    file = write('original/' + path, data)
    row = dict(source=path, sourceValue=source_value, sourceValues=[source_value], file=file, definition=definition, textures=[])
    for key, value in items.walk(definition):
        if isinstance(value, str) and ('texture' in str(key).lower() or str(key).lower() in ['$bumpmap', '$detail']):
            texturePath = canonical(value.removesuffix('.vtf') + '.vtf')
            if not sources.exists(texturePath):
                continue
            row['textures'].append(dict(parameter=key, source=texturePath))
            if texturePath in textures:
                continue
            vtf = sources.read(texturePath)
            if vtf[:4] != b'VTF\0':
                raise ValueError('Original particle texture is not VTF: ' + texturePath)
            major, minor, headerSize = struct.unpack_from('<III', vtf, 4)
            width, height = struct.unpack_from('<HH', vtf, 16)
            flags = struct.unpack_from('<I', vtf, 20)[0]
            frames = struct.unpack_from('<H', vtf, 24)[0]
            # 7.0/7.1 use the 64-byte header and predate the resource dictionary;
            # 7.2+ extend it and carry the dictionary right after the header.
            if major != 7 or minor < 1 or headerSize < 64:
                raise ValueError(f'Unreviewed original particle VTF layout: {texturePath} {major}.{minor} header {headerSize}')
            resources = []
            if headerSize >= 80:
                resourceCount = struct.unpack_from('<I', vtf, 68)[0]
                if 80 + resourceCount * 8 > headerSize:
                    raise ValueError('Invalid VTF resource table: ' + texturePath)
                for n in range(resourceCount):
                    at = 80 + n * 8
                    tag = vtf[at:at + 3].hex()
                    resourceFlags = vtf[at + 3]
                    offset = struct.unpack_from('<I', vtf, at + 4)[0]
                    resource = dict(tag=tag, flags=resourceFlags, value=offset)
                    if tag == '100000' and not resourceFlags & 2:
                        size = struct.unpack_from('<I', vtf, offset)[0]
                        chunk = vtf[offset + 4:offset + 4 + size]
                        if len(chunk) != size:
                            raise ValueError('Truncated original particle sheet data: ' + texturePath)
                        resource['sheetFile'] = write('sheets/' + Path(texturePath).stem + '.bin', chunk)
                        sheet = decode_sheet(chunk, texturePath)
                        resource['sheet'] = sheet
                        resource['decoded'] = True
                        textureSheets.append(dict(source=texturePath, sequenceCount=sheet['sequenceCount'],
                                                  frameCount=sheet['frameCount']))
                    resources.append(resource)
            texture = dict(source=texturePath, file=write('original/' + texturePath, vtf), version=[major, minor],
                           width=width, height=height, flags=flags, frames=frames, resources=resources,
                           resourceTable='present' if headerSize >= 80 else 'absent-before-7.2',
                           images=[])
            # Installed native decoder accepts only its documented original
            # single-image call. Preserve a multi-frame VTF rather than silently
            # exporting frame zero.
            texture['frameDecodeStatus'] = 'complete' if frames == 1 else 'unsupported-multiframe-native-decoder'
            for frame in range(frames if frames == 1 else 0):
                pixels, w, h, isFloat = load_vtf_texture(vtf)
                if isFloat or w != width or h != height:
                    raise ValueError('Unreviewed floating/size particle VTF conversion')
                png = encode_png(pixels, w, h, 4)
                name = 'textures/' + Path(texturePath).stem + f'-frame-{frame}.png'
                texture['images'].append(dict(frame=frame, file=write(name, png), rgbaSha256=items.digest(pixels)))
            textures[texturePath] = texture
    materials.append(row)
    by_source[path] = row

roots = [dict(name=name, id=str(systems[name].id)) for name in ROOTS]
graph = dict(format='source-pistol-particles-v1', build=12426148, root=str(systems[ROOTS[0]].id), roots=roots,
             source=sources.reads[pcf], pcfFile=pcf_file, elements=list(seen.values()),
             namedReplacements=fallbacks, materialResolutions=material_resolutions,
             materials=materials, textures=list(textures.values()),
             boundaries=dict(defaults='Absent PCF parameters remain absent; native unpack defaults are not guessed.',
                             runtime='Graph and raw assets only; original operators and shader execution not yet reproduced.'))
graph_file = jsonfile('graph.json', graph)
receipt = dict(format='source-muzzle-flash-particles-receipt-v1', context=context, roots=ROOTS, graph=graph_file,
               sourceFiles=sources.reads, materialResolutions=material_resolutions,
               systemCount=sum(e['type'] == 'DmeParticleSystemDefinition' for e in seen.values()),
               elementCount=len(seen),
               systemNames=sorted(e['name'] for e in seen.values() if e['type'] == 'DmeParticleSystemDefinition'),
               functionNames=sorted({e['attributes']['functionName'] for e in seen.values() if 'functionName' in e['attributes']}),
               materialCount=len(materials), textureCount=len(textures),
               textureFrameCount=sum(v['frames'] for v in textures.values()),
               sheets=textureSheets,
               sheetFrameCount=sum(s['frameCount'] for s in textureSheets))
jsonfile('receipt.json', receipt)
print('MUZZLE_FLASH_PARTICLE_EXPORT', json.dumps(receipt, ensure_ascii=False))
