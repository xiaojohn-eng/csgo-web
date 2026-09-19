"""Private original Glock/USP-S FP candidates; each team in its own factory process.
No source plugin/shared importer/game/public edits. Preserve every FP sequence,
source FPS/event identity/bodygroup, two source skins and exact raw IBM bytes.
"""
from pathlib import Path
import argparse,ast,hashlib,importlib.util,io,json,struct,sys,wave
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--weapon',choices=['glock','usp'],required=True);parser.add_argument('--team',choices=['t','ct'],required=True)
options=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);weapon_id,team=options.weapon,options.team
inventory=json.loads((ROOT/'.reference-assets/source-exports/pistol-candidates/inventory.json').read_text());entry=next(w for w in inventory['weapons']if w['id']==('4'if weapon_id=='glock'else'61'));fp=next(m for m in entry['models']if m['role']=='model_player')
OUT=ROOT/f'.reference-assets/source-exports/pistol-candidates/{weapon_id}-{team}';OUT.mkdir(parents=True,exist_ok=True)
sequence_map=({'glock_idle':'idle','glock_firesingle':'fire','glock_firelast':'fire_last','glock_draw':'draw','glock_reload':'reload','lookat01':'inspect'}if weapon_id=='glock'else{'idle':'idle','attach':'attach','detach':'detach','shoot1':'fire_1','shoot2':'fire_2','shoot3':'fire_3','shoot_empty':'fire_empty','reload':'reload','draw':'draw_silenced','draw_silenced':'draw_unsilenced','lookat01':'inspect'})
assert set(sequence_map)=={s['name']for s in fp['sequences']}
assert all(len(s['animationIndices'])==1 and not s['autoLayers'] and s['descriptors'][0]['flags']==64 for s in fp['sequences'])
sys.path.insert(0,str(ROOT/'.tools'));import SourceIO
spec=importlib.util.spec_from_file_location('pistol_sections',ROOT/'scripts/source-section-decoder.py');section_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(section_module);section_observations=[];section_module.install_source_section_decoder(section_observations)
raw_frames={}
def save_original_frames(kind,original,frames,bones):
 raw_frames[kind]={'sequence':next(k for k,v in sequence_map.items()if v==kind),'fps':original.fps,'frames':original.frame_count,'boneNames':[b.name for b in bones],
  'positions':np.stack([frames[b.name]['pos']for b in bones],axis=1).tolist(),'quaternionsXYZW':np.stack([frames[b.name]['rot']for b in bones],axis=1).tolist()}
original=ROOT/'scripts/import-source-weapon.py';tree=ast.parse(original.read_text());category=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='category');tree.body[tree.body.index(category)]=ast.parse(f'def category(sequence):\n    return {sequence_map!r}.get(sequence.name)').body[0];source=ast.unparse(tree)
changes=[("for kind in ('idle', 'fire', 'reload', 'inspect'):",f'for kind in {tuple(sequence_map.values())!r}:'),("len(gltf.get('animations', [])) == 4",f"len(gltf.get('animations', [])) == {len(sequence_map)}"),
 ('    raw_find = cm.find_file\n','    raw_find = cm.find_file\n    raw_check = cm.check\n    cm.check = lambda path: raw_check(TinyPath(str(path).replace(chr(92), "/").lower()))\n'),
 ('        path = TinyPath(path)\n','        path = TinyPath(path)\n        if not path.is_absolute(): path = TinyPath(str(path).replace(chr(92), "/").lower())\n'),
 ('        for bone in armature.pose.bones:\n','        save_original_frames(kind, original, frames, primary.bones)\n        for bone in armature.pose.bones:\n')]
# The last token also occurs once later under the arms branch? Match checked text.
for token,value in changes:
 assert source.count(token)==1,(token,source.count(token));source=source.replace(token,value)
sys.argv=[sys.argv[0],'--background','--factory-startup','--','--confirmed-complete','--model',fp['path'],'--arms-model','models/weapons/'+('t_arms.mdl'if team=='t'else'ct_arms_idf.mdl'),'--export-glb','--output-dir',str(OUT)]
exec(compile(source,str(original),'exec'),{'__file__':str(original),'__name__':'__main__','save_original_frames':save_original_frames})
(OUT/'original-frames.json').write_text(json.dumps(raw_frames,separators=(',',':'))+'\n')
spec=importlib.util.spec_from_file_location('pistol_item_sources',ROOT/'scripts/inventory-source-items.py');items=importlib.util.module_from_spec(spec);spec.loader.exec_module(items);context=items.initialize();sources=items.Sources()
assert items.digest(sources.read(fp['path']))==fp['source']['sha256']
arm_dir=ROOT/('.reference-assets/source-exports/m4a4-t-arms'if team=='t'else'.reference-assets/source-exports/ak47-ct-arms');arms=json.loads((arm_dir/('t-metadata.json'if team=='t'else'ct-metadata.json')).read_text())
assert items.digest(sources.read('models/weapons/'+('t_arms.mdl'if team=='t'else'ct_arms_idf.mdl')))==arms['source']['sha256']
for m in arms['materials'].values():
 data=(arm_dir/m['output']).read_bytes();assert items.digest(data)==m['source']['sha256'];dest=OUT/m['output'];dest.parent.mkdir(exist_ok=True);dest.write_bytes(data)
for t in arms['textures'].values():
 data=(arm_dir/t['output']).read_bytes();assert items.digest(data)==t['pngSha256'];dest=OUT/t['output'];dest.parent.mkdir(exist_ok=True);dest.write_bytes(data)
audit=json.loads((OUT/'audit.json').read_text());path=Path(audit['glb']['path']);payload=bytearray(path.read_bytes());size=struct.unpack_from('<I',payload,12)[0];doc=json.loads(payload[20:20+size]);ci=np.array([[1,0,0,0],[0,0,-1,0],[0,1,0,0],[0,0,0,1]],dtype=np.float64);bind_rows=[]
for skin in doc['skins']:
 bones={b['name']:b for b in (arms['bones']if skin['name']==audit['arms']['armature_name']else fp['bones'])};assert len(skin['joints'])==len(bones)
 a=doc['accessors'][skin['inverseBindMatrices']];v=doc['bufferViews'][a['bufferView']];assert a['componentType']==5126 and a['type']=='MAT4'and not v.get('byteStride');offset=28+size+v.get('byteOffset',0)+a.get('byteOffset',0);maximum=0
 for i,n in enumerate(skin['joints']):
  expected=np.asarray(np.asarray(bones[doc['nodes'][n]['name']]['inverseBind'])@ci,dtype='<f4').flatten(order='F');old=np.frombuffer(payload,dtype='<f4',count=16,offset=offset+i*64).copy();maximum=max(maximum,float(np.abs(old-expected).max()));assert maximum<.01;payload[offset+i*64:offset+(i+1)*64]=expected.tobytes()
 bind_rows.append(dict(name=skin['name'],bones=len(skin['joints']),previousDifference=maximum,finalFloat32Difference=0))
path.write_bytes(payload);audit['glb']['sha256']=items.digest(payload);audit['exactInverseBind']=bind_rows;audit['sectionDecoder']=section_observations
catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text());event_names={v.lower()for k,v in entry['definition']['visuals'].items()if k.startswith('sound_')and v.lower()in catalog['soundEvents']}
for clip in audit['clip_checks'].values():
 for e in clip['events']:
  if e['options'].lower()in catalog['soundEvents']:event_names.add(e['options'].lower())
events={};pending=list(sorted(event_names))
while pending:
 name=pending.pop()
 if name in events:continue
 event=catalog['soundEvents'][name];events[name]=event
 for _,value in items.walk(event['definition']):
  if isinstance(value,str)and value.lower()in catalog['soundEvents']and value.lower()not in events:pending.append(value.lower())
sounds=[]
for name,event in events.items():
 for entry_sound in event['waves']:
  relative=entry_sound['file']['path'];data=sources.read(relative);file='sounds/'+relative.removeprefix('sound/');dest=OUT/file;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data);assert dest.read_bytes()==data
  sound=dict(event=name,file=file,sourceWave=entry_sound['sourceWave'],source=sources.reads[relative],sha256=items.digest(data),bytes=len(data))
  with wave.open(io.BytesIO(data),'rb')as wav:sound.update(channels=wav.getnchannels(),sampleRate=wav.getframerate(),sampleWidth=wav.getsampwidth(),frames=wav.getnframes(),duration=wav.getnframes()/wav.getframerate())
  sounds.append(sound)
metadata=dict(context=context,weaponId=weapon_id,item=entry,team=team,arms=arms,glb=audit['glb'],exactInverseBind=bind_rows,sequenceMap=sequence_map,bodyparts=fp['bodyparts'],events=events,sounds=sounds,
 limitations=['Private raw animation asset; no gameplay mode timer or activity-weight selection reconstructed','Silencer geometry exported, original named visibility events retained; GLB alone does not apply those events','No original client visual/material equivalence claim','All source units retained; two skins use rawSourceIBM * inverse(C)'])
(OUT/'audit.json').write_text(json.dumps(audit,indent=2,ensure_ascii=False)+'\n');(OUT/'metadata.json').write_text(json.dumps(metadata,indent=2,ensure_ascii=False)+'\n')
print('PISTOL_EXPORT',weapon_id,team,audit['glb']['sha256'],list(audit['clip_checks']),len(set(s['file']for s in sounds)))
