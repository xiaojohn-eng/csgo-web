"""Original App740 M4A4 (item16, not item60 M4A1-S) + Dust2 IDF arms.
Delegates the frozen original importer through a checked process-local AST patch
which adds only the draw category/5th clip; no shared importer or addon edits.
"""
from pathlib import Path
import ast
import hashlib
import importlib.util
import io
import json
import shutil
import struct
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/m4a4'
OUT.mkdir(parents=True, exist_ok=True)
metadata_only = '--metadata-only' in sys.argv
sys.path.insert(0, str(ROOT / '.tools'))
import SourceIO
section_spec=importlib.util.spec_from_file_location('m4_sections',ROOT/'scripts/source-section-decoder.py')
section_module=importlib.util.module_from_spec(section_spec);section_spec.loader.exec_module(section_module)
section_observations=[]
section_module.install_source_section_decoder(section_observations)

if not metadata_only:
    original = ROOT / 'scripts/import-source-weapon.py'
    source = original.read_text()
    # Explicitly checked additions to the previously verified absolute clips.
    changes = [
        ('    if "idle" in name:\n', '    if "draw" in name or "deploy" in name:\n        return "draw"\n    if "idle" in name:\n'),
        ('for kind in ("idle", "fire", "reload", "inspect"):', 'for kind in ("idle", "fire", "reload", "inspect", "draw"):'),
        ('len(gltf.get("animations", [])) == 4', 'len(gltf.get("animations", [])) == 5'),
        ('    raw_find = cm.find_file\n', '    raw_find = cm.find_file\n    raw_check = cm.check\n    cm.check = lambda path: raw_check(TinyPath(str(path).replace(chr(92), "/").lower()))\n'),
        ('        path = TinyPath(path)\n', '        path = TinyPath(path)\n        if not path.is_absolute(): path = TinyPath(str(path).replace(chr(92), "/").lower())\n'),
    ]
    for token, replacement in changes:
        assert source.count(token) == 1, f'Frozen importer layout changed: {token}'
        source = source.replace(token, replacement)
    sys.argv = [*(sys.argv[:sys.argv.index('--')] if '--' in sys.argv else sys.argv), '--', '--confirmed-complete',
        '--model', 'models/weapons/v_rif_m4a1.mdl', '--arms-model', 'models/weapons/ct_arms_idf.mdl', '--export-glb', '--output-dir', str(OUT)]
    exec(compile(ast.parse(source), str(original), 'exec'), {'__file__': str(original), '__name__': '__main__'})

spec = importlib.util.spec_from_file_location('m4a4_items', ROOT / 'scripts/inventory-source-items.py')
items = importlib.util.module_from_spec(spec); spec.loader.exec_module(items)
context = items.initialize(); sources = items.Sources()
catalog = json.loads((ROOT / 'research/source-items-catalog.json').read_text())
definition = next(w for w in catalog['weapons'] if w['id'] == '16')
assert definition['name'] == 'weapon_m4a1' and definition['englishName'] == 'M4A4'
assert definition['resolvedDefinition']['attributes']['has silencer'] == '0'
assert definition['resolvedDefinition']['model_player'] == 'models/weapons/v_rif_m4a1.mdl'
assert definition['resolvedDefinition']['model_world'] == 'models/weapons/w_rif_m4a1.mdl'
source_items = sources.read('scripts/items/items_game.txt')
receipt = next(row for row in catalog['sourceFilesRead'] if row['path'] == 'scripts/items/items_game.txt') if isinstance(catalog['sourceFilesRead'], list) else catalog['sourceFilesRead']['scripts/items/items_game.txt']
assert items.digest(source_items) == receipt['sha256'], 'Original resolved item cache source changed'
audit = json.loads((OUT / 'audit.json').read_text())
assert audit['status'] == 'passed_source_and_blender_checks'
assert audit['selected_model'] == definition['resolvedDefinition']['model_player']

# Reuse only already decoded original IDF inputs; CRC/SHA-check MDL identity and
# every copied raw PNG. No T bare-arm textures enter this directory.
ct = ROOT / '.reference-assets/source-exports/ak47-ct-arms'
arms = json.loads((ct / 'ct-metadata.json').read_text())
assert items.digest(sources.read('models/weapons/ct_arms_idf.mdl')) == arms['source']['sha256']
for material in arms['materials'].values():
    dest = OUT / material['output']; dest.parent.mkdir(exist_ok=True)
    data = (ct / material['output']).read_bytes(); assert items.digest(data) == material['source']['sha256']; dest.write_bytes(data)
for texture in arms['textures'].values():
    data = (ct / texture['output']).read_bytes(); assert items.digest(data) == texture['pngSha256']; (OUT / texture['output']).write_bytes(data)

# Both original skins retain separately encoded source inverse bind exactly.
import numpy as np
glb_path = Path(audit['glb']['path']); payload = bytearray(glb_path.read_bytes()); size = struct.unpack_from('<I', payload, 12)[0]
doc = json.loads(payload[20:20+size]); ci = np.array([[1,0,0,0],[0,0,-1,0],[0,1,0,0],[0,0,0,1]], dtype=np.float64)
weapon_bones = {b['name']: {'inverseBind': np.vstack([np.asarray(b['pose_to_bone']).T, [0,0,0,1]]).tolist()} for b in audit['bones']}
arm_bones = {b['name']: b for b in arms['bones']}; bind_rows=[]
for skin in doc['skins']:
    bones = arm_bones if skin['name'] == audit['arms']['armature_name'] else weapon_bones
    assert len(skin['joints']) == len(bones)
    a = doc['accessors'][skin['inverseBindMatrices']]; v = doc['bufferViews'][a['bufferView']]
    assert a['componentType'] == 5126 and a['type'] == 'MAT4' and not v.get('byteStride')
    offset = 28 + size + v.get('byteOffset', 0) + a.get('byteOffset', 0); maximum=0
    for i, joint in enumerate(skin['joints']):
        expected = np.asarray(np.asarray(bones[doc['nodes'][joint]['name']]['inverseBind']) @ ci, dtype='<f4').flatten(order='F')
        old = np.frombuffer(payload, dtype='<f4', count=16, offset=offset+i*64).copy()
        maximum=max(maximum,float(np.abs(old-expected).max())); assert maximum<.01, 'Unexpected M4 bind coordinate layout'
        payload[offset+i*64:offset+(i+1)*64]=expected.tobytes()
    bind_rows.append({'name':skin['name'],'count':len(skin['joints']),'previousMaximumDifferenceSourceUnits':maximum,'finalFloat32Difference':0})
glb_path.write_bytes(payload); audit['glb']['sha256']=items.digest(payload); audit['exactInverseBind']=bind_rows
audit['sectionDecoder']=section_observations
(OUT/'audit.json').write_text(json.dumps(audit,indent=2,ensure_ascii=False)+'\n')

event_names = {definition['resolvedDefinition']['visuals']['sound_single_shot'].lower()}
for clip in audit['clip_checks'].values():
    for event in clip['events']:
        for value in event.values():
            if isinstance(value,str) and value.lower() in catalog['soundEvents']: event_names.add(value.lower())
events={};pending=list(sorted(event_names))
while pending:
    name=pending.pop()
    if name in events:continue
    event=catalog['soundEvents'][name];events[name]=event
    for _,value in items.walk(event['definition']):
        if isinstance(value,str) and value.lower() in catalog['soundEvents'] and value.lower() not in events:pending.append(value.lower())
sounds=[];written={}
for name,event in events.items():
    for entry in event['waves']:
        relative=entry['file']['path'];data=sources.read(relative);file='sounds/'+relative.removeprefix('sound/');dest=OUT/file;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data);assert dest.read_bytes()==data
        sound={'event':name,'file':file,'sourceWave':entry['sourceWave'],'source':sources.reads[relative],'sha256':items.digest(data),'bytes':len(data)}
        with wave.open(io.BytesIO(data),'rb')as audio:sound.update(channels=audio.getnchannels(),sampleRate=audio.getframerate(),sampleWidth=audio.getsampwidth(),frames=audio.getnframes(),duration=audio.getnframes()/audio.getframerate())
        sounds.append(sound);written[file]=sound
metadata={'context':context,'itemSource':sources.reads['scripts/items/items_game.txt'],'weapon':definition,'arms':arms,
    'sourceModels':audit['source_models'],'exactInverseBind':bind_rows,'glb':audit['glb'],'events':events,'sounds':sounds,
    'sourceImporterSHA256':items.digest((ROOT/'scripts/import-source-weapon.py').read_bytes()),
    'sourceImporterPatch':'adds draw/deploy categorization and exports exactly five simple absolute animations; no source file edits'}
(OUT/'m4a4-metadata.json').write_text(json.dumps(metadata,indent=2,ensure_ascii=False)+'\n')
print('M4A4_EXPORT',json.dumps({'sha256':audit['glb']['sha256'],'skins':audit['glb']['joints'],'clips':list(audit['clip_checks']),'sounds':len(written),'events':sorted(events)}))
