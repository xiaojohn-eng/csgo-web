"""Extract verified original AK events and preserve original rifle pitch/volume ranges.
Run with Blender Python for the existing SourceIO content-manager environment.
Does not claim to reproduce the original sound operator graph or room acoustics.
"""
from pathlib import Path
import importlib.util,json,sys,hashlib
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'.tools'))
spec=importlib.util.spec_from_file_location('rifle_audio_items',ROOT/'scripts/inventory-source-items.py')
items=importlib.util.module_from_spec(spec);spec.loader.exec_module(items);context=items.initialize();sources=items.Sources()
catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text());events=catalog['soundEvents']
records=catalog['sourceFilesRead'];records={r['path']:r for r in records}if isinstance(records,list)else records
sound_script='scripts/game_sounds_weapons.txt';raw=sources.read(sound_script);assert items.digest(raw)==records[sound_script]['sha256']
def bounds(value,default):
 if value in ['PITCH_NORM',None]:return [default,default]
 values=[float(v.strip())for v in str(value).split(',')];assert len(values)in[1,2]
 return [values[0],values[-1]]
def parameters(name):
 d=events[name]['definition'];return dict(pitch=bounds(d.get('pitch'),100),volume=bounds(d.get('volume'),1))
target=ROOT/'public/source/csgo-12426148/ak47-audio';target.mkdir(parents=True,exist_ok=True);ak=[];receipt=[]
for name,event in sorted(events.items()):
 if not name.startswith('weapon_ak47.'):continue
 suffix=name.split('.',1)[1];key={'single':'shot','singledistant':'distant'}.get(suffix,suffix)
 for index,w in enumerate(event['waves']):
  original=w['file']['path'];data=sources.read(original);relative=original.removeprefix('sound/');dest=target/relative;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data);assert dest.read_bytes()==data
  row=dict(key='source_ak47_'+key+(str(index)if index else''),event=name,url='/source/csgo-12426148/ak47-audio/'+relative,sha256=items.digest(data),bytes=len(data),**parameters(name));ak.append(row);receipt.append(dict(**row,source=sources.reads[original]))
assert len(ak)==9
(ROOT/'game/source-ak47-audio.json').write_text(json.dumps(ak,indent=2)+'\n')
path=ROOT/'game/source-m4a4-audio.json';m4=json.loads(path.read_text())
for row in m4:row.update(parameters(row['event']))
path.write_text(json.dumps(m4,indent=2)+'\n')
vm=json.loads((ROOT/'public/source/csgo-12426148/ak47-draw/provenance.json').read_text())
timeline={name:[dict(time=e['cycle']*clip['duration_seconds'],event=e['options'].lower())for e in clip['events']if e['event']==5004]for name,clip in vm['clips'].items()}
(ROOT/'game/source-ak47-sound-timeline.json').write_text(json.dumps(timeline,indent=2)+'\n')
proof=dict(context=context,soundScript=sources.reads[sound_script],ak=receipt,m4Parameters={r['event']:parameters(r['event'])for r in m4},limitations=['Original sound operator graph, room acoustics, distant crossfade and HRTF remain separate work.'])
(target/'provenance.json').write_text(json.dumps(proof,indent=2)+'\n');(ROOT/'output/source-rifle-audio-stage.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(dict(akEvents=len(ak),uniqueFiles=len({r['url']for r in ak}),m4Events=len(m4),sourceSha256=proof['soundScript']['sha256'])))
