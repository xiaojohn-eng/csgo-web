"""Inventory/extract Source 1 map layers without importing a Blender scene.

Run in factory-startup Blender for the pinned SourceIO Python/native API. No
register(), scene mutation, preferences, game edits, or conversion are performed.
The completion flag is a deliberate gate against parsing Steam preallocation.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import asdict, is_dataclass
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import struct
import subprocess
import sys
import tempfile
import time
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
PIN = 'cfc2591d096628a35f570aa830ab75cc8665108b'
NAMES = {0:'entities',1:'planes',2:'texdata',3:'vertices',4:'visibility',5:'nodes',6:'texinfo',7:'faces',
         8:'lighting',10:'leaves',12:'edges',13:'surfedges',14:'models',16:'leaffaces',17:'leafbrushes',
         18:'brushes',19:'brushsides',20:'areas',21:'areaportals',26:'dispinfo',27:'original_faces',
         28:'physics_displacement',29:'physics_collide',33:'disp_vertices',35:'game',40:'pakfile',
         42:'cubemaps',43:'texdata_strings',44:'texdata_offsets',45:'overlays',48:'disp_triangles',
         53:'lighting_hdr',54:'worldlights_hdr',58:'faces_hdr'}

def canonical(name: str) -> str:
    value = name.replace('\\', '/').lower()
    path = PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts or ':' in value or not path.parts:
        raise ValueError(f'Unsafe resource path: {name!r}')
    return str(path)

def serial(value):
    if is_dataclass(value): return asdict(value)
    if hasattr(value, 'tolist'): return value.tolist()
    if isinstance(value, Path): return str(value)
    raise TypeError(type(value).__name__)

def save(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=serial) + '\n')

def sha_file(path: Path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(1024 * 1024): digest.update(block)
    return digest.hexdigest()

def rows(data: bytes, fmt: str):
    size = struct.calcsize(fmt)
    if len(data) % size: raise ValueError(f'Invalid record length {len(data)} for {fmt} ({size})')
    return list(struct.iter_unpack(fmt, data))

class VPKIndex:
    """Read only the directory tree; globbing the native API would load payloads."""
    def __init__(self, path: Path):
        self.path = path
        with path.open('rb') as stream:
            signature, self.version, tree_size = struct.unpack('<3I', stream.read(12))
            if signature != 0x55AA1234 or self.version not in (1, 2): raise ValueError('Unsupported VPK header')
            self.header_size = 12 if self.version == 1 else 28
            extra = stream.read(16) if self.version == 2 else b''
            self.sections = list(struct.unpack('<4I', extra)) if extra else []
            if tree_size > path.stat().st_size - self.header_size: raise ValueError('VPK tree extends past EOF')
            self.tree = stream.read(tree_size)
        self.data_offset = self.header_size + tree_size
        self.entries = {}
        offset = 0
        def string():
            nonlocal offset
            end = self.tree.index(b'\0', offset)
            value = self.tree[offset:end].decode('utf8'); offset = end + 1
            return value
        while extension := string():
            while directory := string():
                while stem := string():
                    crc, preload_size, archive, entry_offset, length, terminator = struct.unpack_from('<IHHIIH', self.tree, offset)
                    offset += 18
                    if terminator != 0xFFFF or offset + preload_size > len(self.tree): raise ValueError('Invalid VPK entry')
                    name = canonical(('' if directory == ' ' else directory + '/') + stem + ('' if extension == ' ' else '.' + extension))
                    if name in self.entries: raise ValueError(f'Duplicate VPK resource: {name}')
                    self.entries[name] = dict(crc32=crc, preloadBytes=preload_size, archiveIndex=archive,
                                              offset=entry_offset, length=length, preloadOffset=offset)
                    offset += preload_size
        if offset != len(self.tree): raise ValueError('VPK tree has trailing unparsed bytes')

    def read(self, name: str) -> bytes:
        entry = self.entries[canonical(name)]
        data = self.tree[entry['preloadOffset']:entry['preloadOffset'] + entry['preloadBytes']]
        if entry['length']:
            if entry['archiveIndex'] == 0x7FFF:
                archive = self.path; offset = self.data_offset + entry['offset']
            else:
                prefix = self.path.stem.removesuffix('_dir')
                archive = self.path.with_name(f"{prefix}_{entry['archiveIndex']:03d}.vpk"); offset = entry['offset']
            if offset + entry['length'] > archive.stat().st_size: raise ValueError(f'Truncated archive: {archive}')
            with archive.open('rb') as stream:
                stream.seek(offset); data += stream.read(entry['length'])
        if zlib.crc32(data) != entry['crc32']: raise ValueError(f'CRC mismatch: {name}')
        return data

def collision_layers(lumps: dict[int, bytes], versions: dict[int, int]):
    """Retain original halfspaces and BSP model ownership; no render-mesh proxy."""
    planes = rows(lumps.get(1, b''), '<4fi')
    brush_rows = rows(lumps.get(18, b''), '<3i')
    side_rows = rows(lumps.get(19, b''), '<HhhH')
    node_rows = rows(lumps.get(5, b''), '<3i6h2H2h')
    model_rows = rows(lumps.get(14, b''), '<9f3i')
    leaf_size = {0:56, 1:32}.get(versions.get(10, 0))
    if leaf_size is None: raise ValueError('Unsupported leaf layout; raw lump preserved')
    leaf_data = lumps.get(10, b'')
    if len(leaf_data) % leaf_size: raise ValueError('Leaf record length mismatch')
    leaves = [struct.unpack_from('<ihH6h4Hh', leaf_data, i) for i in range(0, len(leaf_data), leaf_size)]
    leafbrushes = [row[0] for row in rows(lumps.get(17, b''), '<H')]
    sides = []
    for plane, texinfo, dispinfo, bevel_raw in side_rows:
        if plane >= len(planes): raise ValueError('Brush side references missing plane')
        sides.append(dict(plane=plane, texinfo=texinfo, displacement=dispinfo, bevelRaw16=bevel_raw))
    brushes = []
    for first, count, contents in brush_rows:
        if first < 0 or count < 0 or first + count > len(sides): raise ValueError('Brush side range invalid')
        brushes.append(dict(firstSide=first, sideCount=count, contents=contents & 0xFFFFFFFF))
    owners = []
    for model_id, model in enumerate(model_rows):
        stack = [model[9]]; visited = set(); owned = set(); leaf_ids = set()
        while stack:
            node = stack.pop()
            if node in visited: continue
            visited.add(node)
            if node >= 0:
                if node >= len(node_rows): raise ValueError('Model references missing BSP node')
                stack.extend(node_rows[node][1:3])
            else:
                index = -1 - node
                if index >= len(leaves): raise ValueError('BSP node references missing leaf')
                leaf_ids.add(index); leaf = leaves[index]; first, count = leaf[11:13]
                if first + count > len(leafbrushes): raise ValueError('Leaf brush range invalid')
                owned.update(leafbrushes[first:first+count])
        if any(i >= len(brushes) for i in owned): raise ValueError('Leaf references missing brush')
        owners.append(dict(model=model_id, mins=model[:3], maxs=model[3:6], origin=model[6:9], headNode=model[9],
                           firstFace=model[10], faceCount=model[11], brushIds=sorted(owned), leafCount=len(leaf_ids)))
    return dict(coordinates='Original Source units, X/Y horizontal, Z up; no browser transform applied',
                halfspaceConvention='dot(plane.normal, point) <= plane.dist; preserve bevel/content flags',
                planes=[dict(normal=p[:3], dist=p[3], type=p[4]) for p in planes], sides=sides, brushes=brushes, models=owners,
                contentHistogram=dict(Counter(hex(b['contents']) for b in brushes)),
                limitations=['Halfspaces/ownership extracted, not yet converted to tested Rapier hulls.',
                             'Entity behavior and contents masks still need separate player/bullet/trigger decisions.',
                             'Physics displacement lump 28 and model PHY solids are separate from these brushes.'])

def self_test():
    payload = b'VPK synthetic readback'; preload = payload[:4]; rest = payload[4:]
    tree = b'txt\0test\0entry\0' + struct.pack('<IHHIIH', zlib.crc32(payload), len(preload), 0x7FFF, 0, len(rest), 0xFFFF) + preload + b'\0\0\0'
    with tempfile.TemporaryDirectory() as directory:
        for version in (1, 2):
            path = Path(directory) / 'test_dir.vpk'
            path.write_bytes(struct.pack('<3I', 0x55AA1234, version, len(tree)) + (struct.pack('<4I', len(rest),0,0,0) if version == 2 else b'') + tree + rest)
            index = VPKIndex(path)
            assert index.read('test/entry.txt') == payload
        external_tree = b'txt\0test\0external\0' + struct.pack('<IHHIIH', zlib.crc32(payload),len(preload),3,7,len(rest),0xFFFF) + preload + b'\0\0\0'
        path.write_bytes(struct.pack('<3I',0x55AA1234,2,len(external_tree))+struct.pack('<4I',0,0,0,0)+external_tree)
        chunk = Path(directory)/'test_003.vpk'; chunk.write_bytes(b'padding'+rest)
        assert VPKIndex(path).read('test/external.txt') == payload
        chunk.write_bytes(b'padding'+b'!'*len(rest))
        try: VPKIndex(path).read('test/external.txt')
        except ValueError as error: assert 'CRC mismatch' in str(error)
        else: raise AssertionError('Corrupted external payload was accepted')
        try: canonical('../../outside')
        except ValueError: pass
        else: raise AssertionError('Traversal was accepted')
    print('SOURCE_MAP_SELF_TEST: VPK v1/v2 preload, inline/external chunks, corrupt CRC rejection and path boundary passed')

def physics_blocks(data: bytes):
    # SourceIO SolidBlock.parse does not seek over each VPHY payload. Keep its
    # actual SolidHeader/tree decoder, but give each solid a bounded buffer and
    # advance by the on-disk size, as SourceIO's standalone Phy parser already does.
    from SourceIO.library.models.phy.phy import SolidHeader
    from SourceIO.library.utils import MemoryBuffer
    result = []; offset = 0
    while offset < len(data):
        model, data_size, script_size, count = struct.unpack_from('<4i', data, offset); offset += 16
        if model == -1:
            if (data_size,script_size,count) != (-1,0,0) or offset != len(data): raise ValueError('Physics terminal record mismatch')
            break
        end = offset + data_size
        if min(data_size,script_size,count) < 0 or end + script_size > len(data): raise ValueError('Physics model span outside lump')
        solids = []
        for _ in range(count):
            size = struct.unpack_from('<I',data,offset)[0] + 4
            if offset + size > end: raise ValueError('Solid spans outside model block')
            solid = SolidHeader.from_buffer(MemoryBuffer(data[offset:offset+size]))
            nodes = [solid.collision_model.root_tree]; leaves = []; triangles = 0
            while nodes:
                node = nodes.pop()
                if node.left_node is not None: nodes.append(node.left_node)
                if node.right_node is not None: nodes.append(node.right_node)
                if node.convex_leaf is not None:
                    leaf = node.convex_leaf
                    if leaf.has_children: continue
                    if any(index < 0 for tri in leaf.triangles for index in tri): raise ValueError('Negative physics vertex index')
                    triangles += len(leaf.triangles)
                    leaves.append(dict(bone=leaf.bone_id, flags=leaf.flags, vertices=len(leaf.unique_vertices), triangles=len(leaf.triangles)))
            solids.append(dict(lumpOffset=offset, bytes=size, version=solid.version, type=solid.type,
                               convexLeaves=leaves, triangles=triangles))
            offset += size
        if offset != end: raise ValueError('Physics solid sizes do not consume model data size')
        script = data[end:end+script_size].decode('latin1').rstrip('\0')
        result.append(dict(model=model, solids=solids, keyvalues=script)); offset = end + script_size
    return dict(models=result, method='Bounded VPHY block spans + unmodified SourceIO SolidHeader/CollisionModel/TreeNode decoders',
                convertedHulls=0, note='Tree/triangle counts validated; vertex coordinate conversion and tested Rapier convex hull generation remain separate.')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-dir', type=Path, default=ROOT / '.reference-assets/csgo-legacy/csgo')
    parser.add_argument('--map', default='de_dust2')
    parser.add_argument('--output', type=Path, default=ROOT / 'output/source1/de_dust2')
    parser.add_argument('--download-complete', action='store_true', help='Only after Steam terminal success + ACF fully installed verification')
    parser.add_argument('--extract-lumps', action='store_true')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    if args.self_test: return self_test()
    if not args.download_complete: parser.error('Refusing asset reads before --download-complete confirmation')
    import bpy
    if not bpy.app.background or '--factory-startup' not in sys.argv: raise ValueError('Use Blender --background --factory-startup')
    source = ROOT / '.tools/SourceIO'
    commit = subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'], text=True).strip()
    if commit != PIN: raise ValueError('SourceIO version changed; review before proceeding')
    if subprocess.check_output(['git','-C',str(source),'status','--porcelain','--untracked-files=no'], text=True).strip():
        raise ValueError('SourceIO tracked source is modified')
    sys.path.insert(0, str(source.parent))
    from SourceIO.library.utils import FileBuffer, TinyPath
    from SourceIO.library.utils.pylib import VPKFile
    from SourceIO.library.shared.app_id import SteamAppId
    from SourceIO.library.shared.content_manager import ContentManager
    from SourceIO.library.source1.bsp.bsp_file import open_bsp
    import SourceIO.library.source1.bsp.lumps  # Register the reviewed lump handlers.
    from SourceIO.blender_bindings.source1.bsp.entities.csgo_entity_handlers import CSGOEntityHandler

    started = time.perf_counter(); game = args.game_dir.resolve(); out = args.output.resolve()
    if out.is_relative_to(game) or out.is_relative_to(ROOT / 'public'): raise ValueError('Output must be isolated from source/public')
    name = canonical(args.map)
    if '/' in name or '.' in name: raise ValueError('Map must be a plain basename')
    path = game / 'maps' / f'{name}.bsp'
    before_stat = path.stat()
    report = dict(map=name, bsp=str(path), sourceioCommit=commit, steamParseAppId=730,
                  blender=bpy.app.version_string, downloadedFilesModified=False, sceneObjectsCreated=0,
                  limitations=[], errors=[], extractionComplete=False, browserMapConverted=False)
    out.mkdir(parents=True, exist_ok=True)
    catalog = []
    # Locale/restricted-content packs are inventoried but never silently override pak01.
    indexes = [VPKIndex(p) for p in sorted(game.glob('*_dir.vpk'))]
    for index in indexes:
        entries = {name:{k:v for k,v in entry.items() if k != 'preloadOffset'} for name,entry in index.entries.items()}
        save(out / 'vpk' / (index.path.stem + '.json'), entries)
        catalog.append(dict(path=str(index.path), version=index.version, files=len(entries),
                            directorySha256=sha_file(index.path), extensions=dict(Counter(PurePosixPath(n).suffix for n in entries))))
    report['vpkCatalog'] = catalog
    bsp = open_bsp(TinyPath(path), FileBuffer(TinyPath(path)), ContentManager(), SteamAppId.COUNTER_STRIKE_GO)
    if bsp is None or bsp.info.ident != 'VBSP' or bsp.info.version not in ((20,0),(21,0)): raise ValueError('Unsupported BSP branch')
    raw = {}; table = []
    for lump in bsp.info.lumps:
        if lump.size < 0 or lump.offset < 0 or lump.offset + lump.size > before_stat.st_size: raise ValueError('Lump extends past BSP EOF')
        external = path.parent / f'{path.stem}_l_{lump.id}.lmp'
        alternate = path.parent / f'{path.name}.{lump.id:04x}.bsp_lump'
        if external.exists() or alternate.exists(): raise ValueError('External BSP lump override present; freeze/review it explicitly')
        row = dict(id=lump.id, name=NAMES.get(lump.id, f'lump_{lump.id}'), offset=lump.offset, bytes=lump.size,
                   version=lump.version, compressed=lump.compressed)
        if lump.size:
            data = bsp._get_lump_buffer(lump.id, lump).read()
            raw[lump.id] = data; row.update(decodedBytes=len(data), sha256=hashlib.sha256(data).hexdigest())
            if args.extract_lumps:
                target = out / 'lumps' / f'{lump.id:02d}-{row["name"]}.bin'; target.parent.mkdir(exist_ok=True)
                target.write_bytes(data)
        table.append(row)
    report.update(bspVersion=bsp.info.version, revision=bsp.info.revision, bspBytes=before_stat.st_size,
                  bspSha256=sha_file(path), lumps=table)
    (out / 'entities.raw.txt').write_bytes(raw.get(0, b''))
    api = {}
    for key, attribute in [('LUMP_ENTITIES','entities'),('LUMP_MODELS','models'),('LUMP_FACES','faces'),
                           ('LUMP_VERTICES','vertices'),('LUMP_DISPINFO','infos'),('LUMP_GAME_LUMP','game_lumps'),
                           ('LUMP_PHYSICS','solid_blocks')]:
        try:
            parsed = bsp.get_lump(key)
            api[key] = dict(status='parsed' if parsed is not None else 'empty', count=len(getattr(parsed,attribute,[])))
        except Exception as error:
            api[key] = dict(status='error', error=f'{type(error).__name__}: {error}')
            report['errors'].append(dict(layer=key,error=api[key]['error']))
    report['sourceioLumpAPI'] = api
    entities = getattr(bsp.get_lump('LUMP_ENTITIES'), 'entities', [])
    save(out / 'entities.json', entities)
    classes = Counter(e.get('classname','<missing>') for e in entities)
    report['entities'] = dict(count=len(entities), byClass=dict(classes),
        blenderHandlerPresent={key:hasattr(CSGOEntityHandler,'handle_'+key) and key in CSGOEntityHandler.entity_lookup_table for key in classes},
        note='Handler presence is Blender import coverage only; no Source gameplay or entity I/O is implemented here.')
    game_lump = bsp.lump_cache.get('LUMP_GAME_LUMP'); static = game_lump.game_lumps.get('sprp') if game_lump else None
    props = [vars(p).copy() for p in static.static_props] if static else []
    for prop in props:
        if not 0 <= prop['prop_type'] < len(static.model_names): raise ValueError('Static prop model index invalid')
        prop['model'] = static.model_names[prop['prop_type']]
    save(out / 'static-props.json', dict(version=static._glump_info.version if static else None,
                                       models=static.model_names if static else [], props=props))
    report['staticProps'] = dict(count=len(props), uniqueModels=len(static.model_names) if static else 0,
        solidHistogram=dict(Counter(str(p['solid']) for p in props)),
        nonUnitUniformScales=sum(p['uniform_scale'] not in (0,1) for p in props),
        note='Records extracted; SourceIO initial BSP import makes Empty placeholders. Preserve original skin/solid/uniform_scale for later real model instancing.')
    collision = collision_layers(raw, {v.id:v.version for v in bsp.info.lumps})
    save(out / 'collision-brushes.json', collision)
    report['brushCollision'] = {key:len(collision[key]) for key in ('planes','sides','brushes','models')}
    report['brushCollision'].update(contents=collision['contentHistogram'],
        worldBrushCount=len(collision['models'][0]['brushIds']), physicsDisplacementBytes=len(raw.get(28,b'')),
        physicsCollideBytes=len(raw.get(29,b'')), generatedRapierColliders=0)
    if 29 in raw:
        physics = physics_blocks(raw[29]); save(out/'collision-vphysics.json',physics)
        report['vphysics'] = dict(models=len(physics['models']), solids=sum(len(m['solids']) for m in physics['models']),
            convexLeaves=sum(len(s['convexLeaves']) for m in physics['models'] for s in m['solids']),
            triangles=sum(s['triangles'] for m in physics['models'] for s in m['solids']), boundedReaderPassed=True)
        if api.get('LUMP_PHYSICS',{}).get('status') == 'error':
            report['errors'] = [e for e in report['errors'] if e['layer'] != 'LUMP_PHYSICS']
            report['limitations'].append('SourceIO PhysicsLump wrapper asserts after first solid; bounded per-solid reader succeeds. Upstream code remains untouched; original API failure retained in sourceioLumpAPI.')
    if 40 in raw:
        pak = zipfile.ZipFile(io.BytesIO(raw[40]))
        pak_names = {canonical(info.filename):info for info in pak.infolist() if not info.is_dir()}
    else: pak = None; pak_names = {}
    save(out / 'pakfile-catalog.json', [dict(name=k,bytes=v.file_size,compressedBytes=v.compress_size,crc32=v.CRC) for k,v in sorted(pak_names.items())])
    report['embeddedPak'] = dict(files=len(pak_names), uncompressedBytes=sum(p.file_size for p in pak_names.values()),
                                extensions=dict(Counter(PurePosixPath(n).suffix for n in pak_names)))
    primary = [index for index in indexes if index.path.name == 'pak01_dir.vpk']
    def locate(resource):
        key = canonical(resource); candidates = []
        if key in pak_names: candidates.append(dict(provider='embedded-pak',bytes=pak_names[key].file_size,crc32=pak_names[key].CRC))
        loose = game / key
        if loose.is_file(): candidates.append(dict(provider='loose-csgo',bytes=loose.stat().st_size))
        for index in primary:
            if key in index.entries:
                entry = index.entries[key]; candidates.append(dict(provider=index.path.name,bytes=entry['length']+entry['preloadBytes'],crc32=entry['crc32']))
        return dict(path=key, found=bool(candidates), candidates=candidates)
    model_names = sorted(set([p['model'] for p in props] + [e['model'] for e in entities if str(e.get('model','')).lower().endswith('.mdl')]))
    dependencies = []
    for model in model_names:
        stem = canonical(model).removesuffix('.mdl')
        dependencies.append(dict(model=model, files=[locate(stem+suffix) for suffix in ('.mdl','.vvd','.dx90.vtx','.phy')],
                                 note='PHY may be absent for nonsolid props; this is direct model-file presence, not texture/animation dependency closure.'))
    strings = raw.get(43,b''); names = []
    for (offset,) in rows(raw.get(44,b''), '<i'):
        if offset < 0 or offset >= len(strings): raise ValueError('Texture string offset outside lump')
        end = strings.index(b'\0', offset); names.append(strings[offset:end].decode('latin1'))
    materials = [locate('materials/'+name.strip('/\\')+'.vmt') for name in names if name]
    save(out / 'direct-dependencies.json', dict(models=dependencies, worldMaterials=materials,
        resolver='Embedded BSP pak, loose csgo, main pak01 only; report all candidates. Locale/restricted VPK not enabled.',
        transitiveClosureComplete=False))
    report['dependencies'] = dict(models=len(dependencies), missingMDL=sum(not d['files'][0]['found'] for d in dependencies),
        missingVVD=sum(not d['files'][1]['found'] for d in dependencies), missingVTX=sum(not d['files'][2]['found'] for d in dependencies),
        missingPHY=sum(not d['files'][3]['found'] for d in dependencies), worldMaterials=len(materials),
        missingWorldVMT=sum(not d['found'] for d in materials), transitiveClosureComplete=False)
    by_model = {d['model']:d for d in dependencies}
    report['dependencies']['solidPropInstancesMissingPHY'] = sum(p['solid']==6 and not by_model[p['model']]['files'][3]['found'] for p in props)
    save(out/'solid-props-missing-phy.json', [dict(index=i, model=p['model'], origin=p['origin'], rotation=p['rotation'], solid=p['solid'])
                                          for i,p in enumerate(props) if p['solid']==6 and not by_model[p['model']]['files'][3]['found']])
    if primary:
        index = primary[0]
        sample = next((canonical(m) for m in model_names if canonical(m) in index.entries), next(iter(index.entries)))
        actual = VPKFile(TinyPath(index.path)).find_file(TinyPath(sample))
        expected = index.read(sample)
        if not isinstance(actual, bytes) or actual != expected: raise ValueError('Native VPK API did not return identical checked bytes')
        report['nativeVpkProof'] = dict(path=sample, returnType=type(actual).__name__, bytes=len(actual),
                                       sha256=hashlib.sha256(actual).hexdigest(), rawIndexCrcVerified=True)
    for extra in [game/'gameinfo.txt',game/'maps'/f'{name}.nav',game/'resource/overviews'/f'{name}.txt']:
        if extra.is_file():
            target = out/'sidecars'/extra.name; target.parent.mkdir(exist_ok=True)
            target.write_bytes(extra.read_bytes())
    after_stat = path.stat()
    if (before_stat.st_size,before_stat.st_mtime_ns)!=(after_stat.st_size,after_stat.st_mtime_ns): raise ValueError('Input changed during inventory')
    report['limitations'] += ['Map layers inventoried/extracted, no Blender scene or GLB created.',
        'Material shader/lightmap conversion, complete model VMT/VTF dependencies and prop PHY hull conversion remain.',
        'Entity I/O, moving/breakable props, triggers, skybox, PVS/nav semantics need explicit browser implementations.',
        'BSP units/axis are untouched; a calibrated common transform must be used for rendering and collision.']
    report['extractionComplete'] = not report['errors']; report['elapsedSeconds'] = time.perf_counter()-started
    save(out/'inventory.json',report)
    print('SOURCE_MAP_INVENTORY '+json.dumps({key:report[key] for key in ('map','bspVersion','entities','staticProps','brushCollision','dependencies','errors','elapsedSeconds')},default=serial))
    if report['errors']: raise RuntimeError('Some SourceIO layers failed; see inventory.json')

if __name__ == '__main__': main()
