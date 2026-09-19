"""Stage original control sounds in a new directory; frozen FP assets stay intact."""
from pathlib import Path
import importlib.util,json
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('command_audio_items',ROOT/'scripts/inventory-source-items.py')
items=importlib.util.module_from_spec(spec);spec.loader.exec_module(items)
context=items.initialize();sources=items.Sources()
catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text())
records=catalog['sourceFilesRead'];records={r['path']:r for r in records}if isinstance(records,list)else records
script='scripts/game_sounds_weapons.txt';assert items.digest(sources.read(script))==records[script]['sha256']
target=ROOT/'public/source/csgo-12426148/pistol-command-audio';target.mkdir(parents=True,exist_ok=True)
rows=[];proof=[]
for name,key in [('weapon.autosemiautoswitch','mode'),('default.clipempty_pistol','empty')]:
 event=catalog['soundEvents'][name];d=event['definition'];assert d['pitch']=='PITCH_NORM'and d['volume']=='1.0'and len(event['waves'])==1
 source=event['waves'][0]['file']['path'];data=sources.read(source);relative=source.removeprefix('sound/')
 file=target/relative;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data);assert file.read_bytes()==data
 row=dict(key='source_pistol_command_'+key,event=name,url='/source/csgo-12426148/pistol-command-audio/'+relative,bytes=len(data),sha256=items.digest(data),pitch=[100,100],volume=[1,1]);rows.append(row)
 proof.append(dict(**row,source=sources.reads[source],definition=d))
(ROOT/'game/source-pistol-command-audio.json').write_text(json.dumps(rows,indent=2)+'\n')
receipt=dict(status='staged-and-readback-verified',context=context,soundScript=sources.reads[script],records=proof,scope='Original WAV and script parameters. Empty sound dispatch remains gated on separate native command evidence.')
(target/'provenance.json').write_text(json.dumps(receipt,indent=2)+'\n')
(ROOT/'output/source-pistol-command-audio-stage.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(dict(records=len(rows),bytes=sum(r['bytes']for r in rows),sha256=items.digest((ROOT/'game/source-pistol-command-audio.json').read_bytes()))))
