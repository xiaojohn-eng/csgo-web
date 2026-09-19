"""Read original named AWP zoom and rifle-empty WAVs absent from FP clip events.
Run in Blender; leaves all geometry, frames and animation audits unchanged.
"""
from pathlib import Path
import importlib.util,io,json,wave
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('awp_sources',ROOT/'scripts/inventory-source-items.py')
items=importlib.util.module_from_spec(spec);spec.loader.exec_module(items);items.initialize();sources=items.Sources()
catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text())
names={name for name in catalog['soundEvents'] if name.startswith('weapon_awp.')}|{'default.clipempty_rifle'}
assert 'weapon_awp.zoom' in names
for team in ['t','ct']:
 folder=ROOT/f'.reference-assets/source-exports/awp-candidates/awp-{team}'
 metadata=json.loads((folder/'metadata.json').read_text());assert metadata['weaponId']=='awp'
 for name in sorted(names):
  event=catalog['soundEvents'][name];metadata['events'][name]=event
  for sound in event['waves']:
   relative=sound['file']['path'];raw=sources.read(relative);assert sources.reads[relative]['crc32']==sound['file']['crc32'] and len(raw)==sound['file']['bytes']
   file='sounds/'+relative.removeprefix('sound/');path=folder/file;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw);assert path.read_bytes()==raw
   row=dict(event=name,file=file,sourceWave=sound['sourceWave'],source=sources.reads[relative],sha256=items.digest(raw),bytes=len(raw))
   with wave.open(io.BytesIO(raw),'rb')as wav:row.update(channels=wav.getnchannels(),sampleRate=wav.getframerate(),sampleWidth=wav.getsampwidth(),frames=wav.getnframes(),duration=wav.getnframes()/wav.getframerate())
   metadata['sounds']=[r for r in metadata['sounds']if not(r['event']==name and r['file']==file)]+[row]
 metadata['sounds'].sort(key=lambda r:(r['event'],r['file']))
 (folder/'metadata.json').write_text(json.dumps(metadata,indent=2,ensure_ascii=False)+'\n')
 print('AWP_AUDIO_EXTENDED',team,len(metadata['sounds']),len(set(r['file']for r in metadata['sounds'])))
