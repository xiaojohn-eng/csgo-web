"""Original Dust2 CT baseline; independent outputs, no T/runtime file changes."""
from pathlib import Path
from collections import deque
from dataclasses import asdict
import ast
import hashlib
import importlib.util
import json
import math
import re
import struct
import sys
import traceback
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/character-ct'
OUT.mkdir(parents=True, exist_ok=True)
REPORT = dict(status='running', dependencies={}, models=[], sequences=[])
def sha(v): return hashlib.sha256(v).hexdigest()
def serial(v):
    if hasattr(v, 'tolist'): return v.tolist()
    if hasattr(v, '__dataclass_fields__'): return asdict(v)
    if isinstance(v, Path): return str(v)
    raise TypeError(type(v).__name__)
def save(stage):
    REPORT['stage'] = stage
    (OUT / 'metadata-preflight.json').write_text(json.dumps(REPORT, indent=2, default=serial) + '\n')
    print('SOURCE_CT_STAGE', stage, flush=True)
def main():
    spec = importlib.util.spec_from_file_location('source_items_inventory', ROOT / 'scripts/inventory-source-items.py')
    inventory = importlib.util.module_from_spec(spec); spec.loader.exec_module(inventory); REPORT.update(inventory.initialize()); sources = inventory.Sources()
    # Reuse only the audited pure parsers; do not execute/write the T exporter.
    original = ROOT / 'scripts/import-source-character.py'; tree = ast.parse(original.read_text())
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('gamemode_blocks', 'raw_pose_parameters', 'raw_sequence_fields')]
    helpers = dict(re=re, math=math); exec(compile(ast.Module(body=functions, type_ignores=[]), str(original), 'exec'), helpers)
    modes_raw = sources.read('gamemodes.txt'); modes = inventory.json_kv(helpers['gamemode_blocks'](modes_raw))
    definition = modes['gamemodes.txt']['maps']['de_dust2']; variants = list(definition['ct_models']); selected = 'models/player/' + variants[0] + '.mdl'
    assert variants == ['ctm_idf', 'ctm_idf_variantb', 'ctm_idf_variantc', 'ctm_idf_variantd', 'ctm_idf_variante']
    REPORT.update(gamemodes=dict(sha256=sha(modes_raw), definition=definition), selectedModel=selected,
        variants=[sources.metadata('models/player/' + value + '.mdl') for value in variants])
    from SourceIO.library.shared.app_id import SteamAppId
    from SourceIO.library.shared.content_manager import ContentManager
    from SourceIO.library.shared.content_manager.providers.loose_files import LooseFilesContentProvider
    from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
    from SourceIO.library.utils import TinyPath
    from SourceIO.library.models.mdl.v49 import MdlV49
    from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc
    from SourceIO.library.source1.vmt import VMT
    cm = ContentManager(); cm.clean()
    providers = [LooseFilesContentProvider(TinyPath(inventory.GAME), SteamAppId.COUNTER_STRIKE_GO), VPKContentProvider(TinyPath(inventory.GAME / 'pak01_dir.vpk'), SteamAppId.COUNTER_STRIKE_GO)]
    for p in providers: cm.add_child(p)
    cm.priority_list = providers[:]; find_raw = cm.find_file; check_raw = cm.check
    cm.check = lambda path: check_raw(TinyPath(str(path).lower()))
    def find(path, do_not_cache=False):
        path = TinyPath(str(path).lower()); assert not path.is_absolute() and '..' not in str(path).split('/')
        result = find_raw(path, do_not_cache=do_not_cache)
        if result is not None and str(path) not in REPORT['dependencies']:
            position = result.tell(); result.seek(0); raw = result.read(); result.seek(position)
            REPORT['dependencies'][str(path)] = dict(bytes=len(raw), sha256=sha(raw))
        return result
    cm.find_file = find
    parsed = {}; buffers = {}; pending = deque([selected]); original_decode = StudioAnimDesc.read_animations
    # Metadata graph needs descriptors only. Do not eagerly decode every unrelated
    # animation/include in MdlV49.from_buffer; selected frame decode is separate.
    try:
        StudioAnimDesc.read_animations = lambda *args, **kwargs: None
        while pending:
            path = pending.popleft().lower()
            if path in parsed: continue
            assert len(parsed) < 64
            buffer = find(TinyPath(path))
            if buffer is None: REPORT.setdefault('missingIncludes', []).append(path); continue
            buffer.seek(0); mdl = MdlV49.from_buffer(buffer); parsed[path] = mdl; buffers[path] = buffer; pending.extend(mdl.include_models)
            descriptors = [dict(index=i, name=d.name, fps=d.fps, frames=d.frame_count, flags=int(d.flags), animblockId=d.animblock_id,
                delta=bool(int(d.flags)&4), seconds=(d.frame_count-1)/d.fps if d.fps else None) for i,d in enumerate(mdl.anim_descs)]
            REPORT['models'].append(dict(path=path, version=mdl.header.version, bones=len(mdl.bones), includes=mdl.include_models, animationBlock=mdl.header.anim_block_name,
                animations=descriptors, materials=[m.name for m in mdl.materials], materialPaths=mdl.materials_paths, poseParameters=helpers['raw_pose_parameters'](mdl,buffer),
                boneDefinitions=[dict(name=b.name,parent=b.parent_id,position=b.position,quaternion=b.quat,flags=int(b.flags),alignment=b.q_alignment,poseToBone=b.pose_to_bone) for b in mdl.bones]))
            for i, s in enumerate(mdl.sequences): REPORT['sequences'].append(dict(sourceModel=path,index=i,name=s.name,activityName=s.activity_name,flags=s.flags,
                animationIndices=s.anim_desc_indices,events=[asdict(e) for e in s.events],**helpers['raw_sequence_fields'](s,mdl,buffer)))
            save('metadata ' + path)
    finally: StudioAnimDesc.read_animations = original_decode
    primary = parsed[selected]; REPORT['materials'] = []
    for material in primary.materials:
        paths = [TinyPath('materials') / (material.name + '.vmt')] + [TinyPath('materials') / p / (material.name + '.vmt') for p in primary.materials_paths]
        path = next((p for p in paths if cm.check(p)), None); assert path is not None
        vmt = VMT(find(path), str(path), cm); parameters = {k: v for k, v in vmt.data.items() if isinstance(v, (str, int, float))}
        entry = dict(name=material.name, path=str(path), shader=vmt.shader, parameters=parameters, textures=[])
        for k,v in parameters.items():
            if isinstance(v,str) and ('texture' in k or k in ('$bumpmap','$detail','$envmapmask','$phongexponenttexture')):
                texture = 'materials/' + v.replace('\\','/').removesuffix('.vtf') + '.vtf'
                entry['textures'].append(dict(parameter=k, **sources.metadata(texture)))
        REPORT['materials'].append(entry)
    animations = [m for m in REPORT['models'] if 'ct_animations' in m['path']]
    assert animations, 'Original CT include graph does not contain ct_animations; inspect before proposing a replacement'
    main_names = {b.name: i for i,b in enumerate(primary.bones)}
    REPORT['ctAnimationModels'] = [m['path'] for m in animations]
    REPORT['boneMappings'] = []
    for m in animations:
        anim = parsed[m['path']]; names = {b.name:i for i,b in enumerate(anim.bones)}; common = main_names.keys() & names.keys()
        mismatch = [n for n in common if (primary.bones[primary.bones[main_names[n]].parent_id].name if primary.bones[main_names[n]].parent_id >= 0 else None) !=
            (anim.bones[anim.bones[names[n]].parent_id].name if anim.bones[names[n]].parent_id >= 0 else None)]
        REPORT['boneMappings'].append(dict(source=m['path'],shared=len(common),mainOnly=sorted(main_names.keys()-common),animationOnly=sorted(names.keys()-common),parentMismatches=mismatch))
    REPORT['status'] = 'passed_original_ct_metadata_preflight'; save('metadata complete')
    if '--sample-combat' in sys.argv:
        spec = importlib.util.spec_from_file_location('source_ct_animation', ROOT / 'scripts/source-ct-animation.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        module.sample_combat(primary, parsed, buffers, cm, REPORT, OUT)
        save('CT continuous frame sampling complete')
    if '--world-ak' in sys.argv:
        spec = importlib.util.spec_from_file_location('source_ct_world_ak', ROOT / 'scripts/import-source-ct-world-ak.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        module.export_world_ak(primary, parsed, buffers, cm, find, REPORT, ROOT)
        save('CT original world AK composite complete')
    return primary, parsed, buffers, cm, find
if __name__ == '__main__':
    try: main()
    except Exception: REPORT['status']='failed'; REPORT['error']=traceback.format_exc(); save('failed'); raise
