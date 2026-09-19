#!/usr/bin/env python3
"""Stage three original HE/C4 WAVs; verify the installed VPK directory and CRC."""
import hashlib
import importlib.util
import json
from pathlib import Path
import zlib

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / '.reference-assets/csgo-legacy/csgo'
spec = importlib.util.spec_from_file_location('source_items', ROOT / 'scripts/inventory-source-items.py')
items = importlib.util.module_from_spec(spec)
spec.loader.exec_module(items)
index, directory = items.directory_index(GAME / 'pak01_dir.vpk')
catalog = json.loads((ROOT / 'research/source-items-catalog.json').read_text())
read_files = catalog['sourceFilesRead']
if isinstance(read_files, list):
    read_files = {row['path']: row for row in read_files}

def read(record):
    actual = index[record['path']]
    for key in ('crc32', 'bytes', 'preloadBytes', 'archiveIndex', 'archiveOffset', 'archiveBytes'):
        assert actual[key] == record[key], (record['path'], key)
    assert actual['preloadBytes'] == 0 and actual['archiveIndex'] != 0x7fff
    with (GAME / f"pak01_{actual['archiveIndex']:03d}.vpk").open('rb') as archive:
        archive.seek(actual['archiveOffset'])
        data = archive.read(actual['archiveBytes'])
    assert len(data) == actual['bytes'] and f'{zlib.crc32(data):08x}' == actual['crc32']
    sha = hashlib.sha256(data).hexdigest()
    if 'sha256' in record:
        assert sha == record['sha256']
    return data, {**record, 'sha256': sha}

_, script = read(read_files['scripts/game_sounds_weapons.txt'])
target = ROOT / 'public/source/csgo-12426148/explosion-audio'
records, evidence = [], []
for event, kind in [('basegrenade.explode', 'he'), ('c4.explode', 'c4')]:
    definition = catalog['soundEvents'][event]
    props = definition['definition']
    def bounds(value, default):
        if value in (None, 'PITCH_NORM'):
            return [default, default]
        values = [float(v.strip()) for v in value.split(',')]
        return [values[0], values[-1]]
    for number, wave in enumerate(definition['waves']):
        data, source = read(wave['file'])
        relative = source['path'].removeprefix('sound/')
        dest = target / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        row = dict(key=f'source_explosion_{kind}_{number}', kind=kind, event=event,
            source=source['path'], url='/source/csgo-12426148/explosion-audio/' + relative,
            bytes=len(data), sha256=source['sha256'], pitch=bounds(props.get('pitch'), 100),
            volume=bounds(props.get('volume'), 1), soundlevel=props['soundlevel'])
        records.append(row)
        evidence.append(dict(record=row, originalWave=wave['sourceWave'], file=source, definition=props))
assert len(records) == 3
(ROOT / 'game/source-explosion-audio.json').write_text(json.dumps(records, indent=2) + '\n')
(ROOT / 'research/source-explosion-audio.json').write_text(json.dumps(dict(
    build=12426148, directory=directory, soundScript=script, records=evidence,
    limits=['Original HE distant crossfade, operator stacks, DSP and soundlevel attenuation are not reproduced.',
            'HE uses the existing browser positional audio; C4 SNDLVL_NONE remains non-positional.']), indent=2) + '\n')
print(json.dumps(dict(records=len(records), bytes=sum(row['bytes'] for row in records), soundScriptSHA=script['sha256'])))
